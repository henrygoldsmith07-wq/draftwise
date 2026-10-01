import type {
  StylePreferences,
  WritingIssue,
} from "../../types/src/index.js";
import {
  CONTRACTIONS,
  CONTEXTUAL_DIALECT_WORDS,
  DIALECT_NOUN_CONTEXT,
  DIALECT_VERB_CONTEXT,
  DIALECT_VARIANTS,
  KEYBOARD_NEIGHBOURS,
  PROGRAMME_COMPUTING_CONTEXT,
  PROGRAMME_NON_COMPUTING_CONTEXT,
  SPELLING_COMMON,
  SPELLING_COMMON_EXTRA,
  SPELLING_COMMON_GAP,
  SPELLING_CORE,
  SPELLING_EXTENDED,
  SPELLING_UNICODE,
  TYPO_FIXES,
} from "./lexicon.ts";
import {
  mergePreferences,
  type GrammarOptions,
} from "./preferences.ts";
import {
  makeIssue,
  pushIssue,
} from "./issues.ts";
import {
  preserveCase,
} from "./util.ts";
import {
  type Token,
  parseDocument,
} from "./parser.ts";

// Common English words, plurals, and technical vocabulary that the compact lexicon
// missed. Each entry prevents a false positive from the fuzzy spelling suggester.
const SPELLING_FREQUENCY = [...new Set([...SPELLING_CORE, ...SPELLING_UNICODE, ...SPELLING_COMMON, ...SPELLING_COMMON_EXTRA, ...SPELLING_COMMON_GAP, ...SPELLING_EXTENDED])];
const SPELLING_WORDS = new Set(SPELLING_FREQUENCY);
const SPELLING_RANK = new Map(SPELLING_FREQUENCY.map((word, index) => [word.toLocaleLowerCase(), index]));
const SPELLING_INDEX = new Map<number, string[]>();
SPELLING_FREQUENCY.forEach((word) => {
  const normalized = word.toLocaleLowerCase();
  const bucket = SPELLING_INDEX.get(normalized.length) ?? [];
  bucket.push(normalized);
  SPELLING_INDEX.set(normalized.length, bucket);
});
const SPELLING_CACHE = new Map<string, string | null>();

function contextualDialectReplacement(tokens: Token[], index: number, preferences: StylePreferences) {
  const word = tokens[index]?.lower;
  if (!word || !CONTEXTUAL_DIALECT_WORDS.has(word)) return undefined;
  const before = tokens.slice(Math.max(0, index - 3), index).map((token) => token.lower);
  const after = tokens.slice(index + 1, index + 3).map((token) => token.lower);
  const immediateBefore = before.at(-1);
  const nearby = new Set([...before, ...after]);
  const verbUse = Boolean(immediateBefore && DIALECT_VERB_CONTEXT.has(immediateBefore));
  const nounUse = Boolean(immediateBefore && DIALECT_NOUN_CONTEXT.has(immediateBefore))
    || before.some((value) => DIALECT_NOUN_CONTEXT.has(value));

  if (word === "license" && preferences.dialect === "en-GB") {
    if (verbUse) return undefined;
    return nounUse ? "licence" : undefined;
  }
  if (word === "licence" && preferences.dialect === "en-US") {
    return verbUse || nounUse ? "license" : undefined;
  }
  if (word === "practice" && preferences.dialect === "en-GB") {
    return verbUse ? "practise" : undefined;
  }
  if (word === "practise" && preferences.dialect === "en-US") {
    return verbUse || nounUse ? "practice" : undefined;
  }
  if (word === "program" && preferences.dialect === "en-GB") {
    if (nearby.has("software") || [...nearby].some((value) => PROGRAMME_COMPUTING_CONTEXT.has(value))) return undefined;
    return [...nearby].some((value) => PROGRAMME_NON_COMPUTING_CONTEXT.has(value)) || nounUse ? "programme" : undefined;
  }
  if (word === "programme" && preferences.dialect === "en-US") {
    return [...nearby].some((value) => PROGRAMME_NON_COMPUTING_CONTEXT.has(value) || PROGRAMME_COMPUTING_CONTEXT.has(value)) || nounUse ? "program" : undefined;
  }
  return undefined;
}

