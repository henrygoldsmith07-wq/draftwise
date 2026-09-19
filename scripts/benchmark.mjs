import { analyzeLocally, analyzeLocallyIncremental, detectChangedRange, mergeWritingIssues } from "../packages/grammar/src/index.ts";

const sizes = [1_000, 5_000, 10_000, 20_000, 50_000];
const vocabulary = ["writing", "editor", "draft", "reader", "sentence", "clarity", "local", "suggestion", "review", "document", "interface", "message", "project", "answer", "result"];

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))] ?? 0;
}

function summarise(values) {
  return { medianMs: Number(percentile(values, 0.5).toFixed(2)), p95Ms: Number(percentile(values, 0.95).toFixed(2)) };
}

function sample(operation, count) {
  operation();
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    operation();
    values.push(performance.now() - start);
  }
  return values;
}

function mergeFixture(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `benchmark-${index}`,
    start: index * 3,
    end: index * 3 + (index % 11 === 0 ? 8 : 4),
    original: "word",
    replacement: "term",
    category: "word choice",
    severity: index % 17 === 0 ? "medium" : "low",
    confidence: 0.7 + (index % 20) / 100,
    title: "Benchmark issue",
    explanation: "Benchmark candidate.",
    source: "local",
  }));
}

for (const size of sizes) {
  const text = Array.from({ length: size }, (_, index) => index % 97 === 0 ? "repeatd" : vocabulary[index % vocabulary.length]).join(" ") + ".";
  const fullMemoryBefore = process.memoryUsage();
  const initial = analyzeLocally(text);
  const fullMemoryAfter = process.memoryUsage();
  const nextText = `${text.slice(0, Math.floor(text.length / 2))}x${text.slice(Math.floor(text.length / 2))}`;
  const changed = detectChangedRange(text, nextText);
  const repeats = size >= 50_000 ? 3 : 5;
  const full = sample(() => analyzeLocally(text), repeats);
  const incremental = sample(() => analyzeLocallyIncremental(text, nextText, initial.issues, changed), repeats);
  const candidates = mergeFixture(Math.min(5_000, Math.max(500, Math.floor(size / 10))));
  const merge = sample(() => mergeWritingIssues(candidates), repeats);
  const heapDeltaMb = Math.max(0, (fullMemoryAfter.heapUsed - fullMemoryBefore.heapUsed) / 1024 / 1024);
  console.log(JSON.stringify({
    words: initial.stats.words,
    issues: initial.issues.length,
    mergeCandidates: candidates.length,
    full: summarise(full),
    incremental: summarise(incremental),
    issueMerge: summarise(merge),
    heapDeltaMb: Number(heapDeltaMb.toFixed(2)),
    rssMb: Number((fullMemoryAfter.rss / 1024 / 1024).toFixed(1)),
    repeats,
  }));
}
