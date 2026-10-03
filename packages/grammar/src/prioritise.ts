import type {
  PrioritisedIssue,
  SuggestionKind,
  SuggestionReport,
  SuggestionTier,
  StylePreferences,
  SuppressedFinding,
  WritingGoals,
  WritingIssue,
} from "../../types/src/index.js";
import {
  type ParsedDocument,
  parseDocument,
} from "./parser.ts";

/**
 * Context-aware suggestion intelligence.
 *
 * Raw rule detection stays untouched upstream. This layer answers the question
 * a writer actually cares about: given this audience, intent, tone and register,
 * which of the detected findings are worth showing, how important is each one,
 * and which noise should never reach the sidebar.
 *
 * The pipeline mirrors the product model:
 *   detected issue -> correctness confidence -> contextual relevance -> impact
 *   -> suppression / ranking -> displayed suggestion
 */

export interface DismissedFinding {
  ruleId: string;
  start: number;
  end: number;
  original: string;
}

export interface PrioritiseOptions {
  goals?: WritingGoals;
  preferences?: StylePreferences;
  /** Recent dismissals; similar findings near them are held back. */
  dismissed?: Iterable<DismissedFinding>;
  /** Per-rule dismissal history; noisy rules rank lower. */
  ruleDismissalCounts?: Record<string, number>;
  /**
   * Transparent rank adjustments from the Writing Profile. Each names its
   * reason; a strong negative dampens the family to a single displayed
   * instance rather than hiding it entirely.
   */
  rankAdjustments?: Array<{ family: string; rankDelta: number; reason: string }>;
  text?: string;
  document?: ParsedDocument;
}

export interface PrioritiseResult {
  displayed: PrioritisedIssue[];
  suppressed: SuppressedFinding[];
  report: SuggestionReport;
}

const OBJECTIVE_CATEGORIES = new Set(["spelling", "grammar", "punctuation", "capitalization"]);
const STYLE_RULE_PREFIXES = ["style-", "punctuation-oxford-comma"];

export const SUGGESTION_DENSITY_CAPS: Record<SuggestionTier, number> = {
  "fix-first": 12,
  improve: 8,
  optional: 5,
};

const PER_RULE_CAPS: Record<SuggestionKind, number> = {
  objective: 10,
  clarity: 5,
  style: 3,
};

const LOW_CONFIDENCE_STYLE_THRESHOLD = 0.7;
const REGISTER_MISMATCH_THRESHOLD = 0.35;
const NEAR_DISMISSAL_CHARS = 240;

export function classifyIssueKind(issue: Pick<WritingIssue, "ruleId" | "category">): SuggestionKind {
  if (STYLE_RULE_PREFIXES.some((prefix) => issue.ruleId.startsWith(prefix))) return "style";
  if (issue.category === "tone" || issue.category === "formality" || issue.category === "passive voice") return "style";
  if (OBJECTIVE_CATEGORIES.has(issue.category)) {
    return issue.ruleId === "dialect-spelling" ? "clarity" : "objective";
  }
  return "clarity";
}

/**
 * The advice a rule represents, in one key. Many findings share a cause:
 * every "wordiness-*" rule is the same kind of advice about tightening phrases,
 * so turning off that type turns the whole family off at once.
 */
export function ruleFamily(ruleId: string) {
  if (ruleId.startsWith("wordiness-")) return "wordiness";
  if (ruleId.startsWith("style-cliche-")) return "cliche";
  if (ruleId.startsWith("grammar-confused-")) return "confused-word";
  return ruleId;
}

/**
 * How relevant the finding is to the register the writer selected. Casual
 * writing tolerates fragments and relaxed punctuation, academic writing prizes
 * precision over style nits, technical writing must not have valid terminology
 * corrected, and storytelling gets fewer prescriptive style corrections.
 */
