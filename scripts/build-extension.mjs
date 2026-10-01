import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const typescript = require("typescript");
const root = process.cwd();

function stripImportsAndExports(source) {
  // Both patterns are anchored to line starts. An unanchored match can span from a
  // stray "import" inside a comment across module boundaries and swallow unrelated
  // source, including template literals.
  return source
    .replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$/gmu, "")
    .replace(/^import\s+["'][^"']+["'];?[ \t]*$/gmu, "")
    .replace(/^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+["'][^"']+["'];?[ \t]*$/gmu, "")
    .replace(/^export\s+/gmu, "");
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

function wrapper(name, source, returnNames, prelude = "") {
  return `const ${name} = (() => {\n${prelude}\n${transpile(source)}\nreturn { ${returnNames.join(", ")} };\n})();\n`;
}

async function readModules(files) {
  const parts = [];
  for (const file of files) {
    parts.push(await readFile(resolve(root, file), "utf8"));
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
  "packages/grammar/src/spelling.ts",
  "packages/grammar/src/grammar.ts",
  "packages/grammar/src/style.ts",
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
  "scoreWriting",
  "suggestSpelling",
];

const analysisSource = await readModules(["packages/analysis/src/index.ts"]);
const grammarSource = await readModules(GRAMMAR_MODULES);
const aiSource = await readModules(["packages/ai/src/index.ts"]);

const analysis = wrapper("DraftwiseAnalysisModule", analysisSource, ["createAnalysisChunks", "expandRangeToContext", "mapChunkIssue", "mergeAnalysisIssues"]);
const grammarPrelude = `const { mergeAnalysisIssues } = DraftwiseAnalysisModule;\n`;
const grammar = wrapper("DraftwiseGrammarModule", grammarSource, GRAMMAR_EXPORTS, grammarPrelude);
const extensionDir = resolve(root, "extension");
await writeFile(resolve(extensionDir, "shared-analysis.js"), `(() => {\n${analysis}${grammar}globalThis.DraftwiseGrammar = DraftwiseGrammarModule;\n})();\n`, "utf8");

const aiPrelude = `const { createAnalysisChunks, expandRangeToContext, mapChunkIssue, mergeAnalysisIssues } = DraftwiseAnalysisModule;\nconst { analyzeLocally, getWritingStats, inferTone, scoreWriting } = DraftwiseGrammarModule;\n`;
const ai = wrapper("DraftwiseProviderModule", aiSource, ["analyzeWithProvider", "analyzeWithTriage", "triageChunks", "parseClassifierDecisions", "isChunkUnresolved", "buildClassifierExcerpt", "validateClassifierUrl", "ClassifierError", "ProviderError"], aiPrelude);
await writeFile(resolve(extensionDir, "shared-provider.js"), `(() => {\n${analysis}${grammar}${ai}globalThis.DraftwiseProvider = DraftwiseProviderModule;\n})();\n`, "utf8");

console.log("Draftwise extension bundles are up to date.");