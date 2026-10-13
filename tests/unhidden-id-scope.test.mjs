import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { buildSuggestionState } from "../lib/suggestions.ts";

// Issue ids embed offsets, so an id computed against one document is only
// meaningful there. These tests pin what a stale id does when it meets different
// text — which is what happens when a writer opens a held-back finding, then
// switches, creates, clears or imports a document.
const MISSES = [
  "seperate", "occured", "definately", "accomodate", "untill", "wich",
  "teh", "adress", "arguement", "becuase", "calender", "embarass", "foriegn",
  "goverment", "independant", "occassion", "priviledge", "publically",
  "refered", "tommorow",
];

const goals = { register: "formal", tone: "neutral", audience: "professional", intent: "inform", readability: "standard" };
const style = { dialect: "en-GB", voice: "neutral", formality: "neutral" };

const draftWith = (words) => words.map((word, index) => (
  `Section ${index + 1} of the plan. The manager ${word} the update on Thursday. We reviewed the figures twice.\n\n`
)).join("");

const stateFor = (text, extra) => {
  const issues = analyzeLocally(text, style, goals).issues;
  return buildSuggestionState({ issues, goals, style, dismissedKeys: [], text, ...extra });
};

const firstDraft = draftWith(MISSES.slice(0, 12));

test("an id from one draft is inert against a different draft", () => {
  // The failure this guards: a stale id force-shows a finding in a document the
  // writer never opened anything in, because the id happens to collide with a
  // different finding at the same offset.
  const first = stateFor(firstDraft);
  const staleId = first.suppressed[0].issue.id;

  const otherDraft = "A short unrelated note about invoices and deadlines. Nothing similar here at all.";
  const other = stateFor(otherDraft);
  const withStale = stateFor(otherDraft, { unhiddenIssueIds: [staleId] });

  assert.equal(withStale.displayed.length, other.displayed.length,
    "an id from another document must not force anything into the list");
});

test("a stale id does not inflate a longer draft either", () => {
  const first = stateFor(firstDraft);
  const staleIds = first.suppressed.slice(0, 8).map((entry) => entry.issue.id);

  const secondDraft = draftWith(MISSES.slice(8, 20));
  const before = stateFor(secondDraft);
  const after = stateFor(secondDraft, { unhiddenIssueIds: staleIds });

  // None of the first draft's ids exist in the second, so the two must agree.
  const idsInSecond = new Set(before.displayed.map((issue) => issue.id));
  const forced = after.displayed.filter((issue) => !idsInSecond.has(issue.id));
  assert.equal(forced.length, 0, "no finding from the previous document should reappear");
});

test("an id is honoured within its own draft", () => {
  // The override must still work for the document it was computed against,
  // otherwise the fix would simply disable the feature.
  const base = stateFor(firstDraft);
  const target = base.suppressed[0];
  const after = stateFor(firstDraft, { unhiddenIssueIds: [target.issue.id] });
  assert.equal(after.displayed.length, base.displayed.length + 1);
  assert.ok(after.displayed.some((issue) => issue.id === target.issue.id));
});

test("the same text at the same offset does share an id", () => {
  // Honest statement of the residual risk: ids are offset-derived, not
  // document-scoped. Two drafts containing identical text at identical offsets
  // will share a key. Clearing the override on document change is what makes
  // this unreachable in the app; this pins the underlying property.
  const a = stateFor(firstDraft);
  const b = stateFor(firstDraft);
  assert.equal(a.suppressed[0].issue.id, b.suppressed[0].issue.id);
});