function registerRelevance(issue: WritingIssue, kind: SuggestionKind, goals?: WritingGoals): number {
  const family = ruleFamily(issue.ruleId);
  const audience = goals?.audience ?? "general";
  const intent = goals?.intent ?? "inform";
  const tone = goals?.tone ?? "professional";

  if (kind === "objective") {
    if (audience === "casual" || tone === "casual") {
      if (family === "capitalization-sentence-start") return 0.25;
      if (family === "punctuation-missing-terminal") return 0.3;
      if (family === "punctuation-repeated") return 0.45;
    }
    if (audience === "technical" && family === "spelling-lexicon") return 0.55;
    return 1;
  }

  if (kind === "clarity") {
    if (family === "structure-fragment") {
      return audience === "casual" || tone === "casual" || intent === "story" ? 0.3 : 0.6;
    }
    if (family === "clarity-vague-word") {
      return audience === "academic" ? 1 : audience === "technical" ? 0.6 : audience === "casual" ? 0.55 : 0.8;
    }
    if (family === "wordiness") {
      return audience === "professional" || audience === "academic" ? 1 : audience === "casual" ? 0.6 : 0.85;
    }
    if (family === "structure-long-sentence") {
      return intent === "story" ? 0.5 : audience === "casual" ? 0.5 : 0.85;
    }
    if (family === "conciseness-filler") {
      // In casual writing and email, "just"/"basically" carry tone rather than
      // padding: flagging them there is nagging, not editing.
      return audience === "casual" || tone === "casual" ? 0.25 : intent === "story" ? 0.5 : 0.9;
    }
    return 0.85;
  }

  // Style findings are preferences. Registers that lean expressive get fewer of them.
  if (family === "style-passive-voice") {
    return audience === "academic" ? 0.55 : intent === "story" ? 0.5 : audience === "professional" ? 0.7 : 0.6;
  }
  if (family === "cliche") return audience === "academic" ? 0.7 : intent === "story" ? 0.5 : 0.65;
  if (family === "style-intensifier") {
    // "Very good" in a school assignment or casual message is voice, not noise.
    return audience === "casual" || tone === "casual" ? 0.3 : audience === "academic" ? 0.55 : 0.6;
  }
  if (family === "style-contractions") return tone === "formal" ? 0.9 : 0.5;
  if (family === "punctuation-oxford-comma") return audience === "casual" ? 0.35 : 0.6;
  return 0.65;
}

function contextRelevance(issue: WritingIssue, kind: SuggestionKind, goals: WritingGoals | undefined, document: ParsedDocument): number {
  let relevance = registerRelevance(issue, kind, goals);
  const sentence = document.sentences.find((span) => issue.start >= span.start && issue.end <= span.end);
  if (sentence && sentence.tokens.length <= 4 && kind !== "objective") relevance *= 0.85;
  return Math.max(0, Math.min(1, relevance));
}

function issueImpact(issue: WritingIssue, kind: SuggestionKind, document: ParsedDocument): number {
  const severity = issue.severity === "high" ? 0.9 : issue.severity === "medium" ? 0.6 : 0.35;
  const categoryWeight = kind === "objective" ? 1 : kind === "clarity" ? 0.8 : 0.45;
  let impact = severity * categoryWeight;
  if (ruleFamily(issue.ruleId) === "structure-long-sentence") {
    const sentence = document.sentences.find((span) => issue.start >= span.start && issue.end <= span.end);
    if (sentence) impact = Math.min(0.9, 0.3 + Math.max(0, sentence.tokens.length - 32) * 0.02);
  }
  return Math.max(0, Math.min(1, impact));
}

function assignTier(kind: SuggestionKind, issue: WritingIssue, relevance: number, impact: number): SuggestionTier {
  if (kind === "objective" && issue.confidence >= 0.9 && issue.severity !== "low") return "fix-first";
  if (kind === "style") return "optional";
  if (kind === "clarity" && relevance >= 0.55 && impact >= 0.45) return "improve";
  if (kind === "objective") return relevance >= 0.5 ? "fix-first" : "optional";
  return "optional";
}

function tierWeight(tier: SuggestionTier) {
  return tier === "fix-first" ? 3 : tier === "improve" ? 2 : 1;
}

