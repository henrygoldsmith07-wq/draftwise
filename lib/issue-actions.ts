import type { WritingIssue } from "@/packages/types/src";

export function getOpenIssues(issues: WritingIssue[], dismissedIssueIds: Iterable<string>) {
  const dismissed = new Set(dismissedIssueIds);
  return issues.filter((issue) => !dismissed.has(issue.id));
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
