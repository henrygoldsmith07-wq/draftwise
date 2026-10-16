/**
 * Local writing activity: words written per day, time active, and streaks.
 *
 * Competitors keep writers coming back with weekly progress reports and
 * writing streaks. Those are cloud features elsewhere; here the same loop
 * runs entirely on-device. The log lives under its own storage key (not in
 * the versioned workspace) so activity tracking can never corrupt settings
 * or drafts, and clearing local data removes it with everything else.
 *
 * Everything here is pure and framework-free except the two storage helpers,
 * so the streak math is unit-tested without a browser. Recording is
 * throttled by the caller: one small localStorage write per tick while the
 * writer is active, never per keystroke.
 */

export const ACTIVITY_STORAGE_KEY = "draftwise:activity:v1";

/** How much history the log keeps. Old days fall off the far end. */
const MAX_STORED_DAYS = 120;

export interface ActivityDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Words added that day. Only additions count — deleting never punishes. */
  words: number;
  /** Milliseconds with a keystroke since the previous tick. */
  activeMs: number;
}

export interface ActivityLog {
  version: 1;
  days: ActivityDay[];
}

export interface ActivityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WeekTotals {
  words: number;
  activeDays: number;
  activeMs: number;
  streak: number;
}

export function emptyLog(): ActivityLog {
  return { version: 1, days: [] };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

/** Local calendar date, so "today" means the writer's today in any timezone. */
export function dayKey(when: Date): string {
  return `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}`;
}

function shiftDayKey(key: string, deltaDays: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + deltaDays);
  return dayKey(date);
}

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  return words.length;
}

/**
 * Fold one tick into the log. Words are additions since the caller's last
 * snapshot; the caller clamps deletions to zero before calling.
 */
export function recordWords(log: ActivityLog, when: Date, wordsWritten: number, activeMs: number): ActivityLog {
  const date = dayKey(when);
  const words = Number.isFinite(wordsWritten) && wordsWritten > 0 ? Math.floor(wordsWritten) : 0;
  const ms = Number.isFinite(activeMs) && activeMs > 0 ? Math.floor(activeMs) : 0;
  if (words === 0 && ms === 0) return log;
  const days = log.days.map((day) => ({ ...day }));
  const existing = days.find((day) => day.date === date);
  if (existing) {
    existing.words += words;
    existing.activeMs += ms;
  } else {
    days.push({ date, words, activeMs: ms });
    days.sort((left, right) => (left.date < right.date ? -1 : 1));
  }
  return { version: 1, days: days.slice(-MAX_STORED_DAYS) };
}

/**
 * Consecutive days with words written, ending today — or yesterday, so a
 * writer opening the app in the morning still sees a live streak rather than
 * a reset. A day with only idle time and no words does not extend a streak:
 * showing up counts when writing happens.
 */
export function currentStreak(log: ActivityLog, today: Date): number {
  const active = new Set(log.days.filter((day) => day.words > 0).map((day) => day.date));
  if (active.size === 0) return 0;
  let cursor = dayKey(today);
  if (!active.has(cursor)) cursor = shiftDayKey(cursor, -1);
  let streak = 0;
  while (active.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }
  return streak;
}

/** Last 7 calendar days including today, plus the live streak. */
export function weekTotals(log: ActivityLog, today: Date): WeekTotals {
  const end = dayKey(today);
  const start = shiftDayKey(end, -6);
  let words = 0;
  let activeDays = 0;
  let activeMs = 0;
  for (const day of log.days) {
    if (day.date < start || day.date > end) continue;
    words += day.words;
    activeMs += day.activeMs;
    if (day.words > 0) activeDays += 1;
  }
  return { words, activeDays, activeMs, streak: currentStreak(log, today) };
}

function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function sanitiseDay(value: unknown): ActivityDay | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (!isDayKey(record.date)) return null;
  const words = typeof record.words === "number" && Number.isFinite(record.words) && record.words >= 0
    ? Math.floor(record.words)
    : null;
  const activeMs = typeof record.activeMs === "number" && Number.isFinite(record.activeMs) && record.activeMs >= 0
    ? Math.floor(record.activeMs)
    : null;
  if (words === null || activeMs === null) return null;
  return { date: record.date, words, activeMs };
}

export function readActivityLog(storage: ActivityStorage): ActivityLog {
  let raw: string | null = null;
  try {
    raw = storage.getItem(ACTIVITY_STORAGE_KEY);
  } catch {
    return emptyLog();
  }
  if (!raw) return emptyLog();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyLog();
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || !Array.isArray(record.days)) return emptyLog();
    const days = record.days.flatMap((entry): ActivityDay[] => {
      const day = sanitiseDay(entry);
      return day ? [day] : [];
    });
    days.sort((left, right) => (left.date < right.date ? -1 : 1));
    return { version: 1, days: days.slice(-MAX_STORED_DAYS) };
  } catch {
    return emptyLog();
  }
}

export function writeActivityLog(log: ActivityLog, storage: ActivityStorage): void {
  try {
    storage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Activity is advisory. A full or unavailable store must never break
    // writing, so a failed write is silently dropped — the next tick retries.
  }
}
