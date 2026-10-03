import { commitHistory, stepHistory, type HistoryState } from "../hooks/useHistory.ts";

/**
 * Per-document undo/redo history.
 *
 * The single editor history was a correctness bug the moment Draftwise grew
 * multiple documents: switching documents left the previous document's text on
 * the undo stack, so Undo in document B could restore document A's text into B
 * and then persist it there. This store keys every stack by immutable document
 * id, so no document can ever undo into another's contents.
 *
 * Bounded twice over: by entry count per document and by total character
 * budget across all documents, both pruned oldest-first.
 */

export const HISTORY_LIMIT_PER_DOCUMENT = 80;
export const HISTORY_CHAR_BUDGET_PER_DOCUMENT = 2_000_000;
export const HISTORY_DOCUMENT_LIMIT = 24;

export interface DocumentHistorySnapshot {
  canUndo: boolean;
  canRedo: boolean;
  values: number;
  index: number;
}

export class DocumentHistoryStore {
  private histories = new Map<string, HistoryState<string>>();
  private order: string[] = [];
  private listeners = new Set<() => void>();
  private snapshotCache = new Map<string, DocumentHistorySnapshot>();

  /** External-store subscription: mutations notify React through useSyncExternalStore. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    this.snapshotCache.clear();
    for (const listener of this.listeners) listener();
  }

  /** Open (or create) a document's history with its current text as the base state. */
  open(documentId: string, text: string) {
    if (!documentId) return;
    if (!this.histories.has(documentId)) {
      this.histories.set(documentId, { values: [text], index: 0 });
      this.order.push(documentId);
      this.pruneDocuments();
      this.emit();
    }
  }

  /** Drop a document's history entirely (delete, clear-all). */
  remove(documentId: string) {
    this.histories.delete(documentId);
    this.order = this.order.filter((id) => id !== documentId);
    this.emit();
  }

  clear() {
    this.histories.clear();
    this.order = [];
    this.emit();
  }

  commit(documentId: string, text: string) {
    const current = this.histories.get(documentId);
    if (!current) return;
    this.histories.set(documentId, commitHistory(current, text, HISTORY_LIMIT_PER_DOCUMENT, HISTORY_CHAR_BUDGET_PER_DOCUMENT));
    this.emit();
  }

  undo(documentId: string): string | null {
    const current = this.histories.get(documentId);
    if (!current) return null;
    const result = stepHistory(current, -1);
    if (result.state === current) return null;
    this.histories.set(documentId, result.state);
    this.emit();
    return result.value;
  }

  redo(documentId: string): string | null {
    const current = this.histories.get(documentId);
    if (!current) return null;
    const result = stepHistory(current, 1);
    if (result.state === current) return null;
    this.histories.set(documentId, result.state);
    this.emit();
    return result.value;
  }

  snapshot(documentId: string): DocumentHistorySnapshot {
    const cached = this.snapshotCache.get(documentId);
    if (cached) return cached;
    const current = this.histories.get(documentId);
    const value = current
      ? {
          canUndo: current.index > 0,
          canRedo: current.index < current.values.length - 1,
          values: current.values.length,
          index: current.index,
        }
      : { canUndo: false, canRedo: false, values: 0, index: 0 };
    this.snapshotCache.set(documentId, value);
    return value;
  }

  /**
   * Replace a document's history wholesale — used after version restore, where
   * the sensible shape is [pre-restore draft, restored draft] so restore is
   * itself undoable.
   */
  reset(documentId: string, texts: string[]) {
    if (!this.histories.has(documentId) || texts.length === 0) return;
    this.histories.set(documentId, { values: texts.slice(-HISTORY_LIMIT_PER_DOCUMENT), index: texts.length - 1 });
    this.emit();
  }

  private pruneDocuments() {
    while (this.order.length > HISTORY_DOCUMENT_LIMIT) {
      const oldest = this.order.shift();
      if (oldest) this.histories.delete(oldest);
    }
  }
}
