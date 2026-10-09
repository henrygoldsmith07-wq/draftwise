import { readFile } from "node:fs/promises";
import { analyzeLocally, prioritiseSuggestions } from "../packages/grammar/src/index.ts";

/**
 * Development evaluation: the reporting surface that guides rule work.
 *
 * This is the dataset we DO tune against (evaluation/corpus.json,
 * evaluation/clean-prose.json and evaluation/dev-corpus.json). The held-out
 * blind corpus in scripts/evaluate-blind.mjs stays the independent measurement
 * and is never read here.
 *
 * The key measurement is the quality of DISPLAYED suggestions: what survives
 * contextual filtering, not what the raw detectors fire.
 */

const corpus = JSON.parse(await readFile(new URL("../evaluation/corpus.json", import.meta.url), "utf8"));
const cleanProse = JSON.parse(await readFile(new URL("../evaluation/clean-prose.json", import.meta.url), "utf8"));
const devCorpus = JSON.parse(await readFile(new URL("../evaluation/dev-corpus.json", import.meta.url), "utf8"));
// The context corpus adds the shapes the main corpus never contained: structured
// documents, ambiguous wording, findings where a suggested change would damage
// meaning, and overlapping findings on one span. It is loaded here rather than in
// evaluate-blind.mjs because it is a regression corpus like the others, not a
// held-out measurement. Run with --strict to gate on it.
const contextCorpus = JSON.parse(await readFile(new URL("../evaluation/context-corpus.json", import.meta.url), "utf8"));

const DEFAULT_GOALS = { audience: "general", intent: "inform", tone: "professional" };
const DEFAULT_DIALECT = "en-GB";

/**
 * Per-example analysis options.
 *
 * The context corpus is the first corpus to carry dialect, terminology
 * preferences and explicit goals, because a case like "correct British spelling
 * produces nothing" is meaningless without saying which dialect is in force.
 * Anything absent falls back to the same defaults the other corpora use.
 */
function optionsFor(example) {
  const goals = example.goals ?? (example.register === "casual"
    ? { audience: "casual", intent: "inform", tone: "casual" }
    : example.register === "academic"
      ? { audience: "academic", intent: "explain", tone: "neutral" }
      : example.register === "technical"
        ? { audience: "technical", intent: "explain", tone: "neutral" }
        : DEFAULT_GOALS);
  const dialect = example.dialect ?? DEFAULT_DIALECT;
  return {
    goals,
    dialect,
    analysisOptions: { dialect, ...(example.preferences ?? {}) },
    preferences: {
      dialect,
      preferredTerminology: example.preferences?.preferredTerminology ?? {},
    },
  };
}
// A style opinion is not an error. Counting a defensible passive-voice remark as
// a false positive would punish the engine for offering editorial advice, so the
// headline false-positive rate covers objective error categories only and
// stylistic noise is reported separately (same discipline as evaluate-blind).
const ERROR_CATEGORIES = new Set(["spelling", "grammar", "punctuation", "capitalization"]);
const isErrorCategory = (category) => ERROR_CATEGORIES.has(category);
const wordCount = (text) => String(text || "").trim().split(/\s+/u).filter(Boolean).length;
const perThousand = (count, words) => (words ? Number(((count / words) * 1000).toFixed(3)) : 0);
const ratio = (numerator, denominator) => (denominator ? Number((numerator / denominator).toFixed(3)) : 1);

function matchScore(expected, issue) {
  if (expected.ruleId && expected.ruleId !== issue.ruleId) return -1;
  if (expected.category && expected.category !== issue.category) return -1;
  if (typeof expected.original === "string" && expected.original !== issue.original) return -1;
  if (Number.isInteger(expected.start) && Number.isInteger(expected.end)
    && (expected.start !== issue.start || expected.end !== issue.end)) return -1;
  let score = 1;
  if (Number.isInteger(expected.start) && Number.isInteger(expected.end)) score += 4;
  if (typeof expected.original === "string") score += 2;
  return score;
}

