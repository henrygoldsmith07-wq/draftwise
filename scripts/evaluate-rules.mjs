import { readFile } from "node:fs/promises";
import { analyzeLocally } from "../packages/grammar/src/index.ts";

const corpus = JSON.parse(await readFile(new URL("../evaluation/corpus.json", import.meta.url), "utf8"));
const examples = [];
let truePositives = 0;
let falsePositives = 0;
let missedIssues = 0;
const byCategory = new Map();
const byKind = new Map();

function increment(map, key, field) {
  const current = map.get(key) ?? { expected: 0, truePositives: 0, falsePositives: 0, missedIssues: 0 };
  current[field] += 1;
  map.set(key, current);
}

for (const example of corpus) {
  const result = analyzeLocally(example.text, { dialect: "en-GB" });
  const used = new Set();
  const matched = [];
  const missed = [];
  for (const expected of example.expected) {
    increment(byCategory, expected.category, "expected");
    increment(byKind, example.kind, "expected");
    const index = result.issues.findIndex((issue, issueIndex) => !used.has(issueIndex) && issue.ruleId === expected.ruleId && issue.category === expected.category);
    if (index >= 0) {
      used.add(index);
      truePositives += 1;
      increment(byCategory, expected.category, "truePositives");
      increment(byKind, example.kind, "truePositives");
      matched.push({ ruleId: expected.ruleId, category: expected.category, confidence: result.issues[index].confidence });
    } else {
      missedIssues += 1;
      increment(byCategory, expected.category, "missedIssues");
      increment(byKind, example.kind, "missedIssues");
      missed.push(expected);
    }
  }
  const falseIssues = result.issues.filter((_issue, index) => !used.has(index));
  falsePositives += falseIssues.length;
  for (const issue of falseIssues) {
    increment(byCategory, issue.category, "falsePositives");
    increment(byKind, example.kind, "falsePositives");
  }
  examples.push({ id: example.id, kind: example.kind, truePositives: matched, falsePositives: falseIssues.map(({ ruleId, category, confidence, original }) => ({ ruleId, category, confidence, original })), missedIssues: missed });
}

const precision = truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : 1;
const recall = truePositives + missedIssues ? truePositives / (truePositives + missedIssues) : 1;
const finalise = (map) => Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, {
  ...value,
  precision: value.truePositives + value.falsePositives ? Number((value.truePositives / (value.truePositives + value.falsePositives)).toFixed(3)) : 1,
  recall: value.truePositives + value.missedIssues ? Number((value.truePositives / (value.truePositives + value.missedIssues)).toFixed(3)) : 1,
}]));

console.log(JSON.stringify({ corpusSize: corpus.length, truePositives, falsePositives, missedIssues, precision: Number(precision.toFixed(3)), recall: Number(recall.toFixed(3)), byCategory: finalise(byCategory), byKind: finalise(byKind), examples }, null, 2));

if (process.argv.includes("--strict") && (precision < 0.7 || recall < 0.7)) process.exit(1);
