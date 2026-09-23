import type { WritingIssue } from "@/packages/types/src";

export function getIssueDismissalKey(issue: WritingIssue) {
  return `${issue.id}:${issue.source}:${issue.original}:${issue.replacement}`;
}

export function getOpenIssues(issues: WritingIssue[], dismissedIssueKeys: Iterable<string>) {
  const dismissed = new Set(dismissedIssueKeys);
  return issues.filter((issue) => !dismissed.has(getIssueDismissalKey(issue)));
}

function hasValidIssueRange(text: string, issue: WritingIssue) {
  return Number.isSafeInteger(issue.start)
    && Number.isSafeInteger(issue.end)
    && issue.start >= 0
    && issue.end >= issue.start
    && issue.end <= text.length
    && issue.end - issue.start === issue.original.length;
}

export function applyIssueReplacements(text: string, issues: WritingIssue[]) {
  const actionable = [...issues]
    .filter((issue) => issue.replacement && issue.replacement !== issue.original && hasValidIssueRange(text, issue))
    .sort((left, right) => right.start - left.start || right.end - left.end);

  let next = text;
  for (const issue of actionable) {
    if (!issue.replacement || !hasValidIssueRange(next, issue) || next.slice(issue.start, issue.end) !== issue.original) continue;
    next = `${next.slice(0, issue.start)}${issue.replacement}${next.slice(issue.end)}`;
  }
  return next;
}
