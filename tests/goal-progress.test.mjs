import assert from "node:assert/strict";
import test from "node:test";
import { lengthProgress, lengthProgressLabel } from "../lib/goal-progress.ts";

test("no target means no meter", () => {
  const progress = lengthProgress(412);
  assert.equal(progress.target, null);
  assert.equal(progress.percent, 0);
  assert.equal(lengthProgressLabel(progress), null);
});

test("zero and malformed targets mean no meter", () => {
  assert.equal(lengthProgress(100, 0).target, null);
  assert.equal(lengthProgress(100, -50).target, null);
  assert.equal(lengthProgress(100, NaN).target, null);
});

test("progress tracks the share of the goal", () => {
  const progress = lengthProgress(300, 600);
  assert.equal(progress.words, 300);
  assert.equal(progress.target, 600);
  assert.equal(progress.percent, 50);
  assert.equal(progress.remaining, 300);
  assert.equal(lengthProgressLabel(progress), "300 of 600 words · 300 to go");
});

test("over-goal clamps the bar and says so plainly", () => {
  const progress = lengthProgress(688, 600);
  assert.equal(progress.percent, 100);
  assert.equal(progress.remaining, -88);
  assert.equal(lengthProgressLabel(progress), "688 of 600 words · 88 over");
});

test("exact target reads as on target", () => {
  const progress = lengthProgress(600, 600);
  assert.equal(progress.percent, 100);
  assert.equal(lengthProgressLabel(progress), "600 of 600 words · on target");
});

test("negative and non-finite word counts are treated as empty", () => {
  assert.equal(lengthProgress(-20, 600).words, 0);
  assert.equal(lengthProgress(NaN, 600).words, 0);
  assert.equal(lengthProgressLabel(lengthProgress(0, 600)), "0 of 600 words · 600 to go");
});
