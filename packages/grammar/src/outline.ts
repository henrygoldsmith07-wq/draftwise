import type { StylePreferences, WritingGoals, WritingIssue, WritingStats } from "../../types/src/index.js";
import { type ParsedDocument, parseDocument } from "./parser.ts";

/**
 * Document-level editorial reasoning.
 *
 * Sentence-level rules answer "is this sentence right?". This layer answers the
 * question a writer actually has once a draft is longer than a screen:
 * "is this document going anywhere, and where is it weakest?"
 *
 * Everything here is local, deterministic, and derived from text the writer
 * already has. No provider, no network, no AI. It runs in the browser on every
 * analysis, and it scales with length instead of degrading: a 10,000-word draft
 * gets a proportionally richer reading, not the same five notes.
 *
 * The output is deliberately editorial rather than numeric. A writer does not
 * need another score; they need to know which section carries the argument,
 * where it stops doing work, and what the draft is currently most concerned
 * with.
 */

/** A section of the draft, inferred from its own text and the goals. */
export interface DocumentSection {
  id: string;
  /** Zero-based index in document order. */
  index: number;
  start: number;
  end: number;
  /** First sentence, trimmed: enough to recognise the passage without quoting a wall. */
  opening: string;
  /** One or two words naming what the section is mostly about. */
  topic: string;
  /** The sentence the section spends most of its length on. */
  dominantSentence: string;
  words: number;
  sentences: number;
  /** Word count of the paragraph immediately before this section, used for pacing. */
  /**
   * How much of the section's vocabulary is unique to it. High values mean the
   * section introduces material rather than restating.
   */
  novelty: number;
  /** True when this section is dense, low-novelty filler between two substantial ones. */
  filler: boolean;
  /** What the section is doing in the argument. */
  role: SectionRole;
}

export type SectionRole = "opening" | "development" | "supporting-detail" | "turn" | "closing" | "unclear";

export interface DocumentNote {
  id: string;
  kind: "structure" | "balance" | "goal" | "coverage";
  /** Short headline the writer can scan. */
  title: string;
  /** What Draftwise observed, in plain language, tied to the actual draft. */
  detail: string;
  /** What the writer could do about it. */
  suggestion: string;
  /** Sections this note is about, so the UI can jump to them. */
  sectionIds: string[];
  /** Where in the document this note applies. */
  start: number;
  end: number;
  /** 0-1. Deliberately below objective-rule confidence: these are editorial reads. */
  confidence: number;
}

export interface DocumentOutline {
  sections: DocumentSection[];
  notes: DocumentNote[];
  /** The draft's recurring subject matter, most prominent first. */
  themes: Array<{ term: string; count: number; share: number }>;
  /** Short description of what shape the draft is in. */
  shape: "single-idea" | "linear" | "sectioned" | "list-driven" | "very-short";
  /** One sentence describing where the draft's weight sits. */
  focus: string;
}

const OUTLINE_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those", "there", "here",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done", "have", "has", "had",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
  "in", "on", "at", "to", "for", "of", "with", "from", "by", "as", "into", "about", "over", "after", "before",
  "not", "no", "so", "because", "while", "although", "though", "which", "who", "whom", "what", "when", "where", "how", "why",
  "will", "would", "can", "could", "should", "may", "might", "must", "shall", "also", "more", "most", "some", "any", "each", "every", "all", "both",
  "up", "out", "down", "off", "own", "same", "very", "just", "now", "only", "even", "still", "much", "many", "one", "two", "first", "last",
]);

const OPENING_CUES = ["however", "but", "yet", "nevertheless", "although", "though", "instead", "on the other hand", "meanwhile", "now"];
const CLOSING_CUES = ["overall", "in conclusion", "to conclude", "to sum up", "in summary", "finally", "ultimately", "in short", "therefore", "for these reasons"];
const TRANSITION_CUES = ["moreover", "furthermore", "in addition", "additionally", "similarly", "likewise", "consequently", "as a result", "for instance", "for example"];

/**
 * A conservative stem so inflections of one word count as one theme.
 *
 * The failure mode to avoid is worse than missing a match: "across" must never
 * become "acros", and "carefully" must not become "careful" while "detail"
 * stays "detail". Only endings that are unambiguous evidence of inflection are
 * removed, and never below three remaining characters, so no theme is ever
 * shorter than a real word fragment.
 */
