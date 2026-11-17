import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyIssueReplacements, getIssueDismissalKey, getOpenIssues, issueAnchors } from "../lib/issue-actions.ts";
import { decodeDismissalKey } from "../lib/dismissal-key.ts";
import { anchorMatches, fingerprintText } from "../packages/grammar/src/index.ts";

const issue = (patch = {}) => ({
  id: "issue",
  ruleId: "test",
  start: 0,
  end: 3,
  original: "bad",
  replacement: "good",
  category: "clarity",
  severity: "medium",
  confidence: 0.9,
  title: "Improve wording",
  explanation: "",
  source: "local",
  ...patch,
});

test("dismissed suggestions stay excluded from bulk acceptance", () => {
  const issues = [
    issue({ id: "keep", start: 0, end: 3, original: "bad", replacement: "good" }),
    issue({ id: "dismissed", start: 4, end: 8, original: "word", replacement: "term" }),
  ];
  const openIssues = getOpenIssues(issues, [getIssueDismissalKey(issues[1])]);
  assert.deepEqual(openIssues.map((item) => item.id), ["keep"]);
  assert.equal(applyIssueReplacements("bad word", openIssues), "good word");
});

test("dismissing a suggestion suppresses the same edit from another analysis source", () => {
  const local = issue({ id: "local-copy", source: "local" });
  const ai = issue({ id: "ai-copy", source: "ai" });
  const openIssues = getOpenIssues([local, ai], [getIssueDismissalKey(local)]);
  assert.deepEqual(openIssues, []);
  assert.equal(applyIssueReplacements("bad word", openIssues), "bad word");
});

test("malformed persisted dismissal keys are ignored without hiding suggestions", () => {
  const candidate = issue();
  assert.doesNotThrow(() => getOpenIssues([candidate], ["not-json", "{}", "[1,2,3]"]));
  assert.deepEqual(getOpenIssues([candidate], ["not-json", "{}", "[1,2,3]"]), [candidate]);
});

test("dismissal keys cannot collide when issue fields contain separators", () => {
  const dismissedIssue = issue({ id: "a:b", source: "c", original: "bad", replacement: "good" });
  const distinctIssue = issue({ id: "a", source: "b:c", original: "bad", replacement: "good" });
  assert.notEqual(getIssueDismissalKey(dismissedIssue), getIssueDismissalKey(distinctIssue));
  assert.deepEqual(getOpenIssues([dismissedIssue, distinctIssue], [getIssueDismissalKey(dismissedIssue)]), []);
});

test("dismissal keys preserve boundaries in suggestion text", () => {
  const dismissedIssue = issue({ original: "bad:word", replacement: "good" });
  const distinctIssue = issue({ original: "bad", replacement: "word:good" });
  assert.notEqual(getIssueDismissalKey(dismissedIssue), getIssueDismissalKey(distinctIssue));
  assert.deepEqual(getOpenIssues([dismissedIssue, distinctIssue], [getIssueDismissalKey(dismissedIssue)]).map((item) => item.original), ["bad"]);
});

test("dismissing one repeated suggestion does not hide the same edit at another location", () => {
  const first = issue({ id: "repeated", start: 0, end: 3 });
  const second = issue({ id: "repeated", start: 8, end: 11 });
  const dismissed = [getIssueDismissalKey(first)];
  assert.notEqual(getIssueDismissalKey(first), getIssueDismissalKey(second));
  assert.deepEqual(getOpenIssues([first, second], dismissed).map((item) => item.start), [8]);
});

test("dismissal identity includes the rule that produced an otherwise identical edit", () => {
  const first = issue({ ruleId: "clarity-a" });
  const second = issue({ ruleId: "clarity-b" });
  assert.notEqual(getIssueDismissalKey(first), getIssueDismissalKey(second));
  assert.deepEqual(getOpenIssues([first, second], [getIssueDismissalKey(first)]).map((item) => item.ruleId), ["clarity-b"]);
});

test("bulk acceptance skips stale and non-actionable suggestions", () => {
  const issues = [issue({ id: "stale", original: "old", replacement: "new" }), issue({ id: "same", start: 4, end: 8, original: "word", replacement: "word" })];
  assert.equal(applyIssueReplacements("bad word", issues), "bad word");
});

test("bulk acceptance applies a valid deletion suggestion", () => {
  assert.equal(applyIssueReplacements("very very clear", [issue({ start: 5, end: 10, original: "very ", replacement: "" })]), "very clear");
});

test("deletion suggestions still require an exact current-text match", () => {
  assert.equal(applyIssueReplacements("very quite clear", [issue({ start: 5, end: 10, original: "very ", replacement: "" })]), "very quite clear");
});

