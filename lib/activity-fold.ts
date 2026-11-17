/**
 * Per-document bookkeeping for writing-activity credits.
 *
 * The page folds keystrokes into the activity store on a timer and on pagehide.
 * Keeping the fold state here — rather than in a single mutable ref on the page
 * — makes the two rules that used to lose words testable:
 *
 *   1. a document's baseline is seeded from the text it had when it became
 *      active, so words typed before the first tick still count;
 *   2. drafts are keyed by document id, so switching drafts cannot fold A's
 *      text against B's baseline.
 */

import { countWords, creditSince } from "./writing-activity.ts";

export interface ActivityFoldResult {
  documentId: string;
  words: number;
  credited: number;
}

export class ActivityFoldTracker {
  private baselines = new Map<string, number>();
  private drafts = new Map<string, string>();
  private pendingId: string | null = null;

  /** Seed a document's starting word count. Safe to call repeatedly. */
  ensureBaseline(documentId: string, text: string) {
    if (!documentId || this.baselines.has(documentId)) return;
    this.baselines.set(documentId, countWords(text));
  }

  /** A document became active: seed it, and forget any stale pending marker. */
  activate(documentId: string, text: string) {
    if (!documentId) return;
    this.ensureBaseline(documentId, text);
    this.drafts.set(documentId, text);
  }

  /** Text changed in a document; mark its additions as awaiting a fold. */
  noteEdit(documentId: string, text: string) {
    if (!documentId) return;
    this.drafts.set(documentId, text);
    this.pendingId = documentId;
  }

  /** Replace text without crediting it (import, version restore, backup). */
  replace(documentId: string, text: string) {
    if (!documentId) return;
    this.drafts.set(documentId, text);
    this.baselines.set(documentId, countWords(text));
    if (this.pendingId === documentId) this.pendingId = null;
  }

  /** Credit the pending document's additions and close the fold window. */
  fold(): ActivityFoldResult | null {
    const documentId = this.pendingId;
    if (!documentId) return null;
    this.pendingId = null;
    const text = this.drafts.get(documentId) ?? "";
    const words = countWords(text);
    const baseline = this.baselines.get(documentId) ?? 0;
    this.baselines.set(documentId, words);
    return { documentId, words, credited: creditSince(baseline, words) };
  }
}
