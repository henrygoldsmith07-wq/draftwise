import type {
  AnalysisScores,
  IssueCategory,
  ScoreDimension,
  WritingGoals,
  WritingIssue,
  WritingStats,
} from "../../types/src/index.js";
import {
  type ParsedDocument,
  parseDocument,
} from "./parser.ts";
import {
  clamp,
} from "./util.ts";

function scoreContribution(score: number, summary: string, signals: string[]): { score: number; summary: string; signals: string[] } {
  return { score, summary, signals: signals.slice(0, 4) };
}

/**
 * Severity-and-confidence weight of the findings in a set of categories.
 *
 * Separated from the penalty itself so the penalty can decide how much weight
 * a finding carries at a given document length.
 */
function weightedIssueSum(issues: WritingIssue[], categories: IssueCategory[]) {
  const categorySet = new Set(categories);
  return issues.reduce((total, issue) => {
    if (!categorySet.has(issue.category)) return total;
    const severity = issue.severity === "high" ? 1.8 : issue.severity === "medium" ? 1.1 : 0.45;
    const confidence = Number.isFinite(issue.confidence) ? Math.max(0, Math.min(1, issue.confidence)) : 0.5;
    return total + severity * confidence;
  }, 0);
}

/**
 * How far a category's findings push its score down.
 *
 * The penalty is driven by the *rate* of findings, not their number. An earlier
 * version summed an absolute penalty per finding, which meant a long draft paid
 * for every word it contained: at a constant error rate, correctness fell from
 * 93 on a 170-word draft to 0 on a 3,400-word one and stayed pinned at 0 after
 * that, however much worse the writing became. Length-normalising makes a
 * score mean the same thing at 200 words and at 20,000.
 *
 * Rate alone is not enough, because a long document can hide a lot of work: 80
 * typos spread across 13,000 words is a modest *rate* and a great deal of
 * *work*. So the absolute count is compared as well and the harsher of the two
 * wins. A short draft with a handful of slips therefore still reads as nearly
 * clean, and a long one carrying hundreds of them does not read as fine.
 *
 * `halfPoint` is the rate, in weighted findings per 1,000 words, at which this
 * category has given up half of its `maxPenalty`.
 */
function issuePenalty(
  issues: WritingIssue[],
  categories: IssueCategory[],
  maxPenalty: number,
  words: number,
  halfPoint: number,
  absoluteHalfPoint = 250,
) {
  const weighted = weightedIssueSum(issues, categories);
  if (weighted <= 0 || words <= 0) return 0;
  const perThousand = weighted / (words / 1000);
  const byRate = perThousand / (perThousand + halfPoint);
  const byVolume = weighted / (weighted + absoluteHalfPoint);
  return maxPenalty * Math.max(byRate, byVolume);
}

/** The rate behind a score, so a dimension can explain itself in words. */
function findingsPerThousand(issues: WritingIssue[], categories: IssueCategory[], words: number) {
  if (words <= 0) return 0;
  return weightedIssueSum(issues, categories) / (words / 1000);
}

