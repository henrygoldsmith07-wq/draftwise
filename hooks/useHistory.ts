"use client";

import { useCallback, useRef, useState } from "react";
import {
  commitHistory,
  stepHistory,
  type HistoryState,
} from "../lib/editor-history.ts";

// Pure history logic lives in lib/editor-history.ts; this re-export keeps
// existing import paths working.
export * from "../lib/editor-history.ts";

export function useHistory<T>(
  initial: T,
  limit = DEFAULT_HISTORY_LIMIT,
  charBudget = DEFAULT_HISTORY_CHAR_BUDGET,
  weight: (value: T) => number = defaultHistoryWeight,
) {
  const [history, setHistory] = useState<HistoryState<T>>({ values: [initial], index: 0 });
  const historyRef = useRef(history);

  const publish = useCallback((next: HistoryState<T>) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const commit = useCallback((value: T) => {
    const next = commitHistory(historyRef.current, value, limit, charBudget, weight);
    if (next !== historyRef.current) publish(next);
  }, [charBudget, limit, publish, weight]);

  const undo = useCallback(() => {
    const result = stepHistory(historyRef.current, -1);
    if (result.state !== historyRef.current) publish(result.state);
    return result.value;
  }, [publish]);

  const redo = useCallback(() => {
    const result = stepHistory(historyRef.current, 1);
    if (result.state !== historyRef.current) publish(result.state);
    return result.value;
  }, [publish]);

  const reset = useCallback((value: T) => {
    publish({ values: [value], index: 0 });
  }, [publish]);

  return {
    value: history.values[history.index],
    commit,
    undo,
    redo,
    reset,
    canUndo: history.index > 0,
    canRedo: history.index < history.values.length - 1,
  };
}
