import assert from "node:assert/strict";
import test from "node:test";
import { applyIssueReplacements, getIssueDismissalKey, getOpenIssues } from "../lib/issue-actions.ts";

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

test("dismissal keys cannot collide when issue fields contain separators", () => {
  const dismissedIssue = issue({ id: "a:b", source: "c", original: "bad", replacement: "good" });
  const distinctIssue = issue({ id: "a", source: "b:c", original: "bad", replacement: "good" });
  assert.notEqual(getIssueDismissalKey(dismissedIssue), getIssueDismissalKey(distinctIssue));
  assert.deepEqual(getOpenIssues([dismissedIssue, distinctIssue], [getIssueDismissalKey(dismissedIssue)]).map((item) => item.id), ["a"]);
});

test("dismissal keys preserve boundaries in suggestion text", () => {
  const dismissedIssue = issue({ original: "bad:word", replacement: "good" });
  const distinctIssue = issue({ original: "bad", replacement: "word:good" });
  assert.notEqual(getIssueDismissalKey(dismissedIssue), getIssueDismissalKey(distinctIssue));
  assert.deepEqual(getOpenIssues([dismissedIssue, distinctIssue], [getIssueDismissalKey(dismissedIssue)]).map((item) => item.original), ["bad"]);
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
