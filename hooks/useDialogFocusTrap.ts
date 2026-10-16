"use client";

import { useEffect, useRef } from "react";
import { DIALOG_FOCUSABLE_SELECTOR, nextTrapIndex } from "@/lib/dialog-focus";

/**
 * Focus management for the hand-rolled dialogs.
 *
 * While `open`, the dialog keeps keyboard focus inside itself: opening moves
 * focus to its first control (or the dialog shell when it has none), Tab and
 * Shift+Tab cycle instead of escaping, and Escape calls `onClose`. Closing
 * returns focus to whatever held it before the dialog opened — or to
 * `returnFocusRef` when that element is gone, which happens when the trigger
 * unmounts while its confirmation is showing.
 *
 * The effect only touches the DOM (focus, listeners). It never calls setState,
 * so the render-then-effect cascade the set-state-in-effect rule guards
 * against cannot happen here.
 */
export function useDialogFocusTrap<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  // Read-only so any element ref (button, div) is accepted without a cast:
  // the hook only ever reads `.current`.
  returnFocusRef?: { readonly current: HTMLElement | null },
) {
  const dialogRef = useRef<T | null>(null);
  const closeRef = useRef(onClose);
  const returnRef = useRef(returnFocusRef);

  useEffect(() => {
    if (!open) return;
    closeRef.current = onClose;
    returnRef.current = returnFocusRef;
    const dialog = dialogRef.current;
    if (!dialog || typeof document === "undefined") return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)];
    (focusables()[0] ?? dialog).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = current === -1
        ? (event.shiftKey ? items.length - 1 : 0)
        : nextTrapIndex(current, items.length, event.shiftKey);
      event.preventDefault();
      items[next]?.focus({ preventScroll: true });
    };
    // Capture phase so a nested stopPropagation (e.g. inside a card button)
    // cannot let Tab slip out of the dialog unnoticed.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const fallback = returnRef.current?.current;
      const target = fallback && fallback.isConnected ? fallback : previouslyFocused;
      if (target && target.isConnected) target.focus({ preventScroll: true });
    };
  }, [open, onClose, returnFocusRef]);

  return dialogRef;
}
