import {
  createDocument,
  countWords,
  recordSnapshot,
  summariseDocuments,
  type DocumentSnapshot,
  type DocumentStoreBackend,
  type DocumentSummary,
  type StoredDocument,
} from "./documents.ts";

/**
 * The document lifecycle's single source of truth.
 *
 * Framework-free so the real product workflows — create, edit, switch, reopen,
 * duplicate, delete, import, flush, clear — can be integration-tested against a
 * real backend. The React hook is a thin subscription adapter over this class.
 *
 * Invariants:
 * 1. Identity is stable: a document id is minted once and never regenerated
 *    from the editor's current text.
 * 2. Every write names its document. Pending writes are keyed by id, so a save
 *    in flight while the user switches documents cannot overwrite one document
 *    with another's text.
 * 3. The active document is always a real document: removing the last one
 *    creates a fresh blank draft rather than leaving the editor orphaned.
 */

export type DocumentSaveStatus = "idle" | "saving" | "saved" | "error";

export interface DocumentLifecycleState {
  documents: StoredDocument[];
  activeId: string;
  hydrated: boolean;
  saveStatus: DocumentSaveStatus;
}

export interface DocumentsSeed {
  title: string;
  draft: string;
}

export function emptyLifecycleState(): DocumentLifecycleState {
  return { documents: [], activeId: "", hydrated: false, saveStatus: "idle" };
}

export class DocumentLifecycle {
  private backend: DocumentStoreBackend;
  private seed: DocumentsSeed;
  private state: DocumentLifecycleState = emptyLifecycleState();
  private listeners = new Set<() => void>();
  private pending = new Map<string, StoredDocument>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(backend: DocumentStoreBackend, seed: DocumentsSeed) {
    this.backend = backend;
    this.seed = seed;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DocumentLifecycleState => this.state;

  get documents(): StoredDocument[] {
    return this.state.documents;
  }

  get activeId(): string {
    return this.state.activeId;
  }

  private setState(patch: Partial<DocumentLifecycleState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private findById(id: string) {
    return this.state.documents.find((document) => document.id === id) ?? null;
  }

  /** Load once: hydrate from storage, seeding a first document if the store is empty. */
  load(seedOverride?: Partial<DocumentsSeed>): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    const seed: DocumentsSeed = { ...this.seed, ...seedOverride };
    this.loadPromise = (async () => {
      const stored = await this.backend.list();
      if (stored.length === 0) {
        const initial = createDocument(seed.title, seed.draft);
        try {
          await this.backend.put(initial);
        } catch {
          // Storage refused the seed write (quota, private mode). The editor
          // still gets a real document; the failure is reported via saveStatus
          // and the write stays queued for retry.
          this.setState({ documents: [initial], activeId: initial.id, hydrated: true, saveStatus: "error" });
          this.queueWrite(initial);
          return;
        }
        this.setState({ documents: [initial], activeId: initial.id, hydrated: true });
        return;
      }
      const ordered = [...stored].sort((left, right) => right.updatedAt - left.updatedAt);
      this.setState({
        documents: ordered,
        activeId: ordered[0].id,
        hydrated: true,
      });
    })();
    return this.loadPromise;
  }

  private queueWrite(document: StoredDocument) {
    this.pending.set(document.id, document);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 500);
  }

