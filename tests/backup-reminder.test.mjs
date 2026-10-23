import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_REMINDER_SNOOZE_MS,
  BACKUP_REMINDER_STALE_MS,
  BACKUP_REMINDER_WORD_THRESHOLD,
  shouldShowBackupReminder,
} from "../lib/backup-reminder.ts";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;

test("stays quiet below the word threshold, even with no backup ever", () => {
  assert.equal(
    shouldShowBackupReminder({ totalWords: BACKUP_REMINDER_WORD_THRESHOLD - 1, now: NOW }),
    false,
  );
  assert.equal(shouldShowBackupReminder({ totalWords: 0, now: NOW }), false);
});

test("fires at the threshold when nothing was ever backed up or snoozed", () => {
  assert.equal(
    shouldShowBackupReminder({ totalWords: BACKUP_REMINDER_WORD_THRESHOLD, now: NOW }),
    true,
  );
});

test("stays quiet after a recent backup, fires once it goes stale", () => {
  assert.equal(
    shouldShowBackupReminder({ totalWords: 500, lastBackupAt: NOW - DAY, now: NOW }),
    false,
  );
  assert.equal(
    shouldShowBackupReminder({
      totalWords: 500,
      lastBackupAt: NOW - BACKUP_REMINDER_STALE_MS - 1,
      now: NOW,
    }),
    true,
  );
});

test("a recent 'later' snoozes the nudge, then it may return", () => {
  assert.equal(
    shouldShowBackupReminder({ totalWords: 500, snoozedAt: NOW - DAY, now: NOW }),
    false,
  );
  assert.equal(
    shouldShowBackupReminder({
      totalWords: 500,
      snoozedAt: NOW - BACKUP_REMINDER_SNOOZE_MS - 1,
      now: NOW,
    }),
    true,
  );
});

test("a fresh backup beats an old snooze, and an old backup does not beat a fresh snooze", () => {
  assert.equal(
    shouldShowBackupReminder({
      totalWords: 500,
      lastBackupAt: NOW - DAY,
      snoozedAt: NOW - 30 * DAY,
      now: NOW,
    }),
    false,
  );
  assert.equal(
    shouldShowBackupReminder({
      totalWords: 500,
      lastBackupAt: NOW - 60 * DAY,
      snoozedAt: NOW - DAY,
      now: NOW,
    }),
    false,
  );
});

test("ignores malformed inputs instead of nagging or crashing", () => {
  assert.equal(shouldShowBackupReminder({ totalWords: NaN, now: NOW }), false);
  assert.equal(shouldShowBackupReminder({ totalWords: -50, now: NOW }), false);
  assert.equal(
    shouldShowBackupReminder({ totalWords: 500, lastBackupAt: NaN, now: NOW }),
    true,
  );
  assert.equal(
    shouldShowBackupReminder({ totalWords: 500, snoozedAt: "yesterday", now: NOW }),
    true,
  );
});

test("a future timestamp counts as fresh, never as a reason to nag", () => {
  assert.equal(
    shouldShowBackupReminder({ totalWords: 500, lastBackupAt: NOW + DAY, now: NOW }),
    false,
  );
});