function boundedEditDistance(left: string, right: string, limit = 2) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let previousPrevious: number[] | null = null;
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = current[0];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const value = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
        previousPrevious && row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]
          ? previousPrevious[column - 2] + 1
          : limit + 1,
      );
      current[column] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > limit) return limit + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length];
}

function spellingKey(word: string, preferences: StylePreferences) {
  return `${preferences.dialect}:${word.toLocaleLowerCase()}`;
}

function dictionaryHas(word: string, preferences: StylePreferences) {
  const lower = word.toLocaleLowerCase().normalize("NFC");
  return SPELLING_WORDS.has(lower)
    || preferences.personalDictionary?.some((value) => value.toLocaleLowerCase().normalize("NFC") === lower)
    || preferences.names?.some((value) => value.toLocaleLowerCase().normalize("NFC") === lower);
}

// English derivational/inflectional suffixes. Stripping these lets the lexicon
// recognise a whole word family (retain -> retention, balance -> balancer) instead
// of treating the derived form as a misspelling of something else entirely.
const DERIVATIONAL_SUFFIXES = [
  "ational", "ization", "isation", "iveness", "fulness", "ousness",
  "ation", "ition", "ution", "ision", "usion", "ension",
  "ement", "ments", "ment", "ness", "ities", "ity", "ances", "ance", "ences", "ence",
  "ions", "ion", "ings", "ing", "ers", "er", "est", "ies", "ied", "ive", "able", "ible",
  "ally", "ily", "ly", "ors", "or", "es", "ed", "s",
];

// A stripped stem is usually a real English root, but some inflections drop a
// silent "e" ("place" -> "plac", "move" -> "mov"). Restore it so a real word
// family resolves to its root.
//
// The silent "e" is only restored after a consonant that cannot end an English
// syllable, plus a bare final "c" (where the "e" is what keeps it soft). Adding
// it unconditionally is what let "moved" reach "move" and "measured" reach
// "measure", and it also let "message" reach "mesage" and so match "receeve",
// silently suppressing a real typo.
function stemVariants(stem: string): string[] {
  const variants = new Set<string>();
  const add = (value: string) => { if (value.length >= 3) variants.add(value); };
  add(stem);
  if (/c$|[bdfglmnprstvz]$/u.test(stem)) add(`${stem}e`);
  if (/(.)\1$/u.test(stem)) add(stem.slice(0, -1));
  if (stem.endsWith("i")) add(`${stem.slice(0, -1)}y`);
  return [...variants];
}

function inflectionRoots(lower: string) {
  const roots = new Set<string>();
  const add = (value: string) => { if (value.length >= 3) roots.add(value); };
  if (lower.endsWith("ies")) add(`${lower.slice(0, -3)}y`);
  if (lower.endsWith("ves")) { add(`${lower.slice(0, -3)}f`); add(`${lower.slice(0, -3)}fe`); }
  for (const suffix of DERIVATIONAL_SUFFIXES) {
    if (!lower.endsWith(suffix) || lower.length - suffix.length < 3) continue;
    for (const variant of stemVariants(lower.slice(0, -suffix.length))) add(variant);
  }
  return roots;
}

