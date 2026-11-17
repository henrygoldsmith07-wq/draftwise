import assert from "node:assert/strict";
import test from "node:test";
import { getIssueDismissalKey, getOpenIssues } from "../lib/issue-actions.ts";
import { decodeDismissalKey } from "../lib/dismissal-key.ts";
import { anchorMatches, fingerprintAnchor, fingerprintText } from "../packages/grammar/src/dismissal-anchor.ts";

const issueFor = (text, start, original, replacement, ruleId = "spelling-lexicon") => ({
  id: `${ruleId}-${start}-${start + original.length}-x`,
  ruleId,
  start,
  end: start + original.length,
  original,
  replacement,
  category: "spelling",
  severity: "low",
  confidence: 1,
  title: "Spelling",
  explanation: "",
  source: "local",
});

test("persisted dismissal keys contain none of the writer's raw text", () => {
  const text = "The manager recievd the quarterly forecast and sent it to the team.";
  const start = text.indexOf("recievd");
  const issue = issueFor(text, start, "recievd", "received");
  const key = getIssueDismissalKey(issue, text);

  assert.ok(key.includes("d2"), "the key must be versioned so legacy keys stay readable");
  for (const fragment of ["recievd", "received", "manager", "quarterly", "forecast"]) {
    assert.ok(!key.includes(fragment), `the key leaked the raw fragment "${fragment}"`);
  }
});

test("fingerprint anchors keep the exact suffix/prefix semantics", () => {
  const before = "Some distinctive preceding sentence. ";
  const after = " and a distinctive following sentence";
  const beforeFp = fingerprintAnchor(before);
  const afterFp = fingerprintAnchor(after);

  assert.ok(anchorMatches(`padding${before}`, beforeFp, "before"));
  assert.ok(anchorMatches(`${after}padding`, afterFp, "after"));
  assert.equal(anchorMatches(`different${before}`, beforeFp, "before"), true, "extra text above is the case anchors exist for");
  assert.equal(anchorMatches(`different${before.slice(1)}`, beforeFp, "before"), false, "a changed suffix must not match");
  assert.equal(anchorMatches(before.slice(1), beforeFp, "before"), false, "a shorter suffix must not match");
  assert.equal(anchorMatches(after.slice(0, -1), afterFp, "after"), false, "a shorter prefix must not match");
});

test("a fingerprinted dismissal still survives an edit above it and keeps its own instance", () => {
  const text = "The manager recievd the update. Later the manager recievd the summary.";
  const first = text.indexOf("recievd");
  const second = text.lastIndexOf("recievd");
  const firstIssue = issueFor(text, first, "recievd", "received");
  const secondIssue = issueFor(text, second, "recievd", "received");
  const key = getIssueDismissalKey(firstIssue, text);

  const open = getOpenIssues([firstIssue, secondIssue], [key], text);
  assert.deepEqual(open.map((item) => item.start), [second]);

  const grown = `IMPORTANT: ${text}`;
  const movedStart = grown.indexOf("recievd");
  const movedIssue = issueFor(grown, movedStart, "recievd", "received");
  assert.deepEqual(getOpenIssues([movedIssue], [key], grown), [], "the fingerprinted anchor must follow the text");
});

test("raw words in the key would have been visible; the fingerprint is stable and distinct", () => {
  assert.equal(fingerprintText("recievd"), fingerprintText("recievd"), "fingerprints are deterministic");
  assert.notEqual(fingerprintText("recievd"), fingerprintText("received"));
  const key = getIssueDismissalKey(issueFor("recievd at 0", 0, "recievd", "received"), "recievd at 0");
  const parsed = decodeDismissalKey(key);
  assert.ok(parsed?.originalFingerprint);
  assert.equal(parsed.original, undefined, "the parsed new key holds no raw original text");
  assert.equal(parsed.replacement, undefined, "the parsed new key holds no raw replacement text");
});