function stem(word: string): string {
  if (word.length <= 4) return word;
  let result = word;
  // -ss plurals and -es verb endings: boxes -> box, watches -> watch.
  if (/(?:sses|xes|zes|ches|shes)$/u.test(result)) result = result.slice(0, -2);
  // -ies -> -y: studies -> study.
  else if (/ies$/u.test(result)) result = `${result.slice(0, -3)}y`;
  // -ing only after a plausible stem, and only when something remains.
  else if (/ing$/u.test(result) && result.length >= 8) result = result.slice(0, -3);
  // -ed likewise.
  else if (/ed$/u.test(result) && result.length >= 6) result = result.slice(0, -2);
  // A plain plural -s, but never a genuine -ss word ("across", "analysis").
  else if (/s$/u.test(result) && !/(?:ss|us|is)$/u.test(result)) result = result.slice(0, -1);
  return result.length >= 3 ? result : word;
}

function sectionTopic(words: string[]): string {
  const counts = new Map<string, number>();
  for (const raw of words) {
    const key = stem(raw);
    if (key.length < 4) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [term, count] of counts) {
    if (count > bestCount || (count === bestCount && term < best)) {
      best = term;
      bestCount = count;
    }
  }
  return bestCount >= 2 ? best : "";
}

/**
 * Split the draft into sections. Paragraphs are the writer's own unit of
 * thought, so sections are built from consecutive paragraphs rather than an
 * arbitrary character count: a section boundary should mean the argument moved.
 * A run of paragraphs is cut when the vocabulary turns over enough that the
 * writer is clearly onto something new.
 */
function buildSections(document: ParsedDocument, stats: WritingStats): DocumentSection[] {
  const paragraphs = document.paragraphs.filter((paragraph) => paragraph.tokens.length > 0);
  if (paragraphs.length === 0) return [];

  // Target a section roughly every 180 words, but never split a paragraph.
  const targetWords = 180;
  const groups: Array<typeof paragraphs> = [];
  let current: typeof paragraphs = [];
  let currentWords = 0;
  for (const paragraph of paragraphs) {
    current.push(paragraph);
    currentWords += paragraph.tokens.length;
    if (currentWords >= targetWords && paragraph.tokens.length < 120) {
      groups.push(current);
      current = [];
      currentWords = 0;
    }
  }
  if (current.length) groups.push(current);

  // Now merge adjacent groups that share too much vocabulary to be a real turn.
  const merged: Array<{ paragraphs: typeof paragraphs; words: Set<string> }> = [];
  for (const group of groups) {
    const words = new Set<string>();
    for (const paragraph of group) for (const token of paragraph.tokens) {
      const word = token.lower;
      if (word.length > 4 && !OUTLINE_STOP_WORDS.has(word)) words.add(stem(word));
    }
    const previous = merged[merged.length - 1];
    if (previous && words.size && previous.words.size) {
      let shared = 0;
      for (const word of words) if (previous.words.has(word)) shared += 1;
      const overlap = shared / Math.max(1, Math.min(words.size, previous.words.size));
      if (overlap > 0.45) {
        previous.paragraphs.push(...group);
        for (const word of words) previous.words.add(word);
        continue;
      }
    }
    merged.push({ paragraphs: group, words });
  }

  const totalStems = new Set<string>();
  for (const group of merged) for (const word of group.words) totalStems.add(word);

  const sections: DocumentSection[] = [];
  merged.forEach((group, index) => {
    const start = group.paragraphs[0].start;
    const end = group.paragraphs[group.paragraphs.length - 1].end;
    const sentences = document.sentences.filter((sentence) => sentence.start >= start && sentence.end <= end);
    const words = group.paragraphs.reduce((total, paragraph) => total + paragraph.tokens.length, 0);
    const tokens = group.paragraphs.flatMap((paragraph) => paragraph.tokens.map((token) => token.lower));

    let novelCount = 0;
    const seen = new Set<string>();
    for (const token of tokens) {
      const word = stem(token);
      if (word.length < 4 || OUTLINE_STOP_WORDS.has(word)) continue;
      if (!seen.has(word)) {
        seen.add(word);
        // Only credit a stem as new if it is new to the whole document, or
        // first appears here rather than being common everywhere.
        if (totalStems.has(word)) novelCount += 1;
      }
    }
    const novelty = seen.size ? Math.max(0, Math.min(1, novelCount / Math.max(6, seen.size))) : 0;

    const dominant = sentences.reduce(
      (longest, sentence) => (sentence.tokens.length > longest.tokens.length ? sentence : longest),
      sentences[0],
    );

    sections.push({
      id: `section-${index}`,
      index,
      start,
      end,
      opening: (sentences[0]?.text ?? group.paragraphs[0].text).trim().slice(0, 140),
      topic: sectionTopic(tokens),
      dominantSentence: (dominant?.text ?? "").trim().slice(0, 180),
      words,
      sentences: sentences.length,
      novelty,
      filler: false,
      role: "development",
    });
  });

  // A section sandwiched between substantial neighbours that adds little new
  // vocabulary is doing little work. That is a real editorial observation and
  // one the writer cannot see, because locally every sentence looks fine.
  for (let index = 1; index < sections.length - 1; index += 1) {
    const section = sections[index];
    const before = sections[index - 1];
    const after = sections[index + 1];
    if (section.words >= 40 && section.novelty < 0.22 && before.novelty > section.novelty && after.novelty > section.novelty) {
      section.filler = true;
    }
  }

  if (stats.words > 0 && sections.length > 0) {
    const average = stats.words / sections.length;
    // A single section spanning most of the draft means no real structure yet.
    if (sections.length === 1 && average > 260) sections[0].filler = sections[0].filler && sections[0].novelty >= 0.2;
  }

  // Roles are assigned last: they depend on novelty and on the final section
  // count, both of which the filler pass above can change.
  for (const section of sections) {
    section.role = section.filler ? "supporting-detail" : roleFor(section, sections.length);
  }
  return sections;
}

