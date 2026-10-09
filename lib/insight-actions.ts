import type {
  AnalysisResult,
  PrioritisedIssue,
  SuggestionReport,
  StylePreferences,
  WritingGoals,
  WritingIssue,
} from "../packages/types/src/index.ts";
import { ruleFamily } from "../packages/grammar/src/index.ts";
import { familyLabel } from "../lib/writing-profile.ts";

/**
 * Actionable insights.
 *
 * The Insights view used to show a score per dimension and a list of rules that
 * moved it. Both are true, and neither tells the writer what to do next: "Clarity
 * 71" is not an editing decision, and a list of rule ids is not a plan.
 *
 * This module turns the analysis the writer already has into the one thing
 * worth doing now, plus the patterns worth knowing about. Everything is derived
 * from findings that actually exist in the current draft — nothing is inferred,
 * estimated or carried over from a previous session, so no insight here can be
 * stale or unsupported.
 *
 * It is deliberately local and deterministic: the same draft always produces the
 * same recommendation, which is what makes it inspectable and reversible.
 */

export interface InsightAction {
  /** One imperative sentence: the next thing worth doing. */
  label: string;
  /** Why this one, rather than the others. */
  reason: string;
  /** How many findings this action would address. */
  affectedCount: number;
  /** The rule family this action concerns, so it can be tuned or turned off. */
  family: string;
  /** Whether acting on this is a one-click fix or a judgement call. */
  kind: "objective" | "judgement";
  /** A representative finding to jump to, when one exists. */
  target?: WritingIssue;
}

export interface RecurringPattern {
  family: string;
  label: string;
  count: number;
  /** Plain-language shape of the pattern, e.g. "passive voice in 4 passages". */
  description: string;
  /** True when the writer has repeatedly dismissed this family before. */
  repeatedlyDismissed: boolean;
  target?: WritingIssue;
}

export interface ActionableInsights {
  /** The single most useful next action, or null when there is nothing to do. */
  nextAction: InsightAction | null;
  /** Patterns that recur across the draft, largest first. */
  recurring: RecurringPattern[];
  /** True when the only findings left are stylistic preferences. */
  onlyStyleRemaining: boolean;
}

/** Plain-language description of a family's findings, without repeating a rule id. */
function describeFamily(family: string, count: number, sample: WritingIssue): string {
  const plural = count === 1 ? "" : "s";
  switch (family) {
    case "style-passive-voice":
      return `Passive voice in ${count} passage${plural}`;
    case "conciseness-filler":
      return `${count} filler word${plural}`;
    case "wordiness":
      return `${count} wordy phrase${plural}`;
    case "clarity-vague-word":
      return `${count} vague expression${plural}`;
    case "structure-long-sentence":
      return `${count} long sentence${plural}`;
    case "structure-fragment":
      return `${count} sentence fragment${plural}`;
    case "cliche":
      return `${count} familiar phrase${plural}`;
    case "style-intensifier":
      return `${count} intensifier${plural}`;
    case "confused-word":
      return `${count} confused word${plural}`;
    case "repetition-adjacent-word":
    case "repetition-repeated-phrase":
      return `${count} repetition${plural}`;
    default: {
      const word = sample.original.trim();
      if (family.startsWith("spelling-")) return `${count} spelling slip${plural}`;
      if (family.startsWith("grammar-")) return `${count} grammar problem${plural}`;
      if (family.startsWith("punctuation-")) return `${count} punctuation problem${plural}`;
      if (family.startsWith("capitalization-")) return `${count} capitalisation problem${plural}`;
      if (family.startsWith("dialect-")) return `${count} dialect mismatch${plural}`;
      if (family.startsWith("consistency-")) return `${count} terminology issue${plural}`;
      return word ? `${count} × “${word.slice(0, 24)}”` : `${count} finding${plural}`;
    }
  }
}

/**
 * How much a family's findings are worth acting on.
 *
 * An objective finding is a mistake the writer would want to know about whatever
 * their preferences are. A stylistic one is a preference they may hold, so it is
 * only worth leading with when nothing objective remains. Weighting by confidence
 * and severity keeps a single high-severity grammar error ahead of a dozen
 * low-severity style notes, without inventing a numeric score of its own.
 */
function actionWeight(family: string, issues: WritingIssue[]): number {
  const objective = issues.filter((issue) => ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category));
  const base = objective.length ? 100 : 30;
  const confidence = issues.reduce((total, issue) => total + Math.max(0, Math.min(1, issue.confidence)), 0) / issues.length;
  const severity = issues.reduce((total, issue) => total + (issue.severity === "high" ? 3 : issue.severity === "medium" ? 2 : 1), 0);
  return base + confidence * 10 + Math.min(20, severity);
}

