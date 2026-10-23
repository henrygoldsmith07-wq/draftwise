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
    // Temporal and additive adverbs almost never sit between a possessive and
    // its noun ("your still able" is always "you're still able"), while
    // intensifiers routinely do ("your very first attempt", "your quite nice
    // garden"), so only the former are checked. "own" is excluded because
    // "your very own" is never in the list and "your own" is possessive.
    [/\b(your)\s+(still|always|never|already|also)\s+(?!own\b)[\p{L}]+/giu, "you're", "grammar-confused-your", "Your is possessive; you’re means you are."],
    // A possessive can never precede "the": determiners do not stack, so
    // "your the best" and "its the last thing" are always the contraction.
    [/\b(your)\s+the\b/giu, "you're", "grammar-confused-your", "Your is possessive; you’re means you are."],
    [/\b(its)\s+(a|an|the|not|been|going)\b/giu, "it's", "grammar-confused-its", "It’s means it is; its shows possession."],
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
  // In a draft written entirely without letter case the writer has abandoned
  // apostrophes along with capitals, so suggesting one back ("its" ->
  // "it's", "your" -> "you're") is register noise: the same draft writes
  // "dont" and "i" without one. Letter-level confusions (their/there,
  // than/then) are still checked. See isUncasedDraft.
  const uncasedConfusion = isUncasedDraft(text);
  for (const [pattern, replacement, ruleId, explanation, groupIndex = 1] of patterns) {
    if (uncasedConfusion && (ruleId === "grammar-confused-its" || ruleId === "grammar-confused-your")) continue;
    for (const match of text.matchAll(pattern)) {
      const start = (match.index ?? 0);
      const original = match[groupIndex] ?? "";
      const wordStart = start + (match[0]?.indexOf(original) ?? 0);
      pushIssue(issues, makeIssue(ruleId, wordStart, wordStart + original.length, original, preserveCase(original, replacement), "grammar", "medium", "Check the commonly confused word", explanation, 0.78, preferences));
    }
  }
  return issues;
}

const REFLEXIVE_SUBJECTIVE: Record<string, string> = {
  myself: "I", yourself: "you", himself: "he", herself: "she", itself: "it",
  ourselves: "we", yourselves: "you", themselves: "they", oneself: "one",
};
const REFLEXIVE_OBJECTIVE: Record<string, string> = {
  myself: "me", yourself: "you", himself: "him", herself: "her", itself: "it",
  ourselves: "us", yourselves: "you", themselves: "them", oneself: "one",
};
const REFLEXIVE_ALTERNATION = Object.keys(REFLEXIVE_SUBJECTIVE).join("|");

// Auxiliaries and modals put a following either/neither phrase in subject
// position ("will either himself or James attend" needs "he"). They are
// listed explicitly because VERB_HINTS mixes them with lexical verbs, and a
// lexical verb in the same slot governs an object instead ("invited both
// myself" needs "me").
const SUBJECT_SLOT_AUX = new Set([
  "am", "be", "is", "are", "was", "were", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "will", "would", "can", "could", "shall", "should", "may", "might", "must",
]);

// Base-form transitive verbs that VERB_HINTS does not carry but that govern
// an object slot the same way a preposition does ("contact either myself"
// needs "me", while "if either myself" needs "I").
const TRANSITIVE_GOVERNORS = new Set([
  "send", "give", "ask", "invite", "include", "contact", "email", "call",
  "bring", "take", "pass", "share", "forward", "cc", "notify", "let",
  "help", "see", "hear", "watch",
]);

/**
 * Whether the either/neither/both phrase starting at `keywordStart` sits in
 * an object slot (after a preposition or transitive verb: "to either
 * myself" → "me") or a subject slot ("if either myself" → "I").
 *
 * Defaults to subject: a conjunction, comma or clause boundary before the
 * keyword means nothing governs the phrase, and the reflexive is in subject
 * position by elimination.
 */
