"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export function useSelection(text: string) {
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  useEffect(() => {
    setSelection((current) => {
      const start = Math.max(0, Math.min(text.length, current.start));
      const end = Math.max(start, Math.min(text.length, current.end));
      return start === current.start && end === current.end ? current : { start, end };
    });
  }, [text.length]);

  const updateFromElement = useCallback((element: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (!element) return;
    setSelection({ start: element.selectionStart ?? 0, end: element.selectionEnd ?? 0 });
  }, []);
  const selectedText = useMemo(() => text.slice(selection.start, selection.end), [selection, text]);
  return { selection, selectedText, updateFromElement, setSelection };
}
