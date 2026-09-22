import { readFile } from "node:fs/promises";
import { analyzeLocally } from "../packages/grammar/src/index.ts";

const corpus = JSON.parse(await readFile(new URL("../evaluation/corpus.json", import.meta.url), "utf8"));
const cleanProse = JSON.parse(await readFile(new URL("../evaluation/clean-prose.json", import.meta.url), "utf8"));
const examples = [];
let truePositives = 0;
let falsePositives = 0;
let missedIssues = 0;
let exactSpanMatches = 0;
let exactOriginalMatches = 0;
let fallbackMatches = 0;
const byCategory = new Map();
const byKind = new Map();
const byRule = new Map();

function wordCount(text) {
  return String(text || "").trim().split(/\s+/u).filter(Boolean).length;
}

function increment(map, key, field) {
  const current = map.get(key) ?? { expected: 0, truePositives: 0, falsePositives: 0, missedIssues: 0 };
  current[field] += 1;
  map.set(key, current);
}

function expectedMatchScore(expected, issue) {
  if (expected.ruleId && expected.ruleId !== issue.ruleId) return -1;
  if (expected.category && expected.category !== issue.category) return -1;
  if (typeof expected.original === "string" && expected.original !== issue.original) return -1;
  if (Number.isInteger(expected.start) && Number.isInteger(expected.end)) {
    if (expected.start !== issue.start || expected.end !== issue.end) return -1;
  }
  let score = 1;
  if (Number.isInteger(expected.start) && Number.isInteger(expected.end)) score += 4;
  if (typeof expected.original === "string") score += 2;
  return score;
}

for (const example of corpus) {
  const result = analyzeLocally(example.text, { dialect: "en-GB" });
  const used = new Set();
  const matched = [];
  const missed = [];
  for (const expected of example.expected) {
    increment(byCategory, expected.category, "expected");
    increment(byKind, example.kind, "expected");
    increment(byRule, expected.ruleId, "expected");
    let index = -1;
    let bestScore = -1;
    result.issues.forEach((issue, issueIndex) => {
      if (used.has(issueIndex)) return;
      const score = expectedMatchScore(expected, issue);
      if (score > bestScore) {
        bestScore = score;
        index = issueIndex;
      }
    });
    if (index >= 0) {
      used.add(index);
      truePositives += 1;
      const issue = result.issues[index];
      if (Number.isInteger(expected.start) && Number.isInteger(expected.end) && expected.start === issue.start && expected.end === issue.end) exactSpanMatches += 1;
      if (typeof expected.original === "string" && expected.original === issue.original) exactOriginalMatches += 1;
      if (!Number.isInteger(expected.start) && typeof expected.original !== "string") fallbackMatches += 1;
      increment(byCategory, expected.category, "truePositives");
      increment(byKind, example.kind, "truePositives");
      increment(byRule, expected.ruleId, "truePositives");
      matched.push({ ruleId: expected.ruleId, category: expected.category, confidence: issue.confidence, start: issue.start, end: issue.end, original: issue.original, match: bestScore >= 5 ? "exact-span" : bestScore >= 3 ? "exact-original" : "rule-category" });
    } else {
      missedIssues += 1;
      increment(byCategory, expected.category, "missedIssues");
      increment(byKind, example.kind, "missedIssues");
      increment(byRule, expected.ruleId, "missedIssues");
      missed.push(expected);
    }
  }
  const falseIssues = result.issues.filter((_issue, index) => !used.has(index));
  falsePositives += falseIssues.length;
  for (const issue of falseIssues) {
    increment(byCategory, issue.category, "falsePositives");
    increment(byKind, example.kind, "falsePositives");
    increment(byRule, issue.ruleId, "falsePositives");
  }
  examples.push({ id: example.id, kind: example.kind, truePositives: matched, falsePositives: falseIssues.map(({ ruleId, category, confidence, original }) => ({ ruleId, category, confidence, original })), missedIssues: missed });
}

const precision = truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : 1;
const recall = truePositives + missedIssues ? truePositives / (truePositives + missedIssues) : 1;
const totalWords = corpus.reduce((sum, example) => sum + wordCount(example.text), 0);
const falsePositivesPer1000Words = totalWords ? (falsePositives / totalWords) * 1_000 : 0;
const falsePositiveBudgetPer1000Words = 1;
const finalise = (map) => Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, {
  ...value,
  precision: value.truePositives + value.falsePositives ? Number((value.truePositives / (value.truePositives + value.falsePositives)).toFixed(3)) : 1,
  recall: value.truePositives + value.missedIssues ? Number((value.truePositives / (value.truePositives + value.missedIssues)).toFixed(3)) : 1,
}]));

const cleanProseByStyle = new Map();
let cleanProseFalsePositives = 0;
let cleanProseWords = 0;
for (const example of cleanProse) {
  const result = analyzeLocally(example.text, { dialect: "en-GB" });
  const count = result.issues.length;
  cleanProseFalsePositives += count;
  cleanProseWords += wordCount(example.text);
  const current = cleanProseByStyle.get(example.style) ?? { examples: 0, falsePositives: 0, words: 0 };
  current.examples += 1;
  current.falsePositives += count;
  current.words += wordCount(example.text);
  cleanProseByStyle.set(example.style, current);
}
const cleanFalsePositivesPer1000Words = cleanProseWords ? (cleanProseFalsePositives / cleanProseWords) * 1_000 : 0;

console.log(JSON.stringify({
  corpusSize: corpus.length,
  totalWords,
  truePositives,
  falsePositives,
  missedIssues,
  precision: Number(precision.toFixed(3)),
  recall: Number(recall.toFixed(3)),
  falsePositivesPer1000Words: Number(falsePositivesPer1000Words.toFixed(3)),
  falsePositiveBudgetPer1000Words,
  falsePositiveBudgetPasses: falsePositivesPer1000Words <= falsePositiveBudgetPer1000Words,
  exactSpanMatches,
  exactOriginalMatches,
  fallbackMatches,
  cleanProse: {
    corpusSize: cleanProse.length,
    totalWords: cleanProseWords,
    falsePositives: cleanProseFalsePositives,
    falsePositivesPer1000Words: Number(cleanFalsePositivesPer1000Words.toFixed(3)),
    falsePositiveBudgetPer1000Words,
    falsePositiveBudgetPasses: cleanFalsePositivesPer1000Words <= falsePositiveBudgetPer1000Words,
    byStyle: Object.fromEntries([...cleanProseByStyle.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([style, value]) => [style, { ...value, falsePositivesPer1000Words: value.words ? Number(((value.falsePositives / value.words) * 1_000).toFixed(3)) : 0 }]))
  },
  byCategory: finalise(byCategory),
  byKind: finalise(byKind),
  byRule: finalise(byRule),
  examples,
}, null, 2));

if (process.argv.includes("--strict") && (precision < 0.7 || recall < 0.7 || falsePositivesPer1000Words > falsePositiveBudgetPer1000Words || cleanFalsePositivesPer1000Words > falsePositiveBudgetPer1000Words || cleanProse.length < 150)) process.exit(1);
