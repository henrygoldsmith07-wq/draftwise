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

type AnchoredDismissal = {
  ruleId: unknown;
  original: unknown;
  replacement: unknown;
  before: string;
  after: string;
};

/**
 * Parse a stored dismissal key once and derive both dismissal identities from
 * that single parse.
 *
 * The previous implementation called JSON.parse once per issue x dismissal
 * pair (and copied the entire dismissal set for every issue) on every
 * keystroke. Deriving the identities up front keeps all parsing out of the hot
 * per-issue filter.
 */
function parseDismissalKey(key: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  // Semantic identity. Keys written before anchoring have 7 fields, current
  // keys have 9; the previous implementation accepted both.
  let semanticKey: string | null = null;
  if (parsed.length === 7 || parsed.length === 9) {
    const [, ruleId, , start, end, original, replacement] = parsed;
    if (Number.isSafeInteger(start)
      && Number.isSafeInteger(end)
      && typeof original === "string"
      && typeof replacement === "string") {
      semanticKey = JSON.stringify([ruleId, start, end, original, replacement]);
    }
  }

  // Anchored identity. Only full 9-field keys with string anchors can match.
  let anchored: AnchoredDismissal | null = null;
  if (parsed.length === 9) {
    const [, ruleId, , , , original, replacement, before, after] = parsed;
    if (typeof before === "string" && typeof after === "string") {
      anchored = { ruleId, original, replacement, before, after };
    }
  }

  return { semanticKey, anchored };
}

export function getOpenIssues(issues: WritingIssue[], dismissedIssueKeys: Iterable<string>, text?: string) {
  const dismissed = new Set(dismissedIssueKeys);
  const semanticallyDismissed = new Set<string>();
  // Anchored dismissals indexed by the fields that must match for the anchor
  // comparison to be relevant (rule id plus the exact original/replacement).
  // The filter can jump straight to this issue's candidates instead of
  // scanning and re-parsing every dismissal on every keystroke.
  const anchoredByKey = new Map<string, AnchoredDismissal[]>();
  for (const key of dismissed) {
    const parsed = parseDismissalKey(key);
    if (parsed === null) continue;
    if (parsed.semanticKey !== null) semanticallyDismissed.add(parsed.semanticKey);
    if (parsed.anchored !== null) {
      const indexKey = JSON.stringify([parsed.anchored.ruleId, parsed.anchored.original, parsed.anchored.replacement]);
      const bucket = anchoredByKey.get(indexKey);
      if (bucket) bucket.push(parsed.anchored);
      else anchoredByKey.set(indexKey, [parsed.anchored]);
    }
  }

  return issues.filter((issue) => {
    if (dismissed.has(getIssueDismissalKey(issue))) return false;
    if (semanticallyDismissed.has(getSemanticDismissalKey(issue))) return false;
    if (text === undefined) return true;

    // Anchored match. An exact key match fails as soon as anything above the
    // finding changes length, because the id carries the offsets. Without
    // this, rewriting a paragraph at the top of a long draft brought back
    // every suggestion the writer had already dismissed below it.
    const candidates = anchoredByKey.get(JSON.stringify([issue.ruleId, issue.original, issue.replacement]));
    if (candidates === undefined) return true;
    const live = issueAnchors(text, issue);
    for (const entry of candidates) {
      // Keep the old strict comparisons verbatim; the index only narrows the
      // candidates, so edge/malformed values behave exactly as before.
      if (entry.ruleId !== issue.ruleId
        || entry.original !== issue.original
        || entry.replacement !== issue.replacement) continue;
      if (live.before.endsWith(entry.before) && live.after.startsWith(entry.after)) return false;
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
