import type { WritingIssue } from "@/packages/types/src";

/**
 * Keyboard-driven suggestion review.
 *
 * The shortcuts dialog promises "keep your hands on the draft while you review
 * suggestions", but until this existed the only way to move between findings
 * was the mouse: every navigation went through a click on a card. Reviewing a
 * long draft meant repeatedly leaving the keyboard, and the two most common
 * actions — accept and ignore — had no binding at all.
 *
 * These are pure functions over the ordered visible list so the behaviour can
 * be tested without a DOM. Navigation follows the list the writer can see,
 * which is already sorted by tier then rank by `sortForReview`; stepping by
 * `start` offset instead would jump around the sidebar relative to the draft.
 */

export type ReviewAction = "next" | "previous" | "accept" | "dismiss";

/**
 * Where the review cursor should move.
 *
 * `wrap` keeps the writer inside the review loop: on the last finding, "next"
 * returns to the first rather than doing nothing, because the alternative is a
 * keypress that silently fails at the end of every draft.
 */
export function stepReviewIndex(current: number | null, total: number, action: "next" | "previous"): number {
  if (total <= 0) return -1;
  // No selection yet: either direction starts at the first finding, which is
  // the highest-priority one.
  if (current === null || current < 0 || current >= total) {
    return action === "next" ? 0 : total - 1;
  }
  const delta = action === "next" ? 1 : -1;
  return (current + delta + total) % total;
}

/**
 * Whether a keystroke should drive review rather than reach the document.
 *
 * The guard matters more than the mapping. Two hard rules, both learned from
 * real breakage:
 *
 * 1. Plain Tab and Enter are never claimed. Tab is how a keyboard user moves
 *    focus; stealing it would make the app unusable without a mouse, and Enter
 *    belongs to whatever control has focus (a focused button already activates
 *    on Enter — claiming it fires both). Every review binding carries a
 *    modifier instead.
 * 2. Nothing fires while focus is in a text-entry context, so review keys can
 *    never corrupt the draft. Arrow keys still move the caret normally.
 *
 * The DOM checks go through duck-typed lookups rather than `instanceof`. An
 * earlier version used `instanceof HTMLTextAreaElement`, which throws
 * "HTMLTextAreaElement is not defined" the moment this runs outside a browser —
 * it crashed the first test that imported it and would break any server-side
 * render of the same handler.
 *
 * Returns null when the event should be left alone.
 */
export function reviewActionForKey(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}): ReviewAction | null {
  const modifier = Boolean(event.ctrlKey || event.metaKey);
  // Without a modifier these keys belong to the document and the browser.
  if (!modifier || event.altKey) return null;

  const target = event.target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
    closest?: (selector: string) => unknown;
  } | null | undefined;
  if (!target) return keyToReviewAction(event);

  // Focus in the draft itself. These keys must reach the document untouched:
  // Ctrl+Backspace deletes a word, Ctrl+Arrow moves by word. Claiming them
  // while the caret is in the textarea would corrupt the writer's work.
  if (typeof target.getAttribute === "function" && target.getAttribute("data-review-guard") !== null) return null;

  const tag = typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
  if (tag === "TEXTAREA" || tag === "SELECT") return null;
  if (target.isContentEditable === true) return null;
  if (typeof target.getAttribute === "function" && target.getAttribute("role") === "textbox") return null;
  // A dialog or menu is open: its own keyboard model owns these keys.
  if (typeof target.closest === "function") {
    const overlay = target.closest("[role=\"dialog\"], [role=\"menu\"], [role=\"listbox\"]");
    if (overlay) return null;
  }

  return keyToReviewAction(event);
}

function keyToReviewAction(event: { key: string; shiftKey?: boolean }): ReviewAction | null {
  switch (event.key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "Backspace":
    case "Delete":
      return "dismiss";
    case "Enter":
      // Shift+Enter keeps its meaning of inserting a line break.
      return event.shiftKey ? null : "accept";
    default:
      return null;
  }
}

/** The finding a review action applies to, or null when there is nothing to do. */
export function issueForReviewAction(issues: WritingIssue[], index: number): WritingIssue | null {
  if (index < 0 || index >= issues.length) return null;
  return issues[index] ?? null;
}

/**
 * A live-region announcement for a review move.
 *
 * Keyboard users get no visual hover state, so the announcement is the only
 * confirmation that the cursor moved and what it landed on. It names the
 * position ("3 of 12") so the writer knows how much review remains, and states
 * whether the change is mechanical or a judgement call.
 */
export function reviewAnnouncement(issue: WritingIssue, position: number, total: number): string {
  const where = total > 1 ? `${position + 1} of ${total}. ` : "";
  const what = issue.title?.trim() || issue.category || "Suggestion";
  const change = issue.replacement && issue.replacement !== issue.original
    ? ` Suggested: ${issue.replacement}.`
    : " No automatic change; review the wording.";
  const keys = " Press Enter to accept, Backspace to ignore.";
  return `${where}${what}.${change}${keys}`;
}
