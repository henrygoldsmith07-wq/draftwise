import type {
  PrioritisedIssue,
  StylePreferences,
  WritingGoals,
} from "../../types/src/index.js";

/**
 * Goal-aware, contextual explanation.
 *
 * The rules produce correct but generic advice: "A more specific noun may help
 * the reader understand exactly what you mean." That sentence is true of every
 * vague word in every document, so it tells the writer nothing they can act on.
 *
 * The information needed to make it specific is already on the issue: which rule
 * fired, how confident the rule was, how much it matters, and why it ranked
 * where it did. This module turns that into language tied to *this* draft's
 * audience, intent, tone and register.
 *
 * It is pure, local, and deterministic. No provider call, no network, no
 * latency. This is the layer that keeps Draftwise useful with AI switched off.
 */

const AUDIENCE_NOUN: Record<WritingGoals["audience"], string> = {
  general: "a general reader",
  academic: "an academic reader",
  professional: "a professional reader",
  technical: "a technical reader",
  casual: "a casual reader",
};

const INTENT_PHRASE: Record<WritingGoals["intent"], string> = {
  inform: "inform the reader",
  explain: "explain this",
  persuade: "persuade the reader",
  describe: "describe this accurately",
  story: "carry the reader through the narrative",
};

const TONE_NOUN: Record<WritingGoals["tone"], string> = {
  neutral: "a neutral voice",
  confident: "a confident voice",
  friendly: "a friendly voice",
  professional: "a professional voice",
  formal: "a formal voice",
  casual: "a casual voice",
};

/**
 * Why this finding is ranked where it is, in one sentence.
 *
 * The ranking already made a defensible decision from transparent inputs. This
 * surfaces that decision instead of leaving the writer to guess why an obvious
 * typo sits below an optional style note.
 */
export function explainRanking(issue: PrioritisedIssue, goals?: WritingGoals): string {
  const parts: string[] = [];
  const tierReason = issue.tier === "fix-first"
    ? "Treated as a likely mistake"
    : issue.tier === "improve"
      ? "Worth improving for this draft"
      : "Optional — take it only if it matches your intent";

  if (issue.confidence >= 0.9) parts.push("Draftwise is highly confident in this detection");
  else if (issue.confidence >= 0.75) parts.push("Reasonably confident");
  else parts.push(`Lower confidence (${Math.round(issue.confidence * 100)}%) — safe to ignore if the text is deliberate`);

  if (issue.reasonCodes.includes("register-dampened")) {
    parts.push(goals
      ? `Ranked lower because it matters less for ${AUDIENCE_NOUN[goals.audience]} in ${TONE_NOUN[goals.tone]}`
      : "Ranked lower because it matters less for this register");
  }

  if (issue.groupedCount > 0) {
    parts.push(`Same pattern appears ${issue.groupedCount} more time${issue.groupedCount === 1 ? "" : "s"} in the draft`);
  }

  return `${tierReason}. ${parts.join(". ")}.`;
}

/**
 * The goal-aware "why this matters here" line.
 *
 * Written per rule family so it says something true about the register the
 * writer actually chose, rather than restating the rule's own description.
 */
export function explainRelevance(issue: PrioritisedIssue, goals?: WritingGoals): string | null {
  if (!goals) return null;
  const audience = AUDIENCE_NOUN[goals.audience];
  const intent = INTENT_PHRASE[goals.intent];
  const tone = TONE_NOUN[goals.tone];
  const family = familyFor(issue.ruleId);

  switch (family) {
    case "spelling-lexicon":
      return goals.audience === "technical"
        ? `Technical drafts are read closely and corrected quickly. A wrong term here costs more than it would in a casual note.`
        : `Spelling is checked everywhere, but it is the one error no reader forgives silently.`;
    case "wordiness":
      return goals.intent === "persuade"
        ? `You are trying to ${intent}. Padding works against that: every hedge is a sentence the reader does not get back.`
        : goals.audience === "academic"
          ? `Academic readers are tracking your argument. Thinner wording makes that argument easier to follow.`
          : `Thinner wording makes the point faster without changing what you meant.`;
    case "clarity-vague-word":
      return goals.audience === "academic"
        ? `In academic writing the reader cannot evaluate a claim they cannot pin down. Naming the specific thing is usually the whole fix.`
        : goals.intent === "explain"
          ? `You are trying to ${intent}. A vague noun leaves the reader guessing what you are describing.`
          : `A specific noun tells the reader exactly what you mean instead of leaving them to work it out.`;
    case "style-passive-voice":
      return goals.audience === "professional"
        ? `In professional writing the actor usually matters: who decided, who owns it, who acts.`
        : goals.tone === "formal"
          ? `Formal writing often keeps the passive for genuine reasons. Change it only where the actor matters.`
          : `Passive voice hides who acts. Keep it when the result is genuinely the point, and name the actor when it is not.`;
    case "conciseness-filler":
      return goals.tone === "confident"
        ? `You set a ${tone}. Filler undercuts it — a confident sentence does not need “basically” to sound sure.`
        : goals.audience === "casual"
          ? `In casual writing these words carry tone as much as padding. Leave them if they are doing that job.`
          : `Filler words weaken emphasis. Every one of them spends the reader's attention for nothing.`;
    case "structure-long-sentence":
      return goals.intent === "story"
        ? `Narrative sentences can run long without losing the reader, but this one asks them to hold several ideas at once.`
        : goals.audience === "academic"
          ? `Long sentences are the main thing that costs an academic reader your argument. Splitting this one is usually worth it.`
          : `Long sentences ask the reader to hold several ideas at once. Splitting one is often easier than rewriting it.`;
    case "structure-sticky-sentence":
      return goals.audience === "academic"
        ? `Academic readers will look for the claim inside this sentence. If most of it is connecting words, the claim is doing very little work.`
        : goals.intent === "persuade"
          ? `You are trying to ${intent}. A sentence built from connecting words gives the reader nothing to hold onto.`
          : `Most of this sentence is connective tissue, so the reader has to work out what it is actually saying.`;
    case "structure-fragment":
      return goals.intent === "story"
        ? `Fragments are normal in narrative prose. Keep this one if the rhythm is doing the work.`
        : `A sentence without a verb can read as a thought rather than a claim. Keep it only if that is deliberate.`;
    case "cliche":
      return goals.tone === "formal"
        ? `A familiar phrase can undercut a formal voice because the reader stops hearing your words.`
        : `Clichés are less precise than the concrete thing they stand in for.`;
    case "style-contractions":
      return goals.tone === "formal"
        ? `You set a ${tone}. Contractions read as informal in that register.`
        : `Your style profile prefers avoiding contractions.`;
    case "style-intensifier":
      return goals.tone === "confident"
        ? `An intensifier weakens a confident sentence. “Very good” is weaker than “good”.`
        : `Intensifiers add emphasis without adding meaning, and readers notice the gap.`;
    case "consistency-preferred-term":
      return `Consistency is what makes terminology usable. Your style guide already says which form you want.`;
    case "repetition-repeated-phrase":
      return goals.audience === "casual"
        ? `Repeating a short phrase is normal in casual writing. Keep it when it lands.`
        : `A repeated phrase reads as an accident unless it is deliberate emphasis.`;
    case "repetition-sentence-opening":
      return `Several nearby sentences start the same way, which flattens the rhythm.`;
    default:
      return `Worth weighing against your goal to ${intent} for ${audience}.`;
  }
}