function goalAlignmentEstimate(text: string, stats: WritingStats, goals?: WritingGoals, document = parseDocument(text)) {
  if (!goals || !stats.words) return goals ? 60 : 0;
  const words = document.tokens.map((token) => token.lower);
  // Markers are matched on word boundaries and scored as a *rate*.
  //
  // Two things were wrong before. Matching was plain substring, so the inform
  // intent was satisfied by "is" sitting inside "this", "his" or "decision" —
  // the dimension scored full marks on almost any English sentence. And scoring
  // counted whether a marker appeared *anywhere*, so once a draft ran past a
  // few hundred words every marker had appeared somewhere and the estimate
  // stopped telling one long draft from another. A rate per 1,000 words holds
  // its meaning at any length.
  const markerRate = (markers: string[]) => {
    let hits = 0;
    for (const marker of markers) {
      const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/gu, "\\s+");
      hits += (text.match(new RegExp(`\\b${escaped}\\b`, "giu")) ?? []).length;
    }
    return hits / (stats.words / 1000);
  };
  const audienceMarkers: Record<WritingGoals["audience"], string[]> = {
    academic: ["research", "evidence", "study", "analysis", "method", "findings", "citation"],
    professional: ["project", "client", "team", "recommend", "next step", "deliver", "decision"],
    technical: ["system", "data", "api", "function", "configuration", "implementation", "test", "code"],
    casual: ["you", "we", "feel", "really", "thanks", "can't", "won't"],
    general: ["because", "example", "help", "important", "should", "can"],
  };
  const intentMarkers: Record<WritingGoals["intent"], string[]> = {
    inform: ["is", "are", "fact", "according", "includes"],
    explain: ["because", "means", "example", "how", "why", "therefore"],
    persuade: ["should", "recommend", "benefit", "need", "best", "must"],
    describe: ["looks", "contains", "shows", "appears", "located", "includes"],
    story: ["then", "suddenly", "before", "after", "felt", "said", "walked"],
  };
  const toneMarkers: Record<WritingGoals["tone"], string[]> = {
    neutral: ["may", "can", "typically", "usually"],
    confident: ["will", "can", "proven", "clear", "recommend"],
    friendly: ["you", "we", "help", "thanks", "please"],
    professional: ["recommend", "project", "review", "next step", "available"],
    formal: ["therefore", "however", "shall", "regarding", "accordingly"],
    casual: ["really", "just", "we", "you", "can't", "won't"],
  };
  const evidenceMarkers = ["evidence", "data", "source", "citation", "finding", "result", "research"];
  const explanationMarkers = ["because", "means", "example", "how", "why", "therefore", "explain"];
  const persuasionMarkers = ["should", "recommend", "benefit", "need", "best", "must", "support"];
  const narrativeMarkers = ["then", "suddenly", "before", "after", "felt", "said", "walked", "story"];
  const terminology = new Set(["api", "system", "data", "method", "model", "function", "configuration", "implementation", "test", "code", "evidence", "citation"]);
  const audience = Math.min(24, markerRate(audienceMarkers[goals.audience]) * 1.2);
  const intentMarkersForGoal = goals.intent === "inform" ? intentMarkers.inform.concat(evidenceMarkers) : goals.intent === "explain" ? intentMarkers.explain.concat(explanationMarkers) : goals.intent === "persuade" ? intentMarkers.persuade.concat(persuasionMarkers) : goals.intent === "story" ? intentMarkers.story.concat(narrativeMarkers) : intentMarkers.describe;
  const intent = Math.min(24, markerRate(intentMarkersForGoal) * 1);
  const tone = Math.min(24, markerRate(toneMarkers[goals.tone]) * 1.2);
  const sentenceMidpoint: Record<WritingGoals["audience"], number> = { academic: 24, professional: 18, technical: 20, casual: 13, general: 17 };
  const sentenceFit = Math.max(0, 10 - Math.abs(stats.averageSentenceLength - sentenceMidpoint[goals.audience]) * 0.55);
  const terminologyDensity = words.filter((word) => terminology.has(word)).length / Math.max(1, words.length);
  const terminologyFit = goals.audience === "technical" ? Math.min(7, terminologyDensity * 100) : goals.audience === "academic" ? Math.min(5, terminologyDensity * 65) : Math.max(0, 3 - terminologyDensity * 12);
  const directWords = words.filter((word) => ["you", "your", "we", "our", "us"].includes(word)).length;
  const directness = directWords / Math.max(1, words.length);
  const directAddressFit = ["casual", "general"].includes(goals.audience) || ["friendly", "casual"].includes(goals.tone) ? Math.min(6, directness * 100) : Math.max(0, 3 - directness * 8);
  const contractionCount = words.filter((word) => word.includes("'") || word.includes("’")).length;
  const contractionFit = ["casual", "friendly"].includes(goals.tone) ? Math.min(4, contractionCount * 0.8) : ["formal", "professional"].includes(goals.tone) ? Math.max(-5, -contractionCount * 0.8) : 0;
  const formalityPenalty = goals.tone === "formal" && stats.fillerWords ? Math.min(12, stats.fillerWords * 2) : 0;
  return clamp(42 + audience + intent + tone + sentenceFit + terminologyFit + directAddressFit + contractionFit - formalityPenalty);
}

function engagementEstimate(text: string, stats: WritingStats, document = parseDocument(text)) {
  if (!stats.words) return 0;
  const words = document.tokens.map((token) => token.lower);
  const directWords = words.filter((word) => ["you", "your", "we", "our", "us"].includes(word)).length;
  const directness = Math.min(15, (directWords / Math.max(1, stats.words)) * 100);
  const sentenceVariety = Math.min(10, new Set(stats.sentenceLengths).size * 1.5);
  const questions = (text.match(/[?]/gu) ?? []).length;
  const activeSignal = Math.max(0, 8 - stats.passiveVoicePercentage * 0.08);
  const repetitionPenalty = Math.min(12, stats.repeatedWords.length * 1.5);
  return clamp(54 + directness + Math.min(15, stats.vocabularyDiversity * 24) + sentenceVariety + Math.min(8, questions * 2) + activeSignal - repetitionPenalty);
}

