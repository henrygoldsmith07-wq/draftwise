import assert from "node:assert/strict";
import test from "node:test";
import { formatRelativeTime } from "../lib/time.ts";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("formats the recent past down to minutes", () => {
  assert.equal(formatRelativeTime(NOW, NOW), "just now");
  assert.equal(formatRelativeTime(NOW - 30_000, NOW), "just now");
  assert.equal(formatRelativeTime(NOW - MINUTE, NOW), "1 min ago");
  assert.equal(formatRelativeTime(NOW - 59 * MINUTE, NOW), "59 min ago");
});

test("uses singular and plural hours and days", () => {
  assert.equal(formatRelativeTime(NOW - HOUR, NOW), "1 hour ago");
  assert.equal(formatRelativeTime(NOW - 23 * HOUR, NOW), "23 hours ago");
  assert.equal(formatRelativeTime(NOW - DAY, NOW), "1 day ago");
  assert.equal(formatRelativeTime(NOW - 30 * DAY, NOW), "30 days ago");
});

test("a future timestamp reads as just now, never a negative age", () => {
  assert.equal(formatRelativeTime(NOW + HOUR, NOW), "just now");
});
