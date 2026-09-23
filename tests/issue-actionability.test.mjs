import assert from "node:assert/strict";
import test from "node:test";
import { applyIssueReplacements, hasActionableReplacement } from "../lib/issue-actions.ts";

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

test("deletions are actionable even though their replacement is an empty string", () => {
  const deletion = issue({ start: 5, end: 10, original: "very ", replacement: "" });
  assert.equal(hasActionableReplacement(deletion), true);
  assert.equal(applyIssueReplacements("very very clear", [deletion]), "very clear");
});

test("unchanged and malformed runtime replacements are not actionable", () => {
  assert.equal(hasActionableReplacement(issue({ replacement: "bad" })), false);
  assert.equal(hasActionableReplacement(issue({ replacement: null })), false);
  assert.equal(hasActionableReplacement(issue({ original: null })), false);
});

test("ordinary replacements and insertions remain actionable", () => {
  assert.equal(hasActionableReplacement(issue()), true);
  assert.equal(hasActionableReplacement(issue({ start: 3, end: 3, original: "", replacement: "!" })), true);
});
