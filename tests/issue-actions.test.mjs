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

test("bulk acceptance skips stale and non-actionable suggestions", () => {
  const issues = [
    issue({ id: "stale", start: 0, end: 3, original: "old", replacement: "new" }),
    issue({ id: "same", start: 4, end: 8, original: "word", replacement: "word" }),
  ];
  assert.equal(applyIssueReplacements("bad word", issues), "bad word");
});

test("bulk acceptance rejects malformed or out-of-bounds suggestion ranges", () => {
  const malformed = [
    issue({ id: "negative", start: -3, end: 0 }),
    issue({ id: "reversed", start: 3, end: 0 }),
    issue({ id: "fractional", start: 0.5, end: 3.5 }),
    issue({ id: "past-end", start: 6, end: 9, original: "bad" }),
    issue({ id: "length-mismatch", start: 0, end: 2, original: "bad" }),
  ];
  assert.equal(applyIssueReplacements("bad word", malformed), "bad word");
});

test("bulk acceptance skips all overlapping suggestions rather than choosing one implicitly", () => {
  const issues = [
    issue({ id: "outer", start: 0, end: 3, original: "bad", replacement: "great" }),
    issue({ id: "inner", start: 1, end: 2, original: "a", replacement: "x" }),
  ];
  assert.equal(applyIssueReplacements("bad word", issues), "bad word");
});

test("overlap conflicts do not block independent suggestions", () => {
  const issues = [
    issue({ id: "outer", start: 0, end: 3, original: "bad", replacement: "great" }),
    issue({ id: "inner", start: 1, end: 2, original: "a", replacement: "x" }),
    issue({ id: "independent", start: 4, end: 8, original: "word", replacement: "term" }),
  ];
  assert.equal(applyIssueReplacements("bad word", issues), "bad term");
});

test("adjacent suggestions can still be applied together", () => {
  const issues = [
    issue({ id: "first", start: 0, end: 3, original: "bad", replacement: "good" }),
    issue({ id: "second", start: 3, end: 4, original: " ", replacement: "-" }),
    issue({ id: "third", start: 4, end: 8, original: "word", replacement: "term" }),
  ];
  assert.equal(applyIssueReplacements("bad word", issues), "good-term");
});

test("a changed suggestion at the same rule and range does not inherit an old dismissal", () => {
  const oldIssue = issue({ id: "same-range", original: "bad", replacement: "good" });
  const changedIssue = issue({ id: "same-range", original: "odd", replacement: "better" });
  const dismissed = [getIssueDismissalKey(oldIssue)];
  assert.deepEqual(getOpenIssues([oldIssue], dismissed), []);
  assert.deepEqual(getOpenIssues([changedIssue], dismissed).map((item) => item.original), ["odd"]);
});
