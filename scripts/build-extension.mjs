import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const typescript = require("typescript");
const root = process.cwd();

/**
 * Strip module syntax so the sources can be concatenated into one scope and
 * loaded as a classic browser script.
 *
 * Both patterns must be able to span lines. A multi-line `import type { ... }
 * from "..."` or `export { ... } from "..."` is ordinary, readable TypeScript,
 * and stripping only its first line leaves the braces behind, which TypeScript
 * then transpiles into a CommonJS `exports.__esModule` marker that throws in a
 * content script. Requiring single-line imports throughout the grammar package
 * would be a rule nobody would remember, so the bundler handles both shapes.
 */
function stripImportsAndExports(source) {
  const withoutModuleSyntax = source
    .replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$/gmu, "")
    .replace(/^import\s+["'][^"']+["'];?[ \t]*$/gmu, "")
    .replace(/^export\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+["'][^"']+["'];?[ \t]*$/gmu, "")
    .replace(/^export\s+["'][^"']+["'];?[ \t]*$/gmu, "");
  return withoutModuleSyntax.replace(/^export\s+/gmu, "");
}

function transpile(source) {
  return typescript.transpileModule(stripImportsAndExports(source), {
    compilerOptions: {
      target: typescript.ScriptTarget.ES2022,
      module: typescript.ModuleKind.None,
      removeComments: false,
    },
  }).outputText;
}

/**
 * A multi-line re-export defeats the line-anchored regex in stripImportsAndExports:
 * only the leading `export ` is matched, the braces and `from "..."` survive, and
 * TypeScript transpiles the remainder into a CommonJS `exports.__esModule` marker
 * that throws in the browser because `exports` is undefined there. Fail at build
 * time instead of shipping a bundle that dies on load.
 */
