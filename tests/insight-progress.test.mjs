import assert from "node:assert/strict";
import test from "node:test";
import { captureBaseline, scoreProgress } from "../lib/insight-progress.ts";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

const style = DEFAULT_STYLE_PREFERENCES;

function analysisFor(text) {
  const result = analyzeLocally(text, style);
  return { analysis: { ...result, analysedText: text, source: "local" }, issues: result.issues };
}

test("progress reports a dimension moving up with concrete drivers", () => {
  const before = analysisFor("It was decided by the team that the report should basically be very really quite somewhat possibly written again.");
  const baseline = captureBaseline(before.analysis, before.issues);
  const after = analysisFor("The team decided to rewrite the report.");
  const progress = scoreProgress(baseline, after.analysis, after.issues);
  const conciseness = progress.find((item) => item.dimension === "conciseness" || item.dimension === "clarity");
  assert.ok(conciseness, "expected a dimension to improve");
  assert.ok(conciseness.change > 0);
  assert.ok(conciseness.drivers.length > 0, "every movement names a driver");
  assert.match(conciseness.drivers.join(" "), /resolved|removed|dropped/u);
});

test("progress reports regressions honestly instead of only celebrating gains", () => {
  const before = analysisFor("The team decided to rewrite the report.");
  const baseline = captureBaseline(before.analysis, before.issues);
  const after = analysisFor("The team decided to rewrite the report, which was basically very very very really quite a lot of extra unnecessary words added here.");
  const progress = scoreProgress(baseline, after.analysis, after.issues);
  assert.ok(progress.some((item) => item.change < 0), "a worse draft must show a decline");
  const declining = progress.find((item) => item.change < 0);
  assert.ok(declining.drivers.join(" ").match(/appeared|added|rose/u));
});

test("no change means no progress noise", () => {
  const text = "The team decided to rewrite the report.";
  const first = analysisFor(text);
  const baseline = captureBaseline(first.analysis, first.issues);
  const second = analysisFor(text);
  assert.deepEqual(scoreProgress(baseline, second.analysis, second.issues), []);
});

test("baseline counts findings per rule so drivers can name what changed", () => {
  const first = analysisFor("It was decided by the team that this should be done.");
  const baseline = captureBaseline(first.analysis, first.issues);
  assert.equal(typeof baseline.issueCounts["style-passive-voice"], "number");
  assert.ok(baseline.scores.overall >= 0);
  assert.ok(baseline.stats.words > 0);
});
