import assert from "node:assert/strict";
import test from "node:test";
import {
  issueForReviewAction,
  reviewActionForKey,
  reviewAnnouncement,
  stepReviewIndex,
} from "../lib/review-navigation.ts";

/**
 * Keyboard review.
 *
 * These cover the two ways this feature can do real damage: firing while the
 * writer is typing (corrupting their draft), and stealing a key the browser or
 * a focused control owns (making the app unusable without a mouse). The happy
 * path is the easy part; the guards are what the tests are for.
 */

const makeIssue = (overrides = {}) => ({
  id: "issue-1",
  ruleId: "style-wordy",
  source: "local",
  start: 0,
  end: 5,
  original: "utilize",
  replacement: "use",
  title: "Wordy phrase",
  category: "conciseness",
  tier: "improve",
  rank: 10,
  ...overrides,
});

test("stepping with no selection starts at the highest-priority finding", () => {
  assert.equal(stepReviewIndex(null, 3, "next"), 0);
  // Backwards from nothing is the last one, so the direction is never a no-op.
  assert.equal(stepReviewIndex(null, 3, "previous"), 2);
});

test("stepping wraps at both ends instead of dead-ending", () => {
  assert.equal(stepReviewIndex(2, 3, "next"), 0);
  assert.equal(stepReviewIndex(0, 3, "previous"), 2);
  assert.equal(stepReviewIndex(1, 3, "next"), 2);
});

test("stepping on an empty list yields no target", () => {
  assert.equal(stepReviewIndex(null, 0, "next"), -1);
  assert.equal(issueForReviewAction([], 0), null);
});

test("an out-of-range index is ignored rather than crashing", () => {
  const issues = [makeIssue()];
  assert.equal(stepReviewIndex(99, 1, "next"), 0);
  assert.equal(issueForReviewAction(issues, -1), null);
  assert.equal(issueForReviewAction(issues, 5), null);
  assert.equal(issueForReviewAction(issues, 0)?.id, "issue-1");
});

test("review bindings require a modifier", () => {
  // Without one, arrows and Enter belong to the document and the browser.
  assert.equal(reviewActionForKey({ key: "ArrowDown", target: null }), null);
  assert.equal(reviewActionForKey({ key: "Enter", target: null }), null);
  assert.equal(reviewActionForKey({ key: "Backspace", target: null }), null);
  assert.equal(reviewActionForKey({ key: "ArrowUp", ctrlKey: true, target: null }), "previous");
  assert.equal(reviewActionForKey({ key: "ArrowDown", metaKey: true, target: null }), "next");
});

test("alt-modified keys are left alone", () => {
  // Alt+Arrow is a browser/OS navigation shortcut on several platforms.
  assert.equal(reviewActionForKey({ key: "ArrowDown", ctrlKey: true, altKey: true, target: null }), null);
});

test("shift+Enter is not treated as accept", () => {
  // Shift+Enter inserts a line break. Claiming it would make multi-paragraph
  // writing impossible from the keyboard.
  assert.equal(reviewActionForKey({ key: "Enter", ctrlKey: true, shiftKey: true, target: null }), null);
  assert.equal(reviewActionForKey({ key: "Enter", ctrlKey: true, target: null }), "accept");
});

test("review keys never fire while typing", () => {
  // Plain objects, not real elements: this module is environment-agnostic, and
  // the tests assert the same duck-typed contract it relies on.
  const targets = [
    { tagName: "TEXTAREA" },
    { tagName: "SELECT" },
    { isContentEditable: true },
    { getAttribute: (name) => (name === "role" ? "textbox" : null) },
    { tagName: "DIV", isContentEditable: true, getAttribute: () => null },
    // The draft textarea and the rewrite box both opt in with this attribute.
    { tagName: "TEXTAREA", getAttribute: (name) => (name === "data-review-guard" ? "" : null) },
  ];

  for (const target of targets) {
    assert.equal(reviewActionForKey({ key: "Enter", ctrlKey: true, target }), null);
    assert.equal(reviewActionForKey({ key: "Backspace", ctrlKey: true, target }), null);
    assert.equal(reviewActionForKey({ key: "ArrowDown", ctrlKey: true, target }), null);
  }
});

test("a single-line field still receives review keys", () => {
  // The document title is an <input>. Guarding every input made the bindings
  // unreachable, because focus rests there after clicking the title — the
  // feature existed but no keypress could ever trigger it.
  const titleInput = { tagName: "INPUT", getAttribute: () => null, closest: () => null };
  assert.equal(reviewActionForKey({ key: "ArrowDown", ctrlKey: true, target: titleInput }), "next");
  assert.equal(reviewActionForKey({ key: "Enter", ctrlKey: true, target: titleInput }), "accept");

  const button = { tagName: "BUTTON", getAttribute: () => null, closest: () => null };
  assert.equal(reviewActionForKey({ key: "Enter", ctrlKey: true, target: button }), "accept");
});

test("review keys stand down inside an open dialog or menu", () => {
  // The dialog's own keyboard model owns Enter/Escape while it is open.
  const insideDialog = {
    isContentEditable: false,
    getAttribute: () => null,
    closest: (selector) => (selector.includes("dialog") ? {} : null),
  };
  assert.equal(reviewActionForKey({ key: "Enter", ctrlKey: true, target: insideDialog }), null);
});

test("unrelated keys are ignored", () => {
  assert.equal(reviewActionForKey({ key: "a", ctrlKey: true, target: null }), null);
  assert.equal(reviewActionForKey({ key: "ArrowLeft", ctrlKey: true, target: null }), null);
  assert.equal(reviewActionForKey({ key: "Delete", ctrlKey: true, target: null }), "dismiss");
  assert.equal(reviewActionForKey({ key: "Backspace", ctrlKey: true, target: null }), "dismiss");
});

test("announcement names the position, the change, and the keys", () => {
  const issue = makeIssue();
  const text = reviewAnnouncement(issue, 2, 8);
  assert.match(text, /3 of 8/u);
  assert.match(text, /Wordy phrase/u);
  assert.match(text, /Suggested: use\./u);
  // Without the key hints a keyboard user discovers nothing from the
  // announcement itself.
  assert.match(text, /Enter to accept/u);
  assert.match(text, /Backspace to ignore/u);
});

test("a finding with no automatic change says so instead of implying one", () => {
  const issue = makeIssue({ replacement: "", title: "Review wording" });
  const text = reviewAnnouncement(issue, 0, 1);
  assert.match(text, /No automatic change/u);
  // A single finding carries no "1 of 1" — it adds nothing.
  assert.doesNotMatch(text, /of 1/u);
});

test("the announcement falls back to the category when there is no title", () => {
  const issue = makeIssue({ title: "" });
  assert.match(reviewAnnouncement(issue, 0, 1), /conciseness/u);
});
