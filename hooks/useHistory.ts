"use client";

import { useCallback, useRef, useState } from "react";

export interface HistoryState<T> {
  values: T[];
  index: number;
}

const DEFAULT_HISTORY_LIMIT = 80;
const DEFAULT_HISTORY_CHAR_BUDGET = 2_000_000;

function defaultHistoryWeight(value: unknown) {
  return typeof value === "string" ? value.length : 0;
}

function trimHistory<T>(values: T[], limit: number, charBudget: number, weight: (value: T) => number) {
  const boundedLimit = Math.max(1, Math.floor(limit));
  const boundedBudget = Math.max(0, Math.floor(charBudget));
  const limited = values.slice(-boundedLimit);
  let totalWeight = 0;
  let start = limited.length - 1;

  // Always retain the newest state, even when one draft alone exceeds the budget.
  for (; start >= 0; start -= 1) {
    const itemWeight = Math.max(0, weight(limited[start]));
    if (start < limited.length - 1 && totalWeight + itemWeight > boundedBudget) break;
    totalWeight += itemWeight;
  }

  return limited.slice(Math.max(0, start + 1));
}

export function commitHistory<T>(
  current: HistoryState<T>,
  value: T,
  limit = DEFAULT_HISTORY_LIMIT,
  charBudget = DEFAULT_HISTORY_CHAR_BUDGET,
  weight: (value: T) => number = defaultHistoryWeight,
): HistoryState<T> {
  if (Object.is(current.values[current.index], value)) return current;
  const values = trimHistory([...current.values.slice(0, current.index + 1), value], limit, charBudget, weight);
  return { values, index: values.length - 1 };
}

export function stepHistory<T>(current: HistoryState<T>, direction: -1 | 1) {
  const index = Math.max(0, Math.min(current.values.length - 1, current.index + direction));
  const state = index === current.index ? current : { ...current, index };
  return { state, value: state.values[state.index] };
}

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
