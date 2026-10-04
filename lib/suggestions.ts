import { prioritiseSuggestions, ruleFamily } from "../packages/grammar/src/index.ts";
import type { DismissedFinding, PrioritiseResult } from "../packages/grammar/src/index.ts";
import { issueAnchors } from "./issue-actions.ts";
import { profileAdjustments } from "./writing-profile.ts";
import type { PrioritisedIssue, StylePreferences, SuggestionTier, WritingGoals, WritingIssue, IssueCategory } from "../packages/types/src/index.ts";

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

/** How far out to look for a sentence boundary when building passage context. */
const CONTEXT_CHARS = 160;
const SENTENCE_END = /[.!?…]["'”)]?(\s|$)/u;

interface ContextEdge {
  offset: number;
  /** False when no boundary was reachable and the text is cut mid-sentence. */
  complete: boolean;
}

/** Start of the last whole sentence at or before `offset`. */
function sentenceEdgeBackwards(text: string, offset: number, limit: number): ContextEdge {
  const from = Math.max(0, offset - limit);
  if (from === 0) return { offset: 0, complete: true };
  const match = [...text.slice(from, offset).matchAll(/[.!?…]["'”)]?(\s|$)/gu)].pop();
  if (!match || match.index === undefined) return { offset: from, complete: false };
  return { offset: from + match.index + match[0].length, complete: true };
}

/** End of the first whole sentence at or after `offset`. */
function sentenceEdgeForwards(text: string, offset: number, limit: number): ContextEdge {
  const end = Math.min(text.length, offset + limit);
  if (end === text.length) return { offset: end, complete: true };
  const match = SENTENCE_END.exec(text.slice(offset, end));
  return match ? { offset: offset + match.index + match[0].length, complete: true } : { offset: end, complete: false };
}

function dismissalFromKey(key: string): DismissedFinding | null {
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed) || (parsed.length !== 7 && parsed.length !== 9)) return null;
    const [, ruleId, , start, end, original, , before, after] = parsed;
    if (typeof ruleId !== "string" || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || typeof original !== "string") return null;
    return {
      ruleId,
      start: start as number,
      end: end as number,
      original,
      // Keys written before anchoring was added carry no anchors; those
      // dismissals fall back to matching by position.
      ...(typeof before === "string" && typeof after === "string" ? { before, after } : {}),
    };
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
    anchorFor: args.text === undefined ? undefined : (issue) => issueAnchors(args.text as string, issue),
  });

  // Show each suggestion in its passage: the writer judges it in context, not
  // as an isolated span.
  //
  // The window snaps out to the nearest sentence boundary instead of stopping
  // at a fixed character count. A fixed cut lands mid-clause often enough to
  // be unreadable, and the ellipsis in front of it said nothing about what was
  // missing. When no boundary is reachable the window stays short and is
  // marked, because a partial clause is worse than a shorter whole one.
  const text = args.text ?? "";
  const withContext = result.displayed.map((issue) => {
    if (!text) return issue;
    const before = sentenceEdgeBackwards(text, issue.start, CONTEXT_CHARS);
    const after = sentenceEdgeForwards(text, issue.end, CONTEXT_CHARS);
    return {
      ...issue,
      context: `${before.complete ? "" : "…"}${text.slice(before.offset, after.offset)}${after.complete ? "" : "…"}`,
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

export type CategoryFilter = IssueCategory | "all" | "grammar" | "style";

const MECHANICAL: IssueCategory[] = ["grammar", "spelling", "punctuation", "capitalization"];

/**
 * Narrow the list by what kind of problem it is, as well as how urgent.
 *
 * Tier answers "what should I deal with first"; category answers "I want to
 * see everything about wording and nothing else". On a long draft the tier
 * alone mixes a hundred mechanical slips with every editorial note, and
 * neither tab can separate them. Both filters compose, so a writer can ask for
 * the terminology that is also worth fixing.
 */
export function categoryMatches(issue: WritingIssue, filter: CategoryFilter) {
  if (filter === "all") return true;
  if (filter === "grammar") return MECHANICAL.includes(issue.category);
  if (filter === "style") return !MECHANICAL.includes(issue.category);
  return issue.category === filter;
}

export function filterByCategory(issues: PrioritisedIssue[], filter: CategoryFilter) {
  if (filter === "all") return issues;
  return issues.filter((issue) => categoryMatches(issue, filter));
}

/**
 * Categories worth offering as a filter, largest first.
 *
 * Only categories that actually have findings are offered: a row of filters
 * with most of them empty is noise, and on a short draft it is all noise.
 */
export function filterableCategories(report: PrioritiseResult["report"], limit = 6): Array<{ value: CategoryFilter; label: string; count: number }> {
  const entries = Object.entries(report.byCategory ?? {}) as Array<[IssueCategory, number]>;
  return entries
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([category, count]) => ({ value: category, label: category, count }));
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