function reasonCodesFor(kind: SuggestionKind, tier: SuggestionTier, issue: WritingIssue, relevance: number): string[] {
  const codes: string[] = [`kind:${kind}`, `tier:${tier}`];
  if (issue.confidence >= 0.9) codes.push("high-confidence");
  if (relevance < 0.6) codes.push("register-dampened");
  return codes;
}

function emptyReport(): SuggestionReport {
  return {
    rawCount: 0,
    displayedCount: 0,
    suppressedCount: 0,
    groupedCount: 0,
    byTier: { "fix-first": 0, improve: 0, optional: 0 },
    byCategory: {},
    suppressedByRule: [],
  };
}

function groupKey(issue: WritingIssue) {
  return `${issue.ruleId}\u0000${issue.original.trim().toLocaleLowerCase()}`;
}

/**
 * Evaluate detected findings against context and return only what a writer
 * should see, ranked, with the noise accounted for in the report.
 */
export function prioritiseSuggestions(issues: WritingIssue[], options: PrioritiseOptions = {}): PrioritiseResult {
  const document = options.document ?? parseDocument(options.text ?? issues.map((issue) => issue.original).join(" "));
  const preferences = options.preferences;
  const dismissed = [...(options.dismissed ?? [])];
  const noise = options.ruleDismissalCounts ?? {};
  const suppressed: SuppressedFinding[] = [];
  const report = emptyReport();
  report.rawCount = issues.length;

  const ruleOff = new Set((preferences?.ignoredRuleIds ?? []).map((id) => ruleFamily(id)));
  const ruleReduced = new Set((preferences?.reducedRuleIds ?? []).map((id) => ruleFamily(id)));

  interface Candidate {
    issue: WritingIssue;
    kind: SuggestionKind;
    relevance: number;
    impact: number;
    tier: SuggestionTier;
    rank: number;
    reasonCodes: string[];
    groupedIds: string[];
    groupedCount: number;
  }

  const candidates: Candidate[] = [];
  for (const issue of issues) {
    const kind = classifyIssueKind(issue);
    const family = ruleFamily(issue.ruleId);
    if (ruleOff.has(family)) {
      suppressed.push({ issue, reason: "rule-off" });
      continue;
    }
    const nearDismissal = dismissed.some((entry) => entry.ruleId === issue.ruleId
      && (entry.start === issue.start && entry.end === issue.end && entry.original === issue.original
        || (entry.original.trim().toLocaleLowerCase() === issue.original.trim().toLocaleLowerCase()
          && issue.start >= entry.start - NEAR_DISMISSAL_CHARS && issue.start <= entry.end + NEAR_DISMISSAL_CHARS)));
    if (nearDismissal) {
      suppressed.push({ issue, reason: "near-dismissal" });
      continue;
    }
    const relevance = contextRelevance(issue, kind, options.goals, document);
    if (relevance < REGISTER_MISMATCH_THRESHOLD) {
      suppressed.push({ issue, reason: "register-mismatch" });
      continue;
    }
    const impact = issueImpact(issue, kind, document);
    if (kind !== "objective" && issue.confidence < LOW_CONFIDENCE_STYLE_THRESHOLD && impact < 0.5) {
      suppressed.push({ issue, reason: "low-confidence-style" });
      continue;
    }
    const tier = assignTier(kind, issue, relevance, impact);
    const noisePenalty = Math.min(1.5, (noise[issue.ruleId] ?? 0) * 0.35);
    const profileAdjustment = (options.rankAdjustments ?? [])
      .filter((adjustment) => adjustment.family === family)
      .reduce((total, adjustment) => total + adjustment.rankDelta, 0);
    const rank = tierWeight(tier) * 2 + issue.confidence * 2 + relevance * 1.5 + impact * 1.5 - noisePenalty + profileAdjustment;
    candidates.push({
      issue,
      kind,
      relevance,
      impact,
      tier,
      rank,
      reasonCodes: reasonCodesFor(kind, tier, issue, relevance),
      groupedIds: [],
      groupedCount: 0,
    });
  }

  // Fold repeated patterns into one suggestion: the same rule on the same word
  // or construction is advice the writer needs once, not once per occurrence.
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = groupKey(candidate.issue);
    const bucket = groups.get(key);
    if (bucket) bucket.push(candidate);
    else groups.set(key, [candidate]);
  }
  const grouped: Candidate[] = [];
  for (const bucket of groups.values()) {
    const [first, ...rest] = bucket.sort((left, right) => right.rank - left.rank);
    if (first.issue.ruleId === "spelling-common-typo" || first.issue.ruleId === "spelling-lexicon" || first.issue.ruleId === "consistency-preferred-term") {
      // Spelling and terminology findings are distinct locations of a genuine
      // mistake; each one is a separate fix, so keep them individually.
      grouped.push(...bucket.map((candidate) => ({ ...candidate })));
      continue;
    }
    const merged = { ...first, groupedIds: rest.map((candidate) => candidate.issue.id), groupedCount: rest.length };
    grouped.push(merged);
    for (const candidate of rest) suppressed.push({ issue: candidate.issue, reason: "repeated-pattern" });
    report.groupedCount += rest.length;
  }

  // A rule that keeps firing in one draft is offering the same advice again and
  // again. Show its strongest instances, then stop.
  grouped.sort((left, right) => right.rank - left.rank);
  const perRuleShown = new Map<string, number>();
  const tierShown: Record<SuggestionTier, number> = { "fix-first": 0, improve: 0, optional: 0 };
  const displayed: PrioritisedIssue[] = [];
  for (const candidate of grouped) {
    const family = ruleFamily(candidate.issue.ruleId);
    // A family the writer repeatedly dismissed is dampened to one instance,
    // the same treatment as an explicit "Show fewer" — still visible, never nagging.
    const dampened = ruleReduced.has(family)
      || (options.rankAdjustments ?? []).some((adjustment) => adjustment.family === family && adjustment.rankDelta <= -0.8);
    const perRuleCap = dampened ? 1 : PER_RULE_CAPS[candidate.kind];
    const shown = perRuleShown.get(family) ?? 0;
    if (shown >= perRuleCap) {
      suppressed.push({ issue: candidate.issue, reason: dampened ? "rule-reduced" : "density-cap" });
      continue;
    }
    if (tierShown[candidate.tier] >= SUGGESTION_DENSITY_CAPS[candidate.tier]) {
      suppressed.push({ issue: candidate.issue, reason: "density-cap" });
      continue;
    }
    perRuleShown.set(family, shown + 1);
    tierShown[candidate.tier] += 1;
    displayed.push({
      ...candidate.issue,
      tier: candidate.tier,
      kind: candidate.kind,
      rank: candidate.rank,
      contextRelevance: candidate.relevance,
      impact: candidate.impact,
      groupedCount: candidate.groupedCount,
      groupedIds: candidate.groupedIds,
      reasonCodes: candidate.reasonCodes,
    });
  }

  displayed.sort((left, right) => right.rank - left.rank || left.start - right.start);

  report.displayedCount = displayed.length;
  report.suppressedCount = suppressed.length;
  for (const issue of displayed) {
    report.byTier[issue.tier] += 1;
    report.byCategory[issue.category] = (report.byCategory[issue.category] ?? 0) + 1;
  }
  const ruleCounts = new Map<string, { suppressed: number; displayed: number }>();
  for (const entry of suppressed) {
    const counts = ruleCounts.get(entry.issue.ruleId) ?? { suppressed: 0, displayed: 0 };
    counts.suppressed += 1;
    ruleCounts.set(entry.issue.ruleId, counts);
  }
  for (const issue of displayed) {
    const counts = ruleCounts.get(issue.ruleId) ?? { suppressed: 0, displayed: 0 };
    counts.displayed += 1;
    ruleCounts.set(issue.ruleId, counts);
  }
  report.suppressedByRule = [...ruleCounts.entries()]
    .map(([ruleId, counts]) => ({ ruleId, ...counts }))
    .sort((left, right) => right.suppressed - left.suppressed || left.ruleId.localeCompare(right.ruleId));

  return { displayed, suppressed, report };
}
