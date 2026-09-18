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
  | "sentence structure";

export type IssueSeverity = "low" | "medium" | "high";
export type IssueSource = "local" | "ai";

export interface WritingIssue {
  id: string;
  start: number;
  end: number;
  original: string;
  replacement: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  explanation: string;
  source: IssueSource;
}

export interface AnalysisScores {
  grammar: number;
  clarity: number;
  conciseness: number;
  engagement: number;
  overall: number;
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
}

export interface AnalysisResult {
  issues: WritingIssue[];
  tone: string[];
  scores: AnalysisScores;
  stats: WritingStats;
  analysedText: string;
  source: "local" | "ai" | "local+ai";
}

export interface WritingGoals {
  audience: "general" | "academic" | "professional" | "technical" | "casual";
  intent: "inform" | "explain" | "persuade" | "describe" | "story";
  tone: "neutral" | "confident" | "friendly" | "professional" | "formal" | "casual";
}

export interface ProviderSettings {
  enabled: boolean;
  provider: "openai-compatible" | "custom";
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  customHeaders: string;
}

export interface RewriteRequest {
  text: string;
  instruction: string;
  goals: WritingGoals;
}

export interface RewriteResult {
  replacement: string;
  explanation: string;
  source: "local" | "ai";
}

export const DEFAULT_GOALS: WritingGoals = {
  audience: "general",
  intent: "inform",
  tone: "professional",
};

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  enabled: false,
  provider: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: "",
  temperature: 0.2,
  maxTokens: 900,
  customHeaders: "",
};
