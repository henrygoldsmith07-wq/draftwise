"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createDocumentBackend, summariseDocuments, type DocumentSummary, type DocumentReview, type StoredDocument } from "@/lib/documents";
import { DocumentLifecycle, type DocumentSaveStatus, type DocumentsSeed } from "@/lib/document-lifecycle";

/**
 * Thin React adapter over DocumentLifecycle, which owns the document state,
 * identity and persistence. The editor reads `active` and reports changes;
 * nothing here duplicates lifecycle logic.
 *
 * The lifecycle instance is created once via a lazy state initializer rather
 * than a render-phase ref write, so React's render rules stay satisfied.
 *
 * `preferredActiveId` is workspace metadata (the last-opened document). When it
 * names a document that still exists, reopening Draftwise restores it; when it
 * is stale, the lifecycle falls back to the most recently edited document.
 */
export function useDocuments(seed: DocumentsSeed, ready = true, preferredActiveId?: string) {
  const [lifecycle] = useState(() => new DocumentLifecycle(createDocumentBackend(), seed));
  const state = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshot, lifecycle.getSnapshot);

  // Load only once the caller says its seed is authoritative. `load` memoizes
  // its own promise, so repeat calls are harmless and the first
  // `preferredActiveId` wins — which is the last-opened document at hydration.
  useEffect(() => {
    if (ready) void lifecycle.load(seed, preferredActiveId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed identity changes every render; load is memoized and takes the first call only.
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

  // Lifecycle methods are instance state that must keep their `this`: returning
  // bare references and calling them detached crashes the render (this.state is
  // undefined). Every method is wrapped so callers cannot destructure them
  // into a broken call.
  return {
    documents: state.documents,
    summaries,
    active: active as StoredDocument | null,
    activeId: state.activeId,
    hydrated: state.hydrated,
    saveStatus: state.saveStatus as DocumentSaveStatus,
    storageMode: state.storageMode,
    open: useCallback((id: string) => lifecycle.open(id), [lifecycle]),
    updateActive: useCallback((patch: Partial<Pick<StoredDocument, "title" | "draft">>, snapshot?: "autosave" | "manual" | "import") => lifecycle.updateActive(patch, snapshot), [lifecycle]),
    recordReview: useCallback((review: DocumentReview) => lifecycle.recordReview(review), [lifecycle]),
    updateDocument: useCallback((id: string, patch: Partial<Pick<StoredDocument, "title" | "draft" | "review">>, snapshot?: "autosave" | "manual" | "import") => lifecycle.updateDocument(id, patch, snapshot), [lifecycle]),
    createNew: useCallback((title?: string, draft?: string) => lifecycle.createNew(title, draft), [lifecycle]),
    duplicate: useCallback((id: string) => lifecycle.duplicate(id), [lifecycle]),
    remove: useCallback((id: string) => lifecycle.remove(id), [lifecycle]),
    saveSnapshot: useCallback((reason?: "autosave" | "manual" | "import") => lifecycle.saveSnapshot(reason), [lifecycle]),
    restoreSnapshot: useCallback((documentId: string, snapshotId: string) => lifecycle.restoreSnapshot(documentId, snapshotId), [lifecycle]),
    duplicateSnapshot: useCallback((documentId: string, snapshotId: string) => lifecycle.duplicateSnapshot(documentId, snapshotId), [lifecycle]),
    clearAll: useCallback((freshSeed?: DocumentsSeed) => lifecycle.clearAll(freshSeed), [lifecycle]),
    flush: useCallback(() => lifecycle.flush(), [lifecycle]),
  };
}
