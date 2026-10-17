import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_WORDS_PER_FOLD,
  countWords,
  creditSince,
  currentStreak,
  dayKey,
  emptyLog,
  readActivityLog,
  recordWords,
  weekTotals,
  writeActivityLog,
} from "../lib/writing-activity.ts";

/**
 * The local writing-activity loop: words per day, week totals, streaks.
 *
 * A streak is the retention hook, so its edges are pinned: what counts as a
 * day, when yesterday keeps a streak alive, and what breaks one. Dates are
 * fixed local dates so the tests mean the same thing in every timezone.
 */

const day = (year, month, date, hours = 12) => new Date(year, month - 1, date, hours);

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

test("an empty log has no streak and no week", () => {
  const today = day(2026, 10, 16);
  assert.equal(currentStreak(emptyLog(), today), 0);
  assert.deepEqual(weekTotals(emptyLog(), today), { words: 0, activeDays: 0, activeMs: 0, streak: 0 });
});

test("consecutive writing days build a streak ending today", () => {
  let log = emptyLog();
  log = recordWords(log, day(2026, 10, 14), 120, 60_000);
  log = recordWords(log, day(2026, 10, 15), 80, 30_000);
  log = recordWords(log, day(2026, 10, 16), 200, 90_000);
  assert.equal(currentStreak(log, day(2026, 10, 16)), 3);
});

test("a missed day breaks the streak back to today alone", () => {
  let log = emptyLog();
  log = recordWords(log, day(2026, 10, 12), 300, 60_000);
  log = recordWords(log, day(2026, 10, 16), 50, 10_000);
  assert.equal(currentStreak(log, day(2026, 10, 16)), 1);
});

test("writing yesterday keeps the streak alive this morning", () => {
  let log = emptyLog();
  log = recordWords(log, day(2026, 10, 14), 100, 60_000);
  log = recordWords(log, day(2026, 10, 15), 100, 60_000);
  assert.equal(currentStreak(log, day(2026, 10, 16)), 2);
});

test("idle time without words does not extend a streak", () => {
  let log = emptyLog();
  log = recordWords(log, day(2026, 10, 15), 100, 60_000);
  log = recordWords(log, day(2026, 10, 16), 0, 120_000);
  assert.equal(currentStreak(log, day(2026, 10, 16)), 1);
});

test("ticks on the same day merge instead of duplicating it", () => {
  let log = emptyLog();
  log = recordWords(log, day(2026, 10, 16, 9), 40, 30_000);
  log = recordWords(log, day(2026, 10, 16, 18), 60, 30_000);
  assert.equal(log.days.length, 1);
  assert.equal(log.days[0].words, 100);
  assert.equal(weekTotals(log, day(2026, 10, 16)).words, 100);
});

test("week totals cover the last 7 days and nothing older", () => {
  let log = emptyLog();
  log = recordWords(log, day(2026, 10, 1), 9999, 60_000);
  log = recordWords(log, day(2026, 10, 10), 100, 60_000);
  log = recordWords(log, day(2026, 10, 16), 50, 30_000);
  const totals = weekTotals(log, day(2026, 10, 16));
  assert.equal(totals.words, 150);
  assert.equal(totals.activeDays, 2);
});

test("the log keeps 120 days and drops older ones", () => {
  let log = emptyLog();
  for (let index = 0; index < 130; index += 1) {
    const date = new Date(2026, 0, 1);
    date.setDate(date.getDate() + index);
    log = recordWords(log, date, 10, 1000);
  }
  assert.equal(log.days.length, 120);
  assert.equal(log.days[0].date, dayKey(new Date(2026, 0, 11)));
});

test("empty ticks change nothing", () => {
  const log = recordWords(emptyLog(), day(2026, 10, 16), 0, 0);
  assert.deepEqual(log, emptyLog());
  assert.equal(countWords(""), 0);
  assert.equal(countWords("  \n\t "), 0);
  assert.equal(countWords("The quick brown fox."), 4);
});

test("corrupt or hostile stored activity falls back to empty, keeping valid days", () => {
  assert.deepEqual(readActivityLog(memoryStorage()), emptyLog());
  assert.deepEqual(readActivityLog(memoryStorage({ "draftwise:activity:v1": "not json" })), emptyLog());
  const mixed = memoryStorage({
    "draftwise:activity:v1": JSON.stringify({
      version: 1,
      days: [
        { date: "2026-10-16", words: 40, activeMs: 1000 },
        { date: "yesterday", words: 10, activeMs: 10 },
        { date: "2026-10-15", words: "lots", activeMs: 10 },
        { date: "2026-10-15", words: -5, activeMs: 10 },
        null,
      ],
    }),
  });
  const log = readActivityLog(mixed);
  assert.equal(log.days.length, 1);
  assert.equal(log.days[0].words, 40);
});

test("a log round-trips through storage", () => {
  const storage = memoryStorage();
  const log = recordWords(emptyLog(), day(2026, 10, 16), 77, 5000);
  writeActivityLog(log, storage);
  assert.deepEqual(readActivityLog(storage), log);
});

test("creditSince counts additions, ignores deletions, and caps bulk folds", () => {
  assert.equal(creditSince(100, 140), 40);
  assert.equal(creditSince(100, 100), 0);
  assert.equal(creditSince(140, 100), 0);
  assert.equal(creditSince(0, 10_000), MAX_WORDS_PER_FOLD);
  assert.equal(creditSince(Number.NaN, 50), 0);
});
