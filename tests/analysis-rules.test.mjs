import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLocally, getWritingStats, mergeWritingIssues, scoreWriting, suggestSpelling } from "../packages/grammar/src/index.ts";

test("local analysis catches typos, punctuation, and repetition", () => {
  const result = analyzeLocally("This is repeatd  wording wording, recieve it!!");
  assert.ok(result.issues.some((issue) => issue.category === "spelling" && issue.replacement === "repeated"));
  assert.ok(result.issues.some((issue) => issue.category === "punctuation"));
  assert.ok(result.issues.some((issue) => issue.category === "repetition"));
});

test("unicode text keeps issue offsets anchored to the original string", () => {
  const text = "✨ Draftwise catches repeatd words.";
  const result = analyzeLocally(text);
  const issue = result.issues.find((item) => item.replacement === "repeated");
  assert.ok(issue);
  assert.equal(text.slice(issue.start, issue.end), issue.original);
});

test("stats include long sentences, filler words, and readable defaults", () => {
  const stats = getWritingStats("This is really a sentence with many words that keeps going so it can exercise the long sentence counter and still end clearly while carrying enough detail for the readability check to notice the length.");
  assert.equal(stats.words > 15, true);
  assert.equal(stats.fillerWords, 1);
  assert.equal(stats.longSentences, 1);
  assert.equal(stats.readingTime, 1);
});

test("overlapping issues are merged without losing the first valid span", () => {
  const first = { id: "one", start: 0, end: 4, original: "word", replacement: "term", category: "word choice", severity: "low", title: "Word choice", explanation: "Use a shorter word.", source: "local" };
  const overlap = { ...first, id: "two", start: 2, end: 7, original: "rd ex", replacement: "", title: "Other" };
  const merged = mergeWritingIssues([first, overlap]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "one");
});

test("local spellchecking ranks arbitrary candidates and respects names, acronyms, contractions, and technical terms", () => {
  const style = { dialect: "en-GB", personalDictionary: ["Draftwise"], names: ["Ariadne"], ignoredWords: [], ignoredRuleIds: [], preferredTerminology: {}, oxfordComma: true, allowContractions: true, passiveVoiceSensitivity: "normal", preferredSentenceLength: "balanced", blockedWords: [] };
  assert.equal(suggestSpelling("receeve", style), "receive");
  const result = analyzeLocally("Ariadne uses TypeScript in a well-known API. Draftwise works; NASA agrees. It can't fail.", style);
  assert.equal(result.issues.some((issue) => issue.ruleId === "spelling-lexicon"), false);
});

test("readability keeps a legitimate zero score instead of falling back", () => {
  const stats = { words: 10, characters: 40, sentences: 1, paragraphs: 1, readingTime: 1, readability: 0, longSentences: 0, fillerWords: 0, passiveVoice: 0, passiveVoicePercentage: 0, averageSentenceLength: 10, longestSentence: "", sentenceLengths: [10], paragraphLengths: [10], vocabularyDiversity: 0.8, repeatedWords: [], repeatedPhrases: [], fillerWordFrequency: [], commonWords: [] };
  assert.equal(scoreWriting(stats, [], { audience: "general", intent: "inform", tone: "neutral" }, "Short text.").readability, 0);
});
