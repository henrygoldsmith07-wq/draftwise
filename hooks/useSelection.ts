"use client";

import { useCallback, useMemo, useState } from "react";
import { clampSelection } from "../lib/selection.ts";

// clampSelection lives in lib/selection.ts; this re-export keeps existing
// import paths working.
export * from "../lib/selection.ts";

export function useSelection(text: string) {
  const [storedSelection, setStoredSelection] = useState({ start: 0, end: 0 });
  const selection = useMemo(() => clampSelection(storedSelection, text.length), [storedSelection, text.length]);

  const setSelection = useCallback((next: { start: number; end: number } | ((current: { start: number; end: number }) => { start: number; end: number })) => {
    setStoredSelection((current) => {
      const clamped = clampSelection(current, text.length);
      const value = typeof next === "function" ? next(clamped) : next;
      return clampSelection(value, text.length);
    });
  }, [text.length]);

  const updateFromElement = useCallback((element: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (!element) return;
    setStoredSelection(clampSelection({ start: element.selectionStart ?? 0, end: element.selectionEnd ?? 0 }, text.length));
  }, [text.length]);

  const selectedText = useMemo(() => text.slice(selection.start, selection.end), [selection, text]);
  return { selection, selectedText, updateFromElement, setSelection };
}
