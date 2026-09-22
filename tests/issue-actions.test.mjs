import assert from "node:assert/strict";
import test from "node:test";
import { applyIssueReplacements, getOpenIssues } from "../lib/issue-actions.ts";

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
  const openIssues = getOpenIssues(issues, ["dismissed"]);
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
