import { analyzeLocally, analyzeLocallyIncremental, detectChangedRange } from "../packages/grammar/src/index.ts";

const sizes = [1_000, 5_000, 10_000, 20_000];
const vocabulary = ["writing", "editor", "draft", "reader", "sentence", "clarity", "local", "suggestion", "review", "document"];

for (const size of sizes) {
  const text = Array.from({ length: size }, (_, index) => index % 97 === 0 ? "repeatd" : vocabulary[index % vocabulary.length]).join(" ") + ".";
  const start = performance.now();
  const result = analyzeLocally(text);
  const fullMs = performance.now() - start;
  const nextText = `${text.slice(0, Math.floor(text.length / 2))}x${text.slice(Math.floor(text.length / 2))}`;
  const changed = detectChangedRange(text, nextText);
  const incrementalStart = performance.now();
  const incremental = analyzeLocallyIncremental(text, nextText, result.issues, changed);
  const incrementalMs = performance.now() - incrementalStart;
  console.log(JSON.stringify({ words: result.stats.words, issues: result.issues.length, fullMs: Number(fullMs.toFixed(2)), incrementalMs: Number(incrementalMs.toFixed(2)), incrementalIssues: incremental.issues.length }));
}