function assertNoMultilineReExports(source, label) {
  const starts = source.match(/^export\s+(?:type\s+)?\{[ \t]*$/gmu);
  if (!starts || starts.length === 0) return;
  throw new Error(
    `${label} contains a multi-line re-export. The extension bundler strips re-exports with a ` +
    `line-anchored regex, so a multi-line "export { ... } from" leaves a dangling CommonJS ` +
    `reference in the generated browser bundle. Put each re-export on a single line.`,
  );
}

function wrapper(name, source, returnNames, prelude = "") {
  return `const ${name} = (() => {\n${prelude}\n${transpile(source)}\nreturn { ${returnNames.join(", ")} };\n})();\n`;
}

async function readModules(files) {
  const parts = [];
  for (const file of files) {
    const source = await readFile(resolve(root, file), "utf8");
    assertNoMultilineReExports(source, file);
    parts.push(source);
  }
  return parts.join("\n");
}

// The grammar package is split into focused modules that share one scope inside the
// extension bundle. Order matters: a module whose initialiser reads another module's
// consts must be concatenated after it.
const GRAMMAR_MODULES = [
  "packages/grammar/src/util.ts",
  "packages/grammar/src/preferences.ts",
  "packages/grammar/src/diagnostics.ts",
  "packages/grammar/src/lexicon.ts",
  "packages/grammar/src/parser.ts",
  "packages/grammar/src/issues.ts",
  "packages/grammar/src/markdown.ts",
  "packages/grammar/src/spelling.ts",
  "packages/grammar/src/grammar.ts",
  "packages/grammar/src/style.ts",
  "packages/grammar/src/structure.ts",
  "packages/grammar/src/outline.ts",
  "packages/grammar/src/explain.ts",
  "packages/grammar/src/prioritise.ts",
  "packages/grammar/src/statistics.ts",
  "packages/grammar/src/scoring.ts",
  "packages/grammar/src/index.ts",
];

// Every symbol the extension and the provider prelude reach for. The prelude
// destructures from this object, so an omitted name silently becomes undefined at
// runtime and shadows the in-scope function of the same name.
const GRAMMAR_EXPORTS = [
  "WORD_PATTERN",
  "analyzeDocument",
  "analyzeLocally",
  "analyzeLocallyIncremental",
  "categoryColors",
  "createAnalysisDiagnostics",
  "detectChangedRange",
  "getWritingStats",
  "inferTone",
  "mergeWritingIssues",
  "parseDocument",
  "prioritiseSuggestions",
  "classifyIssueKind",
  "ruleFamily",
  "SUGGESTION_DENSITY_CAPS",
  "scoreWriting",
  "suggestSpelling",
  // Document-level reasoning and goal-aware explanations, so the extension can
  // give the same whole-draft reading the web app does.
  "buildDocumentOutline",
  "summariseDocument",
  "buildExplanation",
  "explainRanking",
  "explainRelevance",
  "buildAction",
  "SUPPRESSION_REASONS",
  "describeSuppression",
];

const analysisSource = await readModules(["packages/analysis/src/index.ts"]);
const grammarSource = await readModules(GRAMMAR_MODULES);
const aiSource = await readModules(["packages/ai/src/index.ts"]);

// Belt and braces: the emitted bundles run as classic scripts in a content
// script and a service worker, where `exports` and `module` do not exist. Any
// CommonJS residue is a build defect, so refuse to write it.
for (const [label, source] of [["grammar", grammarSource], ["analysis", analysisSource], ["ai", aiSource]]) {
  if (/\b(?:Object\.defineProperty\(exports|exports\.__esModule|require\()/.test(transpile(source))) {
    throw new Error(`The ${label} bundle transpiled to CommonJS. The extension loads these as plain scripts; check for a multi-line re-export in the source modules.`);
  }
}

const analysis = wrapper("DraftwiseAnalysisModule", analysisSource, ["createAnalysisChunks", "expandRangeToContext", "mapChunkIssue", "mergeAnalysisIssues"]);

// Every name the bundle claims to export must actually be declared in the
// concatenated source. A name that is listed but never declared produces a
// bundle that loads fine and fails only when that specific feature is used.
const grammarBody = transpile(grammarSource);
const missing = GRAMMAR_EXPORTS.filter((name) => !new RegExp(`(?:function|const|let|var|class)\\s+${name}\\b`).test(grammarBody));
if (missing.length) {
  throw new Error(`The grammar bundle would export undefined names: ${missing.join(", ")}. Add each to packages/grammar/src or drop it from GRAMMAR_EXPORTS.`);
}

const grammarPrelude = `const { mergeAnalysisIssues } = DraftwiseAnalysisModule;\n`;
const grammar = wrapper("DraftwiseGrammarModule", grammarSource, GRAMMAR_EXPORTS, grammarPrelude);
const extensionDir = resolve(root, "extension");
await writeFile(resolve(extensionDir, "shared-analysis.js"), `(() => {\n${analysis}${grammar}globalThis.DraftwiseGrammar = DraftwiseGrammarModule;\n})();\n`, "utf8");

// Derive the provider prelude from the export list instead of restating it by
// hand. A name that is exported but not destructured here silently becomes
// `undefined` inside the provider wrapper and throws only when that code path
// runs, which is how "buildDocumentOutline is not defined" reached the extension.
const aiPrelude = `const { ${["createAnalysisChunks", "expandRangeToContext", "mapChunkIssue", "mergeAnalysisIssues"].join(", ")} } = DraftwiseAnalysisModule;\nconst { ${GRAMMAR_EXPORTS.join(", ")} } = DraftwiseGrammarModule;\n`;
const ai = wrapper("DraftwiseProviderModule", aiSource, ["analyzeWithProvider", "analyzeWithTriage", "triageChunks", "parseClassifierDecisions", "isChunkUnresolved", "buildClassifierExcerpt", "validateClassifierUrl", "ClassifierError", "ProviderError"], aiPrelude);
await writeFile(resolve(extensionDir, "shared-provider.js"), `(() => {\n${analysis}${grammar}${ai}globalThis.DraftwiseProvider = DraftwiseProviderModule;\n})();\n`, "utf8");

console.log("Draftwise extension bundles are up to date.");