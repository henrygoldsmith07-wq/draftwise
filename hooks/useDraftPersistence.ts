"use client";

import { useCallback, useEffect, useState } from "react";
import type { DraftwiseWorkspace } from "@/packages/types/src";

export const WORKSPACE_STORAGE_KEY = "draftwise:workspace:v2";
export const LEGACY_STORAGE_KEYS = [
  "draftwise:draft",
  "draftwise:goals",
  "draftwise:provider",
  "draftwise:theme",
  "draftwise:ai-enabled",
] as const;

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function readLegacyWorkspace(initial: DraftwiseWorkspace, storage: WorkspaceStorage): DraftwiseWorkspace {
  const read = (key: string) => storage.getItem(key);
  const draft = read("draftwise:draft");
  const goals = read("draftwise:goals");
  const provider = read("draftwise:provider");
  const theme = read("draftwise:theme");
  const aiEnabled = read("draftwise:ai-enabled");
  let next = { ...initial };
  if (draft !== null) next = { ...next, draft };
  if (goals) {
    try { next = { ...next, goals: { ...next.goals, ...JSON.parse(goals) } }; } catch { /* Ignore malformed legacy state. */ }
  }
  if (provider) {
    try { next = { ...next, provider: { ...next.provider, ...JSON.parse(provider) } }; } catch { /* Ignore malformed legacy state. */ }
  }
  if (theme === "dark" || theme === "light" || theme === "system") next = { ...next, theme };
  if (aiEnabled !== null) next = { ...next, aiEnabled: aiEnabled === "true" };
  return next;
}

export function readWorkspaceFromStorage(initial: DraftwiseWorkspace, storage: WorkspaceStorage): DraftwiseWorkspace {
  try {
    const stored = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (!stored) return readLegacyWorkspace(initial, storage);
    const parsed = JSON.parse(stored) as Partial<DraftwiseWorkspace>;
    return {
      ...initial,
      ...parsed,
      version: 2 as const,
      goals: { ...initial.goals, ...(parsed.goals ?? {}) },
      style: { ...initial.style, ...(parsed.style ?? {}) },
      provider: { ...initial.provider, ...(parsed.provider ?? {}) },
      classifier: { ...(initial.classifier ?? { baseUrl: "https://classifier.dev/v1", model: "draftwise-triage-v1", apiKey: "" }), ...(parsed.classifier ?? {}) },
    };
  } catch {
    return initial;
  }
}

export function useDraftPersistence(initial: DraftwiseWorkspace) {
  const [workspace, setWorkspace] = useState(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = readWorkspaceFromStorage(initial, window.localStorage);
      setWorkspace(loaded);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initial]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
  }, [hydrated, workspace]);

  const updateWorkspace = useCallback((patch: Partial<DraftwiseWorkspace> | ((current: DraftwiseWorkspace) => DraftwiseWorkspace)) => {
    setWorkspace((current) => typeof patch === "function" ? patch(current) : { ...current, ...patch });
  }, []);

  const clearLocalData = useCallback(() => {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
    setWorkspace(initial);
  }, [initial]);

  return { workspace, setWorkspace, updateWorkspace, hydrated, savedAt: hydrated ? 1 : null, clearLocalData };
}
