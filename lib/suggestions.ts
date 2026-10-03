import { prioritiseSuggestions, ruleFamily } from "../packages/grammar/src/index.ts";
import type { DismissedFinding, PrioritiseResult } from "../packages/grammar/src/index.ts";
import type { PrioritisedIssue, StylePreferences, SuggestionTier, WritingGoals, WritingIssue } from "../packages/types/src/index.ts";

export { ruleFamily };

export interface SuggestionState {
  displayed: PrioritisedIssue[];
  suppressed: PrioritiseResult["suppressed"];
  report: PrioritiseResult["report"];
  /** The current review target: the highest-impact suggestion not yet handled. */
  focus: PrioritisedIssue | null;
  /** How many changes are worth making: fix-first plus improve tiers. */
  changesWorthMaking: number;
  groups: SuggestionGroup[];
}

export interface SuggestionGroup {
  key: string;
  representative: PrioritisedIssue;
  members: PrioritisedIssue[];
  label: string;
}

export type TierFilter = SuggestionTier | "all";

const TIER_ORDER: Record<SuggestionTier, number> = { "fix-first": 0, improve: 1, optional: 2 };

function dismissalFromKey(key: string): DismissedFinding | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed) || parsed.length !== 7) return null;
    const [, ruleId, , start, end, original] = parsed;
    if (typeof ruleId !== "string" || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || typeof original !== "string") return null;
    return { ruleId, start: start as number, end: end as number, original };
  } catch {
    return null;
  }
}

/**
 * The single place where detected findings become what the writer sees.
 * Raw issues stay intact for evaluation and the extension; the sidebar consumes
 * only this ranked, context-filtered result.
 */
export function buildSuggestionState(args: {
  issues: WritingIssue[];
  goals: WritingGoals;
  style: StylePreferences;
  dismissedKeys: string[];
  ruleDismissalCounts?: Record<string, number>;
}): SuggestionState {
  const dismissed = args.dismissedKeys.flatMap((key) => {
    const entry = dismissalFromKey(key);
    return entry ? [entry] : [];
  });
  const result = prioritiseSuggestions(args.issues, {
    goals: args.goals,
    preferences: args.style,
    dismissed,
    ruleDismissalCounts: args.ruleDismissalCounts,
  });

  const groups: SuggestionGroup[] = [];
  const seenGroups = new Map<string, SuggestionGroup>();
  for (const issue of result.displayed) {
    const key = `${issue.ruleId}:${issue.original.trim().toLocaleLowerCase()}`;
    const existing = seenGroups.get(key);
    if (existing) existing.members.push(issue);
    else {
      const group: SuggestionGroup = {
        key,
        representative: issue,
        members: [issue],
        label: issue.groupedCount > 0
          ? `${issue.groupedCount + 1} × ${issue.original.trim()}`
          : issue.original.trim().slice(0, 28),
      };
      seenGroups.set(key, group);
      groups.push(group);
    }
  }

  const changesWorthMaking = result.displayed.filter((issue) => issue.tier === "fix-first" || issue.tier === "improve").length;
  return {
    displayed: result.displayed,
    suppressed: result.suppressed,
    report: result.report,
    focus: result.displayed[0] ?? null,
    changesWorthMaking,
    groups,
  };
}

export function filterByTier(issues: PrioritisedIssue[], filter: TierFilter) {
  if (filter === "all") return issues;
  return issues.filter((issue) => issue.tier === filter);
}

export function sortForReview(issues: PrioritisedIssue[]) {
  return [...issues].sort((left, right) => TIER_ORDER[left.tier] - TIER_ORDER[right.tier] || right.rank - left.rank || left.start - right.start);
}

export const TIER_LABELS: Record<SuggestionTier, string> = {
  "fix-first": "Fix first",
  improve: "Improve",
  optional: "Optional",
};

export const TIER_DESCRIPTIONS: Record<SuggestionTier, string> = {
  "fix-first": "High-confidence problems likely to be genuine mistakes or meaning issues.",
  improve: "Useful clarity, conciseness and readability changes.",
  optional: "Stylistic preferences — useful only if they match your intent.",
};
