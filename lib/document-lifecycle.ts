import {
  createDocument,
  createDocumentId,
  countWords,
  recordSnapshot,
  summariseDocuments,
  type DocumentSnapshot,
  type DocumentStoreBackend,
  type DocumentSummary,
  type DocumentReview,
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

export type DocumentSaveStatus = "idle" | "saving" | "saved" | "error" | "degraded";

/** Outcome counts for a backup merge; every incoming document lands in exactly one bucket. */
export interface DocumentMergeResult {
  /** Imported under their own identity. */
  added: number;
  /** Already present with identical title and text; left alone. */
  skipped: number;
  /** Same id but different content; kept as a titled copy under a fresh id. */
  renamed: number;
}

export interface DocumentLifecycleState {
  documents: StoredDocument[];
  activeId: string;
  hydrated: boolean;
  saveStatus: DocumentSaveStatus;
  /** Which storage tier actually holds the documents right now. */
  storageMode: "indexeddb" | "localstorage" | "memory";
}

export interface DocumentsSeed {
  title: string;
  draft: string;
}

export function emptyLifecycleState(): DocumentLifecycleState {
  return { documents: [], activeId: "", hydrated: false, saveStatus: "idle", storageMode: "memory" };
}

function readStorageMode(backend: DocumentStoreBackend): DocumentLifecycleState["storageMode"] {
  const mode = (backend as { mode?: string }).mode;
  return mode === "indexeddb" || mode === "localstorage" ? mode : "memory";
}

/**
 * localStorage key holding the JSON array of document ids whose deletion
 * failed and still needs retrying. Kept here (rather than in workspace state)
 * so a failed "delete" survives a reload: load() re-queues these ids, hides
 * those documents, and every later flush retries the storage removal. The
 * integrator's "Clear all local data" action must also remove this key.
 */
export const PENDING_DELETIONS_STORAGE_KEY = "draftwise:pending-deletions:v1";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function pendingDeletionsStorage(): KeyValueStorage | null {
  try {
    const storage = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

function readPersistedDeletions(): string[] {
  const storage = pendingDeletionsStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(PENDING_DELETIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writePersistedDeletions(ids: Iterable<string>) {
  const storage = pendingDeletionsStorage();
  if (!storage) return;
  const list = [...ids];
  try {
    if (list.length === 0) storage.removeItem(PENDING_DELETIONS_STORAGE_KEY);
    else storage.setItem(PENDING_DELETIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Best effort: the in-memory queue stays the source of truth this session.
  }
}

export class DocumentLifecycle {
  private backend: DocumentStoreBackend;
  private seed: DocumentsSeed;
  private state: DocumentLifecycleState = emptyLifecycleState();
  private listeners = new Set<() => void>();
  private pending = new Map<string, StoredDocument>();
  /**
   * Newest object we have produced for each id. A failed write may only be
   * re-queued when its object is still this one; otherwise a stale rejection
   * arriving after a newer edit (or after that edit was already written) could
   * put the old text back at the head of the queue.
   */
  private latest = new Map<string, StoredDocument>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(backend: DocumentStoreBackend, seed: DocumentsSeed) {
    this.backend = backend;
    this.seed = seed;
    this.state = { ...this.state, storageMode: readStorageMode(backend) };
  }

  /** The store the drafts actually live in, for callers that must reach it directly. */
  get store(): DocumentStoreBackend {
    return this.backend;
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
  load(seedOverride?: Partial<DocumentsSeed>, preferredActiveId?: string): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    const seed: DocumentsSeed = { ...this.seed, ...seedOverride };
    this.loadPromise = (async () => {
      const stored = await this.backend.list();
      // A deletion that failed in an earlier session is still our job. The
      // ids are persisted, so re-queue them here and hide those documents:
      // otherwise a "deleted" draft reappears the moment the app reloads.
      for (const id of readPersistedDeletions()) this.pendingDeletions.add(id);
      const deletedIds = new Set(this.pendingDeletions);
      const visible = stored.filter((document) => !deletedIds.has(document.id));
      // Storage reads are async, so a writer can start typing before hydration
      // resolves. Their edits live in state and must not be discarded by the
      // load: an earlier version called setState here unconditionally, and any
      // draft replaced during the read silently reverted to the seeded sample
      // about a second later. A queued write is the honest signal that the
      // writer has newer work than what the read will return, and it does not
      // depend on when load() happened to be called.
      const editedId = this.state.activeId;
      const edited = this.findById(editedId);
      const hasUnsavedWork = this.pending.has(editedId);
      if (visible.length === 0) {
        // Nothing usable on disk. If the writer already typed into the seeded
        // document during the read, that document is theirs: keep it and
        // persist it instead of replacing it with a fresh seed.
        if (hasUnsavedWork && edited) {
          this.setState({ activeId: edited.id, hydrated: true });
          this.queueWrite(edited);
          await this.retryDeletionsAfterLoad();
          return;
        }
        const initial = createDocument(seed.title, seed.draft);
        this.latest.set(initial.id, initial);
        try {
          await this.backend.put(initial);
        } catch {
          // Storage refused the seed write (quota, private mode). The editor
          // still gets a real document; the failure is reported via saveStatus
          // and the write stays queued for retry.
          this.setState({ documents: [initial], activeId: initial.id, hydrated: true, saveStatus: "error" });
          this.queueWrite(initial);
          await this.retryDeletionsAfterLoad();
          return;
        }
        this.setState({ documents: [initial], activeId: initial.id, hydrated: true });
        await this.retryDeletionsAfterLoad();
        return;
      }
      const ordered = [...visible].sort((left, right) => right.updatedAt - left.updatedAt);
      // Restore the last-opened document when it still exists. "Most recently
      // edited" is only a fallback: it is not synonymous with "last opened".
      const preferred = preferredActiveId ? ordered.find((document) => document.id === preferredActiveId) : undefined;
      const nextActive = preferred?.id ?? ordered[0].id;
      // If the writer has been editing the active document since the read
      // began, keep their version and re-queue it for persistence rather than
      // handing back the stored copy.
      const merged = hasUnsavedWork && edited?.id === nextActive
        ? ordered.map((document) => (document.id === nextActive ? { ...document, ...edited } : document))
        : ordered;
      this.setState({
        documents: merged,
        activeId: nextActive,
        hydrated: true,
      });
      if (hasUnsavedWork && edited?.id === nextActive && edited) this.queueWrite(edited);
      await this.retryDeletionsAfterLoad();
    })();
    return this.loadPromise;
  }

  private queueWrite(document: StoredDocument) {
    this.pending.set(document.id, document);
    this.latest.set(document.id, document);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 500);
  }

  /** Write everything queued. Failed documents stay queued for the next flush. */
  async flush(): Promise<boolean> {
    // A pending deletion is retried on every flush, so the canonical save
    // pathway recovers a failed delete even when no documents are queued.
    // This subsumes HEAD's early return: with both queues empty the flush is
    // still a no-op success, but a queued failed delete now gets retried.
    if (this.pending.size === 0 && this.pendingDeletions.size === 0) return true;
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
        // Both guards are needed. HEAD's check avoids overwriting a newer edit
        // queued while this write was in flight; the backend's `latest` map
        // additionally rejects a stale rejection after that newer edit was
        // already written. Re-queue only when both conditions still hold.
        if (!this.pending.has(document.id) && this.latest.get(document.id) === document) {
          this.pending.set(document.id, document);
        }
      }
    }
    // Retry failed deletions on the same save pathway. A still-failing delete
    // keeps the flush honest (false + saveStatus error) and stays queued.
    const deletionResult = await this.retryDeletions();
    if (!deletionResult.ok) failed = true;
    // A fallback demotion happens inside put(); refresh the reported tier so
    // the UI never claims IndexedDB durability the app no longer has.
    const storageMode = readStorageMode(this.backend);
    this.setState({ saveStatus: failed ? "error" : "saved", storageMode });
    return !failed;
  }

  /** Best-effort synchronous flush for page exit; a rejected write stays queued. */
  flushSync() {
    for (const document of [...this.pending.values()]) {
      const requeue = () => {
        // Keep a newer queued edit if one arrived mid-write, and reject a
        // stale rejection once a newer object for this id has been produced.
        if (!this.pending.has(document.id) && this.latest.get(document.id) === document) {
          this.pending.set(document.id, document);
        }
      };
      try {
        // put() is async: without a rejection handler a failed exit write
        // silently drops the queued copy, and the next exit finds nothing.
        void this.backend.put(document).catch(requeue);
      } catch {
        requeue();
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

  updateDocument(id: string, patch: Partial<Pick<StoredDocument, "title" | "draft" | "review" | "goals" | "dialect">>, snapshot?: DocumentSnapshot["reason"]): boolean {
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

  updateActive(patch: Partial<Pick<StoredDocument, "title" | "draft" | "review" | "goals" | "dialect">>, snapshot?: DocumentSnapshot["reason"]): boolean {
    return this.state.activeId ? this.updateDocument(this.state.activeId, patch, snapshot) : false;
  }

  /**
   * Store what the last analysis found, without marking the document edited.
   *
   * Going through updateActive would move updatedAt on every analysis, and the
   * document list would claim a draft had just been worked on when the writer
   * had only opened it.
   */
  recordReview(review: DocumentReview): boolean {
    const id = this.state.activeId;
    const current = id ? this.findById(id) : undefined;
    if (!id || !current) return false;
    const next: StoredDocument = { ...current, review };
    this.setState({ documents: this.state.documents.map((document) => (document.id === id ? next : document)) });
    this.queueWrite(next);
    return true;
  }

  open(id: string): boolean {
    if (!this.findById(id)) return false;
    this.setState({ activeId: id });
    return true;
  }

  createNew(title = "Untitled draft", draft = "", goals?: StoredDocument["goals"], dialect?: StoredDocument["dialect"]): StoredDocument {
    const document = createDocument(title, draft, Date.now(), goals, dialect);
    this.setState({ documents: [document, ...this.state.documents], activeId: document.id });
    this.queueWrite(document);
    return document;
  }

  duplicate(id: string): StoredDocument | null {
    const source = this.findById(id);
    if (!source) return null;
    const copy = createDocument(`${source.title} (copy)`, source.draft, Date.now(), source.goals, source.dialect);
    this.setState({ documents: [copy, ...this.state.documents], activeId: copy.id });
    this.queueWrite(copy);
    return copy;
  }

  /**
   * Durable deletion. The document disappears from the in-memory list at once
   * and a pending write for it is cancelled, but the storage deletion is
   * tracked: on failure the id stays queued for retry and the state reports
   * the error, so a "deleted" document can never silently reappear after
   * reload without the writer knowing.
   */
  remove(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    this.pending.delete(id);
    // A removed document must never be persisted by a write still in flight.
    this.latest.delete(id);
    const next = this.state.documents.filter((document) => document.id !== id);
    const removedActive = id === this.state.activeId;
    let statePatch: Partial<DocumentLifecycleState>;
    if (next.length === 0) {
      // The editor must always have a real document behind it. The fresh
      // document is a new identity: the deleted one is not resurrected.
      const fresh = createDocument("Untitled draft", "");
      statePatch = { documents: [fresh], activeId: fresh.id };
      this.setState(statePatch);
      this.queueWrite(fresh);
    } else {
      statePatch = { documents: next, activeId: removedActive ? next[0].id : this.state.activeId };
      this.setState(statePatch);
    }
    return this.backend.remove(id).then(
      () => {
        this.pendingDeletions.delete(id);
        writePersistedDeletions(this.pendingDeletions);
        return { ok: true as const };
      },
      (error: unknown) => {
        // Keep the deletion queued and persisted: retrying is the writer's only
        // path back to a truthful state, across reloads as well as saves.
        this.pendingDeletions.add(id);
        writePersistedDeletions(this.pendingDeletions);
        this.setState({ saveStatus: "error" });
        return { ok: false as const, error: error instanceof Error ? error.message : "Could not delete the document from local storage." };
      },
    );
  }

  /** Ids whose storage deletion failed and is waiting to be retried. */
  private pendingDeletions = new Set<string>();

  hasPendingDeletions() {
    return this.pendingDeletions.size > 0;
  }

  /** The failed-deletion ids, for callers that need to surface them in the UI. */
  get pendingDeletionIds(): string[] {
    return [...this.pendingDeletions];
  }

  /** Retry every failed deletion, e.g. from the save pathway. */
  async retryDeletions(): Promise<{ ok: true } | { ok: false; error: string }> {
    let firstError: string | null = null;
    for (const id of [...this.pendingDeletions]) {
      try {
        await this.backend.remove(id);
        this.pendingDeletions.delete(id);
      } catch (error) {
        firstError ??= error instanceof Error ? error.message : "Could not delete the document from local storage.";
      }
    }
    writePersistedDeletions(this.pendingDeletions);
    return firstError ? { ok: false as const, error: firstError } : { ok: true as const };
  }

  /** Used by load(): a still-failing deletion reports the error, others clear it. */
  private async retryDeletionsAfterLoad() {
    if (this.pendingDeletions.size === 0) return;
    const result = await this.retryDeletions();
    if (!result.ok) this.setState({ saveStatus: "error" });
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
    return this.createNew(`${document.title} (restored)`, snapshot.text, document.goals, document.dialect);
  }

  summaries(query = ""): DocumentSummary[] {
    return summariseDocuments(this.state.documents, query);
  }

  /**
   * Replace the whole library (backup restore). The caller passes documents
   * that already survived validation; storage failures are reported rather
   * than swallowed, and failed writes stay queued so nothing is silently
   * lost. Callers must not reload until this reports success: pending writes
   * live in memory and a reload would drop them.
   */
  async replaceAll(documents: StoredDocument[], activeId?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (documents.length === 0) return { ok: false as const, error: "That backup holds no documents to restore." };
    // Snapshot everything we are about to disturb. A failed restore must leave
    // the original library intact on disk AND in memory: swapping in a partial
    // backup would erase the writer's work before the caller could abort.
    const previousPending = new Map(this.pending);
    const previousLatest = new Map(this.latest);
    let original: StoredDocument[];
    try {
      original = await this.backend.list();
    } catch (error) {
      this.setState({ saveStatus: "error" });
      return { ok: false as const, error: error instanceof Error ? error.message : "Could not read the current documents." };
    }
    this.pending.clear();
    this.latest.clear();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const restoreQueue = () => {
      this.pending = previousPending;
      this.latest = previousLatest;
      // The old debounce was cleared above; re-arm it so restored pending
      // edits still auto-save without waiting for another keystroke.
      this.timer = previousPending.size > 0 ? setTimeout(() => void this.flush(), 500) : null;
    };
    try {
      await this.backend.clear();
    } catch (error) {
      restoreQueue();
      this.setState({ saveStatus: "error" });
      return { ok: false as const, error: error instanceof Error ? error.message : "Could not clear the current documents." };
    }
    let failed = false;
    for (const document of documents) {
      try {
        await this.backend.put(document);
      } catch {
        failed = true;
        break;
      }
    }
    if (failed) {
      // Put the original library back. Even if the rollback itself hits an
      // error, in-memory state is left untouched and we report failure, so the
      // caller never reloads into a half-restored workspace.
      try {
        await this.backend.clear();
        for (const document of original) await this.backend.put(document);
      } catch {
        // Nothing more can be done here; the failure is reported below.
      }
      restoreQueue();
      this.setState({ saveStatus: "error" });
      return { ok: false as const, error: "Restore failed; the original library was preserved. Retry the restore." };
    }
    const nextActive = activeId && documents.some((document) => document.id === activeId)
      ? activeId
      : documents[0].id;
    // put() swallows a failed write and silently demotes to a lower tier, so a
    // try/catch alone cannot detect that the restored library landed in
    // memory only. The caller reloads immediately after a successful restore;
    // that reload would lose every memory-only document. Treat it as failure.
    const storageMode = readStorageMode(this.backend);
    // A ResilientDocumentBackend only reports "memory" after both durable
    // tiers failed and documents were copied there. A bare MemoryDocumentBackend
    // (unit tests, deliberate in-memory mode) has no durable tier to have lost.
    const volatile = storageMode === "memory"
      && typeof (this.backend as { degraded?: boolean }).degraded === "boolean";
    // Track the restored docs as the newest objects and clear any failed
    // deletion ids from the previous library (remote hardening). Both sit
    // alongside the degraded-storage detection above: a memory-only restore
    // is still reported as failure rather than silently lost on reload.
    for (const document of documents) this.latest.set(document.id, document);
    this.pendingDeletions.clear();
    writePersistedDeletions(this.pendingDeletions);
    this.setState({ documents: [...documents], activeId: nextActive, saveStatus: failed || volatile ? "error" : "saved", storageMode });
    if (failed) return { ok: false as const, error: "Some restored documents could not be saved. Nothing was reloaded; retry the restore." };
    if (volatile) return { ok: false as const, error: "The restored documents could not be saved durably on this device. Nothing was reloaded; free some storage and retry the restore." };
    return { ok: true as const };
  }

  /**
   * Merge a backup's documents into the current library (backup merge).
   *
   * The counterpart to replaceAll: nothing current is removed, the workspace
   * settings and activity log are untouched, and no reload is needed — the
   * merged documents join the live state through the normal notification
   * path. Identity collisions resolve transparently, because two libraries
   * that share an id rarely share the text behind it:
   *
   * - Unknown id → added as-is, keeping its history, goals and timestamps.
   * - Known id with identical title and draft → skipped; it is already here.
   * - Known id with different content → kept as a copy under a fresh id with
   *   an " (imported)" title, so neither version is silently overwritten.
   *
   * Failed writes stay queued for retry and are reported rather than
   * swallowed, matching replaceAll's contract.
   */
  async mergeAll(documents: StoredDocument[]): Promise<{ ok: true; merged: DocumentMergeResult } | { ok: false; error: string }> {
    if (documents.length === 0) return { ok: false as const, error: "That backup holds no documents to merge." };
    const merged: DocumentMergeResult = { added: 0, skipped: 0, renamed: 0 };
    const additions: StoredDocument[] = [];
    for (const incoming of documents) {
      const current = this.findById(incoming.id);
      if (!current) {
        additions.push(incoming);
        merged.added += 1;
      } else if (current.title === incoming.title && current.draft === incoming.draft) {
        merged.skipped += 1;
      } else {
        additions.push({ ...incoming, id: createDocumentId(), title: `${incoming.title} (imported)` });
        merged.renamed += 1;
      }
    }
    for (const document of additions) this.latest.set(document.id, document);
    let failed = false;
    for (const document of additions) {
      try {
        await this.backend.put(document);
      } catch {
        failed = true;
        if (this.latest.get(document.id) === document) this.pending.set(document.id, document);
      }
    }
    // Imports join the front of the in-memory list; the dashboard sorts by
    // updatedAt anyway, so this only affects un-sorted consumers.
    this.setState({ documents: [...additions, ...this.state.documents], saveStatus: failed ? "error" : "saved" });
    if (failed) return { ok: false as const, error: "Some imported documents could not be saved. They stay queued — retry the merge." };
    return { ok: true as const, merged };
  }

  /** Remove every trace of stored documents and return to a clean first-run state. */
  async clearAll(freshSeed: DocumentsSeed = this.seed): Promise<void> {
    this.pending.clear();
    this.latest.clear();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.backend.clear();
    const fresh = createDocument(freshSeed.title, freshSeed.draft);
    await this.backend.put(fresh);
    this.latest.set(fresh.id, fresh);
    this.pendingDeletions.clear();
    writePersistedDeletions(this.pendingDeletions);
    this.setState({ documents: [fresh], activeId: fresh.id, saveStatus: "saved" });
  }
}
