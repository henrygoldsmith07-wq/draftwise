"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDocument,
  createDocumentBackend,
  countWords,
  recordSnapshot,
  sanitiseStoredDocument,
  summariseDocuments,
  type DocumentStoreBackend,
  type DocumentSummary,
  type StoredDocument,
} from "@/lib/documents";

export type DocumentSaveStatus = "idle" | "saving" | "saved" | "error";

export function useDocuments(initialDocument: StoredDocument) {
  const backendRef = useRef<DocumentStoreBackend | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [activeId, setActiveId] = useState<string>(initialDocument.id);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<DocumentSaveStatus>("idle");
  const saveTimer = useRef<number | null>(null);
  const pendingWrite = useRef<StoredDocument | null>(null);

  useEffect(() => {
    backendRef.current = createDocumentBackend();
    let cancelled = false;
    void (async () => {
      const backend = backendRef.current;
      if (!backend) return;
      const stored = await backend.list();
      if (cancelled) return;
      if (stored.length === 0) {
        await backend.put(initialDocument);
        if (cancelled) return;
        setDocuments([initialDocument]);
      } else {
        setDocuments(stored);
        setActiveId((current) => (stored.some((document) => document.id === current) ? current : stored[0].id));
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [initialDocument]);

  const active = useMemo(
    () => documents.find((document) => document.id === activeId) ?? documents[0] ?? initialDocument,
    [activeId, documents, initialDocument],
  );

  const flush = useCallback(async () => {
    const backend = backendRef.current;
    const document = pendingWrite.current;
    if (!backend || !document) return;
    pendingWrite.current = null;
    setSaveStatus("saving");
    try {
      await backend.put(document);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }, []);

  const persist = useCallback((document: StoredDocument, snapshotReason?: "autosave" | "manual" | "import") => {
    const next = snapshotReason ? recordSnapshot({ ...document, wordCount: countWords(document.draft) }, snapshotReason) : { ...document, wordCount: countWords(document.draft) };
    setDocuments((current) => current.map((item) => (item.id === next.id ? next : item)));
    pendingWrite.current = next;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), 600);
  }, [flush]);

  const updateActive = useCallback((patch: Partial<Pick<StoredDocument, "title" | "draft">>, snapshotReason?: "autosave" | "manual") => {
    const current = documents.find((document) => document.id === activeId);
    if (!current) return;
    const next: StoredDocument = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
      wordCount: patch.draft !== undefined ? countWords(patch.draft) : current.wordCount,
    };
    persist(next, snapshotReason ?? "autosave");
  }, [activeId, documents, persist]);

  const createNew = useCallback((title = "Untitled draft", draft = "") => {
    const document = createDocument(title, draft);
    setDocuments((current) => [document, ...current]);
    setActiveId(document.id);
    pendingWrite.current = document;
    void (async () => {
      await backendRef.current?.put(document);
      setSaveStatus("saved");
    })();
    return document;
  }, []);

  const duplicate = useCallback((id: string) => {
    const source = documents.find((document) => document.id === id);
    if (!source) return null;
    const copy = createDocument(`${source.title} (copy)`, source.draft);
    setDocuments((current) => [copy, ...current]);
    setActiveId(copy.id);
    pendingWrite.current = copy;
    void (async () => {
      await backendRef.current?.put(copy);
      setSaveStatus("saved");
    })();
    return copy;
  }, [documents]);

  const remove = useCallback((id: string) => {
    setDocuments((current) => {
      const next = current.filter((document) => document.id !== id);
      if (id === activeId && next[0]) setActiveId(next[0].id);
      return next;
    });
    void backendRef.current?.remove(id);
  }, [activeId]);

  const saveSnapshot = useCallback(() => {
    const current = documents.find((document) => document.id === activeId);
    if (!current) return;
    persist(current, "manual");
    void flush();
  }, [activeId, documents, flush, persist]);

  const summaries = useMemo(() => summariseDocuments(documents), [documents]);

  return {
    documents,
    summaries: summaries as DocumentSummary[],
    active: sanitiseStoredDocument(active) ?? active,
    activeId: active.id,
    hydrated,
    saveStatus,
    setActiveId,
    updateActive,
    createNew,
    duplicate,
    remove,
    saveSnapshot,
    flush,
  };
}
