import { analyzeLocally } from "../packages/grammar/src/index.ts";

const sizes = [1_000, 5_000, 20_000];
for (const size of sizes) {
  const text = Array.from({ length: size }, (_, index) => index % 97 === 0 ? "repeatd" : "writing").join(" ") + ".";
  const start = performance.now();
  const result = analyzeLocally(text);
  const elapsedMs = performance.now() - start;
  console.log(JSON.stringify({ words: result.stats.words, issues: result.issues.length, elapsedMs: Number(elapsedMs.toFixed(2)) }));
}
