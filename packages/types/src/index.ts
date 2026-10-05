export type Dialect = "en-GB" | "en-US";

export type IssueCategory =
  | "spelling"
  | "grammar"
  | "punctuation"
  | "clarity"
  | "conciseness"
  | "word choice"
  | "repetition"
  | "tone"
  | "formality"
  | "readability"
  | "fluency"
  | "passive voice"
  | "sentence structure"
  | "consistency"
  | "capitalization";

export type IssueSeverity = "low" | "medium" | "high";
export type IssueSource = "local" | "ai";

export type SuggestionTier = "fix-first" | "improve" | "optional";
export type SuggestionKind = "objective" | "clarity" | "style";

export interface WritingIssue {
  id: string;
  ruleId: string;
  chunkId?: string;
  start: number;
  end: number;
  original: string;
  replacement: string;
  category: IssueCategory;
  severity: IssueSeverity;
  confidence: number;
  title: string;
  explanation: string;
  source: IssueSource;
}

/**
 * A detected issue after context evaluation: classified by whether it is an
 * objective error or a stylistic preference, scored for relevance and impact,
 * assigned to a review tier, and ranked against everything else in the draft.
 */
export interface PrioritisedIssue extends WritingIssue {
  tier: SuggestionTier;
  kind: SuggestionKind;
  /** Overall ranking score within the draft. Higher sorts first. */
  rank: number;
  /** How relevant the finding is to the surrounding sentence and register (0-1). */
  contextRelevance: number;
  /** How much fixing this is likely to change the reader's experience (0-1). */
  impact: number;
  /** Number of further findings folded into this one as the same pattern. */
  groupedCount: number;
  groupedIds: string[];
  /** Short machine-readable reasons for the tiering decision, for tests and insights. */
  reasonCodes: string[];
  /** Surrounding passage, so the writer sees the suggestion in context. */
  context?: string;
}

export interface SuppressedFinding {
  issue: WritingIssue;
  reason: "low-confidence-style" | "rule-reduced" | "rule-off" | "density-cap" | "repeated-pattern" | "register-mismatch" | "near-dismissal";
}

export interface SuggestionReport {
  rawCount: number;
  displayedCount: number;
  suppressedCount: number;
  groupedCount: number;
  byTier: Record<SuggestionTier, number>;
  byCategory: Record<string, number>;
  suppressedByRule: Array<{ ruleId: string; suppressed: number; displayed: number }>;
}

export type ScoreDimension =
  | "correctness"
  | "clarity"
  | "conciseness"
  | "readability"
  | "engagement"
  | "consistency"
  | "goalAlignment";

export interface ScoreContribution {
  score: number;
  summary: string;
  signals: string[];
}

export interface AnalysisScores {
  correctness: number;
  clarity: number;
  conciseness: number;
  readability: number;
  engagement: number;
  consistency: number;
  goalAlignment: number;
  overall: number;
  /** Kept as an alias for older consumers. */
  grammar: number;
  breakdown: Record<ScoreDimension, ScoreContribution>;
}

export interface FrequencyItem {
  value: string;
  count: number;
}

export interface WritingStats {
  words: number;
  characters: number;
  sentences: number;
  paragraphs: number;
  readingTime: number;
  readability: number;
  longSentences: number;
  fillerWords: number;
  passiveVoice: number;
  passiveVoicePercentage: number;
  averageSentenceLength: number;
  longestSentence: string;
  sentenceLengths: number[];
  paragraphLengths: number[];
  vocabularyDiversity: number;
  repeatedWords: FrequencyItem[];
  repeatedPhrases: FrequencyItem[];
  fillerWordFrequency: FrequencyItem[];
  commonWords: FrequencyItem[];
}

export type AnalysisEngine = "local" | "incremental" | "provider";

export interface AnalysisDiagnostics {
  processingMs: number;
  issueCount: number;
  engine: AnalysisEngine;
  /** Development-only provider/classifier counters. Never persisted or sent as telemetry. */
  providerRequests?: number;
  providerHttpRequests?: number;
  estimatedProviderInputTokens?: number;
  estimatedProviderOutputTokens?: number;
  classifierRetries?: number;
  providerRetries?: number;
  classifierRetryDelayMs?: number;
  providerRetryDelayMs?: number;
}

export interface TriageCoverage {
  candidateChunks: number;
  providerChunks: number;
  skippedDueToLimit: number;
}

export interface AiCoverage {
  requestedChunks: number;
  attemptedChunks: number;
  successfulChunks: number;
  failedChunks: number;
  skippedChunks: number;
}

export function isAiCoverageConsistent(coverage: AiCoverage | undefined) {
  if (!coverage) return true;
  const values = [coverage.requestedChunks, coverage.attemptedChunks, coverage.successfulChunks, coverage.failedChunks, coverage.skippedChunks];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) return false;
  return coverage.requestedChunks === coverage.attemptedChunks + coverage.skippedChunks
    && coverage.attemptedChunks === coverage.successfulChunks + coverage.failedChunks;
}

