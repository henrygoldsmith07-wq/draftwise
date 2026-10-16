/**
 * Shared keyboard contract for the hand-rolled dialogs (the version-preview
 * dialog and the bulk-dismiss confirmation). Radix-based dialogs bring their
 * own focus management; these two are plain divs, so they share this instead
 * of reimplementing trapping twice.
 *
 * The React hook lives in hooks/useDialogFocusTrap.ts. Everything in this
 * module is deliberately framework-free so the cycling logic can be unit
 * tested without a DOM or React.
 */

/** Elements a keyboard user can reach, in dialog order. */
export const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * The next index in a focus trap: Tab advances, Shift+Tab retreats, and both
 * wrap around instead of letting focus leave the dialog. Out-of-range input
 * clamps to the first item rather than producing an index that focuses
 * nothing.
 */
export function nextTrapIndex(current: number, count: number, backwards: boolean): number {
  if (!Number.isInteger(count) || count <= 0) return 0;
  if (!Number.isInteger(current) || current < 0 || current >= count) return 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}
