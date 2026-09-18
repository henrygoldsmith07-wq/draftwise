"use client";

import { useCallback, useState } from "react";

export function useHistory<T>(initial: T, limit = 80) {
  const [values, setValues] = useState<T[]>([initial]);
  const [index, setIndex] = useState(0);

  const commit = useCallback((value: T) => {
    setValues((current) => {
      if (Object.is(current[index], value)) return current;
      const next = [...current.slice(0, index + 1), value].slice(-limit);
      setIndex(next.length - 1);
      return next;
    });
  }, [index, limit]);

  const undo = useCallback(() => {
    if (index === 0) return values[0];
    const next = index - 1;
    setIndex(next);
    return values[next];
  }, [index, values]);

  const redo = useCallback(() => {
    if (index >= values.length - 1) return values[index];
    const next = index + 1;
    setIndex(next);
    return values[next];
  }, [index, values]);

  const reset = useCallback((value: T) => {
    setValues([value]);
    setIndex(0);
  }, []);

  return { value: values[index], commit, undo, redo, reset, canUndo: index > 0, canRedo: index < values.length - 1 };
}