test("bulk acceptance rejects malformed or out-of-bounds suggestion ranges", () => {
  const malformed = [issue({ start: -3, end: 0 }), issue({ start: 3, end: 0 }), issue({ start: 0.5, end: 3.5 }), issue({ start: 6, end: 9 }), issue({ start: 0, end: 2 })];
  assert.equal(applyIssueReplacements("bad word", malformed), "bad word");
});

test("bulk acceptance fails closed on malformed runtime text payloads", () => {
  const malformed = [issue({ original: null }), issue({ original: { text: "bad" } }), issue({ replacement: 123 }), issue({ replacement: { text: "good" } })];
  assert.doesNotThrow(() => applyIssueReplacements("bad word", malformed));
  assert.equal(applyIssueReplacements("bad word", malformed), "bad word");
});

test("malformed runtime payloads do not block independent valid suggestions", () => {
  assert.equal(applyIssueReplacements("bad word", [issue({ original: null }), issue({ start: 4, end: 8, original: "word", replacement: "term" })]), "bad term");
});

test("bulk acceptance skips all overlapping suggestions rather than choosing one implicitly", () => {
  assert.equal(applyIssueReplacements("bad word", [issue({ start: 0, end: 3, original: "bad", replacement: "great" }), issue({ start: 1, end: 2, original: "a", replacement: "x" })]), "bad word");
});

test("identical duplicate replacements are applied once instead of being treated as a conflict", () => {
  assert.equal(applyIssueReplacements("bad word", [issue({ source: "local" }), issue({ source: "ai" })]), "good word");
});

test("bulk acceptance skips competing insertions at the same position", () => {
  const issues = [issue({ start: 3, end: 3, original: "", replacement: "!" }), issue({ start: 3, end: 3, original: "", replacement: "?" })];
  assert.equal(applyIssueReplacements("bad word", issues), "bad word");
});

test("competing insertions remain conflicting when an adjacent range ends at their position", () => {
  const issues = [
    issue({ id: "range", start: 0, end: 3, original: "bad", replacement: "good" }),
    issue({ id: "insert-a", start: 3, end: 3, original: "", replacement: "!" }),
    issue({ id: "insert-b", start: 3, end: 3, original: "", replacement: "?" }),
  ];
  assert.equal(applyIssueReplacements("bad word", issues), "good word");
});

test("identical duplicate insertions are applied once", () => {
  const issues = [issue({ source: "local", start: 3, end: 3, original: "", replacement: "!" }), issue({ source: "ai", start: 3, end: 3, original: "", replacement: "!" })];
  assert.equal(applyIssueReplacements("bad word", issues), "bad! word");
});

test("a single insertion remains actionable", () => {
  assert.equal(applyIssueReplacements("bad word", [issue({ start: 3, end: 3, original: "", replacement: "!" })]), "bad! word");
});

test("overlap conflicts do not block independent suggestions", () => {
  const issues = [issue({ start: 0, end: 3, replacement: "great" }), issue({ start: 1, end: 2, original: "a", replacement: "x" }), issue({ start: 4, end: 8, original: "word", replacement: "term" })];
  assert.equal(applyIssueReplacements("bad word", issues), "bad term");
});

test("nested overlap clusters mark every conflicting suggestion", () => {
  const text = "abcdefghij safe";
  const issues = [issue({ start: 0, end: 10, original: "abcdefghij", replacement: "outer" }), issue({ start: 1, end: 2, original: "b", replacement: "B" }), issue({ start: 8, end: 9, original: "i", replacement: "I" }), issue({ start: 11, end: 15, original: "safe", replacement: "kept" })];
  assert.equal(applyIssueReplacements(text, issues), "abcdefghij kept");
});

test("adjacent suggestions can still be applied together", () => {
  const issues = [issue(), issue({ start: 3, end: 4, original: " ", replacement: "-" }), issue({ start: 4, end: 8, original: "word", replacement: "term" })];
  assert.equal(applyIssueReplacements("bad word", issues), "good-term");
});

test("bulk acceptance handles large independent suggestion sets without quadratic conflict scanning", () => {
  const count = 2000;
  const text = "a".repeat(count);
  const issues = Array.from({ length: count }, (_, index) => issue({ id: `issue-${index}`, start: index, end: index + 1, original: "a", replacement: "b" }));
  assert.equal(applyIssueReplacements(text, issues), "b".repeat(count));
});

test("a changed suggestion at the same rule and range does not inherit an old dismissal", () => {
  const oldIssue = issue({ id: "same-range", original: "bad", replacement: "good" });
  const changedIssue = issue({ id: "same-range", original: "odd", replacement: "better" });
  const dismissed = [getIssueDismissalKey(oldIssue)];
  assert.deepEqual(getOpenIssues([oldIssue], dismissed), []);
  assert.deepEqual(getOpenIssues([changedIssue], dismissed).map((item) => item.original), ["odd"]);
});

