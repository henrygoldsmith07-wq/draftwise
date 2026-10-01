import type {
  StylePreferences,
  WritingIssue,
} from "../../types/src/index.js";
import {
  CLICHES,
  FILLER_WORDS,
  INTENSIFIERS,
  VAGUE_WORDS,
  VERB_HINTS,
  WORDINESS,
} from "./lexicon.ts";
import {
  makeIssue,
  pushIssue,
} from "./issues.ts";
import {
  type SentenceSpan,
  parseDocument,
} from "./parser.ts";
import {
  preserveCase,
} from "./util.ts";

export function findRepeatedWordsAndPhrases(text: string, preferences: StylePreferences, document = parseDocument(text)) {
  const issues: WritingIssue[] = [];
  const tokens = document.tokens;
  for (let index = 1; index < tokens.length; index += 1) {
    const previous = tokens[index - 1];
    const current = tokens[index];
    if (previous.lower !== current.lower || previous.end > current.start + 1) continue;
    pushIssue(issues, makeIssue("repetition-adjacent-word", previous.start, current.end, text.slice(previous.start, current.end), previous.value, "repetition", "medium", "Repeated word", "This word appears twice in a row. Removing the repeat keeps the sentence moving.", 0.99, preferences));
  }
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    const phrase = tokens.slice(index, index + 2);
    const next = tokens.slice(index + 2, index + 4);
    if (phrase[0].lower !== next[0].lower || phrase[1].lower !== next[1].lower) continue;
    if (phrase[1].end > next[0].start + 1) continue;
    pushIssue(issues, makeIssue("repetition-repeated-phrase", phrase[0].start, next[1].end, text.slice(phrase[0].start, next[1].end), text.slice(phrase[0].start, phrase[1].end), "repetition", "medium", "Repeated phrase", "This short phrase is repeated back-to-back. Keep it once unless the repetition is deliberate.", 0.98, preferences));
  }
  const openings = new Map<string, SentenceSpan>();
  for (const sentence of document.sentences) {
    const opening = sentence.tokens.slice(0, 2).map((token) => token.lower).join(" ");
    if (!opening || opening.length < 4) continue;
    const existing = openings.get(opening);
    if (existing && sentence.start - existing.end < 600) {
      const end = Math.min(sentence.end, sentence.start + sentence.tokens.slice(0, 2).reduce((total, token) => total + token.value.length, 0) + 1);
      pushIssue(issues, makeIssue("repetition-sentence-opening", sentence.start, end, text.slice(sentence.start, end), "", "repetition", "low", "Vary the sentence opening", "Several nearby sentences start the same way. Varying the openings can improve rhythm.", 0.76, preferences));
    } else {
      openings.set(opening, sentence);
    }
  }
  return issues;
}

