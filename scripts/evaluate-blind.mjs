import { readFile } from "node:fs/promises";
import { analyzeLocally } from "../packages/grammar/src/index.ts";

/**
 * Blind evaluation.
 *
 * This corpus is a held-out sample. It is deliberately NOT the set that rule
 * thresholds, lexicons or scoring are tuned against. That is the whole point.
 *
 * A poor number here is therefore a finding to report, not a target to chase.
 * Tuning rules directly against these examples would turn this into a second
 * regression corpus and destroy the only independent signal we have about
 * false positives, which matter most to a writer. Tuning belongs on
 * evaluation/corpus.json and evaluation/clean-prose.json.
 */

const corpus = JSON.parse(await readFile(new URL("../evaluation/blind-corpus.json", import.meta.url), "utf8"));

// A suggestion the engine offers about style is not the same thing as an error.
// Conflating the two produces a meaningless false-positive number: flagging a
// passive construction in an essay is a defensible editorial opinion, not a
// mistake, and a writer told otherwise stops trusting the tool.
const ERROR_CATEGORIES = new Set(["spelling", "grammar", "punctuation", "capitalization"]);
const isErrorCategory = (category) => ERROR_CATEGORIES.has(category);

const wordCount = (text) => String(text || "").trim().split(/\s+/u).filter(Boolean).length;
const perThousand = (count, words) => (words ? Number(((count / words) * 1000).toFixed(3)) : 0);
const ratio = (numerator, denominator) => (denominator ? Number((numerator / denominator).toFixed(3)) : 1);

function bucketFor(map, key) {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { examples: 0, words: 0, expected: 0, truePositives: 0, missedIssues: 0, falsePositives: 0 };
    map.set(key, bucket);
  }
  return bucket;
}

// An expectation may pin ruleId, category, exact original text and/or an exact
// span. Whatever it leaves open is decided by the best remaining candidate, so a
// partial expectation stays useful instead of silently becoming a recall miss.
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

const byStyle = new Map();
const byKind = new Map();
const byRule = new Map();
const byCategory = new Map();
const offenders = [];

let truePositives = 0;
let falsePositives = 0;
let missedIssues = 0;
let totalWords = 0;
let cleanExamples = 0;
let cleanWords = 0;
let cleanFalsePositives = 0;
let cleanErrorFalsePositives = 0;
let cleanStyleFalsePositives = 0;
let errorFalsePositives = 0;
let styleFalsePositives = 0;

for (const example of corpus) {
  const words = wordCount(example.text);
  const expectations = example.expected ?? [];
  totalWords += words;

  const style = bucketFor(byStyle, example.style);
  style.examples += 1;
  style.words += words;

  const kind = bucketFor(byKind, example.kind);
  kind.examples += 1;
  kind.words += words;

  const result = analyzeLocally(example.text, { dialect: "en-GB" });
  const claimed = new Set();

  for (const expected of expectations) {
    let bestIndex = -1;
    let bestScore = -1;
    result.issues.forEach((issue, issueIndex) => {
      if (claimed.has(issueIndex)) return;
      const score = matchScore(expected, issue);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = issueIndex;
      }
    });

    const matched = bestIndex >= 0;
    if (matched) {
      claimed.add(bestIndex);
      truePositives += 1;
    } else {
      missedIssues += 1;
    }

    // Expectations may omit ruleId when they only pin a category or a span;
    // those contribute to the category totals but not to a per-rule breakdown.
    if (expected.ruleId) {
      const rule = bucketFor(byRule, expected.ruleId);
      rule.expected += 1;
      if (matched) rule.truePositives += 1;
      else rule.missedIssues += 1;
    }

    const category = bucketFor(byCategory, expected.category);
    category.expected += 1;
    if (matched) category.truePositives += 1;
    else category.missedIssues += 1;
  }

  const extra = result.issues.filter((_issue, index) => !claimed.has(index));
  falsePositives += extra.length;
  style.falsePositives += extra.length;
  kind.falsePositives += extra.length;

  for (const issue of extra) {
    if (isErrorCategory(issue.category)) errorFalsePositives += 1;
    else styleFalsePositives += 1;
  }

  if (expectations.length === 0) {
    cleanExamples += 1;
    cleanWords += words;
    cleanFalsePositives += extra.length;
    for (const issue of extra) {
      if (isErrorCategory(issue.category)) cleanErrorFalsePositives += 1;
      else cleanStyleFalsePositives += 1;
    }
  }

  for (const issue of extra) {
    bucketFor(byRule, issue.ruleId).falsePositives += 1;
    bucketFor(byCategory, issue.category).falsePositives += 1;
    offenders.push({
      id: example.id,
      style: example.style,
      ruleId: issue.ruleId,
      category: issue.category,
      original: issue.original,
      replacement: issue.replacement,
    });
  }
}

