import type { WritingIssue } from "@/packages/types/src";

export function getIssueDismissalKey(issue: WritingIssue) {
  return JSON.stringify([issue.id, issue.source, issue.original, issue.replacement]);
}

export function getOpenIssues(issues: WritingIssue[], dismissedIssueKeys: Iterable<string>) {
  const dismissed = new Set(dismissedIssueKeys);
  return issues.filter((issue) => !dismissed.has(getIssueDismissalKey(issue)));
}

function hasValidIssueRange(text: string, issue: WritingIssue) {
  return typeof issue.original === "string"
    && typeof issue.replacement === "string"
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
  let furthest = ordered[0];

  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    const competingInsertions = current.issue.start === current.issue.end
      && furthest.issue.start === furthest.issue.end
      && current.issue.start === furthest.issue.start;
    if (current.issue.start < furthest.issue.end || competingInsertions) {
      conflicting.add(current.index);
      conflicting.add(furthest.index);
    }
    if (current.issue.end > furthest.issue.end) furthest = current;
  }

  return issues.filter((_, index) => !conflicting.has(index));
}

export function applyIssueReplacements(text: string, issues: WritingIssue[]) {
  const candidates = issues.filter(
    (issue) => hasValidIssueRange(text, issue) && issue.replacement.length > 0 && issue.replacement !== issue.original,
  );
  const actionable = withoutOverlappingRanges(withoutDuplicateEdits(candidates))
    .sort((left, right) => right.start - left.start || right.end - left.end);

  let next = text;
  for (const issue of actionable) {
    if (!hasValidIssueRange(next, issue) || issue.replacement.length === 0 || next.slice(issue.start, issue.end) !== issue.original) continue;
    next = `${next.slice(0, issue.start)}${issue.replacement}${next.slice(issue.end)}`;
  }
  return next;
}
