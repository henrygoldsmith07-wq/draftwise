import { readFile } from "node:fs/promises";
import { analyzeLocally, prioritiseSuggestions } from "../packages/grammar/src/index.ts";

/**
 * Blind-corpus display measurement (read-only).
 *
 * The blind corpus is the held-out independent measurement. This script reports
 * what a writer would SEE on it after contextual filtering, alongside raw
 * detector output. Nothing here tunes rules against these examples; the numbers
 * are reported as findings, never as targets.
 */

const corpus = JSON.parse(await readFile(new URL("../evaluation/blind-corpus.json", import.meta.url), "utf8"));
const wordCount = (text) => String(text || "").trim().split(/\s+/u).filter(Boolean).length;

let raw = 0;
let displayed = 0;
let words = 0;
const byStyle = new Map();
const suppressionReasons = new Map();

for (const example of corpus) {
  const wordsThis = wordCount(example.text);
  words += wordsThis;
  const goals = { audience: example.style === "casual" ? "casual" : example.style === "technical" ? "technical" : example.style === "academic" ? "academic" : "general", intent: "inform", tone: example.style === "casual" ? "casual" : "professional" };
  const analysis = analyzeLocally(example.text, { dialect: "en-GB" }, goals);
  const result = prioritiseSuggestions(analysis.issues, { goals, preferences: { dialect: "en-GB" }, text: example.text });
  raw += analysis.issues.length;
  displayed += result.displayed.length;
  for (const entry of result.suppressed) suppressionReasons.set(entry.reason, (suppressionReasons.get(entry.reason) ?? 0) + 1);
  const bucket = byStyle.get(example.style) ?? { raw: 0, displayed: 0, words: 0 };
  bucket.raw += analysis.issues.length;
  bucket.displayed += result.displayed.length;
  bucket.words += wordsThis;
  byStyle.set(example.style, bucket);
}

const perThousand = (count) => (words ? Number(((count / words) * 1000).toFixed(3)) : 0);
console.log(JSON.stringify({
  corpusSize: corpus.length,
  totalWords: words,
  rawSuggestions: raw,
  displayedSuggestions: displayed,
  rawPer1000Words: perThousand(raw),
  displayedPer1000Words: perThousand(displayed),
  suppressionRate: raw ? Number((((raw - displayed) / raw)).toFixed(3)) : 0,
  suppressionReasons: Object.fromEntries([...suppressionReasons.entries()].sort(([a], [b]) => a.localeCompare(b))),
  byStyle: Object.fromEntries([...byStyle.entries()].map(([style, value]) => [style, {
    rawPer1000Words: value.words ? Number(((value.raw / value.words) * 1000).toFixed(3)) : 0,
    displayedPer1000Words: value.words ? Number(((value.displayed / value.words) * 1000).toFixed(3)) : 0,
  }])),
}, null, 2));