function finalise(map) {
  return Object.fromEntries(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, bucket]) => [key, {
        ...bucket,
        precision: ratio(bucket.truePositives, bucket.truePositives + bucket.falsePositives),
        recall: ratio(bucket.truePositives, bucket.truePositives + bucket.missedIssues),
        falsePositivesPer1000Words: perThousand(bucket.falsePositives, bucket.words),
      }]),
  );
}

const report = {
  corpus: "evaluation/blind-corpus.json",
  note: "Held out from rule tuning. Report findings; do not tune against these examples.",
  corpusSize: corpus.length,
  totalWords,
  truePositives,
  falsePositives,
  missedIssues,
  precision: ratio(truePositives, truePositives + falsePositives),
  recall: ratio(truePositives, truePositives + missedIssues),
  falsePositivesPer1000Words: perThousand(falsePositives, totalWords),
  // The headline product-quality number is error false positives per 1,000 words.
  // Style suggestions are tracked separately because they are opinions, not errors,
  // and a writer can reasonably disagree with every one of them.
  errorFalsePositives,
  styleFalsePositives,
  errorFalsePositivesPer1000Words: perThousand(errorFalsePositives, totalWords),
  styleSuggestionsPer1000Words: perThousand(styleFalsePositives, totalWords),
  cleanText: {
    examples: cleanExamples,
    totalWords: cleanWords,
    falsePositives: cleanFalsePositives,
    falsePositivesPer1000Words: perThousand(cleanFalsePositives, cleanWords),
    errorFalsePositives: cleanErrorFalsePositives,
    errorFalsePositivesPer1000Words: perThousand(cleanErrorFalsePositives, cleanWords),
    styleSuggestions: cleanStyleFalsePositives,
    styleSuggestionsPer1000Words: perThousand(cleanStyleFalsePositives, cleanWords),
  },
  byStyle: finalise(byStyle),
  byKind: finalise(byKind),
  byCategory: finalise(byCategory),
  byRule: finalise(byRule),
  offenders,
};

console.log(JSON.stringify(report, null, 2));

// --strict exists so a maintainer can adopt a budget deliberately, via
// DRAFTWISE_BLIND_FP_BUDGET. It is intentionally not wired into CI: binding a
// gate to the held-out set is precisely what turns it into a tuning target.
if (process.argv.includes("--strict")) {
  const budget = Number(process.env.DRAFTWISE_BLIND_FP_BUDGET ?? "3");
  const failing = [];
  if (report.errorFalsePositivesPer1000Words > budget) {
    failing.push("errorFalsePositivesPer1000Words " + report.errorFalsePositivesPer1000Words + " > " + budget);
  }
  if (report.cleanText.errorFalsePositivesPer1000Words > budget) {
    failing.push("cleanText.errorFalsePositivesPer1000Words " + report.cleanText.errorFalsePositivesPer1000Words + " > " + budget);
  }
  if (failing.length) {
    console.error("Blind evaluation over budget:\n- " + failing.join("\n- "));
    process.exit(1);
  }
}