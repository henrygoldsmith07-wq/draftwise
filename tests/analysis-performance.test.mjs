import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { parseDocument } from "../packages/grammar/src/parser.ts";
import { findPunctuation } from "../packages/grammar/src/grammar.ts";
import { DEFAULT_GOALS, DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

const style = DEFAULT_STYLE_PREFERENCES;
const goals = DEFAULT_GOALS;

/**
 * Guards against the two whitespace-run regexes that were quadratic.
 *
 * `parseDocument` paired a greedy negated class with an alternation it could
 * not satisfy, so a long run of spaces was consumed and handed back one
 * character at a time, at every start position in the run. `findPunctuation`
 * had the same shape. Both sat on the keystroke path: a 16 KB whitespace
 * paragraph cost ~2s in analyzeLocally, and a 32 KB one cost ~3.7s.
 *
 * The budget is deliberately loose — it is there to catch a return to
 * quadratic behaviour, not to measure the constant factor.
 */
const BUDGET_MS = 1_000;

function elapsed(run) {
  const started = Date.now();
  run();
  return Date.now() - started;
}

test("a long run of spaces does not make sentence parsing quadratic", () => {
  const small = `Intro paragraph.\n\n${" ".repeat(4_000)}\n\nClosing paragraph here.`;
  const large = `Intro paragraph.\n\n${" ".repeat(64_000)}\n\nClosing paragraph here.`;
  // Warm up so the small case includes first-call compilation cost.
  elapsed(() => parseDocument(small));
  const smallMs = elapsed(() => parseDocument(small));
  const largeMs = elapsed(() => parseDocument(large));
  // 16x the input. Linear work grows roughly 16x; quadratic grows ~256x.
  assert.ok(largeMs < Math.max(BUDGET_MS, smallMs * 60), `parseDocument scaled badly: ${smallMs}ms -> ${largeMs}ms`);
});

test("a long run of newlines does not make punctuation scanning quadratic", () => {
  const small = `Intro paragraph.\n\n${"\n".repeat(4_000)}\n\nClosing paragraph here.`;
  const large = `Intro paragraph.\n\n${"\n".repeat(64_000)}\n\nClosing paragraph here.`;
  elapsed(() => findPunctuation(small, style));
  const smallMs = elapsed(() => findPunctuation(small, style));
  const largeMs = elapsed(() => findPunctuation(large, style));
  assert.ok(largeMs < Math.max(BUDGET_MS, smallMs * 60), `findPunctuation scaled badly: ${smallMs}ms -> ${largeMs}ms`);
});

test("a whitespace-heavy document stays responsive end to end", () => {
  const text = `Intro paragraph.\n\n${" ".repeat(32_000)}\n\nClosing paragraph here.`;
  const total = elapsed(() => analyzeLocally(text, style, goals));
  assert.ok(total < BUDGET_MS, `analyzeLocally took ${total}ms on a 32 KB whitespace paragraph`);
});

test("ordinary prose still parses into the same sentences", () => {
  // The lazy-pattern rewrite must not change what a normal document produces.
  const text = "First sentence here. Second one follows! Is this a third? Yes it is.";
  const parsed = parseDocument(text);
  assert.deepEqual(parsed.sentences.map((sentence) => sentence.text), [
    "First sentence here.",
    "Second one follows!",
    "Is this a third?",
    "Yes it is.",
  ]);
  const trailing = parseDocument("No terminator here");
  assert.deepEqual(trailing.sentences.map((sentence) => sentence.text), ["No terminator here"]);
});