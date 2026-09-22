export interface ReviewIssue {
  id: string;
  start: number;
  end: number;
  original: string;
  replacement?: string | null;
}

export function getOpenIssues<T extends { id: string }>(
  issues: readonly T[],
  dismissedIssueIds: readonly string[],
): T[] {
  if (!dismissedIssueIds.length) return [...issues];
  const dismissed = new Set(dismissedIssueIds);
  return issues.filter((issue) => !dismissed.has(issue.id));
}

export function applyIssueReplacements(
  draft: string,
  issues: readonly ReviewIssue[],
): { text: string; appliedIssueIds: string[] } {
  const actionable = issues
    .filter((issue) => Boolean(issue.replacement) && issue.replacement !== issue.original)
    .sort((a, b) => b.start - a.start || b.end - a.end);

  let text = draft;
  const appliedIssueIds: string[] = [];

  for (const issue of actionable) {
    if (text.slice(issue.start, issue.end) !== issue.original) continue;
    text = `${text.slice(0, issue.start)}${issue.replacement ?? ""}${text.slice(issue.end)}`;
    appliedIssueIds.push(issue.id);
  }

  return { text, appliedIssueIds };
}
