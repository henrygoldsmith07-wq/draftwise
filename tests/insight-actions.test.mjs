import assert from "node:assert/strict";
import test from "node:test";
import { buildActionableInsights } from "../lib/insight-actions.ts";
import { DISMISSAL_LEARNING_THRESHOLD } from "../lib/writing-profile.ts";
import { DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

// buildActionableInsights turns the current analysis into the one action the
// writer should take next plus the recurring patterns. Its promises, pinned
// here: the recommendation always points at a finding the writer can actually
// act on (it is derived from the displayed list, not the raw one), objective
// work outranks style work, and nothing is asserted that has no finding behind
// it. It shipped with none, so these pin the contract.

const issue = (patch = {}) => ({
  id: "issue",
  ruleId: "test-rule",
  start: 0,
  end: 3,
  original: "bad",
  replacement: "good",
  category: "clarity",
  severity: "medium",
  confidence: 0.9,
  title: "Improve wording",
  explanation: "",
  source: "local",
  ...patch,
});

const analysis = (words = 100) => ({
  scores: {
    overall: 80,
    correctness: 80,
    clarity: 80,
    conciseness: 80,
    readability: 80,
    engagement: 80,
    consistency: 80,
    goalAlignment: 80,
    breakdown: {
      goalAlignment: { signals: [], summary: "" },
    },
  },
  stats: {
    words,
    sentences: 5,
    longSentences: 0,
    averageSentenceLength: 20,
    fillerWords: 0,
    fillerWordFrequency: [],
    readingTime: 1,
    readability: 60,
    vocabularyDiversity: 0.5,
    passiveVoicePercentage: 0,
    paragraphs: 1,
    longestSentence: "a sentence",
    repeatedWords: [],
    repeatedPhrases: [],
  },
  tone: [],
  issues: [],
  aiCoverage: "local",
  analysedText: "",
  source: "local",
});

const report = (displayedCount = 0, byTier = { "fix-first": 0, improve: 0, optional: 0 }) => ({
  rawCount: displayedCount,
  displayedCount,
  suppressedCount: 0,
  groupedCount: 0,
  byTier,
  byCategory: {},
  suppressedByRule: [],
});

test("an empty draft has no next action and no patterns", () => {
  const result = buildActionableInsights({
    analysis: analysis(),
    issues: [],
    displayed: [],
    report: report(),
  });
  assert.equal(result.nextAction, null);
  assert.deepEqual(result.recurring, []);
  assert.equal(result.onlyStyleRemaining, false);
});

test("a single finding becomes a one-click action naming its text", () => {
  const typo = issue({ id: "typo", ruleId: "spelling-common-typo", category: "spelling", original: "recievd", replacement: "received" });
  const result = buildActionableInsights({
    analysis: analysis(),
    issues: [typo],
    displayed: [typo],
    report: report(1, { "fix-first": 1, improve: 0, optional: 0 }),
  });
  assert.ok(result.nextAction, "a finding must produce an action");
  assert.equal(result.nextAction.kind, "objective");
  assert.match(result.nextAction.label, /recievd/u, "the label names what to fix");
  assert.equal(result.nextAction.affectedCount, 1);
  assert.equal(result.nextAction.target?.id, "typo", "the action jumps to the finding itself");
});

test("a recurring family becomes a group action with a plain-language description", () => {
  const first = issue({ id: "p1", ruleId: "style-passive-voice", category: "passive voice", start: 0, end: 8, original: "was made" });
  const second = issue({ id: "p2", ruleId: "style-passive-voice", category: "passive voice", start: 20, end: 28, original: "was made" });
  const result = buildActionableInsights({
    analysis: analysis(),
    issues: [first, second],
    displayed: [first, second],
    report: report(2, { "fix-first": 0, improve: 2, optional: 0 }),
  });
  assert.ok(result.nextAction);
  assert.equal(result.nextAction.affectedCount, 2);
  assert.match(result.nextAction.label, /passive voice/iu, "the group action names the pattern");
  const pattern = result.recurring.find((entry) => entry.family === "style-passive-voice");
  assert.ok(pattern, "a family with several findings is a recurring pattern");
  assert.equal(pattern.count, 2);
  assert.match(pattern.description, /2 passages/u, "the description is plain language, not a rule id");
  assert.equal(pattern.label, "Passive voice suggestions", "the family reads as product copy");
});

test("the next action comes from the displayed list, so it is always actionable", () => {
  // The raw list holds a real finding that was suppressed by the density cap;
  // the displayed list only has the style note. The recommendation must point
  // at the on-screen suggestion — pointing at a suppressed finding would be a
  // dead end, exactly what the module exists to prevent.
  const suppressed = issue({ id: "raw-only", ruleId: "conciseness-filler", category: "conciseness", original: "really" });
  const shown = issue({ id: "shown", ruleId: "style-intensifier", category: "tone", original: "very" });
  const result = buildActionableInsights({
    analysis: analysis(),
    issues: [suppressed, shown],
    displayed: [shown],
    report: report(1),
  });
  assert.ok(result.nextAction);
  assert.equal(result.nextAction.family, "style-intensifier");
  assert.equal(result.nextAction.target?.id, "shown");
});

test("objective findings outrank a larger group of style notes", () => {
  // One objective slip must beat several optional style notes even though the
  // style group is larger: the weighting exists so correctness is never buried.
  const typo = issue({ id: "typo", ruleId: "spelling-common-typo", category: "spelling", severity: "high", confidence: 0.99, original: "teh", replacement: "the" });
  const styleNotes = [1, 2, 3, 4].map((index) => issue({
    id: `style-${index}`,
    ruleId: "style-intensifier",
    category: "tone",
    severity: "low",
    confidence: 0.7,
    start: index * 10,
    original: "very",
  }));
  const result = buildActionableInsights({
    analysis: analysis(),
    issues: [typo, ...styleNotes],
    displayed: [typo, ...styleNotes],
    report: report(5, { "fix-first": 1, improve: 0, optional: 4 }),
  });
  assert.ok(result.nextAction);
  assert.equal(result.nextAction.family, "spelling-common-typo");
  assert.equal(result.nextAction.kind, "objective");
});

test("the style-only flag follows the displayed list the writer is looking at", () => {
  const notes = [1, 2].map((index) => issue({ id: `s${index}`, ruleId: "style-intensifier", category: "tone", start: index * 10 }));
  const result = buildActionableInsights({
    analysis: analysis(),
    issues: notes,
    displayed: notes,
    report: report(2, { "fix-first": 0, improve: 0, optional: 2 }),
  });
  assert.equal(result.onlyStyleRemaining, true, "everything on screen is preference");

  // An objective correction on screen means the reassurance would be false —
  // the panel would claim "nothing here is an error" next to an error.
  const shown = [notes[0], issue({ id: "t", ruleId: "spelling-common-typo", category: "spelling" })];
  const mixed = buildActionableInsights({
    analysis: analysis(),
    issues: shown,
    displayed: shown,
    report: report(2),
  });
  assert.equal(mixed.onlyStyleRemaining, false, "an objective finding on screen flips the flag off");

  // But a style-only displayed list stays honest even when the raw analysis
  // holds more: the flag describes the suggestions the writer can act on.
  const suppressedObjective = buildActionableInsights({
    analysis: analysis(),
    issues: [...notes, issue({ id: "raw-typo", ruleId: "spelling-common-typo", category: "spelling" })],
    displayed: notes,
    report: report(2),
  });
  assert.equal(suppressedObjective.onlyStyleRemaining, true);
});

test("a length target far off replaces the headline with the length action", () => {
  // 100 words against a 600-word target is under the 0.6 floor, so the one
  // thing worth doing is writing more — not the wording fix that would
  // otherwise lead.
  const typo = issue({ id: "typo", ruleId: "spelling-common-typo", category: "spelling" });
  const result = buildActionableInsights({
    analysis: analysis(100),
    issues: [typo],
    displayed: [typo],
    report: report(1, { "fix-first": 1, improve: 0, optional: 0 }),
    goals: { audience: "general", intent: "inform", tone: "neutral", targetLength: 600 },
  });
  assert.ok(result.nextAction);
  assert.equal(result.nextAction.family, "goal-length");
  assert.equal(result.nextAction.affectedCount, 0, "no finding is behind a length note");
  assert.equal(result.nextAction.target, undefined);
  assert.match(result.nextAction.label, /600-word target/u);
  assert.match(result.nextAction.label, /Expand/u);
});

test("an over-length target asks for trimming and states both numbers", () => {
  // 1000 words against 600 is over the 1.6 ceiling.
  const result = buildActionableInsights({
    analysis: analysis(1000),
    issues: [issue({ id: "t", ruleId: "style-intensifier", category: "tone" })],
    displayed: [issue({ id: "t", ruleId: "style-intensifier", category: "tone" })],
    report: report(1),
    goals: { audience: "general", intent: "inform", tone: "neutral", targetLength: 600 },
  });
  assert.ok(result.nextAction);
  assert.equal(result.nextAction.family, "goal-length");
  assert.match(result.nextAction.label, /Trim/u);
  assert.match(result.nextAction.reason, /1,000 words against a target of 600/u);
});

test("a length target close to the draft leaves the findings in charge", () => {
  const typo = issue({ id: "typo", ruleId: "spelling-common-typo", category: "spelling", original: "teh", replacement: "the" });
  const result = buildActionableInsights({
    analysis: analysis(560),
    issues: [typo],
    displayed: [typo],
    report: report(1, { "fix-first": 1, improve: 0, optional: 0 }),
    goals: { audience: "general", intent: "inform", tone: "neutral", targetLength: 600 },
  });
  assert.ok(result.nextAction);
  assert.notEqual(result.nextAction.family, "goal-length");
  assert.equal(result.nextAction.target?.id, "typo");
});

test("a family dismissed past the threshold is marked, not silently re-offered", () => {
  const first = issue({ id: "p1", ruleId: "style-passive-voice", category: "passive voice", start: 0, original: "was made" });
  const second = issue({ id: "p2", ruleId: "style-passive-voice", category: "passive voice", start: 20, original: "was made" });
  const counts = { "style-passive-voice": DISMISSAL_LEARNING_THRESHOLD };
  const learned = buildActionableInsights({
    analysis: analysis(),
    issues: [first, second],
    displayed: [first, second],
    report: report(2),
    style: { ...DEFAULT_STYLE_PREFERENCES, dismissalCounts: counts },
  });
  const pattern = learned.recurring.find((entry) => entry.family === "style-passive-voice");
  assert.ok(pattern);
  assert.equal(pattern.repeatedlyDismissed, true, "the writer's refusals are surfaced");

  const fresh = buildActionableInsights({
    analysis: analysis(),
    issues: [first, second],
    displayed: [first, second],
    report: report(2),
    style: DEFAULT_STYLE_PREFERENCES,
  });
  assert.equal(fresh.recurring.find((entry) => entry.family === "style-passive-voice")?.repeatedlyDismissed, false);
});

test("an issue in both the raw and displayed lists is counted once", () => {
  const typo = issue({ id: "dup", ruleId: "spelling-common-typo", category: "spelling" });
  const result = buildActionableInsights({
    analysis: analysis(),
    issues: [typo],
    displayed: [typo],
    report: report(1, { "fix-first": 1, improve: 0, optional: 0 }),
  });
  assert.equal(result.recurring.length, 0, "one finding cannot be a recurring pattern");
  assert.equal(result.nextAction?.affectedCount, 1);
});

test("the same input always produces the same recommendation", () => {
  const findings = [
    issue({ id: "a", ruleId: "spelling-common-typo", category: "spelling", original: "teh", replacement: "the" }),
    issue({ id: "b", ruleId: "clarity-vague-word", category: "clarity", original: "things" }),
    issue({ id: "c", ruleId: "clarity-vague-word", category: "clarity", start: 12, original: "stuff" }),
  ];
  const args = {
    analysis: analysis(),
    issues: findings,
    displayed: findings,
    report: report(3, { "fix-first": 1, improve: 2, optional: 0 }),
  };
  const first = buildActionableInsights(args);
  const second = buildActionableInsights(args);
  assert.deepEqual(first, second, "the insight is derived, not sampled");
});
