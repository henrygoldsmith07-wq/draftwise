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

export interface WritingGoals {
  audience: "general" | "academic" | "professional" | "technical" | "casual";
  intent: "inform" | "explain" | "persuade" | "describe" | "story";
  tone: "neutral" | "confident" | "friendly" | "professional" | "formal" | "casual";
}

export interface StylePreferences {
  dialect: Dialect;
  personalDictionary: string[];
  names?: string[];
  ignoredWords: string[];
  ignoredRuleIds: string[];
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

export interface DraftwiseWorkspace {
  version: 2;
  title: string;
  draft: string;
  goals: WritingGoals;
  style: StylePreferences;
  provider: ProviderSettings;
  classifier?: ClassifierSettings;
  aiEnabled: boolean;
  theme: "light" | "dark" | "system";
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
  baseUrl: "https://classifier.dev",
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

export const DEFAULT_WORKSPACE = (draft: string): DraftwiseWorkspace => ({
  version: 2,
  title: "Untitled draft",
  draft,
  goals: DEFAULT_GOALS,
  style: DEFAULT_STYLE_PREFERENCES,
  provider: DEFAULT_PROVIDER_SETTINGS,
  classifier: DEFAULT_CLASSIFIER_SETTINGS,
  aiEnabled: false,
  theme: "system",
});
