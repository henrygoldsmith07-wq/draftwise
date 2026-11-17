import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("the trap can open on a named safe action instead of the first button", async () => {
  const [hook, overview] = await Promise.all([
    readFile(new URL("../hooks/useDialogFocusTrap.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/draftwise/DocumentOverview.tsx", import.meta.url), "utf8"),
  ]);

  // The new argument is optional, so the two existing callers keep working.
  assert.match(hook, /initialFocusRef\?: \{ readonly current: HTMLElement \| null \},/u);
  assert.match(hook, /const initial = requested && requested\.isConnected \? requested : \(focusables\(\)\[0\] \?\? dialog\);/u);
  assert.match(hook, /focusItem\(initial\);/u);
  assert.match(hook, /element\.scrollIntoView\(\{ block: "nearest" \}\)/u);
  // Escape, Tab cycling and return focus still come from the one shared route.
  assert.match(hook, /event\.key === "Escape"/u);
  assert.match(hook, /closeRef\.current\(\);/u);
  assert.match(hook, /nextTrapIndex\(current, items\.length, event\.shiftKey\)/u);
  assert.match(hook, /fallback && fallback\.isConnected \? fallback : previouslyFocused/u);

  // The bulk-dismiss alertdialog used to open on the destructive "Dismiss all"
  // button; it now names the safe "Keep them" action as its initial focus.
  assert.match(overview, /const keepRef = useRef<HTMLButtonElement \| null>\(null\)/u);
  assert.match(overview, /useDialogFocusTrap<HTMLDivElement>\(batchConfirm, closeBatchConfirm, batchTriggerRef, keepRef\)/u);
  assert.match(overview, /<button type="button" ref=\{keepRef\} onClick=\{\(\) => setBatchConfirm\(false\)\}>Keep them<\/button>/u);
  assert.match(overview, /role="alertdialog" aria-modal="true" tabIndex=\{-1\}/u);
});

test("dialogs capture the opener on every open, not once at mount", async () => {
  // Settings stays mounted for the session and can be opened from different
  // controls in different views. Capturing the opener in a mount-only effect
  // restored focus to the first opener forever, and lost focus entirely when
  // that control had since unmounted.
  const shared = await readFile(new URL("../components/ui/dialog.tsx", import.meta.url), "utf8");
  assert.match(shared, /onOpenAutoFocus=\{\(event\) => \{[\s\S]{0,400}openerRef\.current = document\.activeElement/u);
  assert.doesNotMatch(shared, /React\.useEffect\(\(\) => \{\s*if \(typeof document [\s\S]{0,160}openerRef\.current/u);
});
