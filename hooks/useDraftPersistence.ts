"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftwiseWorkspace } from "../packages/types/src/index.ts";
import {
  AUTO_SAVE_DELAY_MS,
  clearWorkspaceStorage,
  readWorkspaceFromStorage,
  resolveHydratedWorkspace,
  writeWorkspaceToStorage,
  type SaveStatus,
} from "../lib/workspace-storage.ts";

// Every pure helper lives in lib/workspace-storage.ts. This re-export keeps
// existing import paths working while new code imports from lib directly.
export * from "../lib/workspace-storage.ts";

export function useDraftPersistence(initial: DraftwiseWorkspace) {
  const [workspace, setWorkspaceState] = useState(initial);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const workspaceRef = useRef(initial);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  const persistCurrent = useCallback(() => {
    const result = writeWorkspaceToStorage(workspaceRef.current, window.localStorage);
    if (result.ok) {
      dirtyRef.current = false;
      setLastSavedAt(Date.now());
      setSaveStatus("saved");
      setSaveError(null);
    } else {
      setSaveStatus("error");
      setSaveError(result.error);
    }
    return result;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let loaded = initial;
      try {
        loaded = readWorkspaceFromStorage(initial, window.localStorage);
      } catch {
        loaded = initial;
      }
      const wasDirty = dirtyRef.current;
      const resolved = resolveHydratedWorkspace(workspaceRef.current, loaded, wasDirty);
      workspaceRef.current = resolved;
      if (!wasDirty) {
        dirtyRef.current = false;
        setWorkspaceState(resolved);
      }
      setHydrated(true);
      setSaveStatus(wasDirty ? "saving" : "idle");
      setSaveError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initial]);

  useEffect(() => {
    if (!hydrated || !dirtyRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    setSaveError(null);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      persistCurrent();
    }, AUTO_SAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [hydrated, persistCurrent, workspace]);

  useEffect(() => {
    if (!hydrated) return;
    const flushPendingSave = () => {
      if (!dirtyRef.current) return;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const result = writeWorkspaceToStorage(workspaceRef.current, window.localStorage);
      if (result.ok) dirtyRef.current = false;
    };
    window.addEventListener("pagehide", flushPendingSave);
    return () => window.removeEventListener("pagehide", flushPendingSave);
  }, [hydrated]);

  const updateWorkspace = useCallback((patch: Partial<DraftwiseWorkspace> | ((current: DraftwiseWorkspace) => DraftwiseWorkspace)) => {
    const current = workspaceRef.current;
    const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
    workspaceRef.current = next;
    dirtyRef.current = true;
    setWorkspaceState(next);
  }, []);

  const replaceWorkspace = useCallback((next: DraftwiseWorkspace | ((current: DraftwiseWorkspace) => DraftwiseWorkspace)) => {
    const value = typeof next === "function" ? next(workspaceRef.current) : next;
    workspaceRef.current = value;
    dirtyRef.current = true;
    setWorkspaceState(value);
  }, []);

  const saveNow = useCallback(() => {
    if (!hydrated) return { ok: false as const, error: "Draft is still loading." };
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaveStatus("saving");
    setSaveError(null);
    return persistCurrent();
  }, [hydrated, persistCurrent]);

  const clearLocalData = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const result = clearWorkspaceStorage(window.localStorage);
    workspaceRef.current = initial;
    dirtyRef.current = false;
    setWorkspaceState(initial);
    setLastSavedAt(null);
    if (result.ok) {
      setSaveError(null);
      setSaveStatus("idle");
    } else {
      setSaveStatus("error");
      setSaveError(result.error);
    }
  }, [initial]);

  return {
    workspace,
    setWorkspace: replaceWorkspace,
    updateWorkspace,
    hydrated,
    saveStatus,
    lastSavedAt,
    saveError,
    saveNow,
    clearLocalData,
  };
}
