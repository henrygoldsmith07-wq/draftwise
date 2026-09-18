import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const typescript = require("typescript");
const root = process.cwd();
const extensionDir = resolve(root, "extension");

function stripImportsAndExports(source) {
  return source
    .replace(/import[\s\S]*?from\s+["'][^"']+["'];?\s*/gu, "")
    .replace(/\bexport\s+(?=(?:const|function|class|interface|type))/gu, "");
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

const grammarSource = await readFile(resolve(root, "packages/grammar/src/index.ts"), "utf8");
const analysisSource = await readFile(resolve(root, "packages/analysis/src/index.ts"), "utf8");
const aiSource = await readFile(resolve(root, "packages/ai/src/index.ts"), "utf8");

const grammar = wrapper("DraftwiseGrammarModule", grammarSource, ["analyzeLocally", "getWritingStats"]);
await writeFile(resolve(extensionDir, "shared-analysis.js"), `(() => {\n${grammar}globalThis.DraftwiseGrammar = DraftwiseGrammarModule;\n})();\n`, "utf8");

const analysis = wrapper("DraftwiseAnalysisModule", analysisSource, ["createAnalysisChunks", "expandRangeToContext", "mapChunkIssue", "mergeAnalysisIssues"]);
const aiPrelude = `const { createAnalysisChunks, expandRangeToContext, mapChunkIssue, mergeAnalysisIssues } = DraftwiseAnalysisModule;\nconst { analyzeLocally, getWritingStats, inferTone, scoreWriting } = DraftwiseGrammarModule;\n`;
const ai = wrapper("DraftwiseProviderModule", aiSource, ["analyzeWithProvider", "ProviderError"], aiPrelude);
await writeFile(resolve(extensionDir, "shared-provider.js"), `(() => {\n${grammar}${analysis}${ai}globalThis.DraftwiseProvider = DraftwiseProviderModule;\n})();\n`, "utf8");

console.log("Draftwise extension bundles are up to date.");