export function findStyleIssues(text: string, preferences: StylePreferences, document = parseDocument(text)) {
  const issues: WritingIssue[] = [];
  for (const [phrase, replacement] of WORDINESS) {
    const pattern = new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "gi");
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      pushIssue(issues, makeIssue(`wordiness-${phrase.replace(/ /g, "-")}`, start, start + match[0].length, match[0], preserveCase(match[0], replacement), "conciseness", "low", "Tighten this phrase", `“${phrase}” can usually be expressed more directly as “${replacement}”.`, 0.9, preferences));
    }
  }
  for (const [phrase, replacement] of CLICHES) {
    const pattern = new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "gi");
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      pushIssue(issues, makeIssue(`style-cliche-${phrase.replace(/ /g, "-")}`, start, start + match[0].length, match[0], replacement, "word choice", "low", "Possible cliché", "This familiar phrase may be less precise than a concrete alternative.", 0.72, preferences));
    }
  }
  for (const token of document.tokens) {
    if (FILLER_WORDS.has(token.lower)) pushIssue(issues, makeIssue("conciseness-filler", token.start, token.end, token.value, "", "conciseness", "low", "Possible filler word", "Remove it if the sentence keeps its meaning without it.", 0.8, preferences));
    if (VAGUE_WORDS.has(token.lower)) pushIssue(issues, makeIssue("clarity-vague-word", token.start, token.end, token.value, "", "clarity", "low", "Vague wording", "A more specific noun may help the reader understand exactly what you mean.", 0.68, preferences));
    if (INTENSIFIERS.has(token.lower)) pushIssue(issues, makeIssue("style-intensifier", token.start, token.end, token.value, "", "tone", "low", "Check the intensifier", "This intensifier may add emphasis without adding much meaning.", 0.72, preferences));
  }
  for (const [blocked, preferred] of Object.entries(preferences.preferredTerminology)) {
    if (!blocked || !preferred) continue;
    const pattern = new RegExp(`\\b${blocked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      pushIssue(issues, makeIssue("consistency-preferred-term", start, start + match[0].length, match[0], preserveCase(match[0], preferred), "consistency", "medium", "Use your preferred term", `Your style guide prefers “${preferred}” for consistent terminology.`, 0.95, preferences));
    }
  }
  if (!preferences.allowContractions) {
    const contractions: Record<string, string> = { "can't": "cannot", "won't": "will not", "don't": "do not", "it's": "it is", "we're": "we are", "you've": "you have" };
    for (const token of document.tokens) {
      const replacement = contractions[token.lower];
      if (replacement) pushIssue(issues, makeIssue("style-contractions", token.start, token.end, token.value, preserveCase(token.value, replacement), "formality", "low", "Avoid contractions", "Your style profile prefers a more formal register.", 0.9, preferences));
    }
  }
  return issues;
}

export function findStructureIssues(text: string, preferences: StylePreferences, document = parseDocument(text)) {
  const issues: WritingIssue[] = [];
  const sentences = document.sentences;
  const sentenceLimit = preferences.preferredSentenceLength === "short" ? 22 : preferences.preferredSentenceLength === "long" ? 45 : 32;
  for (const sentence of sentences) {
    if (sentence.tokens.length > sentenceLimit) {
      pushIssue(issues, makeIssue("structure-long-sentence", sentence.start, sentence.end, sentence.text, "", "sentence structure", "low", "Long sentence", `This sentence has ${sentence.tokens.length} words. Consider splitting it if the ideas compete for attention.`, 0.84, preferences));
    }
    const hasVerb = sentence.tokens.some((token) => {
      const base = token.lower.split(/[’']/u)[0];
      return VERB_HINTS.has(token.lower) || VERB_HINTS.has(base) || /(?:ed|ing|s)$/u.test(token.lower);
    });
    if (sentence.tokens.length >= 1 && sentence.tokens.length <= 3 && !hasVerb && !/[!?]$/u.test(sentence.text)) {
      pushIssue(issues, makeIssue("structure-fragment", sentence.start, sentence.end, sentence.text, "", "sentence structure", "low", "Possible sentence fragment", "This short sentence may be missing a verb. Keep it if the fragment is intentional.", 0.65, preferences));
    }
  }
  for (const paragraph of document.paragraphs) {
    const count = paragraph.tokens.length;
    if (count > 150) pushIssue(issues, makeIssue("structure-long-paragraph", paragraph.start, paragraph.end, paragraph.text, "", "readability", "low", "Long paragraph", "A shorter paragraph can give the reader a useful pause.", 0.78, preferences));
  }
  const passiveSensitivity = preferences.passiveVoiceSensitivity;
  if (passiveSensitivity !== "off") {
    const pattern = /\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?[\p{L}]+(?:ed|en)\b/giu;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      pushIssue(issues, makeIssue("style-passive-voice", start, start + match[0].length, match[0], "", "passive voice", passiveSensitivity === "strict" ? "medium" : "low", "Try active voice", "Active voice often makes the actor and the action clearer. Keep this suggestion only when it matches your intent.", passiveSensitivity === "strict" ? 0.86 : 0.7, preferences));
    }
  }
  return issues;
}
