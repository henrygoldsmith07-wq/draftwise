import type {
  StylePreferences,
  WritingGoals,
  WritingIssue,
} from "../../types/src/index.js";
import {
  makeIssue,
  pushIssue,
} from "./issues.ts";
import {
  type ParsedDocument,
  parseDocument,
} from "./parser.ts";

/**
 * Document-level structural analysis.
 *
 * Sentence rules fix sentences; this layer looks at how the document carries
 * its argument: repeated ideas, paragraphs that do not advance the piece,
 * claims without support, weak transitions, hedging, and a conclusion that
 * introduces something new.
 *
 * Every finding is deliberately conservative and tied to the exact passage.
 * These are editorial judgements, not errors: confidence stays below the
 * objective rules, and the advice names what the paragraph is doing rather
 * than issuing generic instruction like "improve the introduction".
 */

const MAX_STRUCTURAL_NOTES = 5;
const MIN_PARAGRAPH_WORDS = 15;

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those", "there", "here",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "have", "has", "had",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
  "in", "on", "at", "to", "for", "of", "with", "from", "by", "as", "into", "about", "over", "after", "before",
  "not", "no", "so", "because", "while", "although", "though", "which", "who", "whom", "what", "when", "where", "how", "why",
  "will", "would", "can", "could", "should", "may", "might", "must", "shall", "also", "more", "most", "some", "any", "each", "every", "all", "both",
]);

const HEDGE_WORDS = new Set(["might", "maybe", "perhaps", "possibly", "somewhat", "arguably", "seemingly", "apparently", "fairly", "rather", "quite", "kind of", "sort of"]);
const CLAIM_MARKERS = new Set(["always", "never", "everyone", "nobody", "obviously", "clearly", "proves", "proven", "undeniably", "certainly", "best", "worst"]);
const SUPPORT_MARKERS = ["because", "since", "for example", "for instance", "evidence", "study", "data", "research", "according", "shows that", "means that", "therefore"];

