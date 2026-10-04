import type {
  FrequencyItem,
  WritingStats,
} from "../../types/src/index.js";
import {
  COMMON_WORDS,
  FILLER_WORDS,
} from "./lexicon.ts";
import {
  type SentenceSpan,
  parseDocument,
} from "./parser.ts";
import {
  clamp,
} from "./util.ts";

function countSyllables(word: string) {
  const normalized = word.toLocaleLowerCase().replace(/(?:e|es|ed)$/u, "");
  return Math.max(1, (normalized.match(/[aeiouy]{1,2}/gu) ?? []).length);
}

function frequency(values: string[], limit = 8): FrequencyItem[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return rankByCount(counts, limit);
}

function rankByCount(counts: Map<string, number>, limit = 8): FrequencyItem[] {
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

/**
 * Hard ceiling on how many distinct bigrams are tracked.
 *
 * Every entry is a string plus a Map slot, so on a very long draft this is the
 * single largest allocation in the analysis. Past the ceiling, only bigrams
 * already being tracked keep counting; new ones are dropped. This bounds the
 * cost without changing results for documents of any realistic length, and a
 * phrase first seen after the ceiling simply is not counted a second time.
 */
const MAX_TRACKED_BIGRAMS = 20_000;

/**
 * Word pairs that repeat, restricted to pairs carrying at least one content
 * word.
 *
 * Counting every adjacent pair built a map of tens of thousands of entries on
 * a long draft — "of the", "in a", "it is" — and none of those is a repeated
 * phrase in any sense a writer would recognise. Requiring a content word keeps
 * the same useful results for a fraction of the memory, and makes the reported
 * phrases better advice.
 */
function repeatedPhraseCounts(sentences: SentenceSpan[]) {
  const counts = new Map<string, number>();
  for (const sentence of sentences) {
    const tokens = sentence.tokens;
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      const first = tokens[index].lower;
      const second = tokens[index + 1].lower;
      if (COMMON_WORDS.has(first) && COMMON_WORDS.has(second)) continue;
      const key = `${first} ${second}`;
      if (!counts.has(key) && counts.size >= MAX_TRACKED_BIGRAMS) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export function getWritingStats(text: string, document = parseDocument(text)): WritingStats {
  const tokens = document.tokens;
  const sentences = document.sentences;
  const paragraphs = document.paragraphs.length;
  const sentenceLengths = document.sentenceLengths;
  const paragraphLengths = document.paragraphLengths;
  const words = tokens.length;
  const syllables = tokens.reduce((total, token) => total + countSyllables(token.value), 0);
  const readability = words && sentences.length
    ? clamp(206.835 - 1.015 * (words / sentences.length) - 84.6 * (syllables / words))
    : 0;
  const sentenceWordValues = sentences.flatMap((sentence) => sentence.tokens.map((token) => token.lower));
  const repeatedWords = frequency(sentenceWordValues.filter((word) => !COMMON_WORDS.has(word)));
  const repeatedPhrases = rankByCount(repeatedPhraseCounts(sentences));
  const fillerWordFrequency = frequency(sentenceWordValues.filter((word) => FILLER_WORDS.has(word)));
  const commonWords = frequency(sentenceWordValues.filter((word) => COMMON_WORDS.has(word))).slice(0, 8);
  const longest = sentences.reduce((current, sentence) => sentence.tokens.length > current.tokens.length ? sentence : current, { text: "", start: 0, end: 0, tokens: [] } as SentenceSpan);
  const passiveVoicePattern = /\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?[\p{L}]+(?:ed|en)\b/iu;
  const passiveVoice = [...text.matchAll(/\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?[\p{L}]+(?:ed|en)\b/giu)].length;
  const passiveVoiceSentences = sentences.filter((sentence) => passiveVoicePattern.test(sentence.text)).length;
  return {
    words,
    characters: text.length,
    sentences: sentences.length,
    paragraphs,
    readingTime: words ? Math.max(1, Math.ceil(words / 200)) : 0,
    readability,
    longSentences: sentenceLengths.filter((length) => length > 32).length,
    fillerWords: sentenceWordValues.filter((word) => FILLER_WORDS.has(word)).length,
    passiveVoice,
    passiveVoicePercentage: sentences.length ? Math.round((passiveVoiceSentences / sentences.length) * 100) : 0,
    averageSentenceLength: sentenceLengths.length ? Math.round((words / sentenceLengths.length) * 10) / 10 : 0,
    longestSentence: longest.text,
    sentenceLengths,
    paragraphLengths,
    vocabularyDiversity: words ? Math.round((new Set(sentenceWordValues).size / words) * 100) / 100 : 0,
    repeatedWords,
    repeatedPhrases,
    fillerWordFrequency,
    commonWords,
  };
}

export function inferTone(text: string, document = parseDocument(text)): string[] {
  const words = document.tokens.map((token) => token.lower);
  const confident = words.filter((word) => ["clear", "strong", "will", "can", "decisive", "proven"].includes(word)).length;
  const cautious = words.filter((word) => ["might", "maybe", "perhaps", "could", "possibly", "uncertain"].includes(word)).length;
  const direct = words.filter((word) => ["we", "you", "your", "our"].includes(word)).length;
  const tone: string[] = [];
  if (confident > cautious) tone.push("confident");
  if (cautious > 0) tone.push("thoughtful");
  if (direct > 0) tone.push("direct");
  if (text.includes("!")) tone.push("energetic");
  return [...new Set(tone)].slice(0, 3).length ? [...new Set(tone)].slice(0, 3) : ["neutral"];
}
