import test from "node:test";
import assert from "node:assert/strict";
import { getIssueDismissalKey, getOpenIssues, issueAnchors } from "../lib/issue-actions.ts";

// Dismissal keys are stored globally, not per document. A dismissal in one draft
// must not suppress a finding in another — otherwise dismissing a spelling note
// in your morning email would silently silence the same sentence in tonight's
// report. The anchors and embedded offsets are what prevent that; these tests
// pin the boundary.
const issueFor = (start, end, original, replacement, ruleId = "spelling-lexicon") => ({
  id: `${ruleId}-${start}-${end}-x`,
  ruleId,
  start,
  end,
  original,
  replacement,
  category: "spelling",
  severity: "low",
  confidence: 1,
  title: "Spelling",
  explanation: "",
  source: "local",
});

const draftA = "The manager recievd the update. This sentence is unique to document A.";
const draftB = "A completely different document about budgets and timelines. Nothing alike.";

test("the same sentence at the same offset in two drafts shares a key", () => {
  // This is the known risk, stated honestly rather than hidden: the key is
  // derived from offsets and surrounding text, not from a document id. Two
  // drafts that contain the identical sentence at the identical offset will
  // share a dismissal. Recording the behaviour so any future change to the key
  // format is a deliberate decision.
  const text = "The manager recievd the update. Nothing else here.";
  const first = getIssueDismissalKey(issueFor(13, 20, "recievd", "received"), text);
  const second = getIssueDismissalKey(issueFor(13, 20, "recievd", "received"), text);
  assert.equal(first, second);
});

test("the same sentence at a different offset in the same draft is distinct", () => {
  // Offsets are in the key, so moving text does not inherit a dismissal from
  // its old position.
  const text = "Padding. The manager recievd the update. Later, the manager recievd the summary.";
  const early = text.indexOf("recievd");
  const late = text.lastIndexOf("recievd");
  assert.ok(early !== late);
  const earlyKey = getIssueDismissalKey(issueFor(early, early + 7, "recievd", "received"), text);
  const lateKey = getIssueDismissalKey(issueFor(late, late + 7, "recievd", "received"), text);
  assert.notEqual(earlyKey, lateKey);
});

test("a dismissal in one document does not hide a finding in another", () => {
  const issueA = issueFor(13, 20, "recievd", "received");
  const keyA = getIssueDismissalKey(issueA, draftA);

  // A genuinely different document with a different finding at a different
  // offset: the dismissal from A must not touch it.
  const issueB = issueFor(40, 47, "alike", "alike", "spelling-lexicon");
  const openB = getOpenIssues([issueB], [keyA], draftB);
  assert.equal(openB.length, 1, "a finding in another document must not be suppressed");
});

test("anchors differ when the surrounding text differs", () => {
  const textA = "Before one. The manager recievd the update.";
  const textB = "Before two. The manager recievd the update.";
  const startA = textA.indexOf("recievd");
  const startB = textB.indexOf("recievd");
  const anchorsA = issueAnchors(textA, issueFor(startA, startA + 7, "recievd", "received"));
  const anchorsB = issueAnchors(textB, issueFor(startB, startB + 7, "recievd", "received"));
  assert.notEqual(anchorsA.before, anchorsB.before, "different surrounding text must produce different anchors");
});

test("an exact duplicate elsewhere in the same draft is still reviewed", () => {
  // The existing contract: dismissing one instance must not silence the same
  // word at another location. This is what makes the global key safe in
  // practice for the common case.
  const text = "The manager recievd the update. Later the team recievd the summary.";
  const first = text.indexOf("recievd");
  const second = text.lastIndexOf("recievd");
  const firstIssue = issueFor(first, first + 7, "recievd", "received");
  const secondIssue = issueFor(second, second + 7, "recievd", "received");
  const keys = [getIssueDismissalKey(firstIssue, text)];

  const open = getOpenIssues([firstIssue, secondIssue], keys, text);
  assert.equal(open.length, 1, "only the dismissed instance should be hidden");
  assert.equal(open[0].id, secondIssue.id);
});

test("a dismissal survives an edit above it that shifts offsets", () => {
  const text = "The manager recievd the update on Thursday.";
  const start = text.indexOf("recievd");
  const issue = issueFor(start, start + 7, "recievd", "received");
  const key = getIssueDismissalKey(issue, text);

  // Grow the document above the finding. The stored offsets no longer match,
  // but the anchors still describe the same sentence, so the dismissal holds.
  const grown = "IMPORTANT: " + text;
  const movedStart = grown.indexOf("recievd");
  const movedIssue = issueFor(movedStart, movedStart + 7, "recievd", "received");
  const open = getOpenIssues([movedIssue], [key], grown);
  assert.equal(open.length, 0, "the dismissal should follow the text, not the offset");
});
