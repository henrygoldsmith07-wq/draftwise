import type { WritingIssue } from "@/packages/types/src";
import { anchorMatches, fingerprintText } from "../packages/grammar/src/index.ts";
import {
  DISMISSAL_ANCHOR_CHARS,
  decodeDismissalKey,
  encodeDismissalKey,
  issueAnchors,
  semanticKeyForIssue,
  type ParsedDismissalKey,
} from "./dismissal-key.ts";

export { DISMISSAL_ANCHOR_CHARS, issueAnchors };

export function getIssueDismissalKey(issue: WritingIssue, text?: string) {
  return encodeDismissalKey(issue, text);
}

/**
 * Anchored match for a dismissal key that has already been decoded once, before
 * the per-issue filter. The remote refactor moved anchors into
 * `packages/grammar/src/dismissal-anchor.ts` (fingerprinted d2 keys); this uses
 * that module's `anchorMatches`/`fingerprintText` helpers instead of HEAD's
 * hand-rolled raw-string comparisons, so legacy (7/9-field) and d2 keys both
 * match. It is remote's `isSameDismissal`, changed to take the already-decoded
 * key so JSON.parse never runs inside the filter.
 */
function isSameDismissal(parsed: ParsedDismissalKey, issue: WritingIssue, live: ReturnType<typeof issueAnchors>) {
  if (parsed.ruleId !== issue.ruleId || parsed.before === undefined || parsed.after === undefined) return false;

  const sameText = parsed.originalFingerprint
    ? parsed.originalFingerprint === fingerprintText(issue.original)
    : parsed.original === issue.original;
  const sameReplacement = parsed.replacementFingerprint
    ? parsed.replacementFingerprint === fingerprintText(issue.replacement)
    : parsed.replacement === issue.replacement;
  if (!sameText || !sameReplacement) return false;

  return anchorMatches(live.before, parsed.before, "before")
    && anchorMatches(live.after, parsed.after, "after");
}

export function getOpenIssues(issues: WritingIssue[], dismissedIssueKeys: Iterable<string>, text?: string) {
  const dismissed = new Set(dismissedIssueKeys);
  const semanticallyDismissed = new Set<string>();
  // Anchored dismissals indexed by rule + text/replacement identity, so the
  // filter jumps straight to this issue's candidates instead of scanning and
  // re-parsing every dismissal on every keystroke (HEAD's indexed optimisation).
  const anchoredByKey = new Map<string, ParsedDismissalKey[]>();
  for (const key of dismissed) {
    // Decode each stored key exactly once, up front — never inside the filter.
    // The d2 decoder in `dismissal-key.ts` replaces HEAD's hand-rolled 7/9-field
    // JSON parsing, so fingerprinted keys are understood too.
    const parsed = decodeDismissalKey(key);
    if (parsed === null) continue;

    const originalFingerprint = parsed.originalFingerprint
      ?? (parsed.original === undefined ? null : fingerprintText(parsed.original));
    const replacementFingerprint = parsed.replacementFingerprint
      ?? (parsed.replacement === undefined ? null : fingerprintText(parsed.replacement));

    // Semantic identity: identical to semanticKeyFromDismissal(key) but derived
    // from the single decode above rather than parsing the JSON a second time.
    if (originalFingerprint !== null && replacementFingerprint !== null) {
      semanticallyDismissed.add(JSON.stringify([parsed.ruleId, parsed.start, parsed.end, originalFingerprint, replacementFingerprint]));

      if (parsed.before !== undefined && parsed.after !== undefined) {
        const indexKey = JSON.stringify([parsed.ruleId, originalFingerprint, replacementFingerprint]);
        const bucket = anchoredByKey.get(indexKey);
        if (bucket) bucket.push(parsed);
        else anchoredByKey.set(indexKey, [parsed]);
      }
    }
  }

  return issues.filter((issue) => {
    if (dismissed.has(getIssueDismissalKey(issue))) return false;
    if (semanticallyDismissed.has(semanticKeyForIssue(issue))) return false;
    if (text === undefined) return true;

    // Anchored match. An exact key match fails as soon as anything above the
    // finding changes length, because the id carries the offsets. Without
    // this, rewriting a paragraph at the top of a long draft brought back
    // every suggestion the writer had already dismissed below it.
    const candidates = anchoredByKey.get(JSON.stringify([
      issue.ruleId,
      fingerprintText(issue.original),
      fingerprintText(issue.replacement),
    ]));
    if (candidates === undefined) return true;
    const live = issueAnchors(text, issue);
    for (const parsed of candidates) {
      if (isSameDismissal(parsed, issue, live)) return false;
    }
    return true;
  });
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
