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

test("opening a held-back finding does not displace another", () => {
  const before = stateFor();
  const ACTIONABLE = new Set(["density-cap", "repeated-pattern", "low-confidence-style", "register-budget"]);
  const base = before.suppressed.filter((entry) => ACTIONABLE.has(entry.reason));
  const target = base.find((entry) => entry.issue.original?.includes("tommorow"));
  assert.ok(target, "fixture should hold a spelling finding back by budget");

  const after = stateFor({ unhiddenIssueIds: [target.issue.id] });
  const beforeIds = new Set(before.displayed.map((issue) => issue.id));

  // Exactly one added, and nothing removed. A forced finding must not consume a
  // density slot: charging it against the tier budget evicted a finding the
  // writer never asked to hide, so the count stayed flat and opening one
  // appeared to do nothing at all.
  const added = after.displayed.filter((issue) => !beforeIds.has(issue.id));
  const removed = before.displayed.filter((issue) => !after.displayed.some((candidate) => candidate.id === issue.id));
  assert.equal(added.length, 1, `expected one added, got ${added.length}`);
  assert.equal(added[0].id, target.issue.id);
  assert.equal(removed.length, 0, "opening a finding must not hide a different one");
  assert.equal(after.displayed.length, before.displayed.length + 1);
});

test("opening many held-back findings cannot flood the review list", () => {
  // Forced findings bypass their tier budget by design, so without a ceiling on
  // the total a writer who opens every held-back finding dismantles the density
  // cap entirely — 40 opened findings took a 14-card list to 54. The ceiling
  // keeps "reach the rest" from becoming "show everything".
  const issues = analyzeLocally(longDraft, style, goals).issues;
  const base = buildSuggestionState({ issues, goals, style, dismissedKeys: [], text: longDraft });
  const ACTIONABLE = new Set(["density-cap", "repeated-pattern", "low-confidence-style", "register-budget"]);
  const actionable = base.suppressed.filter((entry) => ACTIONABLE.has(entry.reason));
  assert.ok(actionable.length > 20, "fixture should have plenty to open");

  const allIds = actionable.map((entry) => entry.issue.id);
  const after = buildSuggestionState({ issues, goals, style, dismissedKeys: [], text: longDraft, unhiddenIssueIds: allIds });

  // The list grew well past the default budget, so opening still works...
  assert.ok(after.displayed.length > base.displayed.length + 20, "opening findings should grow the list");
  // ...but it is bounded, and the overflow went back to held-back rather than
  // vanishing, so the writer is never told fewer findings exist than do.
  assert.ok(after.displayed.length <= 60, `list should stay bounded, got ${after.displayed.length}`);
  assert.ok(after.suppressed.length > 0, "overflow should return to the held-back list, not disappear");
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
