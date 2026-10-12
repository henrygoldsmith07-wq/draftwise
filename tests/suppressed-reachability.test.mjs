import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { buildSuggestionState } from "../lib/suggestions.ts";

// Density caps hold findings back by design. These tests pin the override that
// makes the cap inspectable: a finding the writer opens out of the held-back
// list comes back, and nothing else changes.
const MISSES = [
  "seperate", "occured", "definately", "accomodate", "untill", "wich",
  "teh", "adress", "arguement", "becuase", "calender", "embarass", "foriegn",
  "goverment", "independant", "occassion", "priviledge", "publically",
  "refered", "tommorow",
];

// Every block carries a distinct misspelling so nothing groups together and the
// caps are reached on genuinely separate findings.
const longDraft = MISSES.map((word, index) => (
  `Section ${index + 1} of the plan. The manager ${word} the update on Thursday. We reviewed the figures twice.\n\n`
)).join("");

const goals = { register: "formal", tone: "neutral", audience: "professional", intent: "inform", readability: "standard" };
const style = { dialect: "en-GB", voice: "neutral", formality: "neutral" };

const stateFor = (extra) => {
  const issues = analyzeLocally(longDraft, style, goals).issues;
  return buildSuggestionState({ issues, goals, style, dismissedKeys: [], text: longDraft, ...extra });
};

test("the fixture actually exercises the density cap", () => {
  const state = stateFor();
  assert.ok(state.report.suppressedCount > 0, "fixture should hold findings back");
});

test("a held-back finding returns to the list when the writer opens it", () => {
  const before = stateFor();
  const target = before.suppressed[0];

  const after = stateFor({ unhiddenIssueIds: [target.issue.id] });
  const restored = after.displayed.find((issue) => issue.id === target.issue.id);

  assert.ok(restored, "the opened finding should be displayed again");
  // It comes back as a fully classified PrioritisedIssue: the tier the writer
  // filters by must be real, because an earlier version restored the raw
  // suppressed record and produced `tier: undefined`, which put the finding
  // outside every tier filter and made the whole list collapse to nothing.
  assert.ok(restored.tier, "the restored finding must carry a real tier");
  assert.ok(restored.rank !== undefined, "the restored finding must carry a rank");
  assert.equal(restored.start, target.issue.start);
  assert.equal(restored.end, target.issue.end);
  // The passage is re-derived from the current text, so it describes the
  // sentence the finding is actually in rather than a stale window.
  assert.ok(restored.context?.includes("Thursday"), "the restored finding carries a fresh passage");
});

test("opening one finding leaves every other finding suppressed", () => {
  const before = stateFor();
  const target = before.suppressed[0];

  const after = stateFor({ unhiddenIssueIds: [target.issue.id] });

  // Exactly one more displayed, and the restored one is no longer double-counted
  // as suppressed. The cap still applies to everything else.
  assert.equal(after.displayed.length, before.displayed.length + 1);
  assert.equal(after.suppressed.filter((entry) => entry.issue.id === target.issue.id).length, 0);
});

test("an unknown or stale id changes nothing", () => {
  const before = stateFor();
  const after = stateFor({ unhiddenIssueIds: ["no-such-issue-id"] });
  assert.equal(after.displayed.length, before.displayed.length);
  assert.equal(after.suppressed.length, before.suppressed.length);
});

test("omitting the argument behaves exactly as before", () => {
  const withNone = stateFor();
  const withEmpty = stateFor({ unhiddenIssueIds: [] });
  assert.equal(withNone.displayed.length, withEmpty.displayed.length);
  assert.equal(withNone.report.suppressedCount, withEmpty.report.suppressedCount);
});
