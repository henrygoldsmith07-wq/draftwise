/**
 * Selection clamping: keep a text selection inside the document bounds.
 *
 * Framework-free on purpose, split out of hooks/useSelection for the same
 * reason as the other pure helpers: tests and lib consumers should not
 * import React to clamp two numbers.
 */

export function clampSelection(selection: { start: number; end: number }, length: number) {
  const safeLength = Math.max(0, Math.floor(length));
  const start = Math.max(0, Math.min(safeLength, selection.start));
  const end = Math.max(start, Math.min(safeLength, selection.end));
  return start === selection.start && end === selection.end ? selection : { start, end };
}
