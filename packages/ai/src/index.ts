import {
  createAnalysisChunks,
  expandRangeToContext,
  mapChunkIssue,
  mergeAnalysisIssues,
  type AnalysisChunk,
  type ChangedRange,
} from "../../analysis/src/index.ts";
import {
  analyzeLocally,
  createAnalysisDiagnostics,
  getWritingStats,
  inferTone,
  scoreWriting,
  type GrammarOptions,
} from "../../grammar/src/index.ts";
import type {
  AnalysisResult,
  ClassifierChunkDecision,
  ClassifierChunkInput,
  ClassifierErrorCode,
  ClassifierSettings,
  IssueCategory,
  IssueSeverity,
  ProviderErrorCode,
  ProviderSettings,
  RewriteRequest,
  RewriteResult,
  StylePreferences,
  TriageCategory,
  TriageDecision,
  TriageMetrics,
  WritingGoals,
  WritingIssue,
} from "../../types/src/index.js";

const CATEGORY_ALIASES: Record<string, IssueCategory> = {
  style: "clarity",
  wordiness: "conciseness",
  capitalization: "capitalization",
  "sentence structure": "sentence structure",
  "passive voice": "passive voice",
  grammar: "grammar",
  spelling: "spelling",
  punctuation: "punctuation",
  clarity: "clarity",
  conciseness: "conciseness",
  "word choice": "word choice",
  repetition: "repetition",
  tone: "tone",
  formality: "formality",
  readability: "readability",
  fluency: "fluency",
  consistency: "consistency",
};

const VALID_SEVERITIES = new Set<IssueSeverity>(["low", "medium", "high"]);
const MAX_PROVIDER_RESPONSE_CHARS = 2_000_000;

function providerAnalysisNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}
interface ProviderIssue {
  start: number;
  end: number;
  original: string;
  replacement: string;
  category: string;
  severity: string;
  confidence?: number;
  title: string;
  explanation: string;
  ruleId?: string;
}

interface ProviderPayload {
  issues: ProviderIssue[];
  tone: string[];
  scores: Partial<Record<"correctness" | "clarity" | "conciseness" | "readability" | "engagement" | "consistency" | "goalAlignment" | "overall", number>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseProviderPayload(value: unknown): ProviderPayload | null {
  const parsed = parseJsonContent(value);
  if (!isRecord(parsed)) return null;
  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const issues = rawIssues.flatMap((raw): ProviderIssue[] => {
    if (!isRecord(raw) || typeof raw.start !== "number" || !Number.isFinite(raw.start) || typeof raw.end !== "number" || !Number.isFinite(raw.end) || typeof raw.original !== "string" || typeof raw.category !== "string" || typeof raw.severity !== "string") return [];
    return [{
      start: raw.start,
      end: raw.end,
      original: raw.original,
      replacement: typeof raw.replacement === "string" ? raw.replacement : "",
      category: raw.category,
      severity: raw.severity,
      confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
      title: typeof raw.title === "string" ? raw.title : "Writing suggestion",
      explanation: typeof raw.explanation === "string" ? raw.explanation : "Review this change before applying it.",
      ruleId: typeof raw.ruleId === "string" ? raw.ruleId : undefined,
    }];
  });
  const rawScores = isRecord(parsed.scores) ? parsed.scores : {};
  const scores = Object.fromEntries(Object.entries(rawScores).filter(([, score]) => typeof score === "number" && Number.isFinite(score))) as ProviderPayload["scores"];
  return { issues, tone: Array.isArray(parsed.tone) ? parsed.tone.filter((tone): tone is string => typeof tone === "string") : [], scores };
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;

  constructor(code: ProviderErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "ProviderError";
  }
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function parseCustomHeaders(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key, item]) => typeof item === "string" && key.length < 80 && !/^(authorization|cookie|host|content-length|set-cookie|proxy-authorization|proxy-authenticate|x-api-key)$/iu.test(key))
        .map(([key, item]) => [key, String(item).slice(0, 500)]),
    );
  } catch {
    return {};
  }
}

export function validateProviderUrl(baseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw new ProviderError("invalid-url", "Enter a valid provider URL, including https://.");
  }
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.hash) {
    throw new ProviderError("invalid-url", "Provider URLs cannot contain credentials or fragments.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    throw new ProviderError("insecure-url", "Use HTTPS for provider URLs. HTTP is allowed only for localhost development.");
  }
  return parsed;
}

function endpointFor(baseUrl: string) {
  const parsed = validateProviderUrl(baseUrl);
  const path = parsed.pathname.replace(/\/$/u, "");
  parsed.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  return parsed.toString();
}