function isKnownSpelling(word: string, preferences: StylePreferences) {
  const lower = word.toLocaleLowerCase().normalize("NFC");
  const asciiContraction = lower.replaceAll("’", "'");
  if (dictionaryHas(lower, preferences) || CONTRACTIONS.has(asciiContraction)) return true;
  const possessive = lower.match(/^(.+?)(?:['’]s|s['’])$/u);
  if (possessive?.[1] && dictionaryHas(possessive[1], preferences)) return true;
  const parts = lower.split(/[’'-]/u).filter(Boolean);
  if (parts.length > 1 && parts.every((part) => part === "s" || dictionaryHas(part, preferences))) return true;
  return [...inflectionRoots(lower)].some((root) => dictionaryHas(root, preferences));
}

function keyboardPenalty(left: string, right: string) {
  let penalty = Math.abs(left.length - right.length);
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (left[index] === right[index]) continue;
    if (!KEYBOARD_NEIGHBOURS[left[index]]?.includes(right[index] ?? "")) penalty += 1;
  }
  return penalty;
}

function dialectPenalty(word: string, preferences: StylePreferences) {
  for (const variants of Object.values(DIALECT_VARIANTS)) {
    if (word === variants[preferences.dialect]) return 0;
    if (word === variants[preferences.dialect === "en-GB" ? "en-US" : "en-GB"]) return 1;
  }
  return 0;
}


/**
 * True when `word` and `candidate` differ by a shape that is almost always a
 * typing mistake rather than a different word: an adjacent transposition, a
 * doubled letter, or a single inserted/deleted character.
 *
 * A plain single substitution is deliberately NOT accepted. "expected"/"respected",
 * "recording"/"according", and "observed"/"served" are all one edit apart, but
 * both words in each pair is correct English, so substituting them is always a
 * false positive. Real single-substitution typos ("seperate"/"separate",
 * "recieve"/"receive") are already covered by the explicit TYPO_FIXES table.
 */
function hasTypoShape(word: string, candidate: string) {
  if (!candidate || word === candidate) return false;
  const distance = boundedEditDistance(word, candidate, 2);
  if (distance > 2) return false;

  if (word.length === candidate.length) {
    // Only an adjacent transposition qualifies at equal length.
    const differences: number[] = [];
    for (let index = 0; index < word.length; index += 1) {
      if (word[index] !== candidate[index]) differences.push(index);
    }
    if (differences.length !== 2 || differences[1] - differences[0] !== 1) return false;
    return word[differences[0]] === candidate[differences[1]]
      && word[differences[1]] === candidate[differences[0]];
  }

  // A single insertion or deletion. The surplus letter has to look like a slip
  // rather than a different word: dropping the first or last letter of a real
  // word is usually just a different word ("terror"/"error", "alive"/"live"),
  // so a plain edge deletion is rejected outright.
  if (Math.abs(word.length - candidate.length) === 1) {
    const shorter = word.length < candidate.length ? word : candidate;
    const longer = word.length < candidate.length ? candidate : word;
    if (longer.length < 4) return false;
    const edges = [longer.slice(1) === shorter, longer.slice(0, -1) === shorter];
    // A repeated letter is only a typo when the SURPLUS letter is the repeat, so
    // "letter" -> "leter" qualifies while "terror" -> "error" does not: there the
    // repeated "r" is not the letter that was removed.
    for (let index = 0; index < longer.length; index += 1) {
      if (longer.slice(0, index) + longer.slice(index + 1) !== shorter) continue;
      if (index > 0 && longer[index] === longer[index - 1]) return true;
      if (index < longer.length - 1 && longer[index] === longer[index + 1]) return true;
      // An internal removal needs a doubled letter elsewhere in the word to be
      // plausible; a lone missing letter is far more often a different word.
      if (!edges[0] && !edges[1] && /(.)\1/u.test(longer)) return true;
    }
    return false;
  }

  return false;
}

export function suggestSpelling(word: string, preferences: GrammarOptions = {}) {
  const merged = mergePreferences(preferences);
  const lower = word.toLocaleLowerCase().normalize("NFC");
  const key = spellingKey(word, merged);
  if (TYPO_FIXES[lower]) return TYPO_FIXES[lower];
  if (isKnownSpelling(word, merged) || /^[A-Z][\p{L}'’-]+$/u.test(word) || /^[A-Z]{2,}[\w-]*$/u.test(word)) {
    return null;
  }
  if (SPELLING_CACHE.has(key)) return SPELLING_CACHE.get(key) ?? null;
  if (lower.length < 3) return null;
  const maxDistance = lower.length >= 8 ? 2 : 1;
  const hasUnicode = /[^\p{ASCII}]/u.test(lower);
  let best: { word: string; distance: number; keyboard: number; dialect: number; rank: number } | null = null;
  for (let length = Math.max(1, lower.length - maxDistance); length <= lower.length + maxDistance; length += 1) {
    for (const candidate of SPELLING_INDEX.get(length) ?? []) {
      if (candidate === lower || (hasUnicode && !/[^\p{ASCII}]/u.test(candidate))) continue;
      const distance = boundedEditDistance(lower, candidate, maxDistance);
      if (distance > maxDistance) continue;
      // A compact lexicon cannot know every real word, so the nearest candidate is
      // often a different word rather than a misspelling. Require a genuine typo
      // shape - a transposition, an omission, or a doubled/missing letter - so
      // "flow" and "scores" survive while "recieve" is still corrected.
      if (!hasTypoShape(lower, candidate)) continue;
      const candidateScore = { word: candidate, distance, keyboard: keyboardPenalty(lower, candidate), dialect: dialectPenalty(candidate, merged), rank: SPELLING_RANK.get(candidate) ?? Number.MAX_SAFE_INTEGER };
      if (!best
        || candidateScore.distance < best.distance
        || (candidateScore.distance === best.distance && candidateScore.keyboard < best.keyboard)
        || (candidateScore.distance === best.distance && candidateScore.keyboard === best.keyboard && candidateScore.dialect < best.dialect)
        || (candidateScore.distance === best.distance && candidateScore.keyboard === best.keyboard && candidateScore.dialect === best.dialect && candidateScore.rank < best.rank)) best = candidateScore;
    }
  }
  const result = best?.word ?? null;
  SPELLING_CACHE.set(key, result);
  if (SPELLING_CACHE.size > 512) SPELLING_CACHE.delete(SPELLING_CACHE.keys().next().value as string);
  return result;
}

export function findSpelling(text: string, preferences: StylePreferences, document = parseDocument(text)) {
  const issues: WritingIssue[] = [];
  for (const [tokenIndex, token] of document.tokens.entries()) {
    const typo = TYPO_FIXES[token.lower];
    const contextualReplacement = contextualDialectReplacement(document.tokens, tokenIndex, preferences);
    const dialect = !CONTEXTUAL_DIALECT_WORDS.has(token.lower)
      ? Object.entries(DIALECT_VARIANTS).find(([, variants]) =>
        token.lower === variants[preferences.dialect].toLocaleLowerCase() || token.lower === variants[preferences.dialect === "en-GB" ? "en-US" : "en-GB"].toLocaleLowerCase(),
      )
      : undefined;
    const dialectReplacement = contextualReplacement ?? (dialect && token.lower !== dialect[1][preferences.dialect].toLocaleLowerCase()
      ? dialect[1][preferences.dialect]
      : undefined);
    const lexicalReplacement = !dialectReplacement && !typo ? suggestSpelling(token.value, preferences) : undefined;
    const replacement = dialectReplacement ?? typo ?? lexicalReplacement;
    if (!replacement || replacement.toLocaleLowerCase() === token.lower) continue;
    pushIssue(issues, makeIssue(
      dialectReplacement ? "dialect-spelling" : typo ? "spelling-common-typo" : "spelling-lexicon",
      token.start,
      token.end,
      token.value,
      preserveCase(token.value, replacement),
      "spelling",
      dialectReplacement ? "low" : typo ? "high" : "medium",
      dialectReplacement ? `Use ${preferences.dialect === "en-GB" ? "British" : "US"} spelling` : `Spelling: ${preserveCase(token.value, replacement)}`,
      dialectReplacement
        ? `Your style profile uses ${preferences.dialect === "en-GB" ? "British" : "US"} English. Keep the dialect consistent across the document.`
        : `“${token.value}” is a common spelling slip. The suggested replacement is “${preserveCase(token.value, replacement)}”.`,
      dialectReplacement ? 0.86 : typo ? 0.99 : 0.88,
      preferences,
    ));
  }
  return issues;
}
