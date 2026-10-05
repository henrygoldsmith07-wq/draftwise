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
    // Compare the two bigrams by their tokens directly. Slicing four tokens
    // per position allocated two short arrays for every word in the draft —
    // on a long document that is hundreds of thousands of throwaway arrays
    // before a single finding is reported.
    const first = tokens[index];
    const second = tokens[index + 1];
    const third = tokens[index + 2];
    const fourth = tokens[index + 3];
    if (first.lower !== third.lower || second.lower !== fourth.lower) continue;
    if (second.end > third.start + 1) continue;
    pushIssue(issues, makeIssue("repetition-repeated-phrase", first.start, fourth.end, text.slice(first.start, fourth.end), text.slice(first.start, second.end), "repetition", "medium", "Repeated phrase", "This short phrase is repeated back-to-back. Keep it once unless the repetition is deliberate.", 0.98, preferences));
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
  // Stative adjectives that end in -ed.
  //
  // The `-ed` alternative in the passive pattern below matched "are red",
  // "was tired", "naked", "sacred", "beloved" and "wicked" — ordinary prose,
  // reported as passive constructions. The pattern's -en guard covers "are
  // often"; this covers the same mistake in its -ed form.
  const staticEdAdjectives = " red tired naked sacred beloved aged wicked learned crooked jagged ragged blessed cursed diseased supposed used pleased prepared concerned involved married unmarried talented gifted limited unlimited reserved content confident silent violent ";
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
    // Every token capitalised or numeric is a name, label or heading ("Daniel",
    // "Roughly 1."), not a missing-verb fragment.
    const labelLike = sentence.tokens.length > 0 && sentence.tokens.every((token) => token.value[0] !== token.value[0].toLocaleLowerCase());
    if (sentence.tokens.length >= 1 && sentence.tokens.length <= 3 && !hasVerb && !labelLike && !/[!?]$/u.test(sentence.text)) {
      pushIssue(issues, makeIssue("structure-fragment", sentence.start, sentence.end, sentence.text, "", "sentence structure", "low", "Possible sentence fragment", "This short sentence may be missing a verb. Keep it if the fragment is intentional.", 0.65, preferences));
    }
  }
  for (const paragraph of document.paragraphs) {
    const count = paragraph.tokens.length;
    if (count > 150) pushIssue(issues, makeIssue("structure-long-paragraph", paragraph.start, paragraph.end, paragraph.text, "", "readability", "low", "Long paragraph", "A shorter paragraph can give the reader a useful pause.", 0.78, preferences));
  }
  const passiveSensitivity = preferences.passiveVoiceSensitivity;
  if (passiveSensitivity !== "off") {
    // Past participles only. A bare -en suffix is not evidence: "are often",
    // "is even" and "are open" are ordinary prose, and each one that fires
    // costs the writer's trust in every real passive that follows.
    const pattern = /\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?(?:\p{L}+ed|\p{L}*(?:aken|idden|iven|oken|olen|osen|rozen|ritten|roken|hosen|riven|oven|eaten|beaten|fallen|known|grown|shown|thrown|seen|gone|done|built|spent|sent|kept|left|lost|held|made|paid|said|sold|told|found|bound|ground|wound|lent|bent|felt|dealt|swept|crept))\b/giu;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      // "The walls are red" and "He was tired" are not passive constructions.
      const participle = /(?:\p{L}+ed|\p{L}*(?:aken|idden|iven|oken|olen|osen|rozen|ritten|roken|hosen|riven|oven|eaten|beaten|fallen|known|grown|shown|thrown|seen|gone|done|built|spent|sent|kept|left|lost|held|made|paid|said|sold|told|found|bound|ground|wound|lent|bent|felt|dealt|swept|crept))/iu.exec(match[0].replace(/^\S+\s+/u, ""));
      if (participle && staticEdAdjectives.includes(` ${participle[0].toLowerCase()} `)) continue;
      // Only offer the change where an actor is plausibly missing. Reporting
      // what happened ("the backlog was cleared") is correct, deliberate prose.
      const sentence = document.sentences.find((span) => start >= span.start && start < span.end);
      const textBefore = sentence ? sentence.text.slice(0, Math.max(0, start - sentence.start)) : text.slice(Math.max(0, start - 80), start);
      const hasExplicitActor = /\b(?:by\s+\p{L}+|(?:we|they|he|she|it|someone|the)\s+\w+\s+(?:made|built|created|fixed|found|wrote|sent))\s*$/iu.test(textBefore.trim());
      if (hasExplicitActor) continue;
      pushIssue(issues, makeIssue("style-passive-voice", start, start + match[0].length, match[0], "", "passive voice", passiveSensitivity === "strict" ? "medium" : "low", "Consider naming who acts", "This is a passive construction, so the reader cannot tell who is acting. If the actor matters, name them; if the focus on the result is deliberate, keep it.", passiveSensitivity === "strict" ? 0.8 : 0.62, preferences));
    }
  }
  return issues;
}
