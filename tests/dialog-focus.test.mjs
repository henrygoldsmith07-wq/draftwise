import assert from "node:assert/strict";
import test from "node:test";
import { DIALOG_FOCUSABLE_SELECTOR, nextTrapIndex } from "../lib/dialog-focus.ts";

/**
 * The focus trap's cycling logic, without a DOM.
 *
 * Tab order inside a dialog is safety-critical for keyboard and screen-reader
 * users — a wrong index strands focus on nothing or lets it escape behind the
 * dialog — and it is pure arithmetic, so it is pinned here rather than trusted
 * to code review alone.
 */

test("tab advances and wraps around the end of the dialog", () => {
  assert.equal(nextTrapIndex(0, 3, false), 1);
  assert.equal(nextTrapIndex(1, 3, false), 2);
  assert.equal(nextTrapIndex(2, 3, false), 0);
});

test("shift+tab retreats and wraps around the start of the dialog", () => {
  assert.equal(nextTrapIndex(2, 3, true), 1);
  assert.equal(nextTrapIndex(1, 3, true), 0);
  assert.equal(nextTrapIndex(0, 3, true), 2);
});

test("a single-control dialog keeps focus where it is", () => {
  assert.equal(nextTrapIndex(0, 1, false), 0);
  assert.equal(nextTrapIndex(0, 1, true), 0);
});

test("garbage input focuses the first item instead of nothing", () => {
  assert.equal(nextTrapIndex(-1, 3, false), 0);
  assert.equal(nextTrapIndex(9, 3, true), 0);
  assert.equal(nextTrapIndex(0, 0, false), 0);
});

test("the focusable selector covers interactive elements and skips disabled ones", () => {
  for (const token of ["a[href]", "button:not([disabled])", "textarea", "input", "select", '[tabindex]:not([tabindex="-1"])']) {
    assert.ok(DIALOG_FOCUSABLE_SELECTOR.includes(token), `selector should include ${token}`);
  }
});
