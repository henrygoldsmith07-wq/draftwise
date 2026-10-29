import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { getWritingStats, inferTone } from "../packages/grammar/src/statistics.ts";
import { DEFAULT_GOALS, DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

const style = DEFAULT_STYLE_PREFERENCES;
const goals = DEFAULT_GOALS;

/**
 * Guards on the shared-draft work in the stats pass, in the same spirit as the
 * whitespace and spelling guards in analysis-performance: correctness first,
 * then a deliberately loose scaling budget that catches a return to per-word
 * array scans or repeated partitioning, not a timing assertion.
 */
const BUDGET_MS = 1_000;

const elapsed = (run) => {
  const started = Date.now();
  run();
  return Date.now() - started;
};

test("the word-frequency partition keeps every frequency table correct", () => {
  // The partition must hand each word to exactly the tables the three filters
  // used to build: non-common words to repeatedWords, common words to
  // commonWords, filler words to both the count and their own table.
  const text = "The results were clear and the results were really quite basic, but really the plan was simply basic too.";
  const stats = getWritingStats(text);
  assert.ok(stats.repeatedWords.some((item) => item.value === "results" && item.count === 2), "content-word repetition is still counted");
  assert.ok(!stats.repeatedWords.some((item) => ["the", "were", "was", "but", "and"].includes(item.value)), "common words stay out of repeatedWords");
  assert.ok(stats.commonWords.some((item) => item.value === "the" && item.count === 3), "common-word frequencies survive");
  assert.ok(!stats.commonWords.some((item) => item.value === "results"), "content words stay out of commonWords");
  assert.equal(stats.fillerWords, 3, "really twice plus simply once are counted as filler");
  assert.ok(stats.fillerWordFrequency.some((item) => item.value === "really" && item.count === 2), "repeated fillers make the frequency table");
  assert.deepEqual(stats.repeatedPhrases, [
    { value: "results were", count: 2 },
    { value: "the results", count: 2 },
  ], "content-anchored bigram repetition is still reported");
});

test("tone inference keeps its labels and priority on the single-pass counts", () => {
  // Confident outweighing cautious must still yield "confident", the "we/you"
  // direct address must still read as direct, and a flat draft stays neutral.
  const confident = inferTone("We can deliver strong work. We will prove it. We can decide.");
  assert.ok(confident.includes("confident"), `expected confident, got ${confident.join(", ")}`);
  assert.ok(confident.includes("direct"));
  const cautious = inferTone("We might perhaps succeed. It could possibly fail, and it is uncertain, we think.");
  assert.ok(!cautious.includes("confident"), "a cautious draft must not read as confident");
  assert.ok(cautious.includes("thoughtful"));
  assert.ok(cautious.includes("direct"), "we/you still count as direct address");
  assert.deepEqual(inferTone("Plain sentences carry no signals here."), ["neutral"]);
  assert.deepEqual(inferTone(""), ["neutral"]);
});

test("a book-length draft does not make the stats pass quadratic", () => {
  const sentence = "The committee will perhaps reconsider the proposal, and the results were clear enough. ";
  const small = sentence.repeat(3_750);
  const large = sentence.repeat(15_000);
  elapsed(() => analyzeLocally(small, style, goals));
  const smallMs = elapsed(() => analyzeLocally(small, style, goals));
  const largeMs = elapsed(() => analyzeLocally(large, style, goals));
  // 4x the words: linear work grows roughly 4x, quadratic work ~16x.
  assert.ok(largeMs < Math.max(BUDGET_MS, smallMs * 10), `the stats pass scaled badly: ${smallMs}ms -> ${largeMs}ms`);
});
