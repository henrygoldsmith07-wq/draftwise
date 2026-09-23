import type { WritingIssue } from "@/packages/types/src";

export function getIssueDismissalKey(issue: WritingIssue) {
  return `${issue.id}:${issue.source}:${issue.original}:${issue.replacement}`;
}

export function getOpenIssues(issues: WritingIssue[], dismissedIssueKeys: Iterable<string>) {
  const dismissed = new Set(dismissedIssueKeys);
  return issues.filter((issue) => !dismissed.has(getIssueDismissalKey(issue)));
}

export function applyIssueReplacements(text: string, issues: WritingIssue[]) {
  const actionable = [...issues]
    .filter((issue) => issue.replacement && issue.replacement !== issue.original)
    .sort((left, right) => right.start - left.start || right.end - left.end);

  let next = text;
  for (const issue of actionable) {
    if (!issue.replacement || next.slice(issue.start, issue.end) !== issue.original) continue;
    next = `${next.slice(0, issue.start)}${issue.replacement}${next.slice(issue.end)}`;
  }
  return next;
}
