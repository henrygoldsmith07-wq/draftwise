"use client";

import { useCallback, useMemo, useState } from "react";

export function useSelection(text: string) {
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const updateFromElement = useCallback((element: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (!element) return;
    setSelection({ start: element.selectionStart ?? 0, end: element.selectionEnd ?? 0 });
  }, []);
  const selectedText = useMemo(() => text.slice(selection.start, selection.end), [selection, text]);
  return { selection, selectedText, updateFromElement, setSelection };
}
