import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDocument, analyzeLocally, analyzeLocallyIncremental, getWritingStats, mergeWritingIssues, scoreWriting, suggestSpelling } from "../packages/grammar/src/index.ts";

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

test("spelling handles transpositions, omitted letters, inflections, hyphens, possessives, and Unicode", () => {
  assert.equal(suggestSpelling("teh"), "the");
  assert.equal(suggestSpelling("writng"), "writing");
  assert.equal(suggestSpelling("recieve"), "receive");
  assert.equal(suggestSpelling("enviroment"), "environment");
  const result = analyzeLocally("The writer's well-known café has a naïve example.");
  assert.equal(result.issues.some((issue) => issue.category === "spelling"), false);
});

test("article exceptions and noun agreement cover common high-confidence cases", () => {
  const correct = analyzeLocally("An hour passed. An honest answer helps. An honour matters. A university has a user guide for a European one-time test.");
  assert.equal(correct.issues.some((issue) => issue.ruleId === "grammar-article-agreement"), false);
  const incorrect = analyzeLocally("A hour is useful. An university is useful. The results is clear. The result are clear.");
  assert.equal(incorrect.issues.filter((issue) => issue.ruleId === "grammar-article-agreement").length, 2);
  assert.equal(incorrect.issues.filter((issue) => issue.ruleId === "grammar-subject-verb-agreement").length, 2);
});

test("British dialect rules distinguish contextual licence, practise, and programme", () => {
  const british = analyzeLocally(
    "The authority will license the company. I practice every day. I need a driving license. The training program helps. The software program runs.",
    { dialect: "en-GB" },
  );
  const dialectIssues = british.issues.filter((issue) => issue.ruleId === "dialect-spelling");
  assert.ok(dialectIssues.some((issue) => issue.original === "practice" && issue.replacement === "practise"));
  assert.ok(dialectIssues.some((issue) => issue.original === "license" && issue.replacement === "licence"));
  assert.ok(dialectIssues.some((issue) => issue.original === "program" && issue.replacement === "programme"));
  assert.equal(dialectIssues.some((issue) => issue.original === "will" || issue.original === "software"), false);
  assert.equal(dialectIssues.filter((issue) => issue.original === "license").length, 1);
  assert.equal(dialectIssues.filter((issue) => issue.original === "program").length, 1);
});

test("dialect rules leave ambiguous contextual forms alone and handle US counterparts", () => {
  const ambiguous = analyzeLocally("They discuss license, practice, and program.", { dialect: "en-GB" });
  assert.equal(ambiguous.issues.some((issue) => issue.ruleId === "dialect-spelling"), false);
  const us = analyzeLocally("I will use a licence. I practise every day. The television programme starts.", { dialect: "en-US" });
  const dialectIssues = us.issues.filter((issue) => issue.ruleId === "dialect-spelling");
  assert.ok(dialectIssues.some((issue) => issue.original === "licence" && issue.replacement === "license"));
  assert.ok(dialectIssues.some((issue) => issue.original === "practise" && issue.replacement === "practice"));
  assert.ok(dialectIssues.some((issue) => issue.original === "programme" && issue.replacement === "program"));
});

test("analyzeDocument shares sentence and paragraph measurements with stats", () => {
  const document = analyzeDocument("A clear sentence. Another useful result.\n\nA final paragraph.");
  const stats = getWritingStats(document.text, document);
  assert.deepEqual(document.sentenceLengths, [3, 3, 3]);
  assert.deepEqual(document.paragraphLengths, [6, 3]);
  assert.deepEqual(stats.sentenceLengths, document.sentenceLengths);
  assert.deepEqual(stats.paragraphLengths, document.paragraphLengths);
});

test("debug analysis diagnostics expose timing without changing normal issue metadata", () => {
  const previous = globalThis.DraftwiseDebug;
  globalThis.DraftwiseDebug = true;
  try {
    const result = analyzeLocally("This is repeatd.");
    assert.equal(result.diagnostics?.engine, "local");
    assert.equal(result.diagnostics?.issueCount, result.issues.length);
    assert.ok((result.diagnostics?.processingMs ?? -1) >= 0);
    assert.equal(result.issues[0]?.source, "local");
    assert.ok(result.issues[0]?.ruleId);
    assert.ok(result.issues[0]?.explanation);
  } finally {
    if (previous === undefined) delete globalThis.DraftwiseDebug;
    else globalThis.DraftwiseDebug = previous;
  }
});

test("readability keeps a legitimate zero score instead of falling back", () => {
  const stats = { words: 10, characters: 40, sentences: 1, paragraphs: 1, readingTime: 1, readability: 0, longSentences: 0, fillerWords: 0, passiveVoice: 0, passiveVoicePercentage: 0, averageSentenceLength: 10, longestSentence: "", sentenceLengths: [10], paragraphLengths: [10], vocabularyDiversity: 0.8, repeatedWords: [], repeatedPhrases: [], fillerWordFrequency: [], commonWords: [] };
  assert.equal(scoreWriting(stats, [], { audience: "general", intent: "inform", tone: "neutral" }, "Short text.").readability, 0);
});


test("issue IDs change when different text produces the same rule at the same span", () => {
  const first = analyzeLocally("repeatd").issues.find((issue) => issue.ruleId === "spelling-common-typo");
  const second = analyzeLocally("recieve").issues.find((issue) => issue.ruleId === "spelling-common-typo");
  const repeated = analyzeLocally("repeatd").issues.find((issue) => issue.ruleId === "spelling-common-typo");
  assert.ok(first);
  assert.ok(second);
  assert.ok(repeated);
  assert.equal(first.start, second.start);
  assert.equal(first.end, second.end);
  assert.notEqual(first.original, second.original);
  assert.notEqual(first.id, second.id);
  assert.equal(first.id, repeated.id);
});

test("passive voice percentage measures affected sentences and never exceeds 100", () => {
  const repeatedPassive = getWritingStats("The draft was written and was edited.");
  assert.equal(repeatedPassive.passiveVoice, 2);
  assert.equal(repeatedPassive.passiveVoicePercentage, 100);

  const mixed = getWritingStats("The draft was written. We review it.");
  assert.equal(mixed.passiveVoice, 1);
  assert.equal(mixed.sentences, 2);
  assert.equal(mixed.passiveVoicePercentage, 50);
});

test("incremental analysis rekeys shifted retained issues to match full analysis", () => {
  const previousText = `${"context ".repeat(120)}repeatd`;
  const previous = analyzeLocally(previousText);
  const nextText = `Intro. ${previousText}`;
  const incremental = analyzeLocallyIncremental(
    previousText,
    nextText,
    previous.issues,
    { start: 0, end: 7, previousEnd: 0 },
  );
  const full = analyzeLocally(nextText);
  const incrementalIssue = incremental.issues.find((issue) => issue.original === "repeatd");
  const fullIssue = full.issues.find((issue) => issue.original === "repeatd");
  assert.ok(incrementalIssue);
  assert.ok(fullIssue);
  assert.equal(incrementalIssue.start, fullIssue.start);
  assert.equal(incrementalIssue.end, fullIssue.end);
  assert.equal(incrementalIssue.id, fullIssue.id);
});
