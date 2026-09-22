import assert from "node:assert/strict";
import test from "node:test";
import { commitHistory, stepHistory } from "../hooks/useHistory.ts";
import { clampSelection } from "../hooks/useSelection.ts";

test("rapid history commits preserve every intermediate undo point", () => {
  let state = { values: ["a"], index: 0 };
  state = commitHistory(state, "ab", 80);
  state = commitHistory(state, "abc", 80);
  assert.deepEqual(state, { values: ["a", "ab", "abc"], index: 2 });
  const firstUndo = stepHistory(state, -1);
  assert.equal(firstUndo.value, "ab");
  const secondUndo = stepHistory(firstUndo.state, -1);
  assert.equal(secondUndo.value, "a");
});

test("committing after undo discards only the redo branch", () => {
  const state = { values: ["a", "ab", "abc"], index: 1 };
  const next = commitHistory(state, "abd", 80);
  assert.deepEqual(next, { values: ["a", "ab", "abd"], index: 2 });
});

test("history limits retain the newest states and valid index", () => {
  let state = { values: ["a"], index: 0 };
  for (const value of ["b", "c", "d"]) state = commitHistory(state, value, 2);
  assert.deepEqual(state, { values: ["c", "d"], index: 1 });
});

test("large string histories stay within the character budget", () => {
  let state = { values: ["aaaa"], index: 0 };
  state = commitHistory(state, "bbbbb", 80, 12);
  state = commitHistory(state, "cccccc", 80, 12);
  assert.deepEqual(state, { values: ["bbbbb", "cccccc"], index: 1 });
});

test("history always retains the newest draft when it alone exceeds the budget", () => {
  const state = commitHistory({ values: ["small"], index: 0 }, "x".repeat(20), 80, 10);
  assert.deepEqual(state, { values: ["x".repeat(20)], index: 0 });
});

test("selection ranges clamp to the current document length", () => {
  assert.deepEqual(clampSelection({ start: 8, end: 20 }, 10), { start: 8, end: 10 });
  assert.deepEqual(clampSelection({ start: 20, end: 30 }, 10), { start: 10, end: 10 });
  assert.deepEqual(clampSelection({ start: -5, end: 4 }, 10), { start: 0, end: 4 });
});
