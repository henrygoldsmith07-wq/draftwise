"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export function clampSelection(selection: { start: number; end: number }, length: number) {
  const safeLength = Math.max(0, Math.floor(length));
  const start = Math.max(0, Math.min(safeLength, selection.start));
  const end = Math.max(start, Math.min(safeLength, selection.end));
  return start === selection.start && end === selection.end ? selection : { start, end };
}

export function useSelection(text: string) {
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  useEffect(() => {
    setSelection((current) => clampSelection(current, text.length));
  }, [text.length]);

  const updateFromElement = useCallback((element: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (!element) return;
    setSelection({ start: element.selectionStart ?? 0, end: element.selectionEnd ?? 0 });
  }, []);
  const selectedText = useMemo(() => text.slice(selection.start, selection.end), [selection, text]);
  return { selection, selectedText, updateFromElement, setSelection };
}