function contentWords(paragraph: ParsedDocument["paragraphs"][number]) {
  return new Set(paragraph.tokens.map((token) => token.lower.split(/[’']/u)[0]).filter((word) => word.length > 3 && !STOP_WORDS.has(word)));
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function sharedTopicWords(left: Set<string>, right: Set<string>, limit = 3) {
  return [...left].filter((word) => right.has(word)).slice(0, limit);
}

export function findGoalTerminology(
  text: string,
  goals: WritingGoals | undefined,
  preferences: StylePreferences,
  document = parseDocument(text),
): WritingIssue[] {
  const issues: WritingIssue[] = [];
  const forbidden = goals?.forbiddenTerminology ?? [];
  for (const term of forbidden) {
    const needle = term.trim();
    if (!needle) continue;
    const pattern = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "giu");
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      pushIssue(issues, makeIssue(
        "goal-forbidden-term",
        start,
        start + match[0].length,
        match[0],
        "",
        "consistency",
        "medium",
        "Term you asked to avoid",
        `Your goals forbid “${needle}”. Replace it with wording that fits the document.`,
        0.9,
        preferences,
      ));
    }
  }
  const required = (goals?.requiredTerminology ?? []).map((term) => term.trim()).filter(Boolean);
  if (required.length > 0) {
    const lower = text.toLocaleLowerCase();
    const missing = required.filter((term) => !lower.includes(term.toLocaleLowerCase()));
    const anchor = document.paragraphs[0];
    if (missing.length > 0 && anchor) {
      pushIssue(issues, makeIssue(
        "goal-missing-term",
        anchor.start,
        Math.min(anchor.end, anchor.start + 60),
        text.slice(anchor.start, Math.min(anchor.end, anchor.start + 60)),
        "",
        "consistency",
        "low",
        "Required terminology missing",
        `Your goals require ${missing.map((term) => `“${term}”`).join(", ")} somewhere in the draft; none of ${missing.length === 1 ? "it appears" : "them appear"} yet.`,
        0.7,
        preferences,
      ));
    }
  }
  return issues;
}

export function findDocumentStructure(
  text: string,
  preferences: StylePreferences,
  goals: WritingGoals | undefined,
  document = parseDocument(text),
): WritingIssue[] {
  const issues: WritingIssue[] = [];
  const paragraphs = document.paragraphs.filter((paragraph) => paragraph.tokens.length > 0);
  // Claim support and hedging are paragraph-local and hold even in a one-
  // paragraph document; the cross-paragraph checks run only from two up.
  if (paragraphs.length === 0) return issues;

  const audience = goals?.audience ?? "general";
  const intent = goals?.intent ?? "inform";
  const formalRegister = audience === "academic" || audience === "professional" || intent === "persuade";

  // 1. Repeated argument: a paragraph that substantially restates an earlier
  //    one without adding new material.
  const seenParagraphs: Array<{ paragraph: ParsedDocument["paragraphs"][number]; words: Set<string> }> = [];
  for (const paragraph of paragraphs) {
    if (issues.length >= MAX_STRUCTURAL_NOTES) break;
    if (paragraph.tokens.length < MIN_PARAGRAPH_WORDS) continue;
    const words = contentWords(paragraph);
    for (const previous of seenParagraphs) {
      const overlap = jaccard(words, previous.words);
      if (overlap >= 0.55) {
        const topic = sharedTopicWords(words, previous.words);
        pushIssue(issues, makeIssue(
          "structure-note-repeated-idea",
          paragraph.start,
          Math.min(paragraph.end, paragraph.start + 90),
          text.slice(paragraph.start, Math.min(paragraph.end, paragraph.start + 90)),
          "",
          "fluency",
          "low",
          "Repeated idea",
          `What Draftwise noticed: this paragraph covers nearly the same ground as an earlier one${topic.length ? `, sharing ${topic.map((word) => `“${word}”`).join(" and ")}` : ""}. Why it may matter: readers who already read the earlier point lose momentum here. Consider either cutting this paragraph, or keeping only the sentence that adds new evidence or a new angle.`,
          0.6,
          preferences,
        ));
        break;
      }
    }
    seenParagraphs.push({ paragraph, words });
  }

  // 2. Unsupported claim: strong claim language in a paragraph with no
  //    supporting marker anywhere in it.
  if (formalRegister) {
    for (const paragraph of paragraphs) {
      if (issues.length >= MAX_STRUCTURAL_NOTES) break;
      const lower = paragraph.text.toLocaleLowerCase();
      const claim = paragraph.tokens.find((token) => CLAIM_MARKERS.has(token.lower));
      if (!claim) continue;
      if (SUPPORT_MARKERS.some((marker) => lower.includes(marker))) continue;
      pushIssue(issues, makeIssue(
        "structure-note-unsupported-claim",
        claim.start,
        claim.end,
        claim.value,
        "",
        "clarity",
        "low",
        "Claim without support",
        `What Draftwise noticed: this passage asserts that “${claim.value}” holds without saying why. Why it may matter: an unsupported claim is where a sceptical reader stops trusting the argument. Consider adding one sentence of evidence or a worked example right after this claim.`,
        0.55,
        preferences,
      ));
    }
  }

  // 3. Excessive hedging: several hedges stacked in one paragraph weaken the
  //    point instead of qualifying it.
  if (formalRegister) {
    for (const paragraph of paragraphs) {
      if (issues.length >= MAX_STRUCTURAL_NOTES) break;
      const hedges = paragraph.tokens.filter((token) => HEDGE_WORDS.has(token.lower));
      if (hedges.length < 3) continue;
      pushIssue(issues, makeIssue(
        "structure-note-hedging",
        hedges[0].start,
        hedges[0].end,
        hedges[0].value,
        "",
        "tone",
        "low",
        "Stacked hedges",
        `What Draftwise noticed: this passage qualifies itself ${hedges.length} times (“${hedges.slice(0, 3).map((token) => token.value).join("”, “")}”). Why it may matter: stacked hedges read as doubt rather than care, and weaken a point the writer may actually hold confidently. Consider keeping the single strongest qualifier and removing the rest.`,
        0.55,
        preferences,
      ));
    }
  }

  // 4. Conclusion introducing a new idea: the closing paragraph is the first
  //    place a substantial topic word appears. Only meaningful when there is a
  //    body before it to conclude.
  const last = paragraphs[paragraphs.length - 1];
  if (paragraphs.length >= 2 && last && last.tokens.length >= 15 && (intent === "persuade" || intent === "inform")) {
    const earlierWords = new Set(paragraphs.slice(0, -1).flatMap((paragraph) => [...contentWords(paragraph)]));
    const newWords = [...contentWords(last)].filter((word) => !earlierWords.has(word));
    if (newWords.length >= 2) {
      pushIssue(issues, makeIssue(
        "structure-note-conclusion-new-idea",
        last.start,
        Math.min(last.end, last.start + 90),
        text.slice(last.start, Math.min(last.end, last.start + 90)),
        "",
        "fluency",
        "low",
        "New idea in the conclusion",
        `What Draftwise noticed: the closing paragraph brings up ${newWords.slice(0, 2).map((word) => `“${word}”`).join(" and ")}, which appears nowhere earlier in the draft. Why it may matter: a conclusion that raises new material leaves the reader without a place to weigh it. Consider moving this point into the body, or closing instead by returning to what has already been argued.`,
        0.55,
        preferences,
      ));
    }
  }

  // 5. Weak transition: a paragraph opening on a bare connector or dangling
  //    "This…" after a paragraph about something else.
  for (let index = 1; index < paragraphs.length && issues.length < MAX_STRUCTURAL_NOTES; index += 1) {
    const paragraph = paragraphs[index];
    const first = paragraph.tokens[0];
    if (!first) continue;
    const opener = paragraph.text.slice(0, 40);
    const startsWithThis = /^this\s+[\p{L}]+/iu.test(opener);
    const startsWithConnector = /^(also|and|but|so|then)\b/iu.test(opener);
    if (!startsWithThis && !(startsWithConnector && formalRegister)) continue;
    const previousWords = contentWords(paragraphs[index - 1]);
    const currentWords = contentWords(paragraph);
    // A "This X" opener only misleads when X's topic is absent from the
    // previous paragraph: otherwise it is a perfectly good transition.
    const followWord = paragraph.tokens[1]?.lower ?? "";
    const bridging = previousWords.has(followWord) || jaccard(previousWords, currentWords) > 0.2;
    if (bridging) continue;
    pushIssue(issues, makeIssue(
      "structure-note-weak-transition",
      first.start,
      paragraph.tokens[Math.min(2, paragraph.tokens.length - 1)].end,
      text.slice(first.start, paragraph.tokens[Math.min(2, paragraph.tokens.length - 1)].end),
      "",
      "fluency",
      "low",
      "Abrupt transition",
      `What Draftwise noticed: “${opener.trim().split(/\s+/u).slice(0, 3).join(" ")}…” opens on a subject the previous paragraph never introduced. Why it may matter: the reader has to guess the connection instead of following it. Consider naming the link in the first few words — what this paragraph is reacting to, or how it relates to the one above.`,
      0.5,
      preferences,
    ));
  }

  return issues;
}