/**
 * Build the next action and the recurring patterns from the current analysis.
 *
 * `displayed` is the ranked, filtered suggestion list the writer actually sees,
 * so the recommendation can never point at something that is not on screen. The
 * dismissed counts come from the writing profile, which is what lets a pattern
 * the writer has repeatedly rejected be described as such rather than re-offered.
 */
export function buildActionableInsights(args: {
  analysis: AnalysisResult;
  issues: WritingIssue[];
  displayed: PrioritisedIssue[];
  report: SuggestionReport;
  goals?: WritingGoals;
  style?: StylePreferences;
}): ActionableInsights {
  const { issues, displayed, goals, style } = args;
  if (!issues.length && !displayed.length) {
    return { nextAction: null, recurring: [], onlyStyleRemaining: false };
  }

  const byFamily = new Map<string, WritingIssue[]>();
  for (const issue of [...issues, ...displayed]) {
    const family = ruleFamily(issue.ruleId);
    const bucket = byFamily.get(family);
    if (bucket) {
      // De-duplicate: an issue can appear in both the raw and displayed lists.
      if (!bucket.some((existing) => existing.id === issue.id)) bucket.push(issue);
    } else {
      byFamily.set(family, [issue]);
    }
  }

  const recurring: RecurringPattern[] = [...byFamily.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([family, group]) => {
      const sorted = [...group].sort((left, right) => right.start - left.start);
      return {
        family,
        label: familyLabel(family),
        count: group.length,
        description: describeFamily(family, group.length, group[0]),
        repeatedlyDismissed: (style?.dismissalCounts?.[family] ?? 0) >= 3,
        target: sorted[0],
      };
    })
    .sort((left, right) => right.count - left.count || left.family.localeCompare(right.family))
    .slice(0, 5);

  // The next action is the heaviest objective family that is still on screen, or
  // the heaviest stylistic one when nothing objective is left. Deriving it from
  // `displayed` means it always refers to a suggestion the writer can act on.
  const actionable = displayed.length ? displayed : issues;
  const candidates = new Map<string, WritingIssue[]>();
  for (const issue of actionable) {
    const family = ruleFamily(issue.ruleId);
    const bucket = candidates.get(family);
    if (bucket) bucket.push(issue);
    else candidates.set(family, [issue]);
  }

  let nextAction: InsightAction | null = null;
  let bestWeight = -1;
  for (const [family, group] of candidates) {
    const weight = actionWeight(family, group);
    if (weight <= bestWeight) continue;
    // `actionable` is displayed-first, so most members are already prioritised;
    // anything that is not (an un-ranked issue when no displayed list was passed)
    // sorts after every ranked one rather than being misread as fix-first.
    const tierOrder = (value: WritingIssue & Partial<PrioritisedIssue>) => {
      if (value.tier === "fix-first") return 0;
      if (value.tier === "improve") return 1;
      if (value.tier === "optional") return 2;
      return 3;
    };
    const representative = [...group].sort((left, right) =>
      tierOrder(left) - tierOrder(right) || right.confidence - left.confidence || left.start - right.start)[0];
    const objective = ["spelling", "grammar", "punctuation", "capitalization"].includes(representative.category);
    bestWeight = weight;
    nextAction = {
      label: group.length > 1
        ? `Work through ${describeFamily(family, group.length, representative).toLowerCase()}`
        : `Fix “${representative.original.trim().slice(0, 32)}”`,
      reason: objective
        ? "These are objective corrections, so they are worth doing whatever your style preferences are."
        : `This is the largest group of suggestions left, and it is a matter of preference rather than correctness.`,
      affectedCount: group.length,
      family,
      kind: objective ? "objective" : "judgement",
      target: representative,
    };
  }

  // Only when nothing objective remains does the headline become stylistic.
  // Iterating the values directly: the family name is not needed to answer
  // "is anything here an objective correction".
  const anyObjective = [...candidates.values()].some((group) =>
    group.some((issue) => ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category)));
  const onlyStyleRemaining = Boolean(issues.length) && !anyObjective;

  // A goal-driven action when the draft is far off an explicit target length.
  // Stated as a note, never as a score, per the product's no-grading rule.
  if (nextAction && goals?.targetLength && args.analysis.stats.words > 0) {
    const words = args.analysis.stats.words;
    const target = goals.targetLength;
    const ratio = words / target;
    if (ratio > 1.6 || ratio < 0.6) {
      nextAction = {
        ...nextAction,
        label: ratio > 1.6
          ? `Trim towards your ~${target.toLocaleString("en-GB")}-word target`
          : `Expand towards your ~${target.toLocaleString("en-GB")}-word target`,
        reason: `This draft is ${words.toLocaleString("en-GB")} words against a target of ${target.toLocaleString("en-GB")}.`,
        affectedCount: 0,
        family: "goal-length",
        kind: "judgement",
        target: undefined,
      };
    }
  }

  return { nextAction, recurring, onlyStyleRemaining };
}