/**
 * What a section is doing in the argument.
 *
 * Cheap, local, and useful: "your conclusion introduces a new term" only works
 * if the writer can tell which paragraph is the conclusion. Positions alone are
 * a weak signal, so the opening words and the section's novelty decide it.
 */
function roleFor(section: DocumentSection, total: number): SectionRole {
  if (total === 1) return "development";
  const opening = section.opening.toLocaleLowerCase();
  if (section.index === 0) return "opening";
  if (section.index === total - 1) return "closing";
  if (section.novelty >= 0.4 && TRANSITION_CUES.some((cue) => opening.includes(cue))) return "turn";
  if (section.novelty < 0.2) return "supporting-detail";
  return "development";
}

function firstWords(text: string, count: number): string {
  return text.trim().split(/\s+/u).slice(0, count).join(" ");
}

/**
 * The last few words the reader actually sees.
 *
 * The closing check used to look only at where the final section begins. On a
 * long draft the final section usually runs for many paragraphs, so a summary
 * written as the last paragraph — the most ordinary way to end — sat inside the
 * section and was never examined. The closing cue is looked for in the opening
 * of the last section and in the document's own ending.
 */
function closingWords(document: ParsedDocument, text: string): string {
  const parts: string[] = [];
  const paragraphs = document.paragraphs.filter((paragraph) => paragraph.tokens.length > 0);
  const lastParagraph = paragraphs[paragraphs.length - 1];
  if (lastParagraph) parts.push(lastParagraph.text);
  const lastSentence = document.sentences[document.sentences.length - 1];
  if (lastSentence) parts.push(text.slice(lastSentence.start, lastSentence.end));
  return firstWords(parts.join(" "), 14).toLocaleLowerCase();
}

export interface DocumentOutlineOptions {
  goals?: WritingGoals;
  preferences?: StylePreferences;
  issues?: WritingIssue[];
}

/**
 * Build the whole-document reading: an outline, the draft's themes, where its
 * weight sits, and a small set of editorial notes that scale with the draft.
 */
