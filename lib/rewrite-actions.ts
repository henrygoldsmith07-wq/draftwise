import type { StylePreferences, WritingGoals } from "@/packages/types/src";

/**
 * Context-adaptive rewrite actions.
 *
 * The same selection gets different tools depending on what the writer is
 * doing: a persuasive essay needs "strengthen argument", an email needs
 * "make more natural", technical documentation should not be told to "make
 * more formal". The action set is computed from goals and selection shape so
 * the toolbar offers relevant moves rather than a fixed generic list.
 */

export interface RewriteAction {
  label: string;
  instruction: string;
  /** Actions worth running as alternatives for a significant rewrite. */
  significant: boolean;
}

const ALWAYS_ACTIONS: RewriteAction[] = [
  { label: "Improve clarity", instruction: "Improve clarity while preserving the exact meaning", significant: true },
  { label: "Fix grammar", instruction: "Fix grammar and punctuation only; change as little else as possible", significant: false },
  { label: "Shorten", instruction: "Shorten without losing facts or meaning", significant: true },
];

const AUDIENCE_ACTIONS: Record<WritingGoals["audience"], RewriteAction[]> = {
  general: [
    { label: "Simplify", instruction: "Simplify for a general reader without dumbing the content down", significant: true },
  ],
  academic: [
    { label: "Make more precise", instruction: "Replace vague claims with precise academic wording; keep every claim justified", significant: true },
    { label: "Strengthen argument", instruction: "Strengthen the argument: make the claim and its support explicit", significant: true },
  ],
  professional: [
    { label: "Make more direct", instruction: "Make the writing more direct and action-oriented for a professional reader", significant: true },
    { label: "Make more formal", instruction: "Make more formal and professional while keeping the tone natural", significant: false },
  ],
  technical: [
    { label: "Make more precise", instruction: "Tighten technical precision; keep valid terminology exactly as written", significant: true },
    { label: "Improve flow", instruction: "Improve flow between the ideas without adding new claims", significant: true },
  ],
  casual: [
    { label: "Make more natural", instruction: "Make the phrasing sound natural and conversational", significant: true },
    { label: "Make warmer", instruction: "Make the tone warmer and friendlier", significant: false },
  ],
};

const INTENT_ACTIONS: Record<WritingGoals["intent"], RewriteAction[]> = {
  inform: [],
  explain: [
    { label: "Explain more simply", instruction: "Explain the same idea more simply for someone encountering it for the first time", significant: true },
  ],
  persuade: [
    { label: "Strengthen argument", instruction: "Strengthen the argument: make the claim and its support explicit", significant: true },
  ],
  describe: [],
  story: [
    { label: "Improve flow", instruction: "Improve the narrative flow and rhythm without changing what happens", significant: true },
  ],
};

export function rewriteActionsFor(selection: string, goals: WritingGoals, style?: StylePreferences): RewriteAction[] {
  const actions = [...ALWAYS_ACTIONS, ...AUDIENCE_ACTIONS[goals.audience], ...INTENT_ACTIONS[goals.intent]];
  const words = selection.trim().split(/\s+/u).filter(Boolean).length;

  if (words > 40) actions.push({ label: "Remove repetition", instruction: "Remove repeated words and ideas while preserving every distinct point", significant: true });
  if (words > 25) actions.push({ label: "Improve flow", instruction: "Improve flow between the ideas without adding new claims", significant: true });
  if (words < 60) actions.push({ label: "Expand", instruction: "Expand with useful detail that supports the existing meaning; invent no facts", significant: true });
  if (goals.tone === "formal" && style?.allowContractions === true) {
    actions.push({ label: "Fix grammar", instruction: "Fix grammar and punctuation only; change as little else as possible", significant: false });
  }
  if (goals.tone === "casual") {
    actions.push({ label: "Make more natural", instruction: "Make the phrasing sound natural and conversational", significant: true });
  }

  // De-duplicate by label, preserving order.
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.label)) return false;
    seen.add(action.label);
    return true;
  });
}

export const SIGNIFICANT_REWRITE_ALTERNATIVES = 2;

export function significantRewriteInstruction(instruction: string) {
  return `${instruction}. Return ${SIGNIFICANT_REWRITE_ALTERNATIVES} meaningfully different alternatives in addition to your best version.`;
}
