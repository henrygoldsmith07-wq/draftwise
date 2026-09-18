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

export interface AnalysisResult {
  issues: WritingIssue[];
  tone: string[];
  scores: AnalysisScores;
  stats: WritingStats;
  analysedText: string;
  source: "local" | "ai" | "local+ai";
  changedRange?: { start: number; end: number };
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

export interface DraftwiseWorkspace {
  version: 2;
  title: string;
  draft: string;
  goals: WritingGoals;
  style: StylePreferences;
  provider: ProviderSettings;
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

export const DEFAULT_WORKSPACE = (draft: string): DraftwiseWorkspace => ({
  version: 2,
  title: "Untitled draft",
  draft,
  goals: DEFAULT_GOALS,
  style: DEFAULT_STYLE_PREFERENCES,
  provider: DEFAULT_PROVIDER_SETTINGS,
  aiEnabled: false,
  theme: "system",
});
