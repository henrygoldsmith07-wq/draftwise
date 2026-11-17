import type { WritingIssue } from "@/packages/types/src";
import { anchorMatches, fingerprintText } from "../packages/grammar/src/index.ts";
import {
  DISMISSAL_ANCHOR_CHARS,
  decodeDismissalKey,
  encodeDismissalKey,
  issueAnchors,
  semanticKeyForIssue,
  semanticKeyFromDismissal,
} from "./dismissal-key.ts";

export { DISMISSAL_ANCHOR_CHARS, issueAnchors };

export function getIssueDismissalKey(issue: WritingIssue, text?: string) {
  return encodeDismissalKey(issue, text);
}

function getSemanticDismissalKeyFromStoredKey(key: string) {
  return semanticKeyFromDismissal(key);
}

export function getOpenIssues(issues: WritingIssue[], dismissedIssueKeys: Iterable<string>, text?: string) {
  const dismissed = new Set(dismissedIssueKeys);
  const semanticallyDismissed = new Set<string>();
  for (const key of dismissed) {
    const semanticKey = getSemanticDismissalKeyFromStoredKey(key);
    if (semanticKey !== null) semanticallyDismissed.add(semanticKey);
  }
  return issues.filter((issue) => !dismissed.has(getIssueDismissalKey(issue))
    && !semanticallyDismissed.has(semanticKeyForIssue(issue))
    // Anchored match. An exact key match fails as soon as anything above the
    // finding changes length, because the id carries the offsets. Without
    // this, rewriting a paragraph at the top of a long draft brought back
    // every suggestion the writer had already dismissed below it.
    && ![...dismissed].some((key) => isSameDismissal(key, issue, text)));
}

function isSameDismissal(key: string, issue: WritingIssue, text?: string) {
  if (text === undefined) return false;
  const parsed = decodeDismissalKey(key);
  if (!parsed || parsed.ruleId !== issue.ruleId || parsed.before === undefined || parsed.after === undefined) return false;

  const sameText = parsed.originalFingerprint
    ? parsed.originalFingerprint === fingerprintText(issue.original)
    : parsed.original === issue.original;
  const sameReplacement = parsed.replacementFingerprint
    ? parsed.replacementFingerprint === fingerprintText(issue.replacement)
    : parsed.replacement === issue.replacement;
  if (!sameText || !sameReplacement) return false;

  const live = issueAnchors(text, issue);
  return anchorMatches(live.before, parsed.before, "before")
    && anchorMatches(live.after, parsed.after, "after");
}

export function hasActionableReplacement(issue: WritingIssue) {
  return typeof issue.original === "string"
    && typeof issue.replacement === "string"
    && issue.replacement !== issue.original;
}

function hasValidIssueRange(text: string, issue: WritingIssue) {
  return hasActionableReplacement(issue)
    && Number.isSafeInteger(issue.start)
    && Number.isSafeInteger(issue.end)
    && issue.start >= 0
    && issue.end >= issue.start
    && issue.end <= text.length
    && issue.end - issue.start === issue.original.length;
}

function withoutDuplicateEdits(issues: WritingIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify([issue.start, issue.end, issue.original, issue.replacement]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withoutOverlappingRanges(issues: WritingIssue[]) {
  if (issues.length < 2) return issues;

  const ordered = issues
    .map((issue, index) => ({ issue, index }))
    .sort((left, right) => left.issue.start - right.issue.start || right.issue.end - left.issue.end);
  const conflicting = new Set<number>();
  const insertionAt = new Map<number, number>();
  let furthest = ordered[0];

  for (const entry of ordered) {
    if (entry.issue.start === entry.issue.end) {
      const previousInsertion = insertionAt.get(entry.issue.start);
      if (previousInsertion !== undefined) {
        conflicting.add(previousInsertion);
        conflicting.add(entry.index);
      } else {
        insertionAt.set(entry.issue.start, entry.index);
      }
    }
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    if (current.issue.start < furthest.issue.end) {
      conflicting.add(current.index);
      conflicting.add(furthest.index);
    }
    if (current.issue.end > furthest.issue.end) furthest = current;
  }

  return issues.filter((_, index) => !conflicting.has(index));
}

export function applyIssueReplacements(text: string, issues: WritingIssue[]) {
  const candidates = issues.filter((issue) => hasValidIssueRange(text, issue));
  const actionable = withoutOverlappingRanges(withoutDuplicateEdits(candidates))
    .sort((left, right) => right.start - left.start || right.end - left.end);

  let next = text;
  for (const issue of actionable) {
    if (!hasValidIssueRange(next, issue) || next.slice(issue.start, issue.end) !== issue.original) continue;
    next = `${next.slice(0, issue.start)}${issue.replacement}${next.slice(issue.end)}`;
  }
  return next;
}
