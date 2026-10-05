import assert from "node:assert/strict";
import test from "node:test";
import { classifyIssueKind, prioritiseSuggestions, ruleFamily } from "../packages/grammar/src/prioritise.ts";
import { buildSuggestionState, filterByCategory, filterByTier, filterableCategories } from "../lib/suggestions.ts";
import { DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

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

const goals = (audience, intent = "inform", tone = "professional") => ({ audience, intent, tone });

test("objective high-confidence mistakes land in fix-first, style advice in optional", () => {
  const result = prioritiseSuggestions([
    issue({ ruleId: "spelling-common-typo", category: "spelling", severity: "high", confidence: 0.99 }),
    issue({ ruleId: "style-passive-voice", category: "passive voice", severity: "low", confidence: 0.7, original: "was made", replacement: "" }),
    issue({ ruleId: "conciseness-filler", category: "conciseness", severity: "low", confidence: 0.8, original: "really" }),
  ], { goals: goals("professional"), preferences: DEFAULT_STYLE_PREFERENCES, text: "really bad was made" });
  const byRule = Object.fromEntries(result.displayed.map((item) => [item.ruleId, item.tier]));
  assert.equal(byRule["spelling-common-typo"], "fix-first");
  assert.equal(byRule["style-passive-voice"], "optional");
  assert.ok(byRule["conciseness-filler"] === "improve" || byRule["conciseness-filler"] === "optional");
});

test("casual register suppresses sentence-case and missing-terminal nitpicks", () => {
  const result = prioritiseSuggestions([
    issue({ ruleId: "capitalization-sentence-start", category: "capitalization", severity: "medium", confidence: 0.99, original: "h" }),
    issue({ ruleId: "punctuation-missing-terminal", category: "punctuation", severity: "low", confidence: 0.82, original: "free" }),
  ], { goals: goals("casual", "describe", "casual"), preferences: DEFAULT_STYLE_PREFERENCES, text: "hey are you free" });
  assert.equal(result.displayed.length, 0);
  assert.equal(result.suppressed.every((entry) => entry.reason === "register-mismatch"), true);
});

test("academic register keeps vague-word findings but drops intensifier nits", () => {
  const academic = prioritiseSuggestions([
    issue({ ruleId: "clarity-vague-word", category: "clarity", original: "things", replacement: "" }),
    issue({ ruleId: "style-intensifier", category: "tone", severity: "low", confidence: 0.72, original: "very", replacement: "" }),
  ], { goals: goals("academic", "inform", "formal"), preferences: DEFAULT_STYLE_PREFERENCES, text: "very many things" });
  assert.equal(academic.displayed.some((item) => item.ruleId === "clarity-vague-word"), true);
  const casual = prioritiseSuggestions([
    issue({ ruleId: "style-intensifier", category: "tone", severity: "low", confidence: 0.72, original: "very", replacement: "" }),
    issue({ ruleId: "style-intensifier", category: "tone", severity: "low", confidence: 0.72, original: "really", replacement: "" }),
    issue({ ruleId: "style-intensifier", category: "tone", severity: "low", confidence: 0.72, original: "totally", replacement: "" }),
  ], { goals: goals("casual", "describe", "casual"), preferences: DEFAULT_STYLE_PREFERENCES, text: "very really totally fine" });
  assert.equal(casual.suppressed.filter((entry) => entry.reason === "register-mismatch").length >= 2, true);
});

test("repeated findings of the same pattern group into one suggestion", () => {
  const result = prioritiseSuggestions([
    issue({ id: "a", ruleId: "style-passive-voice", category: "passive voice", severity: "low", confidence: 0.7, start: 0, end: 8, original: "was made" }),
    issue({ id: "b", ruleId: "style-passive-voice", category: "passive voice", severity: "low", confidence: 0.7, start: 10, end: 18, original: "was made" }),
    issue({ id: "c", ruleId: "style-passive-voice", category: "passive voice", severity: "low", confidence: 0.7, start: 20, end: 28, original: "was made" }),
  ], { goals: goals("professional"), preferences: DEFAULT_STYLE_PREFERENCES, text: "was made was made was made" });
  const passive = result.displayed.filter((item) => item.ruleId === "style-passive-voice");
  assert.equal(passive.length, 1);
  assert.equal(passive[0].groupedCount, 2);
  assert.equal(result.suppressed.filter((entry) => entry.reason === "repeated-pattern").length, 2);
});

test("density caps hold the sidebar to a reviewable number per tier", () => {
  const many = [];
  for (let index = 0; index < 20; index += 1) {
    many.push(issue({
      id: `filler-${index}`,
      ruleId: "conciseness-filler",
      category: "conciseness",
      severity: "low",
      confidence: 0.8,
      start: index * 10,
      end: index * 10 + 4,
      original: `word${index}`,
    }));
  }
  const result = prioritiseSuggestions(many, { goals: goals("professional"), preferences: DEFAULT_STYLE_PREFERENCES, text: many.map((item) => item.original).join(" ") });
  assert.ok(result.displayed.length <= 5, `expected at most 5 displayed, got ${result.displayed.length}`);
  assert.ok(result.suppressed.filter((entry) => entry.reason === "density-cap").length > 0);
  assert.equal(result.report.rawCount, 20);
});

test("turning a suggestion type off suppresses its whole rule family", () => {
  const preferences = { ...DEFAULT_STYLE_PREFERENCES, ignoredRuleIds: ["wordiness-due-to-the-fact-that"] };
  const result = prioritiseSuggestions([
    issue({ ruleId: "wordiness-due-to-the-fact-that", category: "conciseness", original: "due to the fact that" }),
    issue({ ruleId: "wordiness-in-order-to", category: "conciseness", original: "in order to" }),
    issue({ ruleId: "spelling-common-typo", category: "spelling", original: "repeatd" }),
  ], { goals: goals("professional"), preferences, text: "due to the fact that in order to repeatd" });
  assert.equal(result.displayed.some((item) => item.ruleId.startsWith("wordiness-")), false);
  assert.equal(result.suppressed.filter((entry) => entry.reason === "rule-off").length, 2);
  assert.equal(result.displayed.some((item) => item.ruleId === "spelling-common-typo"), true);
});

test("reducing a suggestion type leaves only its single strongest instance", () => {
  const preferences = { ...DEFAULT_STYLE_PREFERENCES, reducedRuleIds: ["conciseness-filler"] };
  const many = [];
  for (let index = 0; index < 6; index += 1) {
    many.push(issue({ id: `f-${index}`, ruleId: "conciseness-filler", category: "conciseness", start: index * 8, end: index * 8 + 4, original: `filler${index}` }));
  }
  const result = prioritiseSuggestions(many, { goals: goals("professional"), preferences, text: many.map((item) => item.original).join(" ") });
  assert.equal(result.displayed.length, 1);
  assert.ok(result.suppressed.filter((entry) => entry.reason === "rule-reduced").length >= 4);
});

test("a dismissed finding holds back the same word nearby but not distant text", () => {
  const dismissed = [{ ruleId: "clarity-vague-word", start: 0, end: 6, original: "things" }];
  const result = prioritiseSuggestions([
    issue({ id: "near", ruleId: "clarity-vague-word", category: "clarity", start: 20, end: 26, original: "things", replacement: "" }),
    issue({ id: "far", ruleId: "clarity-vague-word", category: "clarity", start: 2000, end: 2006, original: "things", replacement: "" }),
  ], { goals: goals("academic"), preferences: DEFAULT_STYLE_PREFERENCES, text: "things".padEnd(2010, "x"), dismissed });
  assert.equal(result.displayed.some((item) => item.id === "near"), false);
  assert.equal(result.displayed.some((item) => item.id === "far"), true);
});

test("noisy rules rank below quiet rules with the same evidence", () => {
  const text = "alpha beta gamma delta";
  const pair = () => [
    issue({ id: "a", ruleId: "quiet-rule", original: "alpha" }),
    issue({ id: "b", ruleId: "noisy-rule", start: 6, end: 10, original: "beta" }),
  ];
  const baseline = prioritiseSuggestions(pair(), { goals: goals("professional"), preferences: DEFAULT_STYLE_PREFERENCES, text });
  const noisy = prioritiseSuggestions(pair(), { goals: goals("professional"), preferences: DEFAULT_STYLE_PREFERENCES, text, ruleDismissalCounts: { "noisy-rule": 4 } });
  assert.deepEqual(baseline.displayed.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(noisy.displayed.map((item) => item.id), ["a", "b"]);
  assert.ok(noisy.displayed.find((item) => item.id === "b").rank < baseline.displayed.find((item) => item.id === "b").rank);
});

test("rule families group related advice and tiers classify objective versus style", () => {
  assert.equal(ruleFamily("wordiness-in-order-to"), "wordiness");
  assert.equal(ruleFamily("style-cliche-at-the-end-of-the-day"), "cliche");
  assert.equal(ruleFamily("grammar-confused-than"), "confused-word");
  assert.equal(ruleFamily("spelling-common-typo"), "spelling-common-typo");
  assert.equal(classifyIssueKind({ ruleId: "spelling-common-typo", category: "spelling" }), "objective");
  assert.equal(classifyIssueKind({ ruleId: "dialect-spelling", category: "spelling" }), "clarity");
  assert.equal(classifyIssueKind({ ruleId: "style-passive-voice", category: "passive voice" }), "style");
  assert.equal(classifyIssueKind({ ruleId: "structure-long-sentence", category: "sentence structure" }), "clarity");
});

test("the suggestion state exposes review ordering, focus and suppression accounting", () => {
  const state = buildSuggestionState({
    issues: [
      issue({ id: "style", ruleId: "style-passive-voice", category: "passive voice", severity: "low", confidence: 0.7, original: "was made", replacement: "" }),
      issue({ id: "typo", ruleId: "spelling-common-typo", category: "spelling", severity: "high", confidence: 0.99, start: 20, end: 27, original: "repeatd", replacement: "repeated" }),
    ],
    goals: goals("professional"),
    style: DEFAULT_STYLE_PREFERENCES,
    dismissedKeys: [],
  });
  assert.equal(state.focus?.id, "typo");
  assert.equal(state.changesWorthMaking, 1);
  assert.equal(state.report.displayedCount, 2);
  assert.equal(filterByTier(state.displayed, "fix-first").length, 1);
  assert.equal(filterByTier(state.displayed, "optional").length, 1);
  assert.equal(state.report.suppressedCount, state.suppressed.length);
});

test("tier and category filters compose", () => {
  const findings = [
    issue({ id: "typo", ruleId: "spelling/test", category: "spelling", severity: "high", start: 0, end: 3 }),
    issue({ id: "comma", ruleId: "punctuation/test", category: "punctuation", severity: "medium", start: 8, end: 9 }),
    issue({ id: "wording", ruleId: "clarity/test", category: "clarity", severity: "low", start: 16, end: 19 }),
  ];
  const state = buildSuggestionState({
    issues: findings,
    goals: { audience: "general", intent: "inform", tone: "neutral" },
    style: DEFAULT_STYLE_PREFERENCES,
    dismissedKeys: [],
  });

  const spelling = filterByCategory(state.displayed, "spelling");
  assert.deepEqual(spelling.map((item) => item.id), ["typo"]);
  assert.equal(filterByCategory(state.displayed, "grammar").length, 2, "grammar covers the mechanical categories");
  assert.equal(filterByCategory(state.displayed, "style").length, 1, "style excludes the mechanical categories");
  assert.equal(filterByCategory(state.displayed, "all").length, state.displayed.length);

  // Narrowing by category must not override the tier filter, and vice versa.
  const ids = (items) => items.map((item) => item.id).sort();
  assert.deepEqual(ids(filterByTier(filterByCategory(state.displayed, "grammar"), "optional")), [], "a category must not reintroduce other tiers");
  assert.deepEqual(ids(filterByTier(filterByCategory(state.displayed, "all"), "optional")), ["wording"]);
  assert.deepEqual(ids(filterByTier(filterByCategory(state.displayed, "spelling"), "fix-first")), ["typo"]);
});

test("only categories with findings are offered as filters", () => {
  const state = buildSuggestionState({
    issues: [
      issue({ id: "a", ruleId: "clarity/test", category: "clarity", severity: "high", start: 0, end: 3 }),
      issue({ id: "b", ruleId: "clarity/test", category: "clarity", severity: "high", start: 8, end: 11 }),
    ],
    goals: { audience: "general", intent: "inform", tone: "neutral" },
    style: DEFAULT_STYLE_PREFERENCES,
    dismissedKeys: [],
  });
  const options = filterableCategories(state.report);
  assert.ok(options.length > 0);
  assert.ok(options.every((option) => option.count > 0), "empty categories must not be offered");
  assert.ok(options.every((option) => option.value !== "all"), "the all option is rendered separately");
  for (let index = 1; index < options.length; index += 1) {
    assert.ok(options[index - 1].count >= options[index].count, "options are ordered by size");
  }
});

test("passage context is cut on sentence boundaries", () => {
  const text = "The quarterly review found a persistent delay in the northern region. The team reigon lead confirmed the slip. Reporting resumes next week.";
  const state = buildSuggestionState({
    issues: [issue({ id: "typo", ruleId: "spelling/test", category: "spelling", severity: "high", start: text.indexOf("reigon"), end: text.indexOf("reigon") + 6, original: "reigon" })],
    goals: { audience: "general", intent: "inform", tone: "neutral" },
    style: DEFAULT_STYLE_PREFERENCES,
    dismissedKeys: [],
    text,
  });
  const context = state.displayed[0].context;
  // A fixed character window cut mid-clause often enough to be unreadable.
  assert.ok(context.startsWith("The quarterly review"), `context should start at a sentence boundary, got ${JSON.stringify(context)}`);
  assert.ok(context.endsWith("next week."), `context should end at a sentence boundary, got ${JSON.stringify(context)}`);
  assert.ok(!context.includes("…"), `whole sentences need no truncation marker, got ${JSON.stringify(context)}`);
});

test("passage context is marked when no sentence boundary is reachable", () => {
  const text = `${"x".repeat(400)} reigon ${"y".repeat(400)}`;
  const state = buildSuggestionState({
    issues: [issue({ id: "typo", ruleId: "spelling/test", category: "spelling", severity: "high", start: 401, end: 407, original: "reigon" })],
    goals: { audience: "general", intent: "inform", tone: "neutral" },
    style: DEFAULT_STYLE_PREFERENCES,
    dismissedKeys: [],
    text,
  });
  const context = state.displayed[0].context;
  assert.ok(context.startsWith("…") && context.endsWith("…"), `truncated context must say so, got ${JSON.stringify(context.slice(0, 12))}`);
});
