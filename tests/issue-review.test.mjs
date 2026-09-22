import assert from "node:assert/strict";
import test from "node:test";

import { applyIssueReplacements, getOpenIssues } from "../lib/issue-review.ts";

test("dismissed suggestions are excluded from the open review queue", () => {
  const issues = [
    { id: "grammar-1", start: 0, end: 3, original: "teh", replacement: "the" },
    { id: "style-1", start: 4, end: 8, original: "very", replacement: "" },
  ];

  assert.deepEqual(
    getOpenIssues(issues, ["style-1"]).map((issue) => issue.id),
    ["grammar-1"],
  );
});

test("accept all applies only the supplied visible review queue", () => {
  const draft = "teh very clear draft";
  const issues = [
    { id: "grammar-1", start: 0, end: 3, original: "teh", replacement: "the" },
    { id: "style-1", start: 4, end: 8, original: "very", replacement: "quite" },
  ];

  const visible = getOpenIssues(issues, ["style-1"]);
  const result = applyIssueReplacements(draft, visible);

  assert.equal(result.text, "the very clear draft");
  assert.deepEqual(result.appliedIssueIds, ["grammar-1"]);
});

test("batch replacements preserve offsets and skip stale suggestions", () => {
  const draft = "teh cat teh";
  const result = applyIssueReplacements(draft, [
    { id: "first", start: 0, end: 3, original: "teh", replacement: "the" },
    { id: "second", start: 8, end: 11, original: "teh", replacement: "the" },
    { id: "stale", start: 4, end: 7, original: "dog", replacement: "cat" },
  ]);

  assert.equal(result.text, "the cat the");
  assert.deepEqual(result.appliedIssueIds.sort(), ["first", "second"]);
});