test("a dismissal survives an edit above it that shifts every offset below", () => {
  // The stored key carries character offsets, so rewriting anything above the
  // finding used to bring it straight back. Anchoring on the surrounding draft
  // text is what makes a dismissal mean "this sentence, not this position".
  const original = `${"padding sentence to push the finding down the page. ".repeat(20)}the team reigon lead confirmed it. ${"more of the same padding follows here. ".repeat(20)}`;
  const start = original.indexOf("reigon");
  const found = issue({ id: "typo", ruleId: "spelling/test", start, end: start + 6, original: "reigon", replacement: "region" });
  const dismissed = [getIssueDismissalKey(found, original)];

  const inserted = "a whole new opening paragraph. ".repeat(10);
  const edited = inserted + original;
  const moved = issue({ id: "typo", ruleId: "spelling/test", start: start + inserted.length, end: start + inserted.length + 6, original: "reigon", replacement: "region" });

  assert.ok(edited.slice(moved.start, moved.end) === "reigon", "the fixture must keep the typo at the shifted offset");
  assert.deepEqual(getOpenIssues([moved], dismissed, edited), []);
});

test("an anchored dismissal does not follow the word to a new occurrence elsewhere", () => {
  // The same word written somewhere else is a new finding, not the dismissed
  // one. Both anchors must agree for a dismissal to apply.
  const text = `${"padding sentence to push the finding down the page. ".repeat(20)}the team reigon lead confirmed it.`;
  const start = text.indexOf("reigon");
  const found = issue({ id: "typo", ruleId: "spelling/test", start, end: start + 6, original: "reigon", replacement: "region" });
  const dismissed = [getIssueDismissalKey(found, text)];

  const grown = `${text} A reigon appeared in the summary table at the end.`;
  const added = grown.lastIndexOf("reigon");
  const fresh = issue({ id: "typo", ruleId: "spelling/test", start: added, end: added + 6, original: "reigon", replacement: "region" });

  assert.deepEqual(getOpenIssues([found, fresh], dismissed, grown).map((item) => item.start), [added]);
});

test("dismissal keys written before anchoring still parse", () => {
  const legacy = JSON.stringify(["id", "test", "local", 0, 3, "bad", "good"]);
  const found = issue({ start: 0, end: 3 });
  assert.deepEqual(getOpenIssues([found], [legacy]), []);
  assert.doesNotThrow(() => getOpenIssues([found], [legacy], "bad whatever follows"));
});

// A faithful copy of the pre-indexing linear scan, updated to understand the
// fingerprinted d2 key format via the shared decoder. Kept in the test as an
// oracle so the large-input test can prove the indexed version returns exactly
// the same issues as the simple linear scan (including all of its edge rules).
// The oracle deliberately stays O(n) per issue; only the search strategy
// differs from getOpenIssues, so any result mismatch is a real indexing bug.
function legacySemanticKey(candidate) {
  return JSON.stringify([
    candidate.ruleId, candidate.start, candidate.end,
    fingerprintText(candidate.original), fingerprintText(candidate.replacement),
  ]);
}

function legacySemanticKeyFromStored(key) {
  const parsed = decodeDismissalKey(key);
  if (!parsed) return null;
  const originalFp = parsed.originalFingerprint
    ?? (parsed.original === undefined ? null : fingerprintText(parsed.original));
  const replacementFp = parsed.replacementFingerprint
    ?? (parsed.replacement === undefined ? null : fingerprintText(parsed.replacement));
  if (originalFp === null || replacementFp === null) return null;
  return JSON.stringify([parsed.ruleId, parsed.start, parsed.end, originalFp, replacementFp]);
}

function legacyIsSameDismissal(key, candidate, text) {
  if (text === undefined) return false;
  const parsed = decodeDismissalKey(key);
  if (!parsed || parsed.ruleId !== candidate.ruleId || parsed.before === undefined || parsed.after === undefined) return false;
  const sameText = parsed.originalFingerprint
    ? parsed.originalFingerprint === fingerprintText(candidate.original)
    : parsed.original === candidate.original;
  const sameReplacement = parsed.replacementFingerprint
    ? parsed.replacementFingerprint === fingerprintText(candidate.replacement)
    : parsed.replacement === candidate.replacement;
  if (!sameText || !sameReplacement) return false;
  const live = issueAnchors(text, candidate);
  return anchorMatches(live.before, parsed.before, "before")
    && anchorMatches(live.after, parsed.after, "after");
}

function legacyGetOpenIssues(issues, dismissedIssueKeys, text) {
  const dismissed = new Set(dismissedIssueKeys);
  const semanticallyDismissed = new Set();
  for (const key of dismissed) {
    const semanticKey = legacySemanticKeyFromStored(key);
    if (semanticKey !== null) semanticallyDismissed.add(semanticKey);
  }
  return issues.filter((candidate) => !dismissed.has(getIssueDismissalKey(candidate))
    && !semanticallyDismissed.has(legacySemanticKey(candidate))
    && ![...dismissed].some((key) => legacyIsSameDismissal(key, candidate, text)));
}