function parseJsonContent(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const cleaned = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function contentFromPayload(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return null;
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  const content = first.message.content;
  if (Array.isArray(content)) {
    return content.flatMap((part) => {
      if (typeof part === "string") return [part];
      if (isRecord(part) && typeof part.text === "string") return [part.text];
      return [];
    }).join("");
  }
  return typeof content === "string" ? content : null;
}

function providerErrorForStatus(status: number) {
  if (status === 401 || status === 403) return new ProviderError("unauthorized", "The provider rejected this API key.", status);
  if (status === 404) return new ProviderError("invalid-model", "The provider could not find this model or endpoint.", status);
  if (status === 429) return new ProviderError("rate-limited", "The provider is rate-limiting requests. Try again in a moment.", status);
  return new ProviderError("unknown", `The provider returned an error (${status}).`, status);
}

async function requestProvider(
  settings: ProviderSettings,
  messages: Array<{ role: "system" | "user"; content: string }>,
  signal?: AbortSignal,
  timeoutMs = 25_000,
) {
  if (!settings.apiKey.trim()) throw new ProviderError("missing-key", "Add an API key in Settings to enable AI suggestions.");
  const model = settings.model.trim();
  if (!model || model.length > 200 || /[\u0000-\u001f]/u.test(model)) throw new ProviderError("invalid-model", "Add a valid model ID in Settings before enabling AI.");
  const endpoint = endpointFor(settings.baseUrl);
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), Math.max(1_000, timeoutMs));
  const cancel = () => timeoutController.abort();
  signal?.addEventListener("abort", cancel, { once: true });

  const call = async (includeResponseFormat: boolean) => {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: timeoutController.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey.trim()}`,
        ...parseCustomHeaders(settings.customHeaders),
      },
      body: JSON.stringify({
        model,
        temperature: Math.max(0, Math.min(1, settings.temperature)),
        max_tokens: Math.max(100, Math.min(4000, settings.maxTokens)),
        ...(includeResponseFormat ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
    });
    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      if (includeResponseFormat && response.status === 400 && /response_format|json_object|unsupported/iu.test(responseText)) return call(false);
      throw providerErrorForStatus(response.status);
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_PROVIDER_RESPONSE_CHARS) throw new ProviderError("invalid-json", "The provider response was too large to process safely.");
    let responseText: string;
    try {
      responseText = await response.text();
    } catch {
      throw new ProviderError("invalid-json", "The provider returned a response that was not valid JSON.");
    }
    if (responseText.length > MAX_PROVIDER_RESPONSE_CHARS) throw new ProviderError("invalid-json", "The provider response was too large to process safely.");
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new ProviderError("invalid-json", "The provider returned a response that was not valid JSON.");
    }
    return contentFromPayload(payload);
  };

  try {
    return await call(true);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new ProviderError("timeout", "The provider took too long to respond.");
    if (error instanceof TypeError) throw new ProviderError("cors", "The provider could not be reached. This may be a CORS or network permission issue.");
    throw new ProviderError("unknown", "The provider request failed. Local analysis is still available.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

function buildGoalsContext(goals: WritingGoals, preferences?: StylePreferences) {
  return [
    `Audience: ${goals.audience}.`,
    `Intent: ${goals.intent}.`,
    `Desired tone: ${goals.tone}.`,
    `Dialect: ${preferences?.dialect ?? "en-GB"}.`,
    `Contractions: ${preferences?.allowContractions === false ? "avoid" : "allowed"}.`,
  ].join(" ");
}

function analysisPrompt(chunk: AnalysisChunk, goals: WritingGoals, preferences?: StylePreferences) {
  return `You are Draftwise, a careful writing editor. Return JSON only. ${buildGoalsContext(goals, preferences)}
Preserve meaning, facts, names, numbers, URLs, and quoted text. Suggest only high-confidence, useful changes. Never silently rewrite the whole passage.
This is chunk ${chunk.id}. Return ranges relative to the text below, not the full document. Every original must exactly match its range. Use one of these stable categories: spelling, grammar, punctuation, clarity, conciseness, word choice, repetition, tone, formality, readability, fluency, passive voice, sentence structure, consistency, capitalization. Include confidence from 0 to 1 and a ruleId.
JSON shape: {"issues":[{"start":0,"end":4,"original":"text","replacement":"Text","category":"grammar","severity":"medium","confidence":0.9,"ruleId":"grammar-example","title":"Short title","explanation":"Plain explanation."}],"tone":["direct"]}

