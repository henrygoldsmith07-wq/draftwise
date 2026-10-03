import { prioritiseSuggestions, ruleFamily } from "../packages/grammar/src/index.ts";
import type { DismissedFinding, PrioritiseResult } from "../packages/grammar/src/index.ts";
import { profileAdjustments } from "./writing-profile.ts";
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
  /** True when every member has the same replacement, so bulk apply is safe. */
  safeToApplyAll: boolean;
}

/**
 * Human phrasing for a repeated pattern. The writer should recognise the
 * problem from the label alone: "‘really’ appears 7 times", "Passive voice
 * appears in 5 passages", "Inconsistent terminology: ‘login’, ‘log in’".
 */
function groupLabelFor(representative: PrioritisedIssue, total: number, members: PrioritisedIssue[]): string {
  const word = representative.original.trim();
  if (representative.category === "passive voice") return `Passive voice appears in ${total} passage${total === 1 ? "" : "s"}`;
  if (representative.category === "consistency") {
    const variants = [...new Set(members.map((member) => member.original.trim()))].slice(0, 3);
    return `Inconsistent terminology: ${variants.map((variant) => `‘${variant}’`).join(", ")}`;
  }
  if (total === 1) return word.slice(0, 28);
  return `‘${word.slice(0, 24)}’ appears ${total} time${total === 1 ? "" : "s"}`;
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
  text?: string;
}): SuggestionState {
  const dismissed = args.dismissedKeys.flatMap((key) => {
    const entry = dismissalFromKey(key);
    return entry ? [entry] : [];
  });
  // The Writing Profile is transparent by construction: every adjustment it
  // applies names its reason, and dampened families are capped rather than hidden.
  const rankAdjustments = profileAdjustments(args.style);
  const result = prioritiseSuggestions(args.issues, {
    goals: args.goals,
    preferences: args.style,
    dismissed,
    ruleDismissalCounts: args.ruleDismissalCounts,
    rankAdjustments,
    text: args.text,
  });

  // Show each suggestion in its passage: the writer judges it in context, not
  // as an isolated span.
  const text = args.text ?? "";
  const withContext = result.displayed.map((issue) => {
    if (!text) return issue;
    const contextStart = Math.max(0, issue.start - 60);
    const contextEnd = Math.min(text.length, issue.end + 60);
    return {
      ...issue,
      context: `${contextStart > 0 ? "…" : ""}${text.slice(contextStart, contextEnd)}${contextEnd < text.length ? "…" : ""}`,
    };
  });

  const groups: SuggestionGroup[] = [];
  const seenGroups = new Map<string, SuggestionGroup>();
  for (const issue of withContext) {
    const key = `${issue.ruleId}:${issue.original.trim().toLocaleLowerCase()}`;
    const existing = seenGroups.get(key);
    if (existing) existing.members.push(issue);
    else {
      const group: SuggestionGroup = {
        key,
        representative: issue,
        members: [issue],
        label: "",
        safeToApplyAll: true,
      };
      seenGroups.set(key, group);
      groups.push(group);
    }
  }
  // Labels and bulk-safety need the full member list, so they are computed
  // after grouping. Bulk apply is only offered when every occurrence is the
  // same edit; context-dependent replacements are reviewed one at a time.
  for (const group of groups) {
    const total = group.members.reduce((count, member) => count + 1 + member.groupedCount, 0);
    group.label = groupLabelFor(group.representative, total, group.members);
    const replacements = new Set(group.members.map((member) => member.replacement));
    group.safeToApplyAll = group.members.every((member) => member.replacement.trim().length > 0 && member.replacement !== member.original)
      && replacements.size === 1;
  }

  const changesWorthMaking = withContext.filter((issue) => issue.tier === "fix-first" || issue.tier === "improve").length;
  return {
    displayed: withContext,
    suppressed: result.suppressed,
    report: result.report,
    focus: withContext[0] ?? null,
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