export type AiReviewPhase = "local" | "analysing" | "ready" | "error";

export function getAiReviewStatus(
  coverage: AiCoverage | undefined,
  aiEnabled: boolean,
  providerConfigured: boolean,
  phase: AiReviewPhase,
) {
  if (!aiEnabled || !providerConfigured) return "Local analysis only";
  if (phase === "error") return "AI review encountered errors";
  if (phase === "analysing") {
    if (!coverage || coverage.requestedChunks === 0) return "AI review in progress";
    return `AI review in progress - ${coverage.successfulChunks}/${coverage.requestedChunks} sections reviewed`;
  }
  if (!coverage || coverage.requestedChunks === 0) return "Local analysis only";
  if (coverage.failedChunks > 0 && coverage.successfulChunks === 0) {
    return `AI review encountered errors - ${coverage.failedChunks} section${coverage.failedChunks === 1 ? "" : "s"} failed`;
  }
  if (coverage.failedChunks > 0) {
    return `AI review partially complete - ${coverage.successfulChunks}/${coverage.requestedChunks} sections reviewed`;
  }
  if (coverage.skippedChunks > 0) {
    return `AI review limited - ${coverage.skippedChunks} section${coverage.skippedChunks === 1 ? "" : "s"} skipped`;
  }
  if (coverage.successfulChunks === coverage.requestedChunks) return "AI review complete";
  return `AI review partially complete - ${coverage.successfulChunks}/${coverage.requestedChunks} sections reviewed`;
}

export interface AnalysisResult {
  issues: WritingIssue[];
  tone: string[];
  scores: AnalysisScores;
  stats: WritingStats;
  analysedText: string;
  source: "local" | "ai" | "local+ai";
  changedRange?: { start: number; end: number };
  diagnostics?: AnalysisDiagnostics;
  triage?: {
    decisions: ClassifierChunkDecision[];
    metrics: TriageMetrics;
    coverage?: TriageCoverage;
  };
  aiCoverage?: AiCoverage;
}

export type DocumentType = "essay" | "report" | "email" | "article" | "personal-statement" | "technical-explanation" | "notes" | "general";

export interface WritingGoals {
  audience: "general" | "academic" | "professional" | "technical" | "casual";
  intent: "inform" | "explain" | "persuade" | "describe" | "story";
  tone: "neutral" | "confident" | "friendly" | "professional" | "formal" | "casual";
  /** Optional document shape; adapts suggestion ranking without forcing a template. */
  documentType?: DocumentType;
  /** Approximate target length in words; drafts far off it get a gentle note, not a score. */
  targetLength?: number;
  /** Terms that must appear somewhere in the draft. */
  requiredTerminology?: string[];
  /** Terms the writer never wants to see. */
  forbiddenTerminology?: string[];
}

/** A transparent entry in the local Writing Profile; every one is user-removable. */
export interface LearnedPreference {
  id: string;
  kind: "dismissal-pattern" | "reduced-family" | "disabled-family";
  label: string;
  detail: string;
  family: string;
  createdAt: number;
  source: "learned" | "manual";
}

export interface StylePreferences {
  dialect: Dialect;
  personalDictionary: string[];
  names?: string[];
  ignoredWords: string[];
  ignoredRuleIds: string[];
  /** Rules the writer asked to see less often: their cap drops to one per document. */
  reducedRuleIds: string[];
  /** How many times the writer dismissed each suggestion family; drives learning. */
  dismissalCounts?: Record<string, number>;
  /** What the Writing Profile has learned; inspectable and editable in Settings. */
  learned?: LearnedPreference[];
  preferredTerminology: Record<string, string>;
  oxfordComma: boolean;
  allowContractions: boolean;
  passiveVoiceSensitivity: "off" | "normal" | "strict";
  preferredSentenceLength: "short" | "balanced" | "long";
  blockedWords: string[];
}

export interface ProviderSettings {
  provider: "openai-compatible" | "custom";
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  customHeaders: string;
}

export type ProviderErrorCode =
  | "missing-key"
  | "invalid-url"
  | "insecure-url"
  | "invalid-model"
  | "unauthorized"
  | "rate-limited"
  | "timeout"
  | "network"
  | "cors"
  | "invalid-json"
  | "unsupported-provider"
  | "unknown";

export interface RewriteRequest {
  text: string;
  instruction: string;
  goals: WritingGoals;
  preferences?: StylePreferences;
  allowProtectedChanges?: boolean;
  /**
   * Text immediately before and after the selection.
   *
   * A rewrite sent as an isolated selection loses the sentence it came from:
   * "it" and "the former" have no referent, a term introduced in the previous
   * sentence looks like an error, and the writer's own phrasing is invisible so
   * the model reaches for its own register. The rewrite is still validated and
   * applied against `text` alone — this is context for the model, never a
   * wider edit target.
   */
  contextBefore?: string;
  contextAfter?: string;
}

export interface RewriteResult {
  replacement: string;
  alternatives?: string[];
  explanation: string;
  source: "local" | "ai";
}

