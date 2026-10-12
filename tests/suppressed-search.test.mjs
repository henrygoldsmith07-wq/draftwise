import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { buildSuggestionState } from "../lib/suggestions.ts";

// The held-back list is a route into the draft. These tests pin the filtering
// contract the UI relies on: reason filter, text search, and their composition.
// The component's own search/filter logic is duplicated here deliberately, as a
// pure function, because that is the only way to test it without a DOM.
const MISSES = [
  "seperate", "occured", "definately", "accomodate", "untill", "wich",
  "teh", "adress", "arguement", "becuase", "calender", "embarass", "foriegn",
  "goverment", "independant", "occassion", "priviledge", "publically",
  "refered", "tommorow",
];

const longDraft = MISSES.map((word, index) => (
  `Section ${index + 1} of the plan. The manager ${word} the update on Thursday. We reviewed the figures twice.\n\n`
)).join("");

const goals = { register: "formal", tone: "neutral", audience: "professional", intent: "inform", readability: "standard" };
const style = { dialect: "en-GB", voice: "neutral", formality: "neutral" };

const ACTIONABLE = new Set(["density-cap", "repeated-pattern", "low-confidence-style", "register-budget"]);

/** Mirror of the component's base set: actionable by default, or one reason. */
function baseSet(suppressed, reasonFilter) {
  return reasonFilter
    ? suppressed.filter((entry) => entry.reason === reasonFilter)
    : suppressed.filter((entry) => ACTIONABLE.has(entry.reason));
}

/** Mirror of the component's search predicate. */
function searchSet(entries, query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => {
    const issue = entry.issue;
    return (issue.title ?? "").toLocaleLowerCase().includes(needle)
      || (issue.original ?? "").toLocaleLowerCase().includes(needle)
      || (issue.replacement ?? "").toLocaleLowerCase().includes(needle)
      || (issue.explanation ?? "").toLocaleLowerCase().includes(needle);
  });
}

const stateFor = (extra) => {
  const issues = analyzeLocally(longDraft, style, goals).issues;
  return buildSuggestionState({ issues, goals, style, dismissedKeys: [], text: longDraft, ...extra });
};

test("the fixture produces enough held-back findings to need search", () => {
  const state = stateFor();
  assert.ok(baseSet(state.suppressed, null).length > 8, "fixture should exceed the search threshold");
});

test("search matches a finding by the text it flags", () => {
  const state = stateFor();
  const base = baseSet(state.suppressed, null);
  const target = base.find((entry) => entry.issue.original && entry.issue.original.trim().length > 3);
  assert.ok(target, "fixture should have a finding with offending text");

  const needle = target.issue.original.trim().slice(0, 4);
  const hits = searchSet(base, needle);
  assert.ok(hits.length > 0, `searching for ${needle} should find something`);
  assert.ok(hits.some((entry) => entry.issue.id === target.issue.id), "the target must be among the hits");
});

test("search is case-insensitive and whitespace-tolerant", () => {
  const state = stateFor();
  const base = baseSet(state.suppressed, null);
  const target = base.find((entry) => /[a-z]/.test(entry.issue.original ?? ""));
  assert.ok(target);
  const word = target.issue.original.trim().split(/\s+/)[0];
  const lower = searchSet(base, word.toLocaleLowerCase());
  const upper = searchSet(base, word.toLocaleUpperCase());
  const padded = searchSet(base, `  ${word}  `);
  assert.equal(lower.length, upper.length);
  assert.equal(lower.length, padded.length);
  assert.ok(lower.length > 0);
});

test("search composes with the reason filter rather than replacing it", () => {
  const state = stateFor();
  const reasons = [...new Set(state.suppressed.map((entry) => entry.reason))];
  const reason = reasons.find((candidate) => baseSet(state.suppressed, candidate).length > 0);
  assert.ok(reason, "fixture should have at least one reason");

  const byReason = baseSet(state.suppressed, reason);
  const target = byReason[0];
  const needle = (target.issue.original || target.issue.title).trim().split(/\s+/)[0];

  const both = searchSet(byReason, needle);
  assert.ok(both.length > 0);
  // Every hit must belong to the filtered reason: search narrows within the
  // filter and must not resurrect findings from other reasons.
  assert.ok(both.every((entry) => entry.reason === reason), "search must not escape the reason filter");
});

test("an unmatched query returns nothing rather than the unfiltered set", () => {
  const state = stateFor();
  const base = baseSet(state.suppressed, null);
  const hits = searchSet(base, "zzzz-no-such-finding-anywhere");
  assert.equal(hits.length, 0);
});

test("an empty query is a no-op, not a match-everything filter", () => {
  const state = stateFor();
  const base = baseSet(state.suppressed, null);
  assert.deepEqual(searchSet(base, ""), base);
  assert.deepEqual(searchSet(base, "   "), base);
});

test("findings the writer dismissed are excluded by default", () => {
  const state = stateFor();
  const base = baseSet(state.suppressed, null);
  assert.ok(base.every((entry) => ACTIONABLE.has(entry.reason)));
  // Asking for a non-actionable reason directly still works.
  const dismissed = baseSet(state.suppressed, "rule-off");
  assert.ok(dismissed.every((entry) => entry.reason === "rule-off"));
});

test("unhiding a finding removes it from the searchable held-back set", () => {
  const before = stateFor();
  const target = before.suppressed[0];
  const after = stateFor({ unhiddenIssueIds: [target.issue.id] });

  const beforeHits = searchSet(baseSet(before.suppressed, null), target.issue.original.trim().slice(0, 4));
  const afterHits = searchSet(baseSet(after.suppressed, null), target.issue.original.trim().slice(0, 4));
  assert.ok(beforeHits.some((entry) => entry.issue.id === target.issue.id), "it should be searchable while held back");
  assert.equal(afterHits.some((entry) => entry.issue.id === target.issue.id), false, "it should not be offered once opened");
});
