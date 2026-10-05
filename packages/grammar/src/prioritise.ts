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
  type SentenceSpan,
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
  /**
   * Draft text immediately before and after the finding when it was dismissed.
   *
   * Offsets move whenever the writer edits anything above the finding, which
   * is most of the time. Anchoring on the surrounding text instead lets a
   * dismissal survive that edit, and keeps it tied to this particular
   * occurrence: the same word dismissed in one place does not follow the writer
   * to every other place it appears.
   */
  before?: string;
  after?: string;
}

export interface PrioritiseOptions {
  goals?: WritingGoals;
  preferences?: StylePreferences;
  /** Recent dismissals; similar findings near them are held back. */
  dismissed?: Iterable<DismissedFinding>;
  /**
   * The draft text immediately before and after a finding, used to confirm a
   * dismissal still refers to the same piece of writing after the draft has
   * grown or shrunk above it.
   */
  anchorFor?: (issue: WritingIssue) => { before: string; after: string } | undefined;
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

/**
 * Base caps for a short draft. These are floors, not limits: the budget grows
 * with the document (see `densityCapsFor`) so a long draft is never starved of
 * its most important findings just because it is long.
 */
export const SUGGESTION_DENSITY_CAPS: Record<SuggestionTier, number> = {
  "fix-first": 12,
  improve: 8,
  optional: 5,
};

/**
 * Per 1,000 words each tier is allowed this many displayed suggestions.
 *
 * The original product shipped absolute caps (12/8/5) for every document. That
 * made the assistant actively worse on long drafts: at a constant error rate a
 * 1,700-word document showed the writer exactly one suggestion and hid the
 * other 119 with no way to see them. Scaling the budget by length keeps the
 * list focused on a note while never hiding more than roughly this share of a
 * draft's findings.
 */
export const SUGGESTION_DENSITY_PER_THOUSAND_WORDS: Record<SuggestionTier, number> = {
  "fix-first": 14,
  improve: 9,
  optional: 5,
};

/**
 * How many findings per rule family to show, scaled by document length. The
 * base numbers suit a short note; a long draft needs more instances of a real
 * problem to be actionable, otherwise the writer fixes one and hits three more.
 */
const PER_RULE_CAPS: Record<SuggestionKind, number> = {
  objective: 10,
  clarity: 5,
  style: 3,
};

/**
 * Scale a per-draft cap by document length. Short documents keep the tuned base
 * values; longer ones gain capacity roughly in step with their word count, with
 * a ceiling so an enormous document still presents a reviewable list.
 */
function scaleCap(base: number, words: number, perThousand: number, maxMultiple = 8) {
  if (!Number.isFinite(words) || words <= 0) return base;
  const multiple = Math.max(1, Math.min(maxMultiple, words / 250));
  return Math.min(Math.round(base * multiple), Math.max(base, Math.round((perThousand * words) / 1000)));
}

/** The tier caps appropriate to a document of this length. */
export function densityCapsFor(words: number): Record<SuggestionTier, number> {
  return {
    "fix-first": scaleCap(SUGGESTION_DENSITY_CAPS["fix-first"], words, SUGGESTION_DENSITY_PER_THOUSAND_WORDS["fix-first"]),
    improve: scaleCap(SUGGESTION_DENSITY_CAPS.improve, words, SUGGESTION_DENSITY_PER_THOUSAND_WORDS.improve),
    optional: scaleCap(SUGGESTION_DENSITY_CAPS.optional, words, SUGGESTION_DENSITY_PER_THOUSAND_WORDS.optional),
  };
}

/**
 * Per-rule caps appropriate to a document of this length. The base numbers suit
 * a short note; a long draft needs more instances of a real problem to be
 * actionable, otherwise the writer fixes one and hits three more. A high
 * ceiling is safe here because the same pattern still groups into one card with
 * a count, so the list stays compact while the writer learns the true scale.
 */
function perRuleCapsFor(words: number): Record<SuggestionKind, number> {
  return {
    objective: scaleCap(PER_RULE_CAPS.objective, words, PER_RULE_CAPS.objective * 2.4, 10),
    clarity: scaleCap(PER_RULE_CAPS.clarity, words, PER_RULE_CAPS.clarity * 2.6, 12),
    style: scaleCap(PER_RULE_CAPS.style, words, PER_RULE_CAPS.style * 3.0, 14),
  };
}

const LOW_CONFIDENCE_STYLE_THRESHOLD = 0.7;
const REGISTER_MISMATCH_THRESHOLD = 0.35;
const NEAR_DISMISSAL_CHARS = 240;
const NEAR_DISMISSAL_CHARS_PER_WORD = 0.5;
const NEAR_DISMISSAL_MAX_CHARS = 2500;

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

/**
 * Find the sentence containing a span without scanning every sentence.
 *
 * Sentence spans are ordered and non-overlapping, so a binary search turns the
 * old O(issues x sentences) scan into O(issues log sentences). On a long draft
 * with hundreds of findings that difference is the whole analysis budget.
 */
function findSentence(sentences: readonly SentenceSpan[], start: number, end: number): SentenceSpan | undefined {
  if (sentences.length === 0) return undefined;
  let low = 0;
  let high = sentences.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const span = sentences[mid];
    if (end <= span.start) high = mid - 1;
    else if (start >= span.end) low = mid + 1;
    else return span;
  }
  // A span that straddles a boundary still belongs to the sentence it starts in.
  return start >= sentences[high]?.start ? sentences[high] : sentences[low];
}