export type TriageCategory =
  | "correctness"
  | "clarity"
  | "conciseness"
  | "engagement"
  | "tone"
  | "consistency"
  | "structure"
  | "word-choice"
  | "style"
  | "other";

export type TriageDecision = "ai-needed" | "locally-sufficient" | "uncertain";
export type UncertainPolicy = "provider" | "local";

export interface ClassifierSettings {
  baseUrl: string;
  /** Optional advanced credential for classifier.dev Pro/workspace limits. */
  apiKey?: string;
  timeoutMs?: number;
  maxExcerptChars?: number;
  uncertainPolicy?: UncertainPolicy;
}

export type ClassifierErrorCode =
  | "invalid-url"
  | "insecure-url"
  | "unauthorized"
  | "rate-limited"
  | "timeout"
  | "network"
  | "cors"
  | "invalid-json"
  | "invalid-request"
  | "unknown";

export interface ClassifierChunkInput {
  chunkId: string;
  excerpt: string;
  startOffset: number;
  endOffset: number;
  signals: {
    localIssueCount: number;
    localCategories: string[];
    hasLongSentence: boolean;
    hasVagueOrFiller: boolean;
    hasPassiveOrWordiness: boolean;
  };
  categories: TriageCategory[];
}

export interface ClassifierChunkDecision {
  chunkId: string;
  decision: TriageDecision;
  /** The exact classifier label, retained for live threshold evaluation. */
  label?: string;
  categories: TriageCategory[];
  confidence: number;
  reason: string;
  fallback?: boolean;
}

export interface TriageMetrics {
  candidateChunks: number;
  classifierRequests: number;
  classifierHttpRequests: number;
  classifiedChunks: number;
  locallySufficientChunks: number;
  aiNeededChunks: number;
  uncertainChunks: number;
  classifierFailures: number;
  omittedClassifierResults: number;
  providerRequests: number;
  providerHttpRequests: number;
  providerChunks: number;
  avoidedProviderChunks: number;
  confidentLocalRate: number;
  confidentAiRate: number;
  uncertainRate: number;
  fallbackRate: number;
  actualProviderAvoidanceRate: number;
  classifierRetries: number;
  classifierRetryDelayMs: number;
}

/**
 * Workspace configuration: genuinely global preferences only. Document content
 * (title, draft, timestamps, snapshots) lives exclusively in DocumentLifecycle's
 * document store — never duplicated here. `activeDocumentId` is lightweight
 * metadata so reopening Draftwise restores the last-opened document.
 */
export interface DraftwiseWorkspace {
  version: 2;
  goals: WritingGoals;
  style: StylePreferences;
  provider: ProviderSettings;
  classifier?: ClassifierSettings;
  aiEnabled: boolean;
  theme: "light" | "dark" | "system";
  activeDocumentId?: string;
}

export const DEFAULT_GOALS: WritingGoals = {
  audience: "general",
  intent: "inform",
  tone: "professional",
};

export const DEFAULT_STYLE_PREFERENCES: StylePreferences = {
  dialect: "en-GB",
  personalDictionary: [],
  names: [],
  ignoredWords: [],
  ignoredRuleIds: [],
  reducedRuleIds: [],
  preferredTerminology: {},
  oxfordComma: true,
  allowContractions: true,
  passiveVoiceSensitivity: "normal",
  preferredSentenceLength: "balanced",
  blockedWords: [],
};

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  provider: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
  temperature: 0.2,
  maxTokens: 900,
  customHeaders: "",
};

export const DEFAULT_CLASSIFIER_SETTINGS: ClassifierSettings = {
  // Empty means classifier triage is switched off.
  //
  // This used to ship as "https://classifier.dev", which meant a fresh install
  // already had a third-party endpoint configured and enabling AI — a single
  // deliberate act, with nothing else configured — started sending redacted
  // draft excerpts to that endpoint. The claim on the tin is that drafts never
  // leave the device, and a feature being described in a settings dialog the
  // reader may never open is not the same as the user having turned it on.
  //
  // Off by default is also the honest failure mode: with no classifier the
  // unresolved chunks simply go to the provider the user *did* configure.
  // classifier.dev remains one keystroke away in Settings, where it was always
  // shown as an example.
  baseUrl: "",
  uncertainPolicy: "provider",
  timeoutMs: 8_000,
  maxExcerptChars: 500,
};

export const TRIAGE_CATEGORIES: TriageCategory[] = [
  "correctness",
  "clarity",
  "conciseness",
  "engagement",
  "tone",
  "consistency",
  "structure",
  "word-choice",
  "style",
  "other",
];

export const DEFAULT_WORKSPACE = (): DraftwiseWorkspace => ({
  version: 2,
  goals: DEFAULT_GOALS,
  style: DEFAULT_STYLE_PREFERENCES,
  provider: DEFAULT_PROVIDER_SETTINGS,
  classifier: DEFAULT_CLASSIFIER_SETTINGS,
  aiEnabled: false,
  theme: "system",
  activeDocumentId: undefined,
});
