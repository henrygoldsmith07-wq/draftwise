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
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
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
  const repeatedPhrases = frequency(sentences.flatMap((sentence) => sentence.tokens.slice(0, -1).map((token, index) => `${token.lower} ${sentence.tokens[index + 1].lower}`)));
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
