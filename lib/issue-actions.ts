import type { WritingIssue } from "@/packages/types/src";

/**
 * How much draft text either side of a finding is kept to recognise it later.
 *
 * Long enough to be distinctive, short enough that an ordinary edit elsewhere
 * in the paragraph does not break the anchor.
 */
export const DISMISSAL_ANCHOR_CHARS = 48;

export function issueAnchors(text: string, issue: WritingIssue) {
  return {
    before: text.slice(Math.max(0, issue.start - DISMISSAL_ANCHOR_CHARS), issue.start),
    after: text.slice(issue.end, Math.min(text.length, issue.end + DISMISSAL_ANCHOR_CHARS)),
  };
}

export function getIssueDismissalKey(issue: WritingIssue, text?: string) {
  const anchors = text === undefined ? null : issueAnchors(text, issue);
  return JSON.stringify([
    issue.id,
    issue.ruleId,
    issue.source,
    issue.start,
    issue.end,
    issue.original,
    issue.replacement,
    anchors?.before ?? null,
    anchors?.after ?? null,
  ]);
}

function getSemanticDismissalKey(issue: WritingIssue) {
  return JSON.stringify([
    issue.ruleId,
    issue.start,
    issue.end,
    issue.original,
    issue.replacement,
  ]);
}

function getSemanticDismissalKeyFromStoredKey(key: string) {
  try {
    const parsed = JSON.parse(key);
    if (!Array.isArray(parsed) || (parsed.length !== 7 && parsed.length !== 9)) return null;
    const [, ruleId, , start, end, original, replacement] = parsed;
    if (!Number.isSafeInteger(start)
      || !Number.isSafeInteger(end)
      || typeof original !== "string"
      || typeof replacement !== "string") return null;
    return JSON.stringify([ruleId, start, end, original, replacement]);
  } catch {
    return null;
  }
}

export function getOpenIssues(issues: WritingIssue[], dismissedIssueKeys: Iterable<string>, text?: string) {
  const dismissed = new Set(dismissedIssueKeys);
  const semanticallyDismissed = new Set<string>();
  for (const key of dismissed) {
    const semanticKey = getSemanticDismissalKeyFromStoredKey(key);
    if (semanticKey !== null) semanticallyDismissed.add(semanticKey);
  }
  return issues.filter((issue) => !dismissed.has(getIssueDismissalKey(issue))
    && !semanticallyDismissed.has(getSemanticDismissalKey(issue))
    // Anchored match. An exact key match fails as soon as anything above the
    // finding changes length, because the id carries the offsets. Without
    // this, rewriting a paragraph at the top of a long draft brought back
    // every suggestion the writer had already dismissed below it.
    && ![...dismissed].some((key) => isSameDismissal(key, issue, text)));
}

function isSameDismissal(key: string, issue: WritingIssue, text?: string) {
  if (text === undefined) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed) || parsed.length !== 9) return false;
  const [, ruleId, , , , original, replacement, before, after] = parsed;
  if (ruleId !== issue.ruleId || original !== issue.original || replacement !== issue.replacement) return false;
  if (typeof before !== "string" || typeof after !== "string") return false;
  const live = issueAnchors(text, issue);
  return live.before.endsWith(before) && live.after.startsWith(after);
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
