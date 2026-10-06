import type {
  StylePreferences,
  WritingIssue,
} from "../../types/src/index.js";
import {
  ARTICLE_AN_EXCEPTIONS,
  ARTICLE_A_SOUND_PREFIXES,
  VERB_HINTS,
} from "./lexicon.ts";
import {
  makeIssue,
  pushIssue,
} from "./issues.ts";
import {
  parseDocument,
} from "./parser.ts";
import {
  preserveCase,
} from "./util.ts";

export function findConfusedWords(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
  const patterns: Array<[RegExp, string, string, string, number?]> = [
    [/\b(your)\s+(welcome|going|right|sure)\b/giu, "you're", "grammar-confused-your", "Your is possessive; you’re means you are."],
    [/\b(its)\s+(a|an|not|been|going)\b/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
    [/\b(its)\s+(?:almost|nearly|just|really|quite|very|so|pretty|already|finally|always|never|probably|definitely|simply|literally)\s+[\p{L}]+(?=\s+(?:to\b|and\b|but\b|or\b|because\b|though\b|although\b|so\b|then\b))/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
    [/\b(its)\s+(ready|done|over|finished|fine|great|obvious|clear|unclear|impossible)(?=\s+(?:to\b|and\b|but\b|or\b|because\b)|[.,!?;:]|$)/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
    [/\b(their)\s+(is|are|was|were|has|have|a|an|not)\b/giu, "there", "grammar-confused-their", "There points to a place or introduces a statement."],
    [/\b(there)\s+(own|idea|ideas|team|house|car|name|responsibility)\b/giu, "their", "grammar-confused-there", "Their shows possession; there points to a place or introduces a statement."],
    [/\b(better|worse|more|less|rather|different)\s+(then)\b/giu, "than", "grammar-confused-than", "Than compares; then describes time or sequence.", 2],
    [/\b(an?|the|this|that)\s+(affect)\b/giu, "effect", "grammar-confused-affect", "Effect is usually the noun for a result; affect is usually the verb.", 2],
    [/\b(to|will|can|may|might|could|does|did)\s+(effect)\b/giu, "affect", "grammar-confused-effect", "Affect is usually the verb meaning to influence; effect is usually the noun.", 2],
    [/\b(to)\s+(much|many|late|long|loud|quiet|far|quickly)\b/giu, "too", "grammar-confused-too", "Too means excessively or also; to usually introduces a destination or verb.", 1],
    [/\b(too)\s+(the|a|an|my|your|our|their)\b/giu, "to", "grammar-confused-to", "To usually introduces a destination or verb; too means excessively or also.", 1],
    [/\b(to)\s+(advice)\b/giu, "advise", "grammar-confused-advice", "Advise is the verb; advice is the noun.", 1],
    [/\b(some|good|useful|professional)\s+(advise)\b/giu, "advice", "grammar-confused-advise", "Advice is the noun; advise is the verb.", 2],
    [/\b(to|will|can|may|might|could)\s+(loose)\b/giu, "lose", "grammar-confused-loose", "Lose means misplace or fail to win; loose means not tight.", 2],
  ];
  for (const [pattern, replacement, ruleId, explanation, groupIndex = 1] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = (match.index ?? 0);
      const original = match[groupIndex] ?? "";
      const wordStart = start + (match[0]?.indexOf(original) ?? 0);
      pushIssue(issues, makeIssue(ruleId, wordStart, wordStart + original.length, original, preserveCase(original, replacement), "grammar", "medium", "Check the commonly confused word", explanation, 0.78, preferences));
    }
  }
  return issues;
}

function articleFor(word: string) {
  const lower = word.toLocaleLowerCase();
  if (/^[A-Z]{2,}/u.test(word) && /^(?:u|uk|un|url|uuid|ui|usb|utc)/iu.test(word)) return "a";
  if (ARTICLE_AN_EXCEPTIONS.has(lower)) return "an";
  if (ARTICLE_A_SOUND_PREFIXES.test(lower)) return "a";
  return /^[aeiou]/u.test(lower) ? "an" : "a";
}

function nounLooksPlural(word: string) {
  const lower = word.toLocaleLowerCase();
  if (["children", "criteria", "media", "men", "people", "results", "women"].includes(lower)) return true;
  if (!lower.endsWith("s")) return false;
  return !/(?:analysis|basis|business|class|gas|glass|is|mathematics|news|physics|series|species|status|ss|us)$/u.test(lower);
}

export function findPrecisionGrammarIssues(text: string, preferences: StylePreferences, document = parseDocument(text)) {
  const issues: WritingIssue[] = [];
  for (const match of text.matchAll(/\b(the|a|an|this|that|my|your)\s+\1\b/giu)) {
    const start = match.index ?? 0;
    const duplicate = match[1] ?? "";
    const duplicateStart = start + match[0].lastIndexOf(duplicate);
    pushIssue(issues, makeIssue("grammar-duplicate-determiner", duplicateStart, duplicateStart + duplicate.length, duplicate, "", "grammar", "high", "Repeated determiner", "Remove the duplicated determiner so the sentence reads cleanly.", 0.995, preferences));
  }
  for (const match of text.matchAll(/\b(a|an)\s+([\p{L}][\p{L}'’-]*)/giu)) {
    const article = (match[1] ?? "").toLocaleLowerCase();
    const expected = articleFor(match[2] ?? "");
    if (article === expected) continue;
    const start = (match.index ?? 0) + (match[0].toLocaleLowerCase().indexOf(article));
    pushIssue(issues, makeIssue("grammar-article-agreement", start, start + article.length, match[1] ?? article, preserveCase(match[1] ?? article, expected), "grammar", "medium", "Check the article", `Use “${expected}” before “${match[2]}” in this context.`, 0.9, preferences));
  }
  const agreementPatterns: Array<[RegExp, Record<string, string>]> = [
    [/\b(he|she|it)\s+(are|were|have|do)\b/giu, { are: "is", were: "was", have: "has", do: "does" }],
    [/\b(they|we|you)\s+(is|was|has|does)\b/giu, { is: "are", was: "were", has: "have", does: "do" }],
    [/\b(?:the|this|that|my|your|our|their)\s+([\p{L}][\p{L}'’-]*)\s+(is|was|has|does)\b/giu, { is: "are", was: "were", has: "have", does: "do" }],
    [/\b(?:the|this|that|my|your|our|their)\s+([\p{L}][\p{L}'’-]*)\s+(are|were|have|do)\b/giu, { are: "is", were: "was", have: "has", do: "does" }],
    [/\b(?:the|these|those)\s+(?:latest|final|overall|main|primary|key|new|old)\s+([\p{L}][\p{L}'’-]*)\s+(is|was|has|does|are|were|have|do)\b/giu, { is: "are", was: "were", has: "have", does: "do", are: "is", were: "was", have: "has", do: "does" }],
  ];
  for (const [pattern, replacements] of agreementPatterns) {
    for (const match of text.matchAll(pattern)) {
      const subject = match[1] ?? "";
      const verb = match[2] ?? "";
      const subjectIsPlural = nounLooksPlural(subject);
      const pluralVerb = ["are", "were", "have", "do"].includes(verb.toLocaleLowerCase());
      const singularVerb = ["is", "was", "has", "does"].includes(verb.toLocaleLowerCase());
      if ((pluralVerb && subjectIsPlural) || (singularVerb && !subjectIsPlural && !["he", "she", "it", "they", "we", "you"].includes(subject.toLocaleLowerCase()))) continue;
      const start = (match.index ?? 0) + (match[0].lastIndexOf(verb));
      pushIssue(issues, makeIssue("grammar-subject-verb-agreement", start, start + verb.length, verb, preserveCase(verb, replacements[verb.toLocaleLowerCase()] ?? verb), "grammar", "high", "Check subject–verb agreement", "The verb should agree with the subject in number.", 0.94, preferences));
    }
  }
  const trimmed = text.trim();
  const lastSentence = document.sentences[document.sentences.length - 1];
  const lastToken = document.tokens[document.tokens.length - 1];
  if (trimmed && lastSentence && lastToken && lastSentence.tokens.length >= 4 && /[\p{L}\p{N})\]]$/u.test(trimmed) && /\s/u.test(lastSentence.text)) {
    const lastLower = lastToken.lower.split(/[’']/u)[0];
    const hasVerb = VERB_HINTS.has(lastLower) || lastSentence.tokens.some((token) => /(?:ed|ing|s)$/u.test(token.lower));
    if (hasVerb) pushIssue(issues, makeIssue("punctuation-missing-terminal", lastToken.start, lastToken.end, lastToken.value, `${lastToken.value}.`, "punctuation", "low", "Add terminal punctuation", "A complete sentence usually ends with punctuation.", 0.82, preferences));
  }
  return issues;
}

export function findPunctuation(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
  for (const match of text.matchAll(/ {2,}/g)) {
    const start = match.index ?? 0;
    // Leading spaces on a line are indentation, not a stray double space:
    // nested list items and indented code are both written that way on purpose.
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    if (!text.slice(lineStart, start).trim()) continue;
    pushIssue(issues, makeIssue("punctuation-extra-space", start, start + match[0].length, match[0], " ", "punctuation", "low", "Extra space", "A single space keeps the document’s rhythm consistent.", 0.99, preferences));
  }
  // Anchored to a preceding non-space. Unanchored, `\s+` consumed a whole run of
  // whitespace and then gave it back one character at a time looking for a
  // punctuation mark that was not there, at every start position in the run —
  // roughly 1.5s on a 16 KB run of newlines, on the keystroke path. The
  // lookbehind makes the run only start where a word has just ended.
  for (const match of text.matchAll(/(?<=\S)\s+([,.;!?])/g)) {
    const start = match.index ?? 0;
    pushIssue(issues, makeIssue("punctuation-space-before", start, start + match[0].length, match[0], match[1] ?? "", "punctuation", "medium", "Space before punctuation", "Punctuation sits directly after the word before it.", 0.99, preferences));
  }
  for (const match of text.matchAll(/([!?.,])\1+/g)) {
    const start = match.index ?? 0;
    pushIssue(issues, makeIssue("punctuation-repeated", start, start + match[0].length, match[0], match[1] ?? "", "punctuation", "low", "Repeated punctuation", "One punctuation mark is enough unless the style intentionally calls for emphasis.", 0.98, preferences));
  }
  if (preferences.oxfordComma) {
    for (const match of text.matchAll(/\b([\p{L}]+,\s+[\p{L}]+)\s+(and|or)\s+([\p{L}]+)\b/giu)) {
      const conjunction = match[2] ?? "and";
      const conjunctionIndex = (match.index ?? 0) + match[0].lastIndexOf(` ${conjunction} `) + 1;
      pushIssue(issues, makeIssue("punctuation-oxford-comma", conjunctionIndex, conjunctionIndex + conjunction.length + 1, ` ${conjunction}`, `, ${conjunction}`, "punctuation", "low", "Consider the Oxford comma", "Your style profile prefers a comma before the final conjunction in a list.", 0.72, preferences));
    }
  }
  return issues;
}

/**
 * Words whose full stop does not end a sentence.
 *
 * Without this, "Mr. smith", "Dr. jones", "St. mary parish", "etc. the rest"
 * and "vs. the other option" were all reported as lowercase sentence starts,
 * at 0.99 confidence, counting against correctness.
 */
const SENTENCE_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie",
  "approx", "est", "dept", "univ", "vol", "ch", "pp", "fig", "no", "al",
  "inc", "ltd", "co", "corp", "ave", "blvd", "min", "max",
]);

function endsWithAbbreviation(text: string, stopIndex: number) {
  let start = stopIndex;
  while (start > 0 && /[\p{L}.]/u.test(text[start - 1])) start -= 1;
  return isAbbreviationWord(text.slice(start, stopIndex));
}

function isAbbreviationWord(word: string) {
  const normalised = word.toLowerCase().replace(/\./gu, "");
  return normalised.length > 0 && SENTENCE_ABBREVIATIONS.has(normalised);
}

export function findCapitalization(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
  for (const match of text.matchAll(/(^|[.!?]\s+)([a-z])/g)) {
    const prefix = match[1] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    // "Mr. smith" and "etc. the rest" are correct as written. A full stop that
    // closes a known abbreviation is not a sentence boundary, and neither is
    // the very start of a draft that opens with one.
    const precededByAbbreviation = prefix && (match.index ?? 0) > 0 && endsWithAbbreviation(text, (match.index ?? 0) + prefix.length - 2);
    const opensWithAbbreviation = isAbbreviationWord(/^[\p{L}.]+/u.exec(text.slice(start))?.[0] ?? "");
    if (precededByAbbreviation || opensWithAbbreviation) continue;
    const original = match[2] ?? "";
    pushIssue(issues, makeIssue("capitalization-sentence-start", start, start + 1, original, original.toUpperCase(), "capitalization", "medium", "Start with a capital letter", "A new sentence usually begins with a capital letter, which makes the structure easier to scan.", 0.99, preferences));
  }
  for (const match of text.matchAll(/(^|[\s([{])i(?=[\s,.;!?)]|$)/g)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    pushIssue(issues, makeIssue("capitalization-pronoun-i", start, start + 1, "i", "I", "capitalization", "high", "Capitalise the pronoun I", "The first-person pronoun is conventionally capitalised in English.", 0.99, preferences));
  }
  return issues;
}
