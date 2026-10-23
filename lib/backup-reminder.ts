/**
 * When the app should nudge the writer to export a backup.
 *
 * Drafts live only in this browser: a cleared profile, an overzealous disk
 * cleaner, or a lost device takes every word with it. The reminder fires only
 * once there is real work worth protecting (a word threshold, so a fresh
 * install with an empty draft never nags), and stays quiet after a recent
 * backup or a recent "later".
 *
 * Pure and time-injectable so unit tests pin the schedule without clocks.
 */

/** Real work worth protecting: below this the reminder never fires. */
export const BACKUP_REMINDER_WORD_THRESHOLD = 200;
/** A backup this fresh means the writer already owns their words. */
export const BACKUP_REMINDER_STALE_MS = 30 * 24 * 60 * 60 * 1_000;
/** How long "later" lasts before the nudge may return. */
export const BACKUP_REMINDER_SNOOZE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface BackupReminderState {
  /** Total words across the library. */
  totalWords: number;
  /** When a full backup was last exported, if ever. */
  lastBackupAt?: number;
  /** When the writer last chose "later", if ever. */
  snoozedAt?: number;
  /** Defaults to Date.now(); injected by tests. */
  now?: number;
}

function isFreshTimestamp(value: unknown, now: number, windowMs: number): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  // A future timestamp (clock skew, edited storage) counts as fresh rather
  // than as a reason to nag: the writer evidently backed up "recently".
  return now - value < windowMs;
}

export function shouldShowBackupReminder(state: BackupReminderState): boolean {
  const now = state.now ?? Date.now();
  if (!Number.isFinite(state.totalWords) || state.totalWords < BACKUP_REMINDER_WORD_THRESHOLD) return false;
  if (isFreshTimestamp(state.lastBackupAt, now, BACKUP_REMINDER_STALE_MS)) return false;
  if (isFreshTimestamp(state.snoozedAt, now, BACKUP_REMINDER_SNOOZE_MS)) return false;
  return true;
}
