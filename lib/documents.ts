/**
 * Local-first document store.
 *
 * Drafts live in IndexedDB on the device, with a localStorage fallback for
 * environments without it (and for the Node test suite). No account, no server:
 * the store is the browser's own storage and nothing leaves it.
 *
 * The shape is deliberately plain: one row per document plus bounded version
 * snapshots, so a writer can duplicate, rename, search and restore without any
 * cloud involvement.
 */

export interface DocumentSnapshot {
  id: string;
  text: string;
  title: string;
  createdAt: number;
  reason: "autosave" | "manual" | "import";
}

export interface StoredDocument {
  id: string;
  title: string;
  draft: string;
  createdAt: number;
  updatedAt: number;
  wordCount: number;
  snapshots: DocumentSnapshot[];
}

export interface DocumentSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  wordCount: number;
  excerpt: string;
}

export interface DocumentStoreBackend {
  list(): Promise<StoredDocument[]>;
  get(id: string): Promise<StoredDocument | null>;
  put(document: StoredDocument): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const DOCUMENTS_DB_NAME = "draftwise-documents";
export const DOCUMENTS_DB_VERSION = 1;
export const DOCUMENTS_STORE = "documents";
export const MAX_SNAPSHOTS_PER_DOCUMENT = 10;
export const SNAPSHOT_MIN_INTERVAL_MS = 30_000;

export function countWords(text: string) {
  return String(text || "").trim().split(/\s+/u).filter(Boolean).length;
}

export function createDocumentId() {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDocument(title: string, draft = "", now = Date.now()): StoredDocument {
  return {
    id: createDocumentId(),
    title: title || "Untitled draft",
    draft,
    createdAt: now,
    updatedAt: now,
    wordCount: countWords(draft),
    snapshots: [],
  };
}

function summarise(document: StoredDocument): DocumentSummary {
  return {
    id: document.id,
    title: document.title,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    wordCount: document.wordCount,
    excerpt: document.draft.trim().replace(/\s+/gu, " ").slice(0, 120),
  };
}

export function summariseDocuments(documents: StoredDocument[], query = "") {
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? documents.filter((document) => document.title.toLocaleLowerCase().includes(needle) || document.draft.toLocaleLowerCase().includes(needle))
    : documents;
  return matches
    .map(summarise)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * Append a version snapshot when the draft meaningfully changed and enough time
 * passed since the last one. Autosave must not pile up a snapshot per keystroke.
 */
export function recordSnapshot(document: StoredDocument, reason: DocumentSnapshot["reason"], now = Date.now()): StoredDocument {
  const last = document.snapshots[document.snapshots.length - 1];
  const shouldSnapshot = reason !== "autosave"
    || (!last && document.draft.trim().length > 0)
    || (last && last.text !== document.draft && now - last.createdAt >= SNAPSHOT_MIN_INTERVAL_MS);
  if (!shouldSnapshot) return document;
  const snapshot: DocumentSnapshot = { id: `snap-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, text: document.draft, title: document.title, createdAt: now, reason };
  const snapshots = [...document.snapshots, snapshot].slice(-MAX_SNAPSHOTS_PER_DOCUMENT);
  return { ...document, snapshots };
}

export function sanitiseStoredDocument(value: unknown): StoredDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) return null;
  const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : Date.now();
  const updatedAt = typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt;
  const draft = typeof record.draft === "string" ? record.draft : "";
  const snapshots = Array.isArray(record.snapshots)
    ? record.snapshots.flatMap((item): DocumentSnapshot[] => {
      if (!item || typeof item !== "object") return [];
      const snapshot = item as Record<string, unknown>;
      if (typeof snapshot.text !== "string") return [];
      return [{
        id: typeof snapshot.id === "string" ? snapshot.id : `snap-${Date.now().toString(36)}`,
        text: snapshot.text,
        title: typeof snapshot.title === "string" ? snapshot.title : "Untitled draft",
        createdAt: typeof snapshot.createdAt === "number" && Number.isFinite(snapshot.createdAt) ? snapshot.createdAt : createdAt,
        reason: snapshot.reason === "manual" || snapshot.reason === "import" ? snapshot.reason : "autosave",
      }];
    }).slice(-MAX_SNAPSHOTS_PER_DOCUMENT)
    : [];
  return {
    id: record.id,
    title: typeof record.title === "string" && record.title ? record.title : "Untitled draft",
    draft,
    createdAt,
    updatedAt,
    wordCount: typeof record.wordCount === "number" && Number.isFinite(record.wordCount) ? record.wordCount : countWords(draft),
    snapshots,
  };
}

export class MemoryDocumentBackend implements DocumentStoreBackend {
  private documents = new Map<string, StoredDocument>();

  async list() {
    return [...this.documents.values()];
  }

  async get(id: string) {
    return this.documents.get(id) ?? null;
  }

  async put(document: StoredDocument) {
    this.documents.set(document.id, document);
  }

  async remove(id: string) {
    this.documents.delete(id);
  }

  async clear() {
    this.documents.clear();
  }
}

export class LocalStorageDocumentBackend implements DocumentStoreBackend {
  private storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  private key: string;

  constructor(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, key = "draftwise:documents:v1") {
    this.storage = storage;
    this.key = key;
  }

  private readAll() {
    try {
      const raw = this.storage.getItem(this.key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item) => {
        const document = sanitiseStoredDocument(item);
        return document ? [document] : [];
      });
    } catch {
      return [];
    }
  }

  private writeAll(documents: StoredDocument[]) {
    this.storage.setItem(this.key, JSON.stringify(documents));
  }

  async list() {
    return this.readAll();
  }

  async get(id: string) {
    return this.readAll().find((document) => document.id === id) ?? null;
  }

  async put(document: StoredDocument) {
    const documents = this.readAll().filter((item) => item.id !== document.id);
    documents.push(document);
    this.writeAll(documents);
  }

  async remove(id: string) {
    this.writeAll(this.readAll().filter((document) => document.id !== id));
  }

  async clear() {
    this.storage.removeItem(this.key);
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DOCUMENTS_DB_NAME, DOCUMENTS_DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) database.createObjectStore(DOCUMENTS_STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export class IndexedDbDocumentBackend implements DocumentStoreBackend {
  private database: Promise<IDBDatabase | null>;

  constructor() {
    this.database = openDatabase();
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
    const database = await this.database;
    if (!database) return null;
    return new Promise((resolve) => {
      try {
        const transaction = database.transaction(DOCUMENTS_STORE, mode);
        const request = run(transaction.objectStore(DOCUMENTS_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async list() {
    const result = await this.transaction("readonly", (store) => store.getAll() as IDBRequest<unknown[]>);
    return (result ?? []).flatMap((item) => {
      const document = sanitiseStoredDocument(item);
      return document ? [document] : [];
    });
  }

  async get(id: string) {
    const result = await this.transaction("readonly", (store) => store.get(id) as IDBRequest<unknown>);
    return sanitiseStoredDocument(result ?? null);
  }

  async put(document: StoredDocument) {
    await this.transaction("readwrite", (store) => store.put(document) as IDBRequest<IDBValidKey>);
  }

  async remove(id: string) {
    await this.transaction("readwrite", (store) => store.delete(id) as IDBRequest<undefined>);
  }

  async clear() {
    await this.transaction("readwrite", (store) => store.clear() as IDBRequest<undefined>);
  }
}

export function createDocumentBackend(): DocumentStoreBackend {
  if (typeof indexedDB !== "undefined") {
    const backend = new IndexedDbDocumentBackend();
    // If IndexedDB never opens (private mode, disabled storage) the list call
    // resolves to [] anyway; the localStorage backend below is only used when
    // indexedDB itself is unavailable at construction time.
    return backend;
  }
  if (typeof localStorage !== "undefined") return new LocalStorageDocumentBackend(localStorage);
  return new MemoryDocumentBackend();
}
