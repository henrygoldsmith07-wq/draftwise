import assert from "node:assert/strict";
import test from "node:test";
import {
  createAnalysisChunks,
  detectChangedRange,
  mapChunkIssue,
  mergeAnalysisIssues,
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