export function buildDocumentOutline(
  text: string,
  stats?: WritingStats,
  document: ParsedDocument = parseDocument(text),
  options: DocumentOutlineOptions = {},
): DocumentOutline {
  const resolvedStats = stats;
  const sections = buildSections(document, resolvedStats ?? { words: document.tokens.length, sentences: document.sentences.length, paragraphs: document.paragraphs.length, sentenceLengths: document.sentenceLengths, paragraphLengths: document.paragraphLengths, readingTime: 0, characters: text.length, readability: 0, longSentences: 0, fillerWords: 0, passiveVoice: 0, passiveVoicePercentage: 0, averageSentenceLength: 0, longestSentence: "", vocabularyDiversity: 0, repeatedWords: [], repeatedPhrases: [], fillerWordFrequency: [], commonWords: [] });

  const notes: DocumentNote[] = [];
  const goals = options.goals;
  const preferences = options.preferences;

  // --- Themes -----------------------------------------------------------
  const themeCounts = new Map<string, number>();
  let themeTotal = 0;
  for (const token of document.tokens) {
    const word = token.lower;
    if (word.length <= 4 || OUTLINE_STOP_WORDS.has(word)) continue;
    const key = stem(word);
    if (key.length < 4) continue;
    themeCounts.set(key, (themeCounts.get(key) ?? 0) + 1);
    themeTotal += 1;
  }
  const themes = [...themeCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([term, count]) => ({ term, count, share: themeTotal ? count / themeTotal : 0 }));

  // --- Shape ------------------------------------------------------------
  const shape: DocumentOutline["shape"] = sections.length === 0 ? "very-short"
    : resolvedStats && resolvedStats.words > 0 && resolvedStats.words < 90 ? "very-short"
      : sections.length === 1 ? (resolvedStats && resolvedStats.words > 400 ? "linear" : "single-idea")
        : sections.length >= 5 ? "sectioned"
          : (resolvedStats && resolvedStats.paragraphs > sections.length * 3 ? "list-driven" : "linear");

  // --- Weight -----------------------------------------------------------
  const heaviest = sections.reduce<DocumentSection | null>(
    (best, section) => (!best || section.words > best.words ? section : best),
    null,
  );
  const focus = heaviest
    ? heaviest.topic
      ? `The draft spends most of its weight on “${heaviest.topic}”.`
      : `The heaviest part of the draft runs from ${firstWords(heaviest.opening, 6)}...`
    : "The draft is still very short.";

  // --- Editorial notes --------------------------------------------------
  if (sections.length >= 2) {
    // A hard structural turn: the writer changes their mind mid-draft without
    // signalling it. Worth more as the draft gets longer.
    const opener = firstWords(sections[0].opening, 12).toLocaleLowerCase();
    const last = sections[sections.length - 1];
    const closer = firstWords(last.opening, 12).toLocaleLowerCase();
    const openingTurns = OPENING_CUES.some((cue) => opener.includes(cue));
    const closingTurns = CLOSING_CUES.some((cue) => closer.includes(cue))
      || CLOSING_CUES.some((cue) => closingWords(document, text).includes(cue));
    if (openingTurns) {
      notes.push({
        id: "note-opening-turn",
        kind: "structure",
        title: "The draft opens on a contrast",
        detail: "The opening paragraph starts with a contrast (“however”, “but”, “although”) rather than stating the point directly. Readers meet the disagreement before they know what is being disagreed with.",
        suggestion: "Consider naming the point first, then the contrast. Many readers will not carry an unnamed disagreement into the next paragraph.",
        sectionIds: [sections[0].id],
        start: sections[0].start,
        end: sections[0].end,
        confidence: 0.5,
      });
    }
    if (closingTurns) {
      // Point at the final paragraph when that is where the summary actually
      // is, so following the note lands on the wording being criticised.
      const paragraphs = document.paragraphs.filter((paragraph) => paragraph.tokens.length > 0);
      const lastParagraph = paragraphs[paragraphs.length - 1];
      const endsWithCue = lastParagraph
        && CLOSING_CUES.some((cue) => firstWords(lastParagraph.text, 6).toLocaleLowerCase().includes(cue));
      notes.push({
        id: "note-closing-summary",
        kind: "structure",
        title: "The ending summarises rather than lands",
        detail: endsWithCue
          ? "The final paragraph summarises (“overall”, “in conclusion”). A summary is useful once the reader already agrees; it is less useful as the last thing they read."
          : "The closing section begins by summarising (“overall”, “in conclusion”). A summary is useful once the reader already agrees; it is less useful as the last thing they read.",
        suggestion: "Consider ending on the single most consequential point, or a concrete next step, and moving the summary one paragraph earlier.",
        sectionIds: [last.id],
        start: endsWithCue ? lastParagraph.start : last.start,
        end: endsWithCue ? lastParagraph.end : last.end,
        confidence: 0.5,
      });
    }
  }

  const fillerSections = sections.filter((section) => section.filler);
  if (fillerSections.length) {
    const worst = fillerSections[0];
    notes.push({
      id: "note-filler-section",
      kind: "balance",
      title: `${fillerSections.length === 1 ? "A section is" : `${fillerSections.length} sections are`} carrying little new ground`,
      detail: fillerSections.length === 1
        ? `The section beginning “${firstWords(worst.opening, 6)}”” mostly restates vocabulary from the sections around it. Nothing in it is wrong; it just does not add much that the neighbouring sections have not already said.`
        : `${fillerSections.length} sections mostly restate vocabulary from the sections around them. They read as effort without adding much the neighbouring sections have not already said.`,
      suggestion: "Consider cutting the shortest of them, or merging them into the section they restate. If they are there to reassure, keep one and let it be brief.",
      sectionIds: fillerSections.map((section) => section.id),
      start: worst.start,
      end: worst.end,
      confidence: 0.5,
    });
  }

  if (sections.length >= 4) {
    const longestSection = heaviest;
    if (longestSection) {
      const share = resolvedStats && resolvedStats.words > 0 ? longestSection.words / resolvedStats.words : 0;
      const median = [...sections].sort((a, b) => a.words - b.words)[Math.floor(sections.length / 2)].words;
      if (share > 0.45 && longestSection.words > median * 1.8) {
        notes.push({
          id: "note-weight-imbalance",
          kind: "balance",
          title: "One section dominates the draft",
          detail: `The section beginning “${firstWords(longestSection.opening, 6)}”” is about ${Math.round(share * 100)}% of the draft. The other sections are comparatively brief, so the piece reads as one long argument with a short frame around it.`,
          suggestion: "Consider whether the surrounding sections should be expanded to match, or whether the dominant section should be split so its turns are visible.",
          sectionIds: [longestSection.id],
          start: longestSection.start,
          end: longestSection.end,
          confidence: 0.5,
        });
      }
    }
  }

  // --- Goal-aware notes -------------------------------------------------
  if (goals && resolvedStats) {
    const required = (goals.requiredTerminology ?? []).map((term) => term.trim()).filter(Boolean);
    if (required.length) {
      const lower = text.toLocaleLowerCase();
      const missing = required.filter((term) => !lower.includes(term.toLocaleLowerCase()));
      if (missing.length && document.paragraphs.length) {
        const anchor = sections[0] ?? { id: "document", start: document.paragraphs[0].start, end: document.paragraphs[0].end };
        notes.push({
          id: "note-goal-missing-term",
          kind: "goal",
          title: `Your goals require ${missing.length === 1 ? "a term" : "terms"} the draft has not used`,
          detail: `You asked for ${missing.map((term) => `“${term}”`).join(", ")} to appear somewhere. ${missing.length === 1 ? "It does not appear" : "None of them appear"} anywhere in the draft.`,
          suggestion: "Either work the term into the relevant section, or remove it from your goals if it is no longer needed.",
          sectionIds: [anchor.id],
          start: anchor.start,
          end: anchor.end,
          confidence: 0.6,
        });
      }
    }

    const target = goals.targetLength;
    if (typeof target === "number" && target > 0 && resolvedStats.words > 0) {
      const ratio = resolvedStats.words / target;
      if (ratio >= 1.5 || ratio <= 0.6) {
        const direction = ratio > 1 ? "longer" : "shorter";
        const first = sections[0];
        notes.push({
          id: "note-goal-length",
          kind: "goal",
          title: `The draft is ${direction === "longer" ? "well over" : "well under"} your target length`,
          detail: `Your goal is about ${target.toLocaleString()} words; the draft is currently ${resolvedStats.words.toLocaleString()}. That is a note about shape, not a problem to fix on its own.`,
          suggestion: direction === "longer"
            ? "Consider whether the sections furthest from your core point are earning their length, or whether a point is being made twice in different words."
            : "Consider whether the argument needs one more supporting section, or whether the target itself is still right.",
          sectionIds: first ? [first.id] : [],
          start: first?.start ?? 0,
          end: first?.end ?? 0,
          confidence: 0.5,
        });
      }
    }

    if (goals.intent === "persuade" && resolvedStats.sentences > 4) {
      const requestWords = /(?:\bshould\b|\bmust\b|\bneed(?:s|ed)? to\b|\brecommend\b|\bought-?in\b)/iu;
      const asked = document.sentences.filter((sentence) => requestWords.test(sentence.text)).length;
      if (asked === 0) {
        const first = sections[0];
        notes.push({
          id: "note-goal-no-request",
          kind: "goal",
          title: "The draft never makes a request",
          detail: `You set the intent to persuade, but no sentence asks the reader to do anything. A persuasive piece can be entirely reasonable and still leave the reader without a next step.`,
          suggestion: "Consider closing with what you want the reader to do, said plainly. It does not need to be a command.",
          sectionIds: first ? [first.id] : [],
          start: first?.start ?? 0,
          end: first?.end ?? 0,
          confidence: 0.45,
        });
      }
    }
  }

  // --- Preference-aware note -------------------------------------------
  if (preferences && sections.length >= 3) {
    const contractions = document.tokens.filter((token) => /['”]/u.test(token.value)).length;
    if (!preferences.allowContractions && contractions > 0 && goals?.tone !== "casual") {
      const first = sections[0];
      notes.push({
        id: "note-pref-contractions",
        kind: "goal",
        title: "The register is looser than your style profile",
        detail: `Your profile prefers formal wording, and the draft contains ${contractions} contraction${contractions === 1 ? "" : "s"}. Individually each is small; together they set a tone.`,
        suggestion: "Decide deliberately: either loosen the profile, or tighten these where they do not carry voice.",
        sectionIds: first ? [first.id] : [],
        start: first?.start ?? 0,
        end: first?.end ?? 0,
        confidence: 0.45,
      });
    }
  }

  // --- Coverage note ----------------------------------------------------
  // Does the draft state a claim anywhere the reader can point to?
  if (resolvedStats && resolvedStats.sentences >= 6) {
    const claimCue = /(?:\bthe (?:aim|goal|purpose|question|problem) (?:of|is)\b|\bwe (?:aim|argue|set out)\b|\bthis (?:draft|essay|piece|document) (?:argues|considers|examines|explores)\b|\bthe question\b|\bin this (?:essay|piece|draft)\b)/iu;
    if (!claimCue.test(text)) {
      const first = sections[0];
      notes.push({
        id: "note-coverage-no-claim",
        kind: "coverage",
        title: "The draft never says what it is trying to do",
        detail: `Across ${resolvedStats.sentences} sentences, nothing states the aim, question, or claim the piece is working towards. Each section may be clear on its own, but the reader has to assemble the point themselves.`,
        suggestion: "Consider one sentence near the top naming what this draft sets out to do. It makes every later section easier to follow.",
        sectionIds: first ? [first.id] : [],
        start: first?.start ?? 0,
        end: first?.end ?? 0,
        confidence: 0.5,
      });
    }
  }

  // Order notes by position so the UI reads top-to-bottom.
  notes.sort((a, b) => a.start - b.start);

  return { sections, notes, themes, shape, focus };
}

/**
 * A one-line, honest description of how the draft is currently doing, derived
 * from the same signals the outline uses. No score, no judgement: a status the
 * writer can act on.
 */
export function summariseDocument(outline: DocumentOutline, stats: WritingStats, goals?: WritingGoals): string {
  const parts: string[] = [];
  const sectionCount = outline.sections.length;
  parts.push(sectionCount <= 1 ? "One continuous section" : `${sectionCount} sections`);
  if (outline.themes[0]) parts.push(`centred on “${outline.themes[0].term}”`);
  if (outline.themes[1]) parts.push(`with “${outline.themes[1].term}” recurring`);
  const filler = outline.sections.filter((section) => section.filler).length;
  if (filler) parts.push(`${filler} low-weight section${filler === 1 ? "" : "s"}`);
  if (goals) parts.push(`written for a ${goals.audience} audience to ${goals.intent}`);
  if (stats.longSentences > 0) parts.push(`${stats.longSentences} long sentence${stats.longSentences === 1 ? "" : "s"}`);
  return `${parts.join(", ")}.`;
}