test("indexed getOpenIssues matches the legacy linear scan on large input", () => {
  const sentence = (i) => `Sentence ${i} has the reigon and a teh error inside it. `;
  const prefix = "An inserted opening paragraph shifts every offset below. ".repeat(6);
  const baseText = Array.from({ length: 300 }, (_, i) => sentence(i)).join("");
  const text = prefix + baseText;

  // Findings on the edited text. Distinct replacements per finding keep the
  // index buckets small, exercising O(1) lookups rather than one giant bucket.
  const issues = [];
  for (let i = 0; i < 300; i += 1) {
    const from = text.indexOf(`Sentence ${i} `);
    const regionAt = text.indexOf("reigon", from);
    const tehAt = text.indexOf("teh", from);
    issues.push(issue({ id: `region-${i}`, ruleId: "spelling", start: regionAt, end: regionAt + 6, original: "reigon", replacement: `region-${i}` }));
    issues.push(issue({ id: `teh-${i}`, ruleId: "grammar", start: tehAt, end: tehAt + 3, original: "teh", replacement: `the-${i}` }));
  }

  // Dismissals are authored against the PRE-edit text, so their offsets no
  // longer line up with the edited text: only anchored matching can keep them
  // dismissed. This hammers the path that used to JSON.parse every pair.
  const dismissedKeys = [];
  for (let i = 0; i < 300; i += 2) {
    const from = baseText.indexOf(`Sentence ${i} `);
    const regionAt = baseText.indexOf("reigon", from);
    const tehAt = baseText.indexOf("teh", from);
    dismissedKeys.push(getIssueDismissalKey(issue({ id: `region-${i}`, ruleId: "spelling", start: regionAt, end: regionAt + 6, original: "reigon", replacement: `region-${i}` }), baseText));
    dismissedKeys.push(getIssueDismissalKey(issue({ id: `teh-${i}`, ruleId: "grammar", start: tehAt, end: tehAt + 3, original: "teh", replacement: `the-${i}` }), baseText));
  }
  // A legacy 7-field key plus malformed keys the implementation must ignore.
  dismissedKeys.push(JSON.stringify(["legacy", "spelling", "local", issues[0].start, issues[0].end, "reigon", "region-0"]));
  dismissedKeys.push("not-json", "{}", "[1,2,3]");

  assert.ok(dismissedKeys.length > 300, "fixture must contain hundreds of dismissals");
  assert.ok(issues.length > 300, "fixture must contain hundreds of issues");

  const expected = legacyGetOpenIssues(issues, dismissedKeys, text);
  const actual = getOpenIssues(issues, dismissedKeys, text);
  assert.deepEqual(actual.map((item) => item.id), expected.map((item) => item.id));
  assert.ok(actual.length < issues.length, "the fixture must actually dismiss something");
  // The undefined-text path must stay equivalent too (anchoring is skipped).
  assert.deepEqual(
    getOpenIssues(issues, dismissedKeys).map((item) => item.id),
    legacyGetOpenIssues(issues, dismissedKeys).map((item) => item.id),
  );
});

test("getOpenIssues parses dismissal keys only once, before the per-issue filter", () => {
  const source = readFileSync(new URL("../lib/issue-actions.ts", import.meta.url), "utf8");
  const fnStart = source.indexOf("export function getOpenIssues");
  assert.ok(fnStart >= 0, "getOpenIssues source must be present");
  const fnSource = source.slice(fnStart);

  const filterAt = fnSource.indexOf(".filter(");
  assert.ok(filterAt >= 0, "getOpenIssues must still use a per-issue filter");
  const beforeFilter = fnSource.slice(0, filterAt);
  const filterCallback = fnSource.slice(filterAt);

  // The static guarantee: stored keys are never decoded inside the per-issue
  // callback. Decoding is delegated to decodeDismissalKey, which owns the
  // module's single JSON.parse in lib/dismissal-key.ts, and runs once up front.
  assert.ok(!filterCallback.includes("decodeDismissalKey"),
    "the per-issue filter callback must not decode stored keys");
  assert.ok(beforeFilter.includes("decodeDismissalKey("),
    "dismissal keys must be decoded before the filter runs");
  assert.ok(beforeFilter.includes("new Map"),
    "anchored dismissals must be indexed before the filter runs");
  // Parsing lives in exactly one place: the shared decodeDismissalKey helper.
  assert.ok(!source.includes("JSON.parse("),
    "stored keys should be parsed only in the shared decodeDismissalKey helper");
  assert.ok(source.includes('from "./dismissal-key.ts"'),
    "getOpenIssues must use the shared dismissal-key decoder");
});