function reflexiveSlotCase(text: string, keywordStart: number): "subject" | "object" {
  const before = text.slice(0, keywordStart);
  if (PREPOSITION_BEFORE.test(before)) return "object";
  const previous = /([\p{L}']+)\s*$/u.exec(before)?.[1]?.toLocaleLowerCase();
  if (!previous || SUBJECT_SLOT_AUX.has(previous)) return "subject";
  if (VERB_HINTS.has(previous) || /(ed|ing)$/u.test(previous) || TRANSITIVE_GOVERNORS.has(previous)) return "object";
  return "subject";
}

const REFLEXIVE_NEXT_WORD_EXCLUDED = new Set([
  "and", "or", "nor", "the", "a", "an", "to", "of", "for", "with",
  "by", "from", "in", "on", "at", "as", "but", "if", "that",
]);

function reflexiveFollowedByVerb(text: string, reflexiveEnd: number): boolean {
  const next = /\s+([\p{L}']+)/u.exec(text.slice(reflexiveEnd))?.[1]?.toLocaleLowerCase();
  if (!next || REFLEXIVE_NEXT_WORD_EXCLUDED.has(next)) return false;
  return SUBJECT_SLOT_AUX.has(next)
    || VERB_HINTS.has(next)
    || /(ed|ing|es)$/u.test(next);
}

/**
 * A reflexive pronoun standing in for a plain personal pronoun.
 *
 * "Either myself or my colleague" and "myself will attend" are
 * hypercorrections: a reflexive needs its antecedent in the clause ("I
 * myself will attend", "he fixed it himself"), and without one the
 * subject slot takes "I" and the object slot "me". The emphatic uses
 * never match: they follow their antecedent mid-clause, while both patterns
 * here are anchored where no antecedent can stand — after either/neither/
 * both, or at a sentence boundary followed by a verb.
 *
 * Mid-clause coordination ("John and myself attended") is deliberately not
 * covered: telling a subject ("John and I") from an object ("for John and
 * me") there needs government analysis this rule does not attempt. A miss,
 * never a false positive.
 */
export function findReflexiveSubjects(text: string, preferences: StylePreferences) {
  const issues: WritingIssue[] = [];
  const push = (start: number, original: string, replacement: string, slot: "subject" | "object") => {
    pushIssue(issues, makeIssue("grammar-reflexive-subject", start, start + original.length, original, preserveCase(original, replacement), "grammar", "high", "Check the reflexive pronoun",
      slot === "subject"
        ? `“${original}” cannot be the subject of a clause on its own — the reflexive needs its antecedent (“I myself”). Use the subject pronoun “${replacement}” here.`
        : `After a preposition or verb the reflexive needs its antecedent in the clause. Use the object pronoun “${replacement}” here.`,
      0.9, preferences));
  };
  for (const match of text.matchAll(new RegExp(`\\b(either|neither|both)\\s+(${REFLEXIVE_ALTERNATION})\\s+(or|nor|and)\\b`, "giu"))) {
    const original = match[2] ?? "";
    const lower = original.toLocaleLowerCase();
    const slot = reflexiveSlotCase(text, match.index ?? 0);
    const replacement = (slot === "subject" ? REFLEXIVE_SUBJECTIVE : REFLEXIVE_OBJECTIVE)[lower] ?? original;
    const wordStart = (match.index ?? 0) + (match[0]?.indexOf(original) ?? 0);
    push(wordStart, original, replacement, slot);
  }
  for (const match of text.matchAll(new RegExp(`(^|[.!?]\\s+)(${REFLEXIVE_ALTERNATION})\\b`, "giu"))) {
    const original = match[2] ?? "";
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    if (!reflexiveFollowedByVerb(text, start + original.length)) continue;
    const replacement = REFLEXIVE_SUBJECTIVE[original.toLocaleLowerCase()] ?? original;
    push(start, original, replacement, "subject");
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

/**
 * Whether the whole draft is written without letter case.
 *
 * Chat messages, quick notes and semi-formal messages are routinely typed
 * entirely in lower case. In that register the missing capital is not a slip:
 * there is no capital to be missing anywhere in the draft, so the choice is
 * consistent, and consistency is what tells a deliberate voice from an error.
 * Reporting every sentence of such a message (a four-sentence note produced
 * four findings, plus one for each "i") is the single noisiest class of false
 * positive we had on ordinary text, and it landed hardest in the extension,
 * whose main job is short messages on web forms.
 *
 * Two conditions keep this from becoming a blanket exemption.
 *
 * 1. A draft that contains *any* capital letter has casing in play, so a
 *    lower-case sentence in it is still a genuine inconsistency worth
 *    reporting. One capital word anywhere — a name, an acronym — switches the
 *    rules back on for the whole draft.
 *
 * 2. A register needs a body of text to exist. The calibration corpus pins the
 *    reported side: a four-word caseless fragment ("this draft is ready.") must
 *    still be flagged. Ten words leaves a deliberate margin above that — at
 *    ten words the writer has written a message, not an unfinished sentence —
 *    and the margin is what keeps this a rule about a body of text rather than
 *    a rule about one sentence.
 */
const UNCASED_REGISTER_MIN_WORDS = 10;

export function isUncasedDraft(text: string) {
  if (!text.trim()) return false;
  // The cheap test first: any capital letter in the draft makes it cased, which
  // is the common case and skips the word count entirely.
  if (/\p{Lu}/u.test(text)) return false;
  // Count only as far as the threshold. Splitting a long draft into words on
  // every keystroke was measurable work in the analysis loop, and the answer is
  // decided by the tenth word either way.
  const words = /\S+/gu;
  let count = 0;
  while (words.exec(text)) {
    count += 1;
    if (count >= UNCASED_REGISTER_MIN_WORDS) return true;
  }
  return false;
}

/**
 * Whether a determiner phrase starting at `position` is the object of a
 * preposition rather than the subject of its clause.
 *
 * "Costs attributable to the restructuring were met" was reported as an
 * agreement error because the pattern saw "the restructuring were". The real
 * subject is "Costs"; "the restructuring" is what the costs are attributable
 * to. Agreement cannot be judged from a noun that a preposition governs, so the
 * determiner patterns must skip those phrases.
 *
 * Words that can also open a clause — "as", "since", "until", "after" — are
 * deliberately absent: in "as the results are clear" the determiner phrase *is*
 * the subject, and skipping it would hide the agreement error the rule exists
 * to catch.
 */
const PREPOSITION_BEFORE = /(?:^|[^\p{L}])(?:about|above|across|against|along|among|around|at|behind|below|beneath|beside|between|beyond|by|despite|during|except|for|from|in|inside|into|near|of|off|on|onto|outside|over|past|per|through|throughout|to|toward|towards|under|upon|via|with|within|without)\s+$/iu;

function isPrepositionalObject(text: string, position: number) {
  return position > 0 && PREPOSITION_BEFORE.test(text.slice(0, position));
}

/**
 * Whether a verb sits in a hypothetical clause that takes the subjunctive.
 *
 * "If the aggregate were published" is correct English: after "if", "were"
 * applies to every person. Treating it as a plural verb disagreeing with a
 * singular subject reported a grammar error on correct writing, so the "were"
 * agreement fix is withheld inside those clauses.
 */
/**
 * The base form of a third-person singular lexical verb, or null when `word`
 * is not shaped like one.
 *
 * Consonant + "ies" takes "y" ("studies" -> "study") while vowel + "ies"
 * takes "ie" ("dies" -> "die"); sibilant and -o endings take "es"
 * ("watches" -> "watch", "goes" -> "go"); the rest drop a single "s"
 * except double-s endings ("class" is a noun, not "clas" + "s"). Inputs
 * shorter than four letters are never verb forms worth judging ("as", "is").
 */
function toBaseVerbForm(word: string): string | null {
  if (word.length < 4) return null;
  if (word.endsWith("ies")) {
    const stem = word.slice(0, -3);
    return /[aeiou]$/u.test(stem) ? `${stem}ie` : `${stem}y`;
  }
  if (/(?:s|x|z|ch|sh|o)es$/u.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return null;
}

function inHypotheticalClause(text: string, position: number) {
  const boundaries = [".", "!", "?", "\n"].map((mark) => text.lastIndexOf(mark, position - 1));
  const clauseStart = Math.max(...boundaries) + 1;
  return /\b(?:if|wish|as though|as if|suppose|supposing)\b/iu.test(text.slice(clauseStart, position));
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
      // Only the determiner patterns can be thrown off by sentence structure;
      // "he/she/it" and "they/we/you" are unambiguous subjects.
      const determinerLed = /^(?:the|this|that|these|those|my|your|our|their)\b/iu.test(match[0]);
      // A personal pronoun after a determiner agrees with itself: "that it
      // is" and "that they are" are correct English, and the pronoun-led
      // patterns above already own the cases where they are wrong. Without
      // this, every relative clause with a pronoun subject was reported.
      // "I" is not exempt: no above pattern covers it, and "that I is"
      // is always wrong.
      const pronounSubject = ["he", "she", "it", "they", "we", "you"].includes(subject.toLocaleLowerCase());
      if (determinerLed && pronounSubject) continue;
      const subjectIsPlural = nounLooksPlural(subject);
      const pluralVerb = ["are", "were", "have", "do"].includes(verb.toLocaleLowerCase());
      const singularVerb = ["is", "was", "has", "does"].includes(verb.toLocaleLowerCase());
      if ((pluralVerb && subjectIsPlural) || (singularVerb && !subjectIsPlural && !pronounSubject)) continue;
      const start = (match.index ?? 0) + (match[0].lastIndexOf(verb));
      if (determinerLed && isPrepositionalObject(text, match.index ?? 0)) continue;
      if (verb.toLocaleLowerCase() === "were" && inHypotheticalClause(text, start)) continue;
      pushIssue(issues, makeIssue("grammar-subject-verb-agreement", start, start + verb.length, verb, preserveCase(verb, replacements[verb.toLocaleLowerCase()] ?? verb), "grammar", "high", "Check subject–verb agreement", "The verb should agree with the subject in number.", 0.94, preferences));
    }
  }
  // Auxiliary verbs end in -s too, but the patterns above own them: "The
  // results is" and "The results has" are already reported with the right
  // fix, so this loop only sees lexical verbs.
  const AUXILIARY_VERB_FORMS = new Set(["is", "are", "was", "were", "has", "have", "does", "do", "am"]);
  // Plural-looking nouns that are singular or number-ambiguous in ordinary
  // prose: academic fields take singular agreement ("statistics shows" is
  // correct for the discipline), and headquarters/means can be either, so a
  // precision rule declines to judge them.
  const AMBIGUOUS_NUMBER_NOUNS = /(?:headquarters|means|economics|statistics|politics|ethics|linguistics|classics)$/iu;
  for (const match of text.matchAll(/\b(?:the|this|that|my|your|our|their)\s+([\p{L}][\p{L}'’-]*)\s+([\p{L}]+s)\b/giu)) {
    const subject = match[1] ?? "";
    const verb = match[2] ?? "";
    const verbLower = verb.toLocaleLowerCase();
    if (AUXILIARY_VERB_FORMS.has(verbLower)) continue;
    if (!nounLooksPlural(subject) || AMBIGUOUS_NUMBER_NOUNS.test(subject)) continue;
    const base = toBaseVerbForm(verbLower);
    // The stripped form must be a known verb: without that, noun-noun
    // compounds ("the sales calls rang") and stray words ("the results as
    // presented") would be "corrected" into nonsense.
    if (!base || !VERB_HINTS.has(base)) continue;
    const start = (match.index ?? 0) + (match[0].lastIndexOf(verb));
    if (isPrepositionalObject(text, match.index ?? 0)) continue;
    pushIssue(issues, makeIssue("grammar-subject-verb-agreement", start, start + verb.length, verb, preserveCase(verb, base), "grammar", "high", "Check subject–verb agreement", "The verb should agree with the subject in number.", 0.9, preferences));
  }
  const trimmed = text.trim();
  const lastSentence = document.sentences[document.sentences.length - 1];
  const lastToken = document.tokens[document.tokens.length - 1];
  // A message with no letter case has no convention for terminal stops either,
  // and its last line is usually a sign-off rather than a forgotten full stop.
  const uncased = isUncasedDraft(text);
  if (!uncased && trimmed && lastSentence && lastToken && lastSentence.tokens.length >= 4 && /[\p{L}\p{N})\]]$/u.test(trimmed) && /\s/u.test(lastSentence.text)) {
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
  // Uncased drafts get no capitalisation advice at all: see isUncasedDraft.
  if (isUncasedDraft(text)) return issues;
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
