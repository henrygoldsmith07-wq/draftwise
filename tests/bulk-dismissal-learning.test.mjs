import test from "node:test";
import assert from "node:assert/strict";
import { recordDismissal, familyOf, DISMISSAL_LEARNING_THRESHOLD } from "../lib/writing-profile.ts";

// Bulk dismissal is a stronger signal than a single one. These tests pin that
// dismissing a set of findings teaches the Writing Profile exactly as many times
// as there are findings, so a writer who dismisses thirty at once gets the same
// "show fewer of this" behaviour as one who dismisses them one by one.
const issueFor = (ruleId, title) => ({ ruleId, title, id: `${ruleId}-x`, start: 0, end: 1, original: "a", replacement: "b", category: "spelling", severity: "low", confidence: 1, explanation: "", source: "local" });

const baseStyle = { dialect: "en-GB", voice: "neutral", formality: "neutral", dismissalCounts: {}, adjustments: [] };

test("repeated dismissal of one family reaches the learning threshold", () => {
  // The same finding, dismissed DISMISSAL_LEARNING_THRESHOLD times.
  let style = baseStyle;
  const family = familyOf(issueFor("spelling-lexicon", "Spelling"));
  for (let i = 0; i < DISMISSAL_LEARNING_THRESHOLD; i += 1) {
    style = recordDismissal(style, issueFor("spelling-lexicon", "Spelling"));
  }
  assert.equal(style.dismissalCounts[family], DISMISSAL_LEARNING_THRESHOLD);
  // The profile must now be telling the writer what it learned.
  const learned = (style.learned ?? []).filter((entry) => entry.kind === "dismissal-pattern");
  assert.equal(learned.length, 1, "the family should be dampened after enough dismissals");
  assert.equal(learned[0].family, family);
});

test("bulk dismissal counts every finding, not once for the batch", () => {
  // dismissGroup maps recordDismissal across the whole set. Dismissing N
  // findings must increment N times — the earlier version did not call it at
  // all, so a bulk dismissal taught the profile nothing.
  let style = baseStyle;
  const group = Array.from({ length: DISMISSAL_LEARNING_THRESHOLD }, () => issueFor("spelling-lexicon", "Spelling"));
  for (const entry of group) style = recordDismissal(style, entry);

  const family = familyOf(issueFor("spelling-lexicon", "Spelling"));
  assert.equal(style.dismissalCounts[family], DISMISSAL_LEARNING_THRESHOLD);
  assert.equal((style.learned ?? []).filter((entry) => entry.kind === "dismissal-pattern").length, 1);
});

test("bulk dismissal across different families tracks each separately", () => {
  let style = baseStyle;
  const mixed = [
    issueFor("spelling-lexicon", "Spelling"),
    issueFor("grammar-article", "Article"),
    issueFor("clarity-wordy", "Wordy"),
    issueFor("spelling-lexicon", "Spelling"),
  ];
  for (const entry of mixed) style = recordDismissal(style, entry);

  assert.equal(style.dismissalCounts[familyOf(mixed[0])], 2, "the repeated family counts both");
  assert.equal(style.dismissalCounts[familyOf(mixed[1])], 1);
  assert.equal(style.dismissalCounts[familyOf(mixed[2])], 1);
  // Nothing crosses the threshold here, so nothing is learned yet.
  assert.equal((style.learned ?? []).filter((entry) => entry.kind === "dismissal-pattern").length, 0);
});

test("a single bulk dismissal does not create one adjustment per finding", () => {
  // The adjustment must be idempotent per family: dismissing twenty times in a
  // row should not append twenty "you dismissed this" notes.
  let style = baseStyle;
  for (let i = 0; i < DISMISSAL_LEARNING_THRESHOLD * 3; i += 1) {
    style = recordDismissal(style, issueFor("spelling-lexicon", "Spelling"));
  }
  assert.equal((style.learned ?? []).filter((entry) => entry.kind === "dismissal-pattern").length, 1);
});

test("dismissing an empty batch changes nothing", () => {
  let style = baseStyle;
  for (const _entry of []) style = recordDismissal(style, _entry);
  assert.deepEqual(style, baseStyle);
});