function contextRelevance(issue: WritingIssue, kind: SuggestionKind, goals: WritingGoals | undefined, document: ParsedDocument): number {
  let relevance = registerRelevance(issue, kind, goals);
  const sentence = findSentence(document.sentences, issue.start, issue.end);
  if (sentence && sentence.tokens.length <= 4 && kind !== "objective") relevance *= 0.85;
  return Math.max(0, Math.min(1, relevance));
}

function issueImpact(issue: WritingIssue, kind: SuggestionKind, document: ParsedDocument): number {
  const severity = issue.severity === "high" ? 0.9 : issue.severity === "medium" ? 0.6 : 0.35;
  const categoryWeight = kind === "objective" ? 1 : kind === "clarity" ? 0.8 : 0.45;
  let impact = severity * categoryWeight;
  if (ruleFamily(issue.ruleId) === "structure-long-sentence") {
    const sentence = findSentence(document.sentences, issue.start, issue.end);
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

  /**
   * Dismissals indexed by rule and by the normalised text they covered.
   *
   * The previous implementation compared every finding against every dismissal
   * on every pass. Writers accumulate dismissals over a session, and analysis
   * reruns on each edit, so this was quadratic in the two things that grow most
   * during a long writing session. Two indexes make it linear.
   */
  const dismissalByRule = new Map<string, DismissedFinding[]>();
  const dismissalByText = new Map<string, DismissedFinding[]>();
  for (const entry of dismissed) {
    const byRule = dismissalByRule.get(entry.ruleId);
    if (byRule) byRule.push(entry);
    else dismissalByRule.set(entry.ruleId, [entry]);
    const textKey = entry.original.trim().toLocaleLowerCase();
    const byText = dismissalByText.get(textKey);
    if (byText) byText.push(entry);
    else dismissalByText.set(textKey, [entry]);
  }
  // How far a finding may move before its dismissal stops applying to it.
  //
  // Dismissals are stored with character offsets, and analysis reruns on every
  // edit, so anything the writer does above a dismissed finding pushes it down
  // the document. A flat 240-character window is generous in a short note and
  // almost nothing in a long draft: rewrite a paragraph near the top and every
  // dismissal below it was forgotten, and the writer was shown again the things
  // they had already said no to. The window now grows with the draft, still
  // bounded so one dismissal cannot swallow the rest of the document.
  const dismissalSlack = Math.max(
    NEAR_DISMISSAL_CHARS,
    Math.min(NEAR_DISMISSAL_MAX_CHARS, document.tokens.length * NEAR_DISMISSAL_CHARS_PER_WORD),
  );
  const isDismissalNear = (issue: WritingIssue) => {
    const live = options.anchorFor?.(issue);
    const anchored = (entry: DismissedFinding) => entry.before !== undefined
      && entry.after !== undefined
      && live !== undefined
      && live.before.endsWith(entry.before)
      && live.after.startsWith(entry.after);
    const exact = dismissalByRule.get(issue.ruleId);
    if (exact) {
      for (const entry of exact) {
        if (entry.start === issue.start && entry.end === issue.end && entry.original === issue.original) return true;
        if (anchored(entry)) return true;
      }
    }
    const similar = dismissalByText.get(issue.original.trim().toLocaleLowerCase());
    if (!similar) return false;
    for (const entry of similar) {
      if (anchored(entry)) return true;
      if (issue.start >= entry.start - dismissalSlack && issue.start <= entry.end + dismissalSlack) return true;
    }
    return false;
  };

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
    const nearDismissal = isDismissalNear(issue);
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

  // Fold repeated patterns into suggestions. The same rule on the same word is
  // one piece of advice, not one piece per occurrence — but on a long draft a
  // single card is not enough to work from, because the writer cannot find the
  // other 47 occurrences without a list. So a repeated pattern keeps its single
  // best instance *and* as many further instances as the draft has room for.
  // Each remaining instance still carries its own location and text, so it is a
  // real, jumpable suggestion rather than a number.
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = groupKey(candidate.issue);
    const bucket = groups.get(key);
    if (bucket) bucket.push(candidate);
    else groups.set(key, [candidate]);
  }
  const wordCount = document.tokens.length;
  // Each additional instance of a repeated pattern needs the same room in the
  // list as any other suggestion, so a long draft shows more of them rather
  // than hiding the pattern behind a single row.
  const repeatAllowance = Math.max(0, Math.min(12, Math.floor(wordCount / 180) - 1));
  const grouped: Candidate[] = [];
  for (const bucket of groups.values()) {
    const [first, ...rest] = bucket.sort((left, right) => right.rank - left.rank);
    if (first.issue.ruleId === "spelling-common-typo" || first.issue.ruleId === "spelling-lexicon" || first.issue.ruleId === "consistency-preferred-term") {
      // Spelling and terminology findings are distinct locations of a genuine
      // mistake; each one is a separate fix, so keep them individually.
      grouped.push(...bucket.map((candidate) => ({ ...candidate })));
      continue;
    }
    const kept = rest.slice(0, repeatAllowance);
    const folded = rest.slice(repeatAllowance);
    const merged = {
      ...first,
      groupedIds: [...kept, ...folded].map((candidate) => candidate.issue.id),
      groupedCount: rest.length,
    };
    grouped.push(merged);
    // Kept instances stay visible in their own right.
    for (const candidate of kept) {
      grouped.push({ ...candidate, groupedCount: rest.length, groupedIds: [first.issue.id] });
    }
    for (const candidate of folded) suppressed.push({ issue: candidate.issue, reason: "repeated-pattern" });
    report.groupedCount += folded.length;
  }

  // A rule that keeps firing in one draft is offering the same advice again and
  // again. Show its strongest instances, then stop.
  grouped.sort((left, right) => right.rank - left.rank);
  const perRuleShown = new Map<string, number>();
  const tierShown: Record<SuggestionTier, number> = { "fix-first": 0, improve: 0, optional: 0 };
  const displayed: PrioritisedIssue[] = [];
  const densityCaps = densityCapsFor(wordCount);
  const perRuleCaps = perRuleCapsFor(wordCount);
  // Index the profile adjustments once rather than re-filtering per candidate.
  const adjustmentsByFamily = new Map<string, Array<{ rankDelta: number; reason: string }>>();
  for (const adjustment of options.rankAdjustments ?? []) {
    const bucket = adjustmentsByFamily.get(adjustment.family);
    if (bucket) bucket.push(adjustment);
    else adjustmentsByFamily.set(adjustment.family, [adjustment]);
  }
  const dampenedFamilies = new Set<string>();
  for (const [family, adjustments] of adjustmentsByFamily) {
    if (adjustments.some((adjustment) => adjustment.rankDelta <= -0.8)) dampenedFamilies.add(family);
  }
  for (const candidate of grouped) {
    const family = ruleFamily(candidate.issue.ruleId);
    // A family the writer repeatedly dismissed is dampened to one instance,
    // the same treatment as an explicit "Show fewer" — still visible, never nagging.
    const dampened = ruleReduced.has(family) || dampenedFamilies.has(family);
    const perRuleCap = dampened ? 1 : perRuleCaps[candidate.kind];
    const shown = perRuleShown.get(family) ?? 0;
    if (shown >= perRuleCap) {
      suppressed.push({ issue: candidate.issue, reason: dampened ? "rule-reduced" : "density-cap" });
      continue;
    }
    if (tierShown[candidate.tier] >= densityCaps[candidate.tier]) {
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

/**
 * Why a finding was held back, in the writer's own terms.
 *
 * Draftwise deliberately hides some findings so the list stays reviewable. That
 * trade is only honest if the writer can see what was hidden and why — a silent
 * omission reads as "there is nothing else wrong", which on a long draft is the
 * most misleading thing the product could say. These labels are returned with
 * the suppression data and rendered as an inspectable list.
 */
export const SUPPRESSION_REASONS: Record<SuppressedFinding["reason"], string> = {
  "rule-off": "You turned this check off",
  "rule-reduced": "You asked to see less of this",
  "density-cap": "More of this pattern than the list shows",
  "repeated-pattern": "The same pattern elsewhere in the draft",
  "register-mismatch": "Not relevant for your audience and tone",
  "near-dismissal": "You dismissed this one already",
  "low-confidence-style": "Low confidence for a style note",
};

/** A one-line summary of what was held back and the main reasons for it. */
export function describeSuppression(report: SuggestionReport): string {
  if (!report.suppressedCount) return "Nothing was held back: every finding is in the list.";
  const top = report.suppressedByRule
    .filter((entry) => entry.suppressed > 0)
    .slice(0, 3)
    .map((entry) => `${entry.suppressed} × ${entry.ruleId.replace(/^[a-z]+-/, "")}`);
  const grouped = report.groupedCount ? `${report.groupedCount} folded into a repeated pattern` : "";
  const parts = [`${report.suppressedCount} finding${report.suppressedCount === 1 ? "" : "s"} held back`];
  if (top.length) parts.push(`most often ${top.join(", ")}`);
  if (grouped) parts.push(grouped);
  return `${parts.join(" · ")}. Open “Hidden findings” to see each one.`;
}
