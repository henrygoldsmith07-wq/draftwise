import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnalysisChunks,
  detectChangedRange,
  getIncrementalAnalysisRanges,
  mapChunkIssue,
  mergeAnalysisIssues,
  retainUnaffectedIssues,
} from "../packages/analysis/src/index.ts";

test("changed ranges stay bounded and preserve the previous end offset", () => {
  const changed = detectChangedRange("before stable tail", "before changed stable tail");
  assert.deepEqual(changed, { start: 7, end: 15, previousEnd: 7 });
});

test("long documents are chunked without dropping the edited region", () => {
  const text = `${"word ".repeat(2_000)}edited ${"tail ".repeat(2_000)}`;
  const changed = detectChangedRange(text, text.replace("edited", "corrected"));
  assert.ok(changed);
  const chunks = createAnalysisChunks(text, { maxChars: 700, contextWindow: 48, startOffset: changed.start - 48, endOffset: changed.end + 48 });
  assert.ok(chunks.length >= 1);
  assert.ok(chunks.some((chunk) => chunk.contentStartOffset <= changed.start && chunk.contentEndOffset >= changed.end));
  assert.equal(chunks.at(-1)?.endOffset, changed.end + 48);
});

test("provider issue offsets map back to the original long document", () => {
  const text = `${"prefix ".repeat(200)}repeatd ${"suffix ".repeat(200)}`;
  const target = text.indexOf("repeatd");
  const chunk = createAnalysisChunks(text, { maxChars: 500, contextWindow: 32 }).find((item) => item.startOffset <= target && item.endOffset >= target + 7);
  assert.ok(chunk);
  const issue = {
    id: "ai-local",
    ruleId: "spelling-common-typo",
    start: target - chunk.startOffset,
    end: target - chunk.startOffset + 7,
    original: "repeatd",
    replacement: "repeated",
    category: "spelling",
    severity: "high",
    confidence: 0.99,
    title: "Spelling",
    explanation: "Use the standard spelling.",
    source: "ai",
  };
  const mapped = mapChunkIssue(issue, chunk, text);
  assert.equal(mapped?.start, target);
  assert.equal(mapped?.end, target + 7);
  assert.equal(text.slice(mapped.start, mapped.end), "repeatd");
});

test("overlapping issues keep the higher-confidence candidate", () => {
  const base = {
    ruleId: "test",
    chunkId: "chunk-1",
    start: 10,
    end: 15,
    original: "words",
    replacement: "word",
    category: "conciseness",
    severity: "low",
    title: "Tighten",
    explanation: "Use fewer words.",
    source: "ai",
  };
  const merged = mergeAnalysisIssues([
    { ...base, id: "low", confidence: 0.4 },
    { ...base, id: "high", confidence: 0.95, severity: "medium", replacement: "wording" },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "high");
});

test("issue merging compares the overlapping interval set and preserves disjoint issues", () => {
  const issue = (id, start, end, severity, confidence) => ({
    id,
    ruleId: "test",
    start,
    end,
    original: "x".repeat(end - start),
    replacement: "y",
    category: "clarity",
    severity,
    confidence,
    title: id,
    explanation: "",
    source: "ai",
  });
  const merged = mergeAnalysisIssues([
    issue("disjoint-high", 0, 3, "high", 0.99),
    issue("overlapped-low", 10, 20, "low", 0.4),
    issue("replacement", 12, 18, "medium", 0.9),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["disjoint-high", "replacement"]);
});

test("incremental issue retention shifts unaffected ranges and discards the edited context", () => {
  const previous = "Before stays. repeatd here. After stays.";
  const next = "Before stays. repeated here. After stays.";
  const changed = detectChangedRange(previous, next);
  const ranges = getIncrementalAnalysisRanges(previous, next, changed, 4);
  const retained = retainUnaffectedIssues([
    { id: "before", ruleId: "test", start: 0, end: 6, original: "Before", replacement: "Before", category: "style", severity: "low", confidence: 0.9, title: "Before", explanation: "", source: "local" },
    { id: "edited", ruleId: "test", start: previous.indexOf("repeatd"), end: previous.indexOf("repeatd") + 7, original: "repeatd", replacement: "repeated", category: "spelling", severity: "high", confidence: 0.9, title: "Edited", explanation: "", source: "local" },
    { id: "after", ruleId: "test", start: previous.indexOf("After"), end: previous.indexOf("After") + 5, original: "After", replacement: "After", category: "style", severity: "low", confidence: 0.9, title: "After", explanation: "", source: "local" },
  ], ranges, next);
  assert.deepEqual(retained.map((issue) => issue.id), ["before", "after"]);
  assert.equal(next.slice(retained[1].start, retained[1].end), "After");
});

test("issue merging stays deterministic for thousands of candidates", () => {
  const issues = Array.from({ length: 2_000 }, (_, index) => ({
    id: `issue-${index}`,
    ruleId: "stress",
    start: index * 4,
    end: index * 4 + 2,
    original: "aa",
    replacement: "bb",
    category: "clarity",
    severity: index % 11 === 0 ? "high" : "low",
    confidence: index % 11 === 0 ? 0.95 : 0.4,
    title: "Stress",
    explanation: "",
    source: "ai",
  }));
  const start = performance.now();
  const merged = mergeAnalysisIssues(issues);
  const elapsed = performance.now() - start;
  assert.equal(merged.length, issues.length);
  assert.ok(elapsed < 1_500, `merge took ${elapsed.toFixed(1)}ms`);
});
