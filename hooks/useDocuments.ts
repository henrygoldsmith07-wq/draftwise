"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createDocumentBackend, summariseDocuments, type DocumentSummary, type StoredDocument } from "@/lib/documents";
import { DocumentLifecycle, type DocumentSaveStatus, type DocumentsSeed } from "@/lib/document-lifecycle";

/**
 * Thin React adapter over DocumentLifecycle, which owns the document state,
 * identity and persistence. The editor mirrors `active` and reports changes;
 * nothing here duplicates lifecycle logic.
 *
 * The lifecycle instance is created once via a lazy state initializer rather
 * than a render-phase ref write, so React's render rules stay satisfied.
 */
export function useDocuments(seed: DocumentsSeed, ready = true) {
  const [lifecycle] = useState(() => new DocumentLifecycle(createDocumentBackend(), seed));
  const state = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot, lifecycle.getSnapshot);

  // Load only once the caller says its seed is authoritative, so a restored
  // workspace draft becomes the first document instead of being orphaned.
  // `load` memoizes its own promise, so repeat calls are harmless.
  useEffect(() => {
    if (ready) void lifecycle.load(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed identity changes every render; load is memoized and takes the first seed only.
  }, [lifecycle, ready]);

  // Page exit: flush queued writes so closing the tab cannot lose work.
  useEffect(() => {
    const flushSync = () => lifecycle.flushSync();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") lifecycle.flushSync();
    };
    window.addEventListener("beforeunload", flushSync);
    window.addEventListener("pagehide", flushSync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flushSync);
      window.removeEventListener("pagehide", flushSync);
      document.removeEventListener("visibilitychange", onVisibility);
      lifecycle.flushSync();
    };
  }, [lifecycle]);

  const active = useMemo(
    () => state.documents.find((document) => document.id === state.activeId) ?? null,
    [state.activeId, state.documents],
  );
  const summaries = useMemo(() => summariseDocuments(state.documents) as DocumentSummary[], [state.documents]);

  return {
    documents: state.documents,
    summaries,
    active: active as StoredDocument | null,
    activeId: state.activeId,
    hydrated: state.hydrated,
    saveStatus: state.saveStatus as DocumentSaveStatus,
    open: lifecycle.open,
    updateActive: lifecycle.updateActive,
    updateDocument: lifecycle.updateDocument,
    createNew: lifecycle.createNew,
    duplicate: lifecycle.duplicate,
    remove: lifecycle.remove,
    saveSnapshot: lifecycle.saveSnapshot,
    restoreSnapshot: lifecycle.restoreSnapshot,
    duplicateSnapshot: lifecycle.duplicateSnapshot,
    clearAll: lifecycle.clearAll,
    flush: lifecycle.flush,
  };
}