Text for ${chunk.id}:
${chunk.text}`;
}

function normaliseCategory(value: string): IssueCategory | null {
  return CATEGORY_ALIASES[value.toLocaleLowerCase().trim()] ?? null;
}

export function parseAnalysisIssues(value: unknown, sourceText: string, chunkId?: string): WritingIssue[] {
  const parsed = parseProviderPayload(value);
  if (!parsed) return [];
  return parsed.issues.flatMap((candidate, index) => {
    const start = Math.max(0, Math.floor(candidate.start));
    const end = Math.min(sourceText.length, Math.floor(candidate.end));
    const category = normaliseCategory(candidate.category);
    const severity = candidate.severity.toLocaleLowerCase() as IssueSeverity;
    if (!category || !VALID_SEVERITIES.has(severity) || end <= start) return [];
    const original = sourceText.slice(start, end);
    if (!original || original !== candidate.original) return [];
    const confidence = Math.max(0, Math.min(1, candidate.confidence ?? 0.72));
    return [{
      id: `ai-${chunkId ?? "full"}-${start}-${end}-${index}`,
      ruleId: candidate.ruleId?.slice(0, 80) || "ai-suggestion",
      chunkId,
      start,
      end,
      original,
      replacement: candidate.replacement.slice(0, 1000),
      category,
      severity,
      confidence,
      title: candidate.title.slice(0, 120),
      explanation: candidate.explanation.slice(0, 500),
      source: "ai" as const,
    }];
  });
}

export function parseAnalysisResponse(value: unknown, sourceText: string, options: { preferences?: GrammarOptions; goals?: WritingGoals } = {}): AnalysisResult | null {
  const startedAt = providerAnalysisNow();
  const parsed = parseProviderPayload(value);
  if (!parsed) return null;
  const local = analyzeLocally(sourceText, options.preferences, options.goals);
  const aiIssues = parseAnalysisIssues(value, sourceText);
  const issues = mergeAnalysisIssues([...local.issues, ...aiIssues]);
  const stats = getWritingStats(sourceText);
  const scores = scoreWriting(stats, issues, options.goals, sourceText);
  const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "provider");
  return {
    analysedText: sourceText,
    issues,
    tone: parsed.tone.length ? parsed.tone.slice(0, 4) : inferTone(sourceText),
    scores,
    stats,
    source: aiIssues.length ? "local+ai" : "local",
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export interface ProviderAnalysisOptions {
  signal?: AbortSignal;
  preferences?: StylePreferences;
  changedRange?: ChangedRange | null;
  maxChunkChars?: number;
  contextWindow?: number;
  timeoutMs?: number;
  localAnalysis?: AnalysisResult;
}

export async function analyzeWithProvider(
  text: string,
  goals: WritingGoals,
  settings: ProviderSettings,
  options: ProviderAnalysisOptions = {},
) {
  const startedAt = providerAnalysisNow();
  const preferences = options.preferences;
  const local = options.localAnalysis ?? analyzeLocally(text, preferences, goals);
  const changed = options.changedRange && text.length > options.changedRange.start
    ? expandRangeToContext(text, options.changedRange, options.contextWindow ?? 320)
    : null;
  const chunks = createAnalysisChunks(text, {
    maxChars: options.maxChunkChars ?? 8_000,
    contextWindow: options.contextWindow ?? 320,
    startOffset: changed?.start,
    endOffset: changed?.end,
  });
  if (!chunks.length) return { ...local, analysedText: text, source: "local" as const } satisfies AnalysisResult;
  const settled = await Promise.allSettled(chunks.map(async (chunk) => ({
    chunk,
    response: await requestProvider(settings, [
      { role: "system", content: "You are a privacy-first writing assistant. Do not return HTML, markdown, or secrets." },
      { role: "user", content: analysisPrompt(chunk, goals, preferences) },
    ], options.signal, options.timeoutMs),
  })));
  const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!successful.length) {
    const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (firstFailure) throw firstFailure.reason;
  }
  const aiIssues = successful.flatMap(({ chunk, response }) => {
    return parseAnalysisIssues(response, chunk.text, chunk.id)
      .map((issue) => mapChunkIssue(issue, chunk, text))
      .filter((issue): issue is WritingIssue => Boolean(issue));
  });
  const issues = mergeAnalysisIssues([...local.issues, ...aiIssues]);
  const stats = getWritingStats(text);
  const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "provider");
  return {
    ...local,
    analysedText: text,
    issues,
    scores: scoreWriting(stats, issues, goals, text),
    stats,
    source: aiIssues.length ? "local+ai" : "local",
    changedRange: options.changedRange ?? undefined,
    ...(diagnostics ? { diagnostics } : {}),
  } satisfies AnalysisResult;
}

function localRewrite(text: string, instruction: string): string {
  const lower = instruction.toLocaleLowerCase();
  let result = text.replace(/\s{2,}/gu, " ").trim();
  if (lower.includes("shorten") || lower.includes("concise")) {
    result = result.replace(/\b(?:actually|basically|just|really|quite|very|perhaps|simply)\b\s*/giu, "").replace(/\bin order to\b/giu, "to").replace(/\bat this point in time\b/giu, "now");
  }
  if (lower.includes("formal") || lower.includes("professional") || lower.includes("academic")) result = result.replace(/\bcan't\b/giu, "cannot").replace(/\bwon't\b/giu, "will not").replace(/\bget\b/giu, "receive");
  if (lower.includes("casual") || lower.includes("friendly")) result = result.replace(/\bcannot\b/giu, "can't").replace(/\bwill not\b/giu, "won't");
  if (lower.includes("confident")) result = result.replace(/\b(might|maybe|perhaps|could)\b/giu, "can");
  if (lower.includes("simplify")) result = result.replace(/\butilize\b/giu, "use").replace(/\bapproximately\b/giu, "about");
  return result || text;
}

function protectedTokens(text: string) {
  const patterns = [
    /https?:\/\/[^\s)]+/giu,
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu,
    /\b(?:\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*|\s+)\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})\b/giu,
    /(?:[$€£¥]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:usd|eur|gbp|jpy)\b)/giu,
    /\b\d[\d,.]*%/gu,
    /\b(?:id|ticket|case|ref(?:erence)?)[#\s:-]*[a-z0-9][a-z0-9_-]{2,}\b/giu,
    /\b[A-Z][A-Z0-9]{1,}(?:-[A-Z0-9]+)+\b/g,
    /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu,
    /\b(?:gpt|claude|gemini|llama|model|v)\s*[-_.]?\d[\w.-]*/giu,
    /\b[\w.-]+\.(?:pdf|docx?|csv|xlsx?|json|ts|tsx|js|jsx|md|png|jpe?g|gif)\b/giu,
    /[“"'](?:[^“"']|[“"']{1,2})+[”"']/gu,
    /\b\d[\d,.]*\b/gu,
  ];
  return [...new Set(patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0])))];
}

function explicitlyAllowsProtectedChanges(request: RewriteRequest) {
  if (request.allowProtectedChanges) return true;
  return /\b(?:change|update|replace|adjust|convert|reformat|correct)\b[\s\S]{0,80}\b(?:number|date|percentage|percent|currency|url|email|id|identifier|quote|filename|model|version|value)s?\b/iu.test(request.instruction);
}

function validateRewrite(original: string, replacement: string, allowProtectedChanges = false) {
  if (!replacement.trim()) throw new ProviderError("invalid-json", "The provider returned an empty rewrite. Nothing was changed.");
  if (/<[^>]+>/u.test(replacement)) throw new ProviderError("invalid-json", "The provider returned markup. Nothing was changed.");
  if (!allowProtectedChanges) {
    for (const token of protectedTokens(original)) {
      const originalCount = original.split(token).length - 1;
      const replacementCount = replacement.split(token).length - 1;
      if (replacementCount < originalCount) throw new ProviderError("invalid-json", "The rewrite changed a protected URL, value, identifier, or quoted passage. Nothing was changed.");
    }
  }
  return replacement.trim();
}

export async function rewriteWithProvider(
  request: RewriteRequest,
  settings: ProviderSettings,
  signal?: AbortSignal,
): Promise<RewriteResult> {
  if (!settings.apiKey.trim()) return { replacement: localRewrite(request.text, request.instruction), alternatives: [], explanation: "Local rewrite: AI is off, so your text stayed on this device.", source: "local" };
  const response = await requestProvider(settings, [
    { role: "system", content: `You are a careful writing partner. Return JSON only with {"replacement":"...","alternatives":["..."],"explanation":"..."}. Include up to two genuinely different alternatives when useful. ${buildGoalsContext(request.goals, request.preferences)} Preserve meaning, facts, names, numbers, URLs, dates, identifiers, filenames, and quoted text. Do not add HTML or markdown.` },
    { role: "user", content: `Instruction: ${request.instruction}\n\nText to rewrite:\n${request.text}` },
  ], signal);
  const parsed = parseJsonContent(response);
  if (!isRecord(parsed) || typeof parsed.replacement !== "string" || !parsed.replacement.trim()) throw new ProviderError("invalid-json", "The provider returned an invalid rewrite. Nothing was changed.");
  const explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";
  const allowProtectedChanges = explicitlyAllowsProtectedChanges(request);
  const replacement = validateRewrite(request.text, parsed.replacement, allowProtectedChanges);
  const alternatives = Array.isArray(parsed.alternatives)
    ? parsed.alternatives
      .filter((alternative): alternative is string => typeof alternative === "string" && Boolean(alternative.trim()) && alternative.trim() !== replacement)
      .slice(0, 2)
      .flatMap((alternative) => {
        try {
          return [validateRewrite(request.text, alternative, allowProtectedChanges)];
        } catch {
          return [];
        }
      })
    : [];
  return { replacement, alternatives, explanation: explanation.slice(0, 500), source: "ai" };
}

// ---------------------------------------------------------------------------
// classifier.dev triage: cheap gate before expensive provider calls.
// Local rules always run first. Only unresolved/ambiguous chunks are sent to
// classifier.dev, and only `ai-needed` chunks proceed to the provider.
// classifier.dev never rewrites user text; it returns decisions only.
// ---------------------------------------------------------------------------

export const TRIAGE_TAXONOMY: TriageCategory[] = [
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

export const DEFAULT_CLASSIFIER_SETTINGS_VALUE: ClassifierSettings = {
  baseUrl: "https://classifier.dev/v1",
  model: "draftwise-triage-v1",
  apiKey: "",
  timeoutMs: 8_000,
  maxExcerptChars: 500,
};

export const CLASSIFIER_DEBOUNCE_MS = 650;
export const CLASSIFIER_MAX_EXCERPT_CHARS = 500;
export const CLASSIFIER_MAX_BATCH_CHUNKS = 5;

export class ClassifierError extends Error {
  readonly code: ClassifierErrorCode;
  readonly status?: number;

  constructor(code: ClassifierErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "ClassifierError";
  }
}

function classifierNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

export function validateClassifierUrl(baseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(String(baseUrl || "").trim());
  } catch {
    throw new ClassifierError("invalid-url", "Enter a valid classifier URL, including https://.");
  }
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.hash) {
    throw new ClassifierError("invalid-url", "Classifier URLs cannot contain credentials or fragments.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    throw new ClassifierError("insecure-url", "Use HTTPS for classifier URLs. HTTP is allowed only for localhost development.");
  }
  return parsed;
}

function endpointForClassifier(baseUrl: string) {
  const parsed = validateClassifierUrl(baseUrl);
  const path = parsed.pathname.replace(/\/$/u, "");
  parsed.pathname = path.endsWith("/classify") ? path : `${path}/classify`;
  return parsed.toString();
}

function classifierErrorForStatus(status: number) {
  if (status === 401 || status === 403) return new ClassifierError("unauthorized", "The classifier rejected this API key.", status);
  if (status === 404) return new ClassifierError("invalid-model", "The classifier could not find this model or endpoint.", status);
  if (status === 429) return new ClassifierError("rate-limited", "The classifier is rate-limiting requests. Local checks remain available.", status);
  return new ClassifierError("unknown", `The classifier returned an error (${status}).`, status);
}

const LOCAL_TO_TRIAGE: Record<string, TriageCategory> = {
  spelling: "correctness",
  grammar: "correctness",
  punctuation: "correctness",
  capitalization: "correctness",
  clarity: "clarity",
  conciseness: "conciseness",
  repetition: "conciseness",
  tone: "tone",
  consistency: "consistency",
  "sentence structure": "structure",
  readability: "structure",
  "word choice": "word-choice",
  formality: "style",
  fluency: "style",
  "passive voice": "style",
};

export function mapLocalCategoryToTriage(category: string): TriageCategory {
  return LOCAL_TO_TRIAGE[category] ?? "other";
}

export function normaliseTriageCategory(value: unknown): TriageCategory {
  const raw = String(value ?? "").toLocaleLowerCase().trim().replace(/_/gu, "-").replace(/\s+/gu, "-");
  const aliases: Record<string, TriageCategory> = {
    "correctness": "correctness",
    "grammar": "correctness",
    "spelling": "correctness",
    "clarity": "clarity",
    "conciseness": "conciseness",
    "concise": "conciseness",
    "engagement": "engagement",
    "tone": "tone",
    "consistency": "consistency",
    "structure": "structure",
    "sentence-structure": "structure",
    "word-choice": "word-choice",
    "wordchoice": "word-choice",
    "word": "word-choice",
    "style": "style",
    "other": "other",
    "unknown": "other",
    "": "other",
  };
  return aliases[raw] ?? "other";
}

export function normaliseTriageDecision(value: unknown): TriageDecision | null {
  const raw = String(value ?? "").toLocaleLowerCase().trim().replace(/[\s_]+/gu, "-");
  if (["ai-needed", "ai-needed ", "need-ai", "needs-ai", "ai", "needs-review", "requires-ai"].includes(raw)) return "ai-needed";
  if (["locally-sufficient", "locally-sufficient ", "local", "sufficient", "local-only", "no-ai"].includes(raw)) return "locally-sufficient";
  if (["uncertain", "unsure", "unknown", "other", "fallback"].includes(raw)) return "uncertain";
  return null;
}

/** Minimise transmitted text: truncate to a word boundary and redact structured tokens. */
export function redactExcerptForClassifier(text: string) {
  return String(text || "")
    .replace(/https?:\/\/[^\s)]+/giu, "[url]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu, "[email]")
    .replace(/\b(?:\d{1,3}(?:[,.]\d{3})+|\d{4,})\b/gu, "[number]")
    .replace(/\b\d[\d.,]*%/gu, "[percent]");
}

export function buildClassifierExcerpt(chunkText: string, maxChars = CLASSIFIER_MAX_EXCERPT_CHARS) {
  const redacted = redactExcerptForClassifier(chunkText).trim();
  const limit = Math.max(80, Math.min(2_000, maxChars));
  if (redacted.length <= limit) return redacted;
  const sliced = redacted.slice(0, limit);
  const boundary = sliced.search(/\s[^\s]*$/u);
  return (boundary > limit * 0.6 ? sliced.slice(0, boundary) : sliced).trim();
}

export interface ChunkTriageSignals {
  localIssueCount: number;
  localCategories: string[];
  hasLongSentence: boolean;
  hasVagueOrFiller: boolean;
  hasPassiveOrWordiness: boolean;
}

const VAGUE_OR_FILLER_PATTERN = /\b(thing|things|stuff|somehow|various|aspects|actually|basically|just|really|quite|very|perhaps|simply|somewhat|obviously|extremely|incredibly|totally|absolutely)\b/iu;
const WORDINESS_PATTERN = /\b(in order to|at this point in time|due to the fact that|a number of|in the event that|for the purpose of|in close proximity to|make a decision|made a decision|come to a conclusion|at the end of the day|think outside the box|low-hanging fruit|moving forward|game changer)\b/iu;
const PASSIVE_PATTERN = /\b(?:was|were|is|are|be|been|being)\s+(?:being\s+)?[\p{L}]+(?:ed|en)\b/iu;
const HEDGE_PATTERN = /\b(might|maybe|perhaps|could|possibly|uncertain|sort of|kind of)\b/iu;

export function collectChunkSignals(chunkText: string, issuesInChunk: WritingIssue[]): ChunkTriageSignals {
  const sentences = String(chunkText || "").split(/(?<=[.!?…])\s+|\n+/u);
  const hasLongSentence = sentences.some((sentence) => sentence.trim().split(/\s+/u).filter(Boolean).length > 32);
  const hasVagueOrFiller = VAGUE_OR_FILLER_PATTERN.test(chunkText) || WORDINESS_PATTERN.test(chunkText) || HEDGE_PATTERN.test(chunkText);
  const hasPassiveOrWordiness = PASSIVE_PATTERN.test(chunkText) || WORDINESS_PATTERN.test(chunkText);
  return {
    localIssueCount: issuesInChunk.length,
    localCategories: [...new Set(issuesInChunk.map((issue) => issue.category))],
    hasLongSentence,
    hasVagueOrFiller,
    hasPassiveOrWordiness,
  };
}

export function inferTriageCategories(chunkText: string, issuesInChunk: WritingIssue[]): TriageCategory[] {
  const mapped = issuesInChunk.map((issue) => mapLocalCategoryToTriage(issue.category));
  const signals = collectChunkSignals(chunkText, issuesInChunk);
  const extra: TriageCategory[] = [];
  if (signals.hasLongSentence) extra.push("structure");
  if (signals.hasVagueOrFiller) extra.push("clarity");
  if (signals.hasPassiveOrWordiness) extra.push("style");
  if (issuesInChunk.length === 0 && chunkText.trim().split(/\s+/u).length > 25) extra.push("engagement");
  if (HEDGE_PATTERN.test(chunkText)) extra.push("tone");
  const merged = [...new Set([...mapped, ...extra])];
  return merged.length ? merged.slice(0, 4) as TriageCategory[] : ["other"];
}

export interface UnresolvedAssessment {
  unresolved: boolean;
  reasons: string[];
  categories: TriageCategory[];
}

/** Local-first heuristic: decide whether a chunk is unresolved/ambiguous and may need AI. */
export function isChunkUnresolved(chunkText: string, issuesInChunk: WritingIssue[]): UnresolvedAssessment {
  const text = String(chunkText || "");
  const trimmed = text.trim();
  const categories = inferTriageCategories(text, issuesInChunk);
  if (trimmed.length < 20) {
    return { unresolved: false, reasons: ["too-short"], categories: [] };
  }
  const signals = collectChunkSignals(text, issuesInChunk);
  if (!issuesInChunk.length) {
    if (signals.hasLongSentence || signals.hasVagueOrFiller || signals.hasPassiveOrWordiness) {
      return { unresolved: true, reasons: ["no-local-issues-but-ambiguous-signals"], categories };
    }
    const words = trimmed.split(/\s+/u).length;
    if (words > 40 || /[;:—–]/.test(trimmed) || HEDGE_PATTERN.test(trimmed)) {
      return { unresolved: true, reasons: ["long-or-nuanced-clean-text"], categories };
    }
    // Low-engagement clean text: longer, no direct address, no questions.
    // Needs AI for engagement/structure even when local finds nothing.
    if (words > 25 && !/\b(you|we|our|your|us|\?)\b/iu.test(trimmed)) {
      return { unresolved: true, reasons: ["low-engagement-clean-text"], categories: categories.length ? categories : ["engagement"] };
    }
    return { unresolved: false, reasons: ["clean"], categories: [] };
  }
  const hasLowConfidence = issuesInChunk.some((issue) => !Number.isFinite(issue.confidence) || issue.confidence < 0.85);
  if (hasLowConfidence) {
    return { unresolved: true, reasons: ["low-confidence-local"], categories };
  }
  const needsDepth = issuesInChunk.some((issue) =>
    ["clarity", "tone", "consistency", "sentence structure", "readability", "fluency", "word choice", "formality"].includes(issue.category),
  );
  if (needsDepth) {
    return { unresolved: true, reasons: ["needs-semantic-depth"], categories };
  }
  if (signals.hasLongSentence || signals.hasVagueOrFiller || signals.hasPassiveOrWordiness) {
    const onlyCorrectness = issuesInChunk.every((issue) =>
      ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category) && (issue.confidence ?? 0) >= 0.9,
    );
    if (!onlyCorrectness) {
      return { unresolved: true, reasons: ["ambiguous-signals-with-style-issues"], categories };
    }
    // High-confidence correctness-only issues with ambiguous signals can still
    // benefit from a tone/structure check, but local fixes suffice for the
    // immediate pass. Keep locally sufficient to avoid extra cloud calls.
    return { unresolved: false, reasons: ["high-confidence-correctness-only"], categories: [] };
  }
  const onlyHighConfidenceCorrectness = issuesInChunk.every((issue) =>
    ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category) && (issue.confidence ?? 0) >= 0.9,
  );
  if (onlyHighConfidenceCorrectness) {
    return { unresolved: false, reasons: ["high-confidence-correctness-only"], categories: [] };
  }
  return { unresolved: true, reasons: ["mixed-issues"], categories };
}

export function selectTriageCandidates(
  chunks: AnalysisChunk[],
  localIssues: WritingIssue[],
): Array<{ chunk: AnalysisChunk; issues: WritingIssue[]; assessment: UnresolvedAssessment }> {
  return chunks.map((chunk) => {
    const issues = localIssues.filter((issue) => issue.start < chunk.endOffset && issue.end > chunk.startOffset);
    return { chunk, issues, assessment: isChunkUnresolved(chunk.text, issues) };
  });
}

export function buildClassifierInputs(
  candidates: Array<{ chunk: AnalysisChunk; issues: WritingIssue[]; assessment: UnresolvedAssessment }>,
  maxExcerptChars = CLASSIFIER_MAX_EXCERPT_CHARS,
): ClassifierChunkInput[] {
  return candidates
    .filter((candidate) => candidate.assessment.unresolved)
    .map((candidate) => {
      const signals = collectChunkSignals(candidate.chunk.text, candidate.issues);
      return {
        chunkId: candidate.chunk.id,
        excerpt: buildClassifierExcerpt(candidate.chunk.text, maxExcerptChars),
        startOffset: candidate.chunk.startOffset,
        endOffset: candidate.chunk.endOffset,
        signals: {
          localIssueCount: signals.localIssueCount,
          localCategories: signals.localCategories,
          hasLongSentence: signals.hasLongSentence,
          hasVagueOrFiller: signals.hasVagueOrFiller,
          hasPassiveOrWordiness: signals.hasPassiveOrWordiness,
        },
        categories: candidate.assessment.categories,
      };
    });
}

/**
 * Validate classifier.dev output. The classifier must never rewrite user text:
 * any replacement/rewrite/corrected fields are discarded and never returned.
 */
export function parseClassifierDecisions(value: unknown, expectedInputs: ClassifierChunkInput[]): ClassifierChunkDecision[] {
  const expectedIds = new Set(expectedInputs.map((input) => input.chunkId));
  let rawList: unknown[] = [];
  if (Array.isArray(value)) rawList = value;
  else if (isRecord(value) && Array.isArray((value as Record<string, unknown>).results)) rawList = (value as Record<string, unknown>).results as unknown[];
  else if (isRecord(value) && Array.isArray((value as Record<string, unknown>).decisions)) rawList = (value as Record<string, unknown>).decisions as unknown[];
  else if (isRecord(value) && typeof (value as Record<string, unknown>).chunkId === "string") rawList = [value];
  else return [];
  const seen = new Set<string>();
  return rawList.flatMap((raw): ClassifierChunkDecision[] => {
    if (!isRecord(raw) || typeof raw.chunkId !== "string" || !expectedIds.has(raw.chunkId)) return [];
    if (seen.has(raw.chunkId)) return [];
    // Explicitly ignore rewrite-like fields: classifier.dev must never rewrite.
    // Accepted keys are decision/categories/confidence/reason only.
    const decision = normaliseTriageDecision((raw as Record<string, unknown>).decision);
    const finalDecision: TriageDecision = decision ?? "uncertain";
    const rawCategories = (raw as Record<string, unknown>).categories;
    const categories = Array.isArray(rawCategories)
      ? [...new Set(rawCategories.map(normaliseTriageCategory))].slice(0, 4)
      : ["other" as TriageCategory];
    const confidenceRaw = (raw as Record<string, unknown>).confidence;
    const confidence = typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0.5;
    const reasonRaw = (raw as Record<string, unknown>).reason;
    const reason = typeof reasonRaw === "string" ? reasonRaw.slice(0, 300) : finalDecision === "uncertain" ? "unclassified fallback" : "";
    seen.add(raw.chunkId);
    return [{
      chunkId: raw.chunkId,
      decision: finalDecision,
      categories: categories.length ? categories : ["other"],
      confidence,
      reason,
      fallback: decision === null,
    }];
  });
}

export interface ClassifierRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function requestClassifierDecisions(
  inputs: ClassifierChunkInput[],
  settings: ClassifierSettings,
  options: ClassifierRequestOptions = {},
): Promise<ClassifierChunkDecision[]> {
  if (!inputs.length) return [];
  if (!settings.apiKey.trim()) throw new ClassifierError("missing-key", "Add a classifier API key to enable cloud triage.");
  const model = String(settings.model || "").trim();
  if (!model || model.length > 200 || /[\u0000-\u001f]/u.test(model)) throw new ClassifierError("invalid-model", "Add a valid classifier model ID.");
  const endpoint = endpointForClassifier(settings.baseUrl);
  const timeoutMs = Math.max(1_000, Math.min(30_000, options.timeoutMs ?? settings.timeoutMs ?? 8_000));
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const cancel = () => timeoutController.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: timeoutController.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        // Minimal payload: excerpt + signals + goals context only. Never full document.
        inputs: inputs.map((input) => ({
          chunkId: input.chunkId,
          excerpt: input.excerpt,
          signals: input.signals,
          categories: input.categories,
        })),
      }),
    });
    if (!response.ok) throw classifierErrorForStatus(response.status);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > 500_000) throw new ClassifierError("invalid-json", "The classifier response was too large.");
    let responseText: string;
    try {
      responseText = await response.text();
    } catch {
      throw new ClassifierError("invalid-json", "The classifier returned an unreadable response.");
    }
    if (responseText.length > 500_000) throw new ClassifierError("invalid-json", "The classifier response was too large.");
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new ClassifierError("invalid-json", "The classifier returned invalid JSON.");
    }
    return parseClassifierDecisions(payload, inputs);
  } catch (error) {
    if (error instanceof ClassifierError) throw error;
    if (options.signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new ClassifierError("timeout", "The classifier took too long to respond.");
    if (error instanceof TypeError) throw new ClassifierError("cors", "The classifier could not be reached.");
    throw new ClassifierError("unknown", "The classifier request failed.");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}

function fallbackDecision(input: ClassifierChunkInput, reason: string): ClassifierChunkDecision {
  return {
    chunkId: input.chunkId,
    decision: "uncertain",
    categories: input.categories.length ? input.categories : ["other"],
    confidence: 0.5,
    reason: reason.slice(0, 300),
    fallback: true,
  };
}

export interface TriageOptions {
  signal?: AbortSignal;
  classifier?: ClassifierSettings | null;
  uncertainPolicy?: "allow" | "skip";
  maxExcerptChars?: number;
  timeoutMs?: number;
}

export interface TriageOutcome {
  decisions: ClassifierChunkDecision[];
  candidateCount: number;
  metrics: TriageMetrics;
}

/** Local-first triage: heuristic selects candidates, classifier.dev filters, fallback stays local. */
export async function triageChunks(
  chunks: AnalysisChunk[],
  localIssues: WritingIssue[],
  options: TriageOptions = {},
): Promise<TriageOutcome> {
  const startedAt = classifierNow();
  const assessed = selectTriageCandidates(chunks, localIssues);
  const locallySufficient = assessed.filter((item) => !item.assessment.unresolved);
  const inputs = buildClassifierInputs(assessed, options.maxExcerptChars ?? CLASSIFIER_MAX_EXCERPT_CHARS);
  const decisions: ClassifierChunkDecision[] = locallySufficient.map((item) => ({
    chunkId: item.chunk.id,
    decision: "locally-sufficient" as const,
    categories: [],
    confidence: 0.9,
    reason: `locally sufficient: ${item.assessment.reasons.join(",") || "clean"}`,
  }));
  if (!inputs.length) {
    return {
      decisions,
      candidateCount: 0,
      metrics: {
        candidateChunks: 0,
        classifierCalls: 0,
        providerCalls: 0,
        avoidedProviderCalls: chunks.length,
        fallbackCount: 0,
        processingMs: Math.max(0, Math.round((classifierNow() - startedAt) * 100) / 100),
      },
    };
  }
  const classifier = options.classifier;
  const hasClassifierKey = Boolean(classifier?.apiKey?.trim()) && Boolean(classifier?.baseUrl?.trim()) && Boolean(classifier?.model?.trim());
  if (!classifier || !hasClassifierKey) {
    // Heuristic-only mode: unresolved candidates proceed to AI, clean chunks do not.
    // This still avoids provider calls without any network use.
    for (const input of inputs) {
      decisions.push({
        chunkId: input.chunkId,
        decision: "ai-needed",
        categories: input.categories,
        confidence: 0.65,
        reason: "heuristic unresolved; classifier unavailable",
        fallback: true,
      });
    }
    return {
      decisions,
      candidateCount: inputs.length,
      metrics: {
        candidateChunks: inputs.length,
        classifierCalls: 0,
        providerCalls: inputs.length,
        avoidedProviderCalls: Math.max(0, chunks.length - inputs.length),
        fallbackCount: inputs.length,
        processingMs: Math.max(0, Math.round((classifierNow() - startedAt) * 100) / 100),
      },
    };
  }
  try {
    const results = await requestClassifierDecisions(inputs, classifier, { signal: options.signal, timeoutMs: options.timeoutMs ?? classifier.timeoutMs });
    const byId = new Map(results.map((result) => [result.chunkId, result]));
    let fallbacks = 0;
    for (const input of inputs) {
      const found = byId.get(input.chunkId);
      if (found) decisions.push(found);
      else {
        fallbacks += 1;
        decisions.push(fallbackDecision(input, "classifier omitted chunk; local fallback"));
      }
    }
    const aiNeeded = decisions.filter((item) => item.decision === "ai-needed").length;
    const uncertainAllowed = options.uncertainPolicy === "allow"
      ? decisions.filter((item) => item.decision === "uncertain").length
      : 0;
    return {
      decisions,
      candidateCount: inputs.length,
      metrics: {
        candidateChunks: inputs.length,
        classifierCalls: 1,
        providerCalls: aiNeeded + uncertainAllowed,
        avoidedProviderCalls: Math.max(0, chunks.length - aiNeeded - uncertainAllowed),
        fallbackCount: decisions.filter((item) => item.fallback).length + fallbacks,
        processingMs: Math.max(0, Math.round((classifierNow() - startedAt) * 100) / 100),
      },
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // Safe fallback: keep local results, do not trigger expensive AI on classifier failure.
    // `uncertain` with skip policy means provider is skipped; metrics record the fallback.
    for (const input of inputs) {
      const message = error instanceof ClassifierError ? error.message : "classifier unavailable";
      decisions.push(fallbackDecision(input, `classifier fallback: ${message}`));
    }
    return {
      decisions,
      candidateCount: inputs.length,
      metrics: {
        candidateChunks: inputs.length,
        classifierCalls: 1,
        providerCalls: options.uncertainPolicy === "allow" ? inputs.length : 0,
        avoidedProviderCalls: options.uncertainPolicy === "allow" ? Math.max(0, chunks.length - inputs.length) : chunks.length,
        fallbackCount: inputs.length,
        processingMs: Math.max(0, Math.round((classifierNow() - startedAt) * 100) / 100),
      },
    };
  }
}

export function filterChunksForProvider(
  chunks: AnalysisChunk[],
  decisions: ClassifierChunkDecision[],
  uncertainPolicy: "allow" | "skip" = "skip",
) {
  const byId = new Map(decisions.map((decision) => [decision.chunkId, decision]));
  return chunks.filter((chunk) => {
    const decision = byId.get(chunk.id);
    if (!decision) return false;
    if (decision.decision === "ai-needed") return true;
    if (decision.decision === "uncertain" && uncertainPolicy === "allow") return true;
    return false;
  });
}

// Bounded per-excerpt cache for classifier decisions (safe: keyed by excerpt hash + model).
class TriageCache {
  private readonly values = new Map<string, ClassifierChunkDecision>();
  private readonly limit: number;

  constructor(limit = 64) {
    this.limit = limit;
  }

  get(key: string) {
    const value = this.values.get(key);
    if (value !== undefined) {
      this.values.delete(key);
      this.values.set(key, value);
    }
    return value;
  }

  set(key: string, value: ClassifierChunkDecision) {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.limit) this.values.delete(this.values.keys().next().value as string);
  }

  clear() {
    this.values.clear();
  }

  get size() {
    return this.values.size;
  }
}

export function createClassifierCacheKey(excerpt: string, model: string, categories: TriageCategory[]) {
  let hash = 0;
  const source = `${model}:${categories.join(",")}:${excerpt}`;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  }
  return `${model}:${categories.join(",")}:${source.length}:${hash}`;
}

export interface TriageSchedulerOptions {
  classifier: ClassifierSettings;
  debounceMs?: number;
  maxBatchChunks?: number;
  maxExcerptChars?: number;
  uncertainPolicy?: "allow" | "skip";
  cacheLimit?: number;
}

/**
 * Intelligent debounce/batching scheduler for classifier.dev.
 * Coalesces rapid edits, batches up to maxBatchChunks per request,
 * caches per-excerpt decisions, and supports cancellation.
 */
export function createTriageScheduler(schedulerOptions: TriageSchedulerOptions) {
  const debounceMs = Math.max(100, Math.min(5_000, schedulerOptions.debounceMs ?? CLASSIFIER_DEBOUNCE_MS));
  const maxBatch = Math.max(1, Math.min(10, schedulerOptions.maxBatchChunks ?? CLASSIFIER_MAX_BATCH_CHUNKS));
  const cache = new TriageCache(schedulerOptions.cacheLimit ?? 64);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const queue: Array<{
    input: ClassifierChunkInput;
    resolve: (value: ClassifierChunkDecision) => void;
    reject: (reason: unknown) => void;
    signal?: AbortSignal;
  }> = [];
  let controller: AbortController | null = null;

  const flush = async () => {
    timer = null;
    const batch = queue.splice(0, queue.length);
    if (!batch.length) return;
    controller?.abort();
    controller = new AbortController();
    const active = batch.filter((item) => !item.signal?.aborted);
    for (const item of batch) {
      if (item.signal?.aborted) item.reject(new ClassifierError("unknown", "Triage request cancelled."));
    }
    if (!active.length) return;
    // Serve cached decisions without network.
    const uncached: typeof active = [];
    for (const item of active) {
      const key = createClassifierCacheKey(item.input.excerpt, schedulerOptions.classifier.model, item.input.categories);
      const cached = cache.get(key);
      if (cached) item.resolve({ ...cached, chunkId: item.input.chunkId });
      else uncached.push(item);
    }
    if (!uncached.length) return;
    // Batch into groups to bound request size.
    for (let offset = 0; offset < uncached.length; offset += maxBatch) {
      const group = uncached.slice(offset, offset + maxBatch);
      if (group.some((item) => item.signal?.aborted)) {
        for (const item of group) {
          if (item.signal?.aborted) item.reject(new ClassifierError("unknown", "Triage request cancelled."));
          else uncached.push(item);
        }
        continue;
      }
      try {
        const results = await requestClassifierDecisions(
          group.map((item) => item.input),
          schedulerOptions.classifier,
          { signal: controller.signal },
        );
        const byId = new Map(results.map((result) => [result.chunkId, result]));
        for (const item of group) {
          const found = byId.get(item.input.chunkId) ?? fallbackDecision(item.input, "classifier omitted chunk; local fallback");
          cache.set(createClassifierCacheKey(item.input.excerpt, schedulerOptions.classifier.model, item.input.categories), found);
          if (item.signal?.aborted) item.reject(new ClassifierError("unknown", "Triage request cancelled."));
          else item.resolve(found);
        }
      } catch (error) {
        if (controller.signal.aborted) {
          for (const item of group) item.reject(error);
          return;
        }
        for (const item of group) {
          const fallback = fallbackDecision(item.input, error instanceof Error ? error.message : "classifier fallback");
          if (item.signal?.aborted) item.reject(error);
          else item.resolve(fallback);
        }
      }
    }
  };

  const schedule = (inputs: ClassifierChunkInput[], signal?: AbortSignal) => {
    // Cancellation support: aborting the signal rejects pending entries.
    if (signal?.aborted) return Promise.reject(new ClassifierError("unknown", "Triage request cancelled."));
    const promises = inputs.map((input) => new Promise<ClassifierChunkDecision>((resolve, reject) => {
      const key = createClassifierCacheKey(input.excerpt, schedulerOptions.classifier.model, input.categories);
      const cached = cache.get(key);
      if (cached) {
        resolve({ ...cached, chunkId: input.chunkId });
        return;
      }
      queue.push({ input, resolve, reject, signal });
    }));
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), debounceMs);
    return Promise.all(promises);
  };

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
    const pending = queue.splice(0, queue.length);
    for (const item of pending) item.reject(new ClassifierError("unknown", "Triage request cancelled."));
  };

  const clear = () => cache.clear();

  return { schedule, cancel, clear, cache };
}

export interface ProviderTriageOptions extends ProviderAnalysisOptions {
  classifier?: ClassifierSettings | null;
  triageEnabled?: boolean;
  uncertainPolicy?: "allow" | "skip";
  classifierTimeoutMs?: number;
}

/**
 * Triaged provider analysis: local first, classifier.dev gate, expensive AI only when required.
 * Preserves incremental ranges via chunk ids and absolute offset mapping.
 */
export async function analyzeWithTriage(
  text: string,
  goals: WritingGoals,
  settings: ProviderSettings,
  options: ProviderTriageOptions = {},
) {
  const startedAt = providerAnalysisNow();
  const preferences = options.preferences;
  const local = options.localAnalysis ?? analyzeLocally(text, preferences, goals);
  const changed = options.changedRange && text.length > options.changedRange.start
    ? expandRangeToContext(text, options.changedRange, options.contextWindow ?? 320)
    : null;
  const chunks = createAnalysisChunks(text, {
    maxChars: options.maxChunkChars ?? 8_000,
    contextWindow: options.contextWindow ?? 320,
    startOffset: changed?.start,
    endOffset: changed?.end,
  });
  if (!chunks.length) return { ...local, analysedText: text, source: "local" as const } satisfies AnalysisResult;
  const triageEnabled = options.triageEnabled !== false;
  if (!triageEnabled) {
    return analyzeWithProvider(text, goals, settings, options);
  }
  const triage = await triageChunks(chunks, local.issues, {
    signal: options.signal,
    classifier: options.classifier ?? null,
    uncertainPolicy: options.uncertainPolicy ?? "skip",
    maxExcerptChars: options.classifier?.maxExcerptChars,
    timeoutMs: options.classifierTimeoutMs ?? options.classifier?.timeoutMs,
  });
  const aiChunks = filterChunksForProvider(chunks, triage.decisions, options.uncertainPolicy ?? "skip");
  if (!aiChunks.length) {
    const stats = getWritingStats(text);
    const diagnostics = createAnalysisDiagnostics(local.issues.length, startedAt, "provider");
    return {
      ...local,
      analysedText: text,
      issues: mergeAnalysisIssues([...local.issues]),
      scores: scoreWriting(stats, local.issues, goals, text),
      stats,
      source: "local" as const,
      changedRange: options.changedRange ?? undefined,
      triage: { decisions: triage.decisions, metrics: triage.metrics },
      ...(diagnostics ? { diagnostics } : {}),
    } as AnalysisResult & { triage: TriageOutcome };
  }
  const settled = await Promise.allSettled(aiChunks.map(async (chunk) => ({
    chunk,
    response: await requestProvider(settings, [
      { role: "system", content: "You are a privacy-first writing assistant. Do not return HTML, markdown, or secrets." },
      { role: "user", content: analysisPrompt(chunk, goals, preferences) },
    ], options.signal, options.timeoutMs),
  })));
  const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!successful.length) {
    const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (firstFailure) throw firstFailure.reason;
  }
  const aiIssues = successful.flatMap(({ chunk, response }) => {
    return parseAnalysisIssues(response, chunk.text, chunk.id)
      .map((issue) => mapChunkIssue(issue, chunk, text))
      .filter((issue): issue is WritingIssue => Boolean(issue));
  });
  const issues = mergeAnalysisIssues([...local.issues, ...aiIssues]);
  const stats = getWritingStats(text);
  const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "provider");
  return {
    ...local,
    analysedText: text,
    issues,
    scores: scoreWriting(stats, issues, goals, text),
    stats,
    source: aiIssues.length ? "local+ai" : "local",
    changedRange: options.changedRange ?? undefined,
    triage: { decisions: triage.decisions, metrics: { ...triage.metrics, providerCalls: successful.length } },
    ...(diagnostics ? { diagnostics } : {}),
  } as AnalysisResult & { triage: TriageOutcome };
}
