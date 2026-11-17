import assert from "node:assert/strict";
import test from "node:test";
import { ActivityFoldTracker } from "../lib/activity-fold.ts";

test("words typed before the first interval are credited on a page-exit fold", () => {
  const tracker = new ActivityFoldTracker();
  tracker.activate("doc-1", "");

  tracker.noteEdit("doc-1", "one two three four five");
  const folded = tracker.fold();

  assert.equal(folded?.documentId, "doc-1");
  assert.equal(folded?.credited, 5, "the first tick must not seed the baseline from post-edit text");
  assert.equal(tracker.fold(), null, "a second fold is a no-op");
});

test("switching documents folds the old draft against its own baseline", () => {
  const tracker = new ActivityFoldTracker();
  tracker.activate("a", "");
  tracker.noteEdit("a", "alpha beta");
  tracker.activate("b", "existing words here");

  const foldedOnSwitch = tracker.fold();
  assert.equal(foldedOnSwitch?.documentId, "a");
  assert.equal(foldedOnSwitch?.credited, 2);

  tracker.noteEdit("b", "existing words here plus four new ones");
  const foldedB = tracker.fold();
  assert.equal(foldedB?.documentId, "b");
  assert.equal(foldedB?.credited, 4, "b's pre-existing words are not credited again");
});

test("a pending edit is not lost when the same document is re-activated", () => {
  const tracker = new ActivityFoldTracker();
  tracker.activate("a", "");
  tracker.noteEdit("a", "new words");
  tracker.activate("a", "new words");

  assert.equal(tracker.fold()?.credited, 2);
});

test("replacing a draft (import/restore) does not credit its words", () => {
  const tracker = new ActivityFoldTracker();
  tracker.activate("a", "");
  tracker.replace("a", "a whole imported document with many words");

  assert.equal(tracker.fold(), null);
  tracker.noteEdit("a", "a whole imported document with many words and one more");
  assert.equal(tracker.fold()?.credited, 3);
});
