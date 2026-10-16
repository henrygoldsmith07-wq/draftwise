import type { StylePreferences, WritingIssue } from "../packages/types/src/index.ts";
import { ruleFamily } from "../packages/grammar/src/index.ts";

/**
 * The local Writing Profile.
 *
 * Draftwise learns the writer's preferences from what they dismiss and adjust,
 * entirely on-device and entirely in the open: every learned entry is a plain
 * record the user can inspect, edit or delete. There is no opaque model — the
 * learning is exactly the rules below.
 *
 * Learning rules:
 * - Dismissing the same suggestion family 3+ times is a signal the writer does
 *   not want that advice; the family gets dampened (its cap drops to one) and a
 *   visible entry is added.
 * - Choosing "Show fewer" or "Turn off" records the family so the user can see
 *   and undo it outside the suggestion card.
 * - Nothing is ever removed from the list automatically.
 *
 * `familyOf` used to be a second copy of `ruleFamily` from the grammar package.
 * Two implementations of "which rule family is this" drift the moment a new
 * family is added to one and not the other, and the profile is the layer that
 * decides what the writer stops seeing — so it now calls the shared one.
 */

export type LearnedEntryKind = "dismissal-pattern" | "reduced-family" | "disabled-family" | "accepted-pattern";

export interface LearnedEntry {
  id: string;
  kind: LearnedEntryKind;
  /** Human-readable summary shown in the profile. */
  label: string;
  /** Why Draftwise learned this, stated plainly. */
  detail: string;
  family: string;
  createdAt: number;
  source: "learned" | "manual";
}

export const LEARNED_ENTRY_LIMIT = 50;
export const DISMISSAL_LEARNING_THRESHOLD = 3;

/**
 * How many acceptances of one family it takes to treat it as wanted advice.
 *
 * Higher than the dismissal threshold on purpose. Dismissing is a deliberate
 * act against a specific suggestion; accepting is often just "yes, obviously",
 * so the evidence for "this rule helps me" should be stronger before the
 * profile starts acting on it.
 */
export const ACCEPTANCE_LEARNING_THRESHOLD = 5;

export function familyOf(issue: Pick<WritingIssue, "ruleId">) {
  return ruleFamily(issue.ruleId);
}

const FAMILY_LABELS: Record<string, string> = {
  "style-passive-voice": "Passive voice suggestions",
  "conciseness-filler": "Filler-word suggestions",
  "clarity-vague-word": "Vague wording suggestions",
  "style-intensifier": "Intensifier suggestions",
  "structure-long-sentence": "Long sentence suggestions",
  "structure-sticky-sentence": "Dense-sentence suggestions",
  "structure-fragment": "Sentence fragment suggestions",
  "punctuation-oxford-comma": "Oxford comma suggestions",
  "punctuation-missing-terminal": "Missing punctuation suggestions",
  "capitalization-sentence-start": "Capitalisation suggestions",
  wordiness: "Wordiness suggestions",
  cliche: "Cliché suggestions",
  "confused-word": "Confused word suggestions",
};

export function familyLabel(family: string) {
  return FAMILY_LABELS[family] ?? `Suggestions from “${family}”`;
}

export interface ProfileStyle extends StylePreferences {
  /** How many times the writer dismissed each suggestion family. */
  dismissalCounts?: Record<string, number>;
  /** How many times the writer accepted each suggestion family. */
  acceptanceCounts?: Record<string, number>;
  /** What the profile has learned; every entry is user-visible and removable. */
  learned?: LearnedEntry[];
}

function withLearned(style: ProfileStyle, entry: LearnedEntry): ProfileStyle {
  const learned = [...(style.learned ?? []).filter((item) => !(item.family === entry.family && item.kind === entry.kind)), entry];
  return { ...style, learned: learned.slice(-LEARNED_ENTRY_LIMIT) };
}

/** Record a dismissal; learn a dampening entry once the threshold is crossed. */
export function recordDismissal(style: ProfileStyle, issue: Pick<WritingIssue, "ruleId" | "title">): ProfileStyle {
  const family = familyOf(issue);
  const counts = { ...style.dismissalCounts, [family]: (style.dismissalCounts?.[family] ?? 0) + 1 };
  const next: ProfileStyle = { ...style, dismissalCounts: counts };
  if (counts[family] >= DISMISSAL_LEARNING_THRESHOLD) {
    // Symmetric with recordAcceptance: whichever signal is most recent wins, so
    // the profile cannot hold a family as both wanted and unwanted. A writer who
    // accepted a rule for months and then starts dismissing it is telling us
    // something has changed, and the newer evidence is the better guide.
    const acceptanceCounts = { ...style.acceptanceCounts };
    delete acceptanceCounts[family];
    return withLearned(
      {
        ...next,
        acceptanceCounts,
        learned: (style.learned ?? []).filter((entry) => !(entry.family === family && entry.kind === "accepted-pattern")),
      },
      {
        id: `learned-dismiss-${family}`,
        kind: "dismissal-pattern",
        label: familyLabel(family),
        detail: `You dismissed this ${counts[family]} times, so Draftwise now shows only the strongest instance.`,
        family,
        createdAt: Date.now(),
        source: "learned",
      },
    );
  }
  return next;
}