function evaluatePass(examples, mode) {
  const byCategory = new Map();
  const byRegister = new Map();
  const byRule = new Map();
  const bySeverity = new Map();
  const severityCounts = { low: 0, medium: 0, high: 0 };
  const suppressionReasons = new Map();
  let truePositives = 0;
  let falsePositives = 0;
  let missedIssues = 0;
  let displayedTotal = 0;
  let rawTotal = 0;
  let words = 0;
  let highConfidenceShown = 0;
  let highConfidenceCorrect = 0;
  const allDisplayed = [];

  const bucket = (map, key) => {
    let entry = map.get(key);
    if (!entry) { entry = { expected: 0, truePositives: 0, falsePositives: 0, missedIssues: 0 }; map.set(key, entry); }
    return entry;
  };

  for (const example of examples) {
    const register = example.register ?? example.style ?? example.kind ?? "unlabelled";
    const { goals, dialect, analysisOptions, preferences } = optionsFor(example);
    const text = example.text;
    words += wordCount(text);
    const raw = analyzeLocally(text, analysisOptions, goals);
    const report = prioritiseSuggestions(raw.issues, { goals, preferences: { dialect, ...preferences }, text, document: undefined });
    const shown = mode === "displayed" ? report.displayed : raw.issues;
    rawTotal += raw.issues.length;
    displayedTotal += shown.length;
    allDisplayed.push(...shown);
    for (const entry of report.suppressed) {
      suppressionReasons.set(entry.reason, (suppressionReasons.get(entry.reason) ?? 0) + 1);
    }

    const used = new Set();
    for (const expected of example.expected ?? []) {
      bucket(byCategory, expected.category ?? "unlabelled").expected += 1;
      bucket(byRegister, register).expected += 1;
      bucket(byRule, expected.ruleId ?? "unlabelled").expected += 1;
      let index = -1;
      let best = -1;
      shown.forEach((issue, issueIndex) => {
        if (used.has(issueIndex)) return;
        const score = matchScore(expected, issue);
        if (score > best) { best = score; index = issueIndex; }
      });
      if (index >= 0) {
        used.add(index);
        truePositives += 1;
        const issue = shown[index];
        bucket(byCategory, expected.category ?? issue.category).truePositives += 1;
        bucket(byRegister, register).truePositives += 1;
        bucket(byRule, expected.ruleId ?? issue.ruleId).truePositives += 1;
        if (issue.confidence >= 0.9) { highConfidenceShown += 1; highConfidenceCorrect += 1; }
      } else {
        missedIssues += 1;
        bucket(byCategory, expected.category ?? "unlabelled").missedIssues += 1;
        bucket(byRegister, register).missedIssues += 1;
        bucket(byRule, expected.ruleId ?? "unlabelled").missedIssues += 1;
      }
    }
    for (const issue of shown) severityCounts[issue.severity] = (severityCounts[issue.severity] ?? 0) + 1;
    for (let index = 0; index < shown.length; index += 1) {
      const issue = shown[index];
      // Precision by severity counts every displayed suggestion against whether
      // it matched a labelled expectation (stylistic opinions included), so the
      // number reflects what the writer sees at each severity level.
      if (used.has(index)) bucket(bySeverity, issue.severity).truePositives += 1;
      else bucket(bySeverity, issue.severity).falsePositives += 1;
      if (used.has(index)) continue;
      if (isErrorCategory(issue.category)) {
        falsePositives += 1;
        bucket(byCategory, issue.category).falsePositives += 1;
        bucket(byRegister, register).falsePositives += 1;
        bucket(byRule, issue.ruleId).falsePositives += 1;
      }
      if (issue.confidence >= 0.9) highConfidenceShown += 1;
    }
  }

  const finalise = (map) => Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, {
    ...value,
    precision: ratio(value.truePositives, value.truePositives + value.falsePositives),
    recall: ratio(value.truePositives, value.truePositives + value.missedIssues),
  }]));

  const noisyRules = [...byRule.entries()]
    .map(([ruleId, value]) => ({ ruleId, falsePositives: value.falsePositives, truePositives: value.truePositives }))
    .filter((entry) => entry.falsePositives > 0)
    .sort((a, b) => b.falsePositives - a.falsePositives)
    .slice(0, 10);

  // Replacement validity: an actionable suggestion must offer a replacement
  // that actually differs from the original. "Review wording" cards count as
  // editorial notes, not broken replacements.
  let actionable = 0;
  let validReplacements = 0;
  let editorialNotes = 0;
  for (const issue of allDisplayed) {
    if (!issue.replacement || issue.replacement === issue.original) {
      editorialNotes += 1;
      continue;
    }
    actionable += 1;
    if (issue.replacement.trim().length > 0 || issue.original.trim().length > 0) validReplacements += 1;
  }

  return {
    mode,
    examples: examples.length,
    totalWords: words,
    rawSuggestions: rawTotal,
    displayedSuggestions: displayedTotal,
    suppressionRate: ratio(rawTotal - displayedTotal, rawTotal),
    truePositives,
    falsePositives,
    missedIssues,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + missedIssues),
    falsePositivesPer1000Words: perThousand(falsePositives, words),
    suggestionDensityPer1000Words: perThousand(displayedTotal, words),
    severityDistribution: severityCounts,
    highConfidencePrecision: ratio(highConfidenceCorrect, highConfidenceShown),
    replacementValidity: {
      actionable,
      valid: validReplacements,
      editorialNotes,
      validityRate: ratio(validReplacements, actionable),
    },
    byCategory: finalise(byCategory),
    bySeverity: finalise(bySeverity),
    byRegister: finalise(byRegister),
    topNoisyRules: noisyRules,
    suppressedByReason: Object.fromEntries([...suppressionReasons.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

const allExamples = [...corpus, ...cleanProse.map((example) => ({ ...example, expected: [], register: example.style })), ...devCorpus];
const rawPass = evaluatePass(allExamples, "raw");
const displayedPass = evaluatePass(allExamples, "displayed");

// The context corpus is reported separately rather than folded into the headline
// number. Its cases are deliberately harder (structured documents, meaning-risk
// spans, overlapping findings) and its expectations are stricter, so averaging it
// into the main figure would hide a regression in either direction. A separate
// line also keeps the existing headline comparable with every previous run.
const contextPass = evaluatePass(contextCorpus, "displayed");

console.log(JSON.stringify({
  corpusSize: allExamples.length,
  raw: rawPass,
  displayed: displayedPass,
  contextCorpus: {
    examples: contextCorpus.length,
    ...contextPass,
  },
  delta: {
    falsePositivesPer1000Words: Number((rawPass.falsePositivesPer1000Words - displayedPass.falsePositivesPer1000Words).toFixed(3)),
    suggestions: rawPass.displayedSuggestions - displayedPass.displayedSuggestions,
    precisionChange: Number((displayedPass.precision - rawPass.precision).toFixed(3)),
    recallChange: Number((displayedPass.recall - rawPass.recall).toFixed(3)),
  },
}, null, 2));

// The context corpus gates only when asked for, and only on the metrics that
// matter for it: an objective false positive, or a missing correction that the
// case exists to prove is produced. Precision here is measured on displayed
// suggestions, which is the whole point of the corpus.
if (process.argv.includes("--strict")) {
  const mainFails = displayedPass.falsePositivesPer1000Words > 1 || displayedPass.precision < 0.7;
  const contextFails = contextPass.falsePositivesPer1000Words > 2 || contextPass.recall < 0.85;
  if (mainFails || contextFails) process.exit(1);
}
