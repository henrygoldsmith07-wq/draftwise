import type {
  WritingGoals,
  WritingIssue,
} from "../../types/src/index.js";
import {
  analysisNow,
  createAnalysisDiagnostics,
} from "./diagnostics.ts";
import {
  findCapitalization,
  findConfusedWords,
  findPunctuation,
  findPrecisionGrammarIssues,
} from "./grammar.ts";
import { mergeAnalysisIssues } from "../../analysis/src/index.ts";
import {
  analyzeDocument,
} from "./parser.ts";
import {
  mergePreferences,
  type GrammarOptions,
} from "./preferences.ts";
import {
  scoreWriting,
} from "./scoring.ts";
import {
  findSpelling,
} from "./spelling.ts";
import {
  getWritingStats,
  inferTone,
} from "./statistics.ts";
import {
  findRepeatedWordsAndPhrases,
  findStructureIssues,
  findStickySentences,
  findStyleIssues,
} from "./style.ts";
import {
  findDocumentStructure,
  findGoalTerminology,
} from "./structure.ts";
import {
  findConsistencyIssues,
} from "./consistency.ts";
import {
  findProtectedSpans,
  isInsideProtectedSpan,
  isStructuredLineStart,
} from "./markdown.ts";
import {
  createIssueId,
} from "./util.ts";

export function mergeWritingIssues(issues: WritingIssue[]): WritingIssue[] {
  // Callers merge retained history with recalculated findings, and a document
  // with no previous analysis legitimately produces an empty or absent list.
  // Returning [] keeps a missing input from throwing inside the merge.
  return Array.isArray(issues) ? mergeAnalysisIssues(issues) : [];
}

export function analyzeLocally(text: string, options: GrammarOptions = {}, goals?: WritingGoals) {
  const startedAt = analysisNow();
  const preferences = mergePreferences(options);
  const document = analyzeDocument(text);
  // Markdown-aware: code fences, inline code and URLs are machine text that
  // prose rules must not touch, and list items are structured content.
  const protectedSpans = findProtectedSpans(text);
  const rawIssues = mergeWritingIssues([
    ...findSpelling(text, preferences, document),
    ...findConfusedWords(text, preferences),
    ...findPrecisionGrammarIssues(text, preferences, document),
    ...findPunctuation(text, preferences),
    ...findCapitalization(text, preferences),
    ...findRepeatedWordsAndPhrases(text, preferences, document),
    ...findStyleIssues(text, preferences, document),
    ...findStickySentences(document, preferences),
    ...findStructureIssues(text, preferences, document),
    ...findDocumentStructure(text, preferences, goals, document),
    ...findGoalTerminology(text, goals, preferences, document),
    // Runs last: it needs the whole document to tell a consistent choice from a
    // drifting one, and it never overlaps a span an earlier rule already claimed.
    ...findConsistencyIssues(text, preferences, document),
  ]);
  const issues = rawIssues.filter((issue) => {
    if (isInsideProtectedSpan(protectedSpans, issue.start, issue.end)) return false;
    // Fragment and terminal-punctuation advice does not apply to bullets,
    // numbered steps or blockquotes: those are structured, not prose sentences.
    if (issue.ruleId === "structure-fragment" || issue.ruleId === "punctuation-missing-terminal") {
      return !isStructuredLineStart(text, issue.start);
    }
    return true;
  });
  const stats = getWritingStats(text, document);
  const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "local");
  return { issues, tone: inferTone(text, document), stats, scores: scoreWriting(stats, issues, goals, text, document), ...(diagnostics ? { diagnostics } : {}) };
}

function expandLocalContext(text: string, start: number, end: number, contextWindow = 320) {
  const roughStart = Math.max(0, start - contextWindow);
  const roughEnd = Math.min(text.length, end + contextWindow);
  // Find the sentence break that opens the re-analysed region.
  //
  // When the window holds no break, the old fallback was `start - 320`, which
  // lands mid-word. A region that begins mid-sentence makes every `^`-anchored
  // rule fire on the slice boundary: a one-sentence draft produced a spurious
  // "n" -> "N" on the "n" inside "and", at an offset that pointed nowhere.
  //
  // So widen the search rather than trusting the window. A region that starts
  // at a real sentence boundary is the only start where `^` means anything.
  const prefix = text.slice(0, Math.max(roughStart, start));
  const leftMatches = [...text.slice(0, roughStart).matchAll(/(?:[.!?…]\s+|\n\s*)/gu)];
  const left = leftMatches[leftMatches.length - 1];
  const safeStart = left && left.index !== undefined
    ? left.index + left[0].length
    : lastSentenceBreak(prefix);
  const right = text.slice(roughEnd).match(/[.!?…](?:\s|$)|\n\s*/u);
  const safeEnd = right?.index !== undefined ? roughEnd + right.index + right[0].length : roughEnd;
  return { start: Math.min(safeStart, start), end: Math.max(Math.min(text.length, safeEnd), end) };
}