export function recordRuleControl(style: ProfileStyle, family: string, action: "reduce" | "off"): ProfileStyle {
  return withLearned(style, {
    id: `learned-${action}-${family}`,
    kind: action === "off" ? "disabled-family" : "reduced-family",
    label: familyLabel(family),
    detail: action === "off" ? "You turned this suggestion type off." : "You asked to see this suggestion type less often.",
    family,
    createdAt: Date.now(),
    source: "manual",
  });
}

/**
 * Record an accepted suggestion.
 *
 * Dismissal learning could only ever subtract: a family the writer acted on
 * every single time was invisible to the profile, and a family they dismissed
 * three times was permanently dampened with no counter-evidence able to lift
 * it. Accepting now counts in the other direction.
 *
 * Crossing the acceptance threshold also clears the family's dismissal tally.
 * Without that, a writer who dismissed a rule three times in one sitting and
 * then accepted it five times over the following weeks would stay permanently
 * dampened — the profile would be reasoning from stale evidence and no later
 * behaviour could ever change its mind. The learned entries for the family are
 * reconciled at the same time so the settings list never shows a family as
 * both dampened and wanted.
 */
export function recordAcceptance(style: ProfileStyle, issue: Pick<WritingIssue, "ruleId" | "title">): ProfileStyle {
  const family = familyOf(issue);
  const counts = { ...style.acceptanceCounts, [family]: (style.acceptanceCounts?.[family] ?? 0) + 1 };
  const next: ProfileStyle = { ...style, acceptanceCounts: counts };
  if (counts[family] < ACCEPTANCE_LEARNING_THRESHOLD) return next;

  const dismissalCounts = { ...style.dismissalCounts };
  delete dismissalCounts[family];
  return withLearned(
    {
      ...next,
      dismissalCounts,
      // Drop any dampening the writer's later behaviour has contradicted.
      learned: (style.learned ?? []).filter((entry) => !(entry.family === family && entry.kind === "dismissal-pattern")),
    },
    {
      id: `learned-accept-${family}`,
      kind: "accepted-pattern",
      label: familyLabel(family),
      detail: `You accepted this ${counts[family]} times, so Draftwise keeps it in view and no longer holds back repeats.`,
      family,
      createdAt: Date.now(),
      source: "learned",
    },
  );
}

export function removeLearnedEntry(style: ProfileStyle, id: string): ProfileStyle {
  return {
    ...style,
    learned: (style.learned ?? []).filter((entry) => entry.id !== id),
  };
}

/**
 * Rank adjustments derived from the profile. Transparent by construction:
 * each adjustment is a named reason the ranking layer applies openly.
 */
export interface ProfileAdjustment {
  family: string;
  /** Negative dampens the family's suggestions; positive raises them. */
  rankDelta: number;
  reason: string;
}

export function profileAdjustments(style: ProfileStyle): ProfileAdjustment[] {
  const adjustments: ProfileAdjustment[] = [];
  for (const [family, count] of Object.entries(style.dismissalCounts ?? {})) {
    if (count >= DISMISSAL_LEARNING_THRESHOLD) {
      adjustments.push({ family, rankDelta: -0.9, reason: `dismissed ${count} times` });
    }
  }
  // Advice this writer acts on is raised, so a family they consistently accept
  // competes for the visible slots instead of only ever losing them. The lift is
  // smaller than the dismissal penalty: promoting is a nudge toward advice the
  // writer already agrees with, while suppressing has to be decisive enough to
  // actually stop the nagging.
  for (const [family, count] of Object.entries(style.acceptanceCounts ?? {})) {
    if (count >= ACCEPTANCE_LEARNING_THRESHOLD) {
      adjustments.push({ family, rankDelta: 0.6, reason: `accepted ${count} times` });
    }
  }
  if (style.preferredSentenceLength === "short") {
    adjustments.push({ family: "conciseness-filler", rankDelta: 0.5, reason: "you prefer concise writing" });
    adjustments.push({ family: "wordiness", rankDelta: 0.5, reason: "you prefer concise writing" });
    adjustments.push({ family: "structure-long-sentence", rankDelta: 0.4, reason: "you prefer concise writing" });
  }
  if (style.preferredSentenceLength === "long") {
    adjustments.push({ family: "structure-long-sentence", rankDelta: -0.6, reason: "you prefer longer sentences" });
  }
  if (style.allowContractions === true) {
    adjustments.push({ family: "style-contractions", rankDelta: -1, reason: "you allow contractions" });
  }
  if (style.passiveVoiceSensitivity === "off") {
    adjustments.push({ family: "style-passive-voice", rankDelta: -1, reason: "passive voice suggestions are off" });
  }
  return adjustments;
}

/** True when the profile's learning should dampen this family's cap to one. */
export function isFamilyDampened(style: ProfileStyle, family: string) {
  return (style.dismissalCounts?.[family] ?? 0) >= DISMISSAL_LEARNING_THRESHOLD
    || style.reducedRuleIds?.includes(family)
    || false;
}
