"use client";

import { useCallback, useMemo, useState } from "react";

export function clampSelection(selection: { start: number; end: number }, length: number) {
  const safeLength = Math.max(0, Math.floor(length));
  const start = Math.max(0, Math.min(safeLength, selection.start));
  const end = Math.max(start, Math.min(safeLength, selection.end));
  return start === selection.start && end === selection.end ? selection : { start, end };
}

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