export function scoreWriting(stats: WritingStats, issues: WritingIssue[], goals?: WritingGoals, text = "", document?: ParsedDocument): AnalysisScores {
  const high = issues.filter((item) => item.severity === "high").length;
  const hasText = stats.words > 0;
  const objectiveCategories: IssueCategory[] = ["spelling", "grammar", "punctuation", "capitalization"];
  const objectiveRate = findingsPerThousand(issues, objectiveCategories, stats.words);
  const correctness = hasText ? clamp(100 - issuePenalty(issues, objectiveCategories, 58, stats.words, 21)) : 0;
  const clarity = hasText ? clamp(96 - issuePenalty(issues, ["clarity", "sentence structure", "passive voice"], 34, stats.words, 26) - Math.max(0, stats.averageSentenceLength - 24) * 1.3 - stats.passiveVoicePercentage * 0.12) : 0;
  const conciseness = hasText ? clamp(98 - issuePenalty(issues, ["conciseness", "repetition", "word choice"], 30, stats.words, 30) - (stats.fillerWords / Math.max(1, stats.words)) * 180) : 0;
  const readabilityBase = Number.isFinite(stats.readability) ? stats.readability : (hasText ? 65 : 0);
  const readability = hasText ? clamp(readabilityBase) : 0;
  const analysedDocument = document ?? parseDocument(text);
  const engagement = engagementEstimate(text, stats, analysedDocument);
  const consistencyCategories: IssueCategory[] = ["consistency", "spelling", "capitalization"];
  const consistency = hasText ? clamp(100 - issuePenalty(issues, consistencyCategories, 40, stats.words, 24) - Math.min(20, stats.repeatedWords.length * 1.4)) : 0;
  const goalAlignment = goalAlignmentEstimate(text, stats, goals, analysedDocument);
  const directWords = analysedDocument.tokens.filter((token) => ["you", "your", "we", "our", "us"].includes(token.lower)).length;
  const breakdown: Record<ScoreDimension, { score: number; summary: string; signals: string[] }> = {
    correctness: scoreContribution(correctness, "Based on the rate of grammar, spelling, punctuation, and capitalization findings per 1,000 words, so a long draft is not penalised for being long.", [`${objectiveRate.toFixed(1)} objective findings per 1,000 words`, `${high} high-severity issue${high === 1 ? "" : "s"}`]),
    clarity: scoreContribution(clarity, "Reflects sentence structure, vague wording, passive voice, and sentence length.", [`${stats.longSentences} long sentence${stats.longSentences === 1 ? "" : "s"}`, `${stats.passiveVoicePercentage}% passive-voice estimate`]),
    conciseness: scoreContribution(conciseness, "Reflects filler words, wordiness, redundant phrases, and repetition; document length alone is not penalised.", [`${stats.fillerWords} filler-word finding${stats.fillerWords === 1 ? "" : "s"}`, `${stats.repeatedPhrases.length} repeated phrase pattern${stats.repeatedPhrases.length === 1 ? "" : "s"}`]),
    readability: scoreContribution(readability, "A transparent Flesch-style estimate, not an objective measure of quality.", [`Average sentence length: ${stats.averageSentenceLength || 0} words`, `Vocabulary diversity: ${Math.round(stats.vocabularyDiversity * 100)}%`]),
    engagement: scoreContribution(engagement, "An estimate from whole-document directness, sentence variety, vocabulary variety, questions, and active-voice signals.", [`${Math.round((directWords / Math.max(1, stats.words)) * 100)}% direct-address words`, `${new Set(stats.sentenceLengths).size} sentence-length patterns`]),
    consistency: scoreContribution(consistency, "Reflects dialect, preferred terminology, capitalization, spelling variants, and repeated vocabulary patterns.", [`${stats.repeatedWords.length} repeated vocabulary pattern${stats.repeatedWords.length === 1 ? "" : "s"}`, `${issues.filter((item) => item.category === "consistency").length} terminology finding${issues.filter((item) => item.category === "consistency").length === 1 ? "" : "s"}`]),
    goalAlignment: scoreContribution(goalAlignment, "A best-effort estimate using audience, intent, tone, sentence length, terminology, direct address, and evidence signals; it is not an objective judgement.", [goals ? `${goals.audience} audience` : "No goal selected", goals ? `${goals.intent} intent` : "No intent selected", goals ? `${goals.tone} tone` : "Neutral baseline", `Average sentence: ${stats.averageSentenceLength || 0} words`]),
  };
  const overall = hasText ? clamp(correctness * 0.29 + clarity * 0.17 + conciseness * 0.14 + readability * 0.12 + engagement * 0.1 + consistency * 0.1 + goalAlignment * 0.08) : 0;
  return { correctness, clarity, conciseness, readability, engagement, consistency, goalAlignment, overall, grammar: correctness, breakdown };
}

export const categoryColors: Record<IssueCategory, string> = {
  spelling: "#e25d70",
  grammar: "#ef9f55",
  punctuation: "#8b78e6",
  clarity: "#4a9a9d",
  conciseness: "#d8944a",
  "word choice": "#3e87c7",
  repetition: "#d46191",
  tone: "#7b6fd2",
  formality: "#4e879c",
  readability: "#4e879c",
  fluency: "#4e879c",
  "passive voice": "#b5794e",
  "sentence structure": "#7a9d5e",
  consistency: "#6a8f68",
  capitalization: "#bf7a42",
};
