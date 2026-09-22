"use client";

import { useCallback, useRef, useState } from "react";

export interface HistoryState<T> {
  values: T[];
  index: number;
}

export function commitHistory<T>(current: HistoryState<T>, value: T, limit = 80): HistoryState<T> {
  if (Object.is(current.values[current.index], value)) return current;
  const boundedLimit = Math.max(1, Math.floor(limit));
  const values = [...current.values.slice(0, current.index + 1), value].slice(-boundedLimit);
  return { values, index: values.length - 1 };
}

export function stepHistory<T>(current: HistoryState<T>, direction: -1 | 1) {
  const index = Math.max(0, Math.min(current.values.length - 1, current.index + direction));
  const state = index === current.index ? current : { ...current, index };
  return { state, value: state.values[state.index] };
}

export function useHistory<T>(initial: T, limit = 80) {
  const [history, setHistory] = useState<HistoryState<T>>({ values: [initial], index: 0 });
  const historyRef = useRef(history);

  const publish = useCallback((next: HistoryState<T>) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const commit = useCallback((value: T) => {
    const next = commitHistory(historyRef.current, value, limit);
    if (next !== historyRef.current) publish(next);
  }, [limit, publish]);

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
