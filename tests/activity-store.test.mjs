import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_WEEK, WritingActivityStore } from "../lib/activity-store.ts";

/**
 * The activity store's subscription contract.
 *
 * Insights reads the week through useSyncExternalStore, which demands two
 * things this pins down: the server snapshot is a fixed object (never fresh,
 * so hydration cannot drift), and subscribers are only woken when the numbers
 * actually move (so idle ticks never re-render the panel).
 */

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

const day = (year, month, date) => new Date(year, month - 1, date, 12);

test("the server snapshot is a fixed empty week", () => {
  const store = new WritingActivityStore();
  assert.equal(store.getServerSnapshot(), EMPTY_WEEK);
  assert.equal(store.getSnapshot(), EMPTY_WEEK);
});

test("hydrating loads the stored log exactly once", () => {
  const storage = memoryStorage({
    "draftwise:activity:v1": JSON.stringify({ version: 1, days: [{ date: "2026-10-16", words: 40, activeMs: 1000 }] }),
  });
  const store = new WritingActivityStore();
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.hydrate(storage, day(2026, 10, 16));
  assert.equal(store.getSnapshot().words, 40);
  assert.equal(calls, 1);
  store.hydrate(storage, day(2026, 10, 16));
  assert.equal(calls, 1);
});

test("recording persists, updates the snapshot, and wakes subscribers once", () => {
  const storage = memoryStorage();
  const store = new WritingActivityStore();
  store.hydrate(storage, day(2026, 10, 16));
  let calls = 0;
  const stop = store.subscribe(() => { calls += 1; });
  store.record(storage, 25, 30_000, day(2026, 10, 16));
  assert.equal(store.getSnapshot().words, 25);
  assert.equal(calls, 1);
  stop();
  store.record(storage, 10, 30_000, day(2026, 10, 16));
  assert.equal(store.getSnapshot().words, 35);
  assert.equal(calls, 1);
});

test("an empty tick records nothing and wakes nobody", () => {
  const storage = memoryStorage();
  const store = new WritingActivityStore();
  store.hydrate(storage, day(2026, 10, 16));
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  store.record(storage, 0, 0, day(2026, 10, 16));
  assert.equal(calls, 0);
  assert.equal(store.getSnapshot(), EMPTY_WEEK);
});

test("refresh notices a new day without waiting for a write", () => {
  const storage = memoryStorage();
  const store = new WritingActivityStore();
  store.hydrate(storage, day(2026, 10, 16));
  store.record(storage, 60, 30_000, day(2026, 10, 16));
  assert.equal(store.getSnapshot().streak, 1);
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  // Two days later with no writing: the streak lapsed, so the panel moves.
  store.refresh(day(2026, 10, 18));
  assert.equal(store.getSnapshot().streak, 0);
  assert.equal(calls, 1);
});

test("recording without storage is a safe no-op", () => {
  const store = new WritingActivityStore();
  store.hydrate(undefined, day(2026, 10, 16));
  store.record(undefined, 10, 1000, day(2026, 10, 16));
  assert.equal(store.getSnapshot(), EMPTY_WEEK);
});