/** Coarse grouping used to pick the right relevance sentence. */
function familyFor(ruleId: string): string {
  if (ruleId.startsWith("wordiness-")) return "wordiness";
  if (ruleId.startsWith("style-cliche-")) return "cliche";
  if (ruleId.startsWith("spelling-")) return "spelling-lexicon";
  return ruleId;
}

export interface ContextualExplanation {
  /** The rule's own explanation, unchanged. */
  base: string;
  /** Why it ranked where it did. */
  ranking: string;
  /** Why it matters for this draft's goals, or null when no goals are set. */
  relevance: string | null;
  /** What the writer can do right now. */
  action: string;
}

/**
 * Build the full explanation a writer sees on a suggestion card.
 *
 * Ordering matters: what to do first, then why it matters here, then how
 * confident the ranking is. The base rule text is kept last because it is the
 * least specific part.
 */
export function buildExplanation(
  issue: PrioritisedIssue,
  goals?: WritingGoals,
  preferences?: StylePreferences,
): ContextualExplanation {
  const relevance = explainRelevance(issue, goals);
  return {
    base: issue.explanation,
    ranking: explainRanking(issue, goals),
    relevance,
    action: buildAction(issue, goals, preferences),
  };
}

/**
 * A concrete next step. Every suggestion gets one, because “consider revising”
 * is not an action a writer can take between meetings.
 */
export function buildAction(issue: PrioritisedIssue, goals?: WritingGoals, preferences?: StylePreferences): string {
  const family = familyFor(issue.ruleId);

  if (family === "spelling-lexicon") {
    const inDictionary = preferences?.personalDictionary?.some(
      (word) => word.toLocaleLowerCase() === issue.original.trim().toLocaleLowerCase(),
    );
    return inDictionary
      ? "It is in your personal dictionary, so this may be a false alarm — check the case and the surrounding word."
      : "Correct it, or add the word to your personal dictionary if the spelling is deliberate.";
  }

  if (family === "consistency-preferred-term") {
    return `Replace every occurrence with “${issue.replacement.trim()}”, then check the rest of the draft for the same choice.`;
  }

  if (issue.replacement && issue.replacement.trim() && issue.replacement !== issue.original) {
    return `Replace “${truncate(issue.original)}” with “${truncate(issue.replacement)}”.`;
  }

  if (family === "wordiness" || family === "conciseness-filler" || family === "clarity-vague-word") {
    return goals?.intent === "persuade"
      ? "Rewrite the sentence without it, then check the sentence still argues the same point."
      : "Rewrite the sentence without it. If the sentence stops meaning the same thing, keep the word.";
  }

  if (family === "structure-long-sentence") {
    return "Split it at the point where the sentence changes subject, and read the two halves on their own.";
  }

  if (family === "style-passive-voice") {
    return "Name the actor before the verb — or keep it, if the result really is the point.";
  }

  if (issue.groupedCount > 0) {
    return `Fix this one, then use “Replace all” on the group to catch the ${issue.groupedCount} other occurrence${issue.groupedCount === 1 ? "" : "s"}.`;
  }

  return "Read the sentence once more; keep it if the current wording is what you meant.";
}

function truncate(value: string, max = 48): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}