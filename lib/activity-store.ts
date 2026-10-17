import {
  emptyLog,
  readActivityLog,
  recordWords,
  weekTotals,
  writeActivityLog,
  type ActivityLog,
  type ActivityStorage,
  type WeekTotals,
} from "./writing-activity.ts";

/**
 * The writing-activity store the React layer subscribes to.
 *
 * Following the document store and the history store, this is a plain
 * external store read through `useSyncExternalStore` rather than React state.
 * That matters for two concrete reasons:
 *
 * 1. The snapshot is a cached object, so React's identity check is stable and
 *    cannot loop the way a freshly-built object would.
 * 2. Storage is only ever touched from `hydrate`/`record`, which the caller
 *    runs inside effects. Render never reads `window`, so the app still
 *    server-renders its shell, and `getServerSnapshot` gives the server a
 *    fixed empty week.
 *
 * Keeping the persistence out of render is also what lets the interval tick
 * record words without any setState-in-effect anywhere.
 */

export const EMPTY_WEEK: WeekTotals = { words: 0, activeDays: 0, activeMs: 0, streak: 0 };

export class WritingActivityStore {
  private listeners = new Set<() => void>();
  private log: ActivityLog = emptyLog();
  private snapshot: WeekTotals = EMPTY_WEEK;
  private loaded = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WeekTotals => this.snapshot;

  /** The server has no storage; a stable empty week avoids hydration drift. */
  getServerSnapshot = (): WeekTotals => EMPTY_WEEK;

  /** Read storage once, then recompute. Safe to call repeatedly. */
  hydrate(storage: ActivityStorage | undefined, now = new Date()) {
    if (this.loaded || !storage) return;
    this.loaded = true;
    this.log = readActivityLog(storage);
    this.recompute(now);
  }

  /**
   * Fold a tick in: `wordsWritten` is what the caller measured since its own
   * baseline, already clamped to something a person could type in the
   * interval. Persisting here keeps every write off the render path.
   */
  record(storage: ActivityStorage | undefined, wordsWritten: number, activeMs: number, now = new Date()) {
    if (!storage) return;
    const next = recordWords(this.log, now, wordsWritten, activeMs);
    if (next === this.log) return;
    this.log = next;
    writeActivityLog(this.log, storage);
    this.recompute(now);
  }

  /** Recompute the snapshot when the panel is opened, so a new day shows up
   * without waiting for the next write. No-op when nothing changed. */
  refresh(now = new Date()) {
    this.recompute(now);
  }

  /**
   * Replace the log wholesale (backup restore). The replacement is already
   * validated by the caller; it is persisted at once so a reload right after
   * the restore still sees it.
   */
  replace(log: ActivityLog, storage: ActivityStorage | undefined, now = new Date()) {
    this.loaded = true;
    this.log = log;
    if (storage) writeActivityLog(this.log, storage);
    this.recompute(now);
  }

  private recompute(now: Date) {
    const next = weekTotals(this.log, now);
    // Reuse the previous object when nothing moved, so subscribers do not
    // re-render on ticks that record nothing.
    if (next.words === this.snapshot.words
      && next.activeDays === this.snapshot.activeDays
      && next.activeMs === this.snapshot.activeMs
      && next.streak === this.snapshot.streak) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