/** Offset just past the last sentence break in `prefix`, or 0 when there is none. */
function lastSentenceBreak(prefix: string) {
  const matches = [...prefix.matchAll(/(?:[.!?…]\s+|\n\s*)/gu)];
  const last = matches[matches.length - 1];
  return last && last.index !== undefined ? last.index + last[0].length : 0;
}

export function detectChangedRange(previousText: string, nextText: string) {
  if (previousText === nextText) return null;
  let start = 0;
  while (start < previousText.length && start < nextText.length && previousText.charCodeAt(start) === nextText.charCodeAt(start)) start += 1;
  let previousEnd = previousText.length;
  let end = nextText.length;
  while (previousEnd > start && end > start && previousText.charCodeAt(previousEnd - 1) === nextText.charCodeAt(end - 1)) {
    previousEnd -= 1;
    end -= 1;
  }
  return { start, end, previousEnd };
}

export function analyzeLocallyIncremental(
  previousText: string,
  nextText: string,
  previousIssues: WritingIssue[],
  changedRange: { start: number; end: number; previousEnd: number } | null,
  options: GrammarOptions = {},
  goals?: WritingGoals,
) {
  if (!changedRange || previousText === nextText) return analyzeLocally(nextText, options, goals);
  const startedAt = analysisNow();
  const previousRegion = expandLocalContext(previousText, changedRange.start, changedRange.previousEnd);
  const nextRegion = expandLocalContext(nextText, changedRange.start, changedRange.end);
  const delta = nextText.length - previousText.length;
  const region = analyzeLocally(nextText.slice(nextRegion.start, nextRegion.end), options, goals);
  const recalculated = region.issues.map((issue) => ({
    ...issue,
    id: createIssueId(issue.ruleId, issue.start + nextRegion.start, issue.end + nextRegion.start, issue.original),
    start: issue.start + nextRegion.start,
    end: issue.end + nextRegion.start,
  }));
  // Anything the region re-derived is already accounted for.
  const rederived = new Set(recalculated.map((issue) => `${issue.ruleId}\u0000${issue.original.toLowerCase()}`));
  const retained = previousIssues.filter((issue) => issue.source === "local").flatMap((issue) => {
    // An issue overlapping the region was assumed to be re-derived there. It is
    // not always: a long sentence that starts well before the region cannot be
    // seen from a slice that begins later, so dropping it lost a real finding.
    // Keep the candidate and let the set above decide.
    const overlapsRegion = issue.start < previousRegion.end && issue.end > previousRegion.start;
    if (overlapsRegion && rederived.has(`${issue.ruleId}\u0000${issue.original.toLowerCase()}`)) return [];
    const shift = issue.start >= previousRegion.end ? delta : 0;
    const start = issue.start + shift;
    const end = issue.end + shift;
    return start >= 0 && end <= nextText.length && nextText.slice(start, end) === issue.original
      ? [{ ...issue, id: createIssueId(issue.ruleId, start, end, issue.original), start, end }]
      : [];
  });
  const issues = mergeWritingIssues([...retained, ...recalculated]);
  const document = analyzeDocument(nextText);
  const stats = getWritingStats(nextText, document);
  const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "incremental");
  return { issues, tone: inferTone(nextText, document), stats, scores: scoreWriting(stats, issues, goals, nextText, document), ...(diagnostics ? { diagnostics } : {}) };
}
// Public surface preserved for the web app, the extension bundle, and the test suite.
export { WORD_PATTERN, analyzeDocument, parseDocument } from "./parser.ts";
export { categoryColors, scoreWriting } from "./scoring.ts";
export { getWritingStats, inferTone } from "./statistics.ts";
export { suggestSpelling } from "./spelling.ts";
export { createAnalysisDiagnostics } from "./diagnostics.ts";
export { SUGGESTION_DENSITY_CAPS, SUGGESTION_DENSITY_PER_THOUSAND_WORDS, SUPPRESSION_REASONS, classifyIssueKind, densityCapsFor, describeSuppression, prioritiseSuggestions, ruleFamily } from "./prioritise.ts";
export type { DismissedFinding, PrioritiseOptions, PrioritiseResult } from "./prioritise.ts";
export type { GrammarOptions } from "./preferences.ts";
// Document-level reasoning: an outline, themes, and editorial notes that scale
// with the draft. Entirely local - no provider, no network.
// NOTE: every re-export here must stay on a single line. The extension bundler
// strips re-exports with a line-anchored regex, so a multi-line `export type {`
// survives partially and emits a dangling CommonJS `exports` reference into the
// generated browser bundle.
export { buildDocumentOutline, summariseDocument } from "./outline.ts";
export type { DocumentNote, DocumentOutline, DocumentOutlineOptions, DocumentSection, SectionRole } from "./outline.ts";
// Goal-aware, contextual explanation. Local and deterministic.
export { buildAction, buildExplanation, explainRanking, explainRelevance } from "./explain.ts";
export type { ContextualExplanation } from "./explain.ts";
// Document-wide consistency: only flags a form the writer used less often, and
// only when the document actually mixes variants.
export { findConsistencyIssues } from "./consistency.ts";
