import { readFile } from "node:fs/promises";
import { analyzeLocally } from "../packages/grammar/src/index.ts";

const corpus = JSON.parse(await readFile(new URL("../evaluation/corpus.json", import.meta.url), "utf8"));
const examples = [];
let truePositives = 0;
let falsePositives = 0;
let missedIssues = 0;

for (const example of corpus) {
  const result = analyzeLocally(example.text, { dialect: "en-GB" });
  const used = new Set();
  const matched = [];
  const missed = [];
  for (const expected of example.expected) {
    const index = result.issues.findIndex((issue, issueIndex) => !used.has(issueIndex) && issue.ruleId === expected.ruleId && issue.category === expected.category);
    if (index >= 0) {
      used.add(index);
      truePositives += 1;
      matched.push({ ruleId: expected.ruleId, category: expected.category, confidence: result.issues[index].confidence });
    } else {
      missedIssues += 1;
      missed.push(expected);
    }
  }
  const falseIssues = result.issues.filter((_issue, index) => !used.has(index));
  falsePositives += falseIssues.length;
  examples.push({ id: example.id, kind: example.kind, truePositives: matched, falsePositives: falseIssues.map(({ ruleId, category, confidence, original }) => ({ ruleId, category, confidence, original })), missedIssues: missed });
}

const precision = truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : 1;
const recall = truePositives + missedIssues ? truePositives / (truePositives + missedIssues) : 1;
console.log(JSON.stringify({ truePositives, falsePositives, missedIssues, precision: Number(precision.toFixed(3)), recall: Number(recall.toFixed(3)), examples }, null, 2));

if (process.argv.includes("--strict") && (precision < 0.7 || recall < 0.7)) process.exit(1);
