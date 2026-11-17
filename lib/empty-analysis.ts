import type { AnalysisResult, ScoreDimension, WritingGoals, WritingStats } from "../packages/types/src/index.js";

/**
 * A structurally valid, zero-work analysis result for the first client render.
 *
 * The previous code called analyzeLocally in the useState initializer of every
 * page, including the dashboard, before hydration had even produced a draft.
 * That ran the whole rule engine synchronously on first paint. The real result
 * is computed in useAnalysis's effect immediately after mount, so this is only
 * ever the placeholder for the render that precedes that effect.
 */
const DIMENSIONS: ScoreDimension[] = [
  "correctness", "clarity", "conciseness", "readability", "engagement", "consistency", "goalAlignment",
];

const emptyStats = (text: string): WritingStats => ({
  words: 0,
  characters: text.length,
  sentences: 0,
  paragraphs: 0,
  readingTime: 0,
  readability: 0,
  longSentences: 0,
  fillerWords: 0,
  passiveVoice: 0,
  passiveVoicePercentage: 0,
  averageSentenceLength: 0,
  longestSentence: "",
  sentenceLengths: [],
  paragraphLengths: [],
  vocabularyDiversity: 0,
  repeatedWords: [],
  repeatedPhrases: [],
  fillerWordFrequency: [],
  commonWords: [],
});

export function emptyAnalysisResult(text: string, goals?: WritingGoals): AnalysisResult {
  const breakdown = {} as AnalysisResult["scores"]["breakdown"];
  // scoreWriting returns goalAlignment 60 for an empty draft with goals set.
  // Match that exactly so a baseline captured from the placeholder does not
  // later report a bogus "+60 goal alignment improved" when the first words
  // are typed.
  const goalAlignment = goals ? 60 : 0;
  const scores = { grammar: 0, overall: 0, goalAlignment, breakdown } as AnalysisResult["scores"];
  for (const dimension of DIMENSIONS) {
    const value = dimension === "goalAlignment" ? goalAlignment : 0;
    scores[dimension] = value;
    breakdown[dimension] = {
      score: value,
      summary: "Analysis is still starting.",
      signals: value > 0 ? ["general audience", "inform intent", "neutral tone", "Average sentence: 0 words"] : [],
    };
  }
  return { issues: [], tone: [], scores, stats: emptyStats(text), analysedText: text, source: "local" };
}
