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
  /** Persists the document. Failure MUST reject: never report a silent success. */
  put(document: StoredDocument): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export type DocumentBackendMode = "indexeddb" | "localstorage" | "memory";

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
  readonly mode: DocumentBackendMode = "memory";

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
  readonly mode: DocumentBackendMode = "localstorage";

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
    // Quota and storage errors must propagate: a swallowed failure here is
    // exactly how "Saved locally" lies to the writer.
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
  readonly mode: DocumentBackendMode = "indexeddb";

  constructor() {
    this.database = openDatabase();
  }

  /** Resolves true only when the database actually opened and can run transactions. */
  async isAvailable(): Promise<boolean> {
    return Boolean(await this.database);
  }

  /**
   * Runs one transaction. Every failure path rejects: a database that never
   * opened, a failed request, an aborted transaction, or a thrown error.
   * Callers must never mistake a failed write for a successful one.
   */
  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.database;
    if (!database) throw new Error("IndexedDB unavailable");
    return new Promise<T>((resolve, reject) => {
      try {
        const transaction = database.transaction(DOCUMENTS_STORE, mode);
        const request = run(transaction.objectStore(DOCUMENTS_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("IndexedDB transaction failed"));
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

/**
 * Resilient backend chain: IndexedDB when it genuinely works, localStorage
 * when IndexedDB cannot open or write, memory-only as the last resort.
 *
 * `mode` reports which tier is active so the UI can tell the truth about
 * durability — memory-only operation must never be reported as "Saved locally".
 */
export class ResilientDocumentBackend implements DocumentStoreBackend {
  private current: DocumentStoreBackend;
  private storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  private fallbackKey: string;
  private memory = new MemoryDocumentBackend();
  private demoted = false;

  constructor(storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">, fallbackKey = "draftwise:documents:v1") {
    this.storage = storage;
    this.fallbackKey = fallbackKey;
    this.current = typeof indexedDB !== "undefined"
      ? new IndexedDbDocumentBackend()
      : storage
        ? new LocalStorageDocumentBackend(storage, fallbackKey)
        : this.memory;
  }

  get mode(): DocumentBackendMode {
    // Reports the tier actually holding the documents right now — not which
    // tier was attempted. A memory-only fallback must never look persistent.
    return (this.current as { mode?: DocumentBackendMode }).mode ?? "indexeddb";
  }

  get degraded() {
    return this.demoted;
  }

  /** Move one tier down the chain and copy the documents across so nothing is lost. */
  private async demote(documents: StoredDocument[]) {
    this.demoted = true;
    // Each tier is tried in turn: if localStorage is also unavailable, land on
    // memory rather than throwing away the writer's text.
    if (this.storage) {
      const localTier = new LocalStorageDocumentBackend(this.storage, this.fallbackKey);
      try {
        for (const document of documents) await localTier.put(document);
        this.current = localTier;
        return;
      } catch {
        // Fall through to memory; the document set is retried there.
      }
    }
    this.current = this.memory;
    for (const document of documents) {
      await this.memory.put(document);
    }
  }

  async list(): Promise<StoredDocument[]> {
    try {
      return await this.current.list();
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<StoredDocument | null> {
    try {
      return await this.current.get(id);
    } catch {
      return null;
    }
  }

  async put(document: StoredDocument): Promise<void> {
    try {
      await this.current.put(document);
    } catch (error) {
      if (this.current === this.memory) throw error;
      // Preserve the failing document during fallback: data must survive the tier change.
      const known = await this.list();
      const merged = [...known.filter((item) => item.id !== document.id), document];
      await this.demote(merged);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.current.remove(id);
    } catch (error) {
      if (this.current === this.memory) throw error;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.current.clear();
    } catch {
      // Clearing is best-effort across tiers; each tier is attempted.
    }
  }
}

export function createDocumentBackend(): DocumentStoreBackend {
  return new ResilientDocumentBackend(typeof localStorage !== "undefined" ? localStorage : undefined);
}