  /** Write everything queued. Failed documents stay queued for the next flush. */
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = [...this.pending.values()];
    this.pending.clear();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.setState({ saveStatus: "saving" });
    let failed = false;
    for (const document of batch) {
      try {
        await this.backend.put(document);
      } catch {
        failed = true;
        this.pending.set(document.id, document);
      }
    }
    this.setState({ saveStatus: failed ? "error" : "saved" });
  }

  /** Synchronous best-effort flush for page exit. */
  flushSync() {
    for (const document of this.pending.values()) {
      try {
        void this.backend.put(document);
      } catch {
        // The browser is going away; nothing further we can do here.
      }
    }
    this.pending.clear();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  hasPendingWrites() {
    return this.pending.size > 0;
  }

  getActive(): StoredDocument | null {
    return this.findById(this.state.activeId);
  }

  getDocument(id: string): StoredDocument | null {
    return this.findById(id);
  }

  updateDocument(id: string, patch: Partial<Pick<StoredDocument, "title" | "draft">>, snapshot?: DocumentSnapshot["reason"]): boolean {
    const current = this.findById(id);
    if (!current) return false;
    const merged: StoredDocument = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
      wordCount: patch.draft !== undefined ? countWords(patch.draft) : current.wordCount,
    };
    const next = snapshot ? recordSnapshot(merged, snapshot) : merged;
    this.setState({ documents: this.state.documents.map((document) => (document.id === id ? next : document)) });
    this.queueWrite(next);
    return true;
  }

  updateActive(patch: Partial<Pick<StoredDocument, "title" | "draft">>, snapshot?: DocumentSnapshot["reason"]): boolean {
    return this.state.activeId ? this.updateDocument(this.state.activeId, patch, snapshot) : false;
  }

  open(id: string): boolean {
    if (!this.findById(id)) return false;
    this.setState({ activeId: id });
    return true;
  }

  createNew(title = "Untitled draft", draft = ""): StoredDocument {
    const document = createDocument(title, draft);
    this.setState({ documents: [document, ...this.state.documents], activeId: document.id });
    this.queueWrite(document);
    return document;
  }

  duplicate(id: string): StoredDocument | null {
    const source = this.findById(id);
    if (!source) return null;
    const copy = createDocument(`${source.title} (copy)`, source.draft);
    this.setState({ documents: [copy, ...this.state.documents], activeId: copy.id });
    this.queueWrite(copy);
    return copy;
  }

  remove(id: string) {
    this.pending.delete(id);
    const next = this.state.documents.filter((document) => document.id !== id);
    const removedActive = id === this.state.activeId;
    if (next.length === 0) {
      // The editor must always have a real document behind it.
      const fresh = createDocument("Untitled draft", "");
      this.setState({ documents: [fresh], activeId: fresh.id });
      this.queueWrite(fresh);
      void this.backend.remove(id);
      return;
    }
    this.setState({ documents: next, activeId: removedActive ? next[0].id : this.state.activeId });
    void this.backend.remove(id);
  }

  saveSnapshot(reason: DocumentSnapshot["reason"] = "manual"): boolean {
    const updated = this.updateDocument(this.state.activeId, {}, reason);
    if (updated) void this.flush();
    return updated;
  }

  /**
   * Restore an earlier snapshot. The current draft is checkpointed first, so
   * restoring can always be undone from history.
   */
  restoreSnapshot(documentId: string, snapshotId: string): boolean {
    const document = this.findById(documentId);
    const snapshot = document?.snapshots.find((item) => item.id === snapshotId);
    if (!document || !snapshot) return false;
    this.updateDocument(documentId, { draft: document.draft }, "manual");
    this.updateDocument(documentId, { draft: snapshot.text, title: snapshot.title || document.title }, "manual");
    return true;
  }

  /** Duplicate a snapshot's content into a fresh document and open it. */
  duplicateSnapshot(documentId: string, snapshotId: string): StoredDocument | null {
    const document = this.findById(documentId);
    const snapshot = document?.snapshots.find((item) => item.id === snapshotId);
    if (!document || !snapshot) return null;
    return this.createNew(`${document.title} (restored)`, snapshot.text);
  }

  summaries(query = ""): DocumentSummary[] {
    return summariseDocuments(this.state.documents, query);
  }

  /** Remove every trace of stored documents and return to a clean first-run state. */
  async clearAll(freshSeed: DocumentsSeed = this.seed): Promise<void> {
    this.pending.clear();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.backend.clear();
    const fresh = createDocument(freshSeed.title, freshSeed.draft);
    await this.backend.put(fresh);
    this.setState({ documents: [fresh], activeId: fresh.id, saveStatus: "saved" });
  }
}
