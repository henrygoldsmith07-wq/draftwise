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
  TriageCoverage,
  TriageDecision,
  TriageMetrics,
  UncertainPolicy,
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
const MAX_PROVIDER_ISSUES_PER_RESPONSE = 250;
const MAX_PROVIDER_ERROR_RESPONSE_BYTES = 16_384;

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
  if (!isRecord(parsed) || !Array.isArray(parsed.issues)) return null;
  const rawIssues = parsed.issues.slice(0, MAX_PROVIDER_ISSUES_PER_RESPONSE);
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
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) return null;
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

type ProviderResponseKind = "analysis" | "rewrite";

export interface RetryObservation {
  service: "classifier" | "provider";
  attempt: number;
  delayMs: number;
}

function validateProviderContent(content: string | null, kind: ProviderResponseKind) {
  if (!content?.trim()) throw new ProviderError("invalid-json", "The provider returned no usable model content.");
  const parsed = parseJsonContent(content);
  if (!isRecord(parsed)) throw new ProviderError("invalid-json", "The provider returned model content that was not valid JSON.");
  if (kind === "analysis" && (!Array.isArray(parsed.issues) || !Array.isArray(parsed.tone))) {
    throw new ProviderError("invalid-json", "The provider returned an invalid Draftwise analysis.");
  }
  if (kind === "rewrite" && (typeof parsed.replacement !== "string" || !parsed.replacement.trim())) {
    throw new ProviderError("invalid-json", "The provider returned an invalid Draftwise rewrite.");
  }
  return content;
}

async function readResponseTextLimited(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return { text: "", truncated: true };
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { text, truncated: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, truncated: false };
  } finally {
    reader.releaseLock();
  }
}

function providerErrorForStatus(status: number) {
  if (status === 401 || status === 403) return new ProviderError("unauthorized", "The provider rejected this API key.", status);
  if (status === 404) return new ProviderError("invalid-model", "The provider could not find this model or endpoint.", status);
  if (status === 429) return new ProviderError("rate-limited", "The provider is rate-limiting requests. Try again in a moment.", status);
  return new ProviderError("unknown", `The provider returned an error (${status}).`, status);
}

type ExternalService = "classifier" | "provider";

function isRetryableStatus(status: number, service: ExternalService) {
  return service === "classifier"
    ? [429, 502, 503, 504].includes(status)
    : [429, 500, 502, 503, 504].includes(status);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortError() {
  return typeof DOMException === "undefined"
    ? Object.assign(new Error("The request was aborted."), { name: "AbortError" })
    : new DOMException("The request was aborted.", "AbortError");
}

function retryAfterMs(response: Response, attempt: number) {
  const value = response.headers.get("retry-after")?.trim();
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, Math.min(5_000, seconds * 1_000));
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return Math.max(0, Math.min(5_000, timestamp - Date.now()));
  }
  return Math.min(1_500, 100 * (2 ** attempt));
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

export async function fetchWithRetry(
  request: () => Promise<Response>,
  options: { service: ExternalService; signal?: AbortSignal; maxRetries?: number; onRequest?: () => void; onRetry?: (observation: RetryObservation) => void },
) {
  const maxRetries = Math.max(0, Math.min(3, Math.floor(options.maxRetries ?? 2)));
  let attempt = 0;
  while (true) {
    if (options.signal?.aborted) throw abortError();
    try {
      options.onRequest?.();
      const response = await request();
      if (!isRetryableStatus(response.status, options.service) || attempt >= maxRetries) return response;
      const delayMs = retryAfterMs(response, attempt);
      options.onRetry?.({ service: options.service, attempt: attempt + 1, delayMs });
      await waitForRetry(delayMs, options.signal);
      attempt += 1;
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error) || attempt >= maxRetries || !(error instanceof TypeError)) throw error;
      const delayMs = Math.min(1_500, 100 * (2 ** attempt));
      options.onRetry?.({ service: options.service, attempt: attempt + 1, delayMs });
      await waitForRetry(delayMs, options.signal);
      attempt += 1;
    }
  }
}

async function requestProvider(
  settings: ProviderSettings,
  messages: Array<{ role: "system" | "user"; content: string }>,
  signal?: AbortSignal,
  timeoutMs = 25_000,
  options: { responseKind?: ProviderResponseKind; onRequest?: () => void; onRetry?: (observation: RetryObservation) => void } = {},
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
    const response = await fetchWithRetry(
      () => fetch(endpoint, {
      method: "POST",
      signal: timeoutController.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.apiKey.trim(),
        ...parseCustomHeaders(settings.customHeaders),
      },
      body: JSON.stringify({
        model,
        temperature: Math.max(0, Math.min(1, settings.temperature)),
        max_tokens: Math.max(100, Math.min(4000, settings.maxTokens)),
        ...(includeResponseFormat ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
      }),
      { service: "provider", signal: timeoutController.signal, onRequest: options.onRequest, onRetry: options.onRetry },
    );
    if (!response.ok) {
      const errorBody = await readResponseTextLimited(response, MAX_PROVIDER_ERROR_RESPONSE_BYTES).catch(() => ({ text: "", truncated: true }));
      if (includeResponseFormat && response.status === 400 && /response_format|json_object|unsupported/iu.test(errorBody.text)) return call(false);
      throw providerErrorForStatus(response.status);
    }
    let responseText: string;
    try {
      const body = await readResponseTextLimited(response, MAX_PROVIDER_RESPONSE_CHARS);
      if (body.truncated) throw new ProviderError("invalid-json", "The provider response was too large to process safely.");
      responseText = body.text;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("invalid-json", "The provider returned a response that was not valid JSON.");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new ProviderError("invalid-json", "The provider returned a response that was not valid JSON.");
    }
    return validateProviderContent(contentFromPayload(payload), options.responseKind ?? "analysis");
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

function aiIssueFingerprint(ruleId: string, original: string, replacement: string) {
  const value = `${ruleId}\u001f${original}\u001f${replacement}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function parseAnalysisIssues(value: unknown, sourceText: string, chunkId?: string): WritingIssue[] {
  const parsed = parseProviderPayload(value);
  if (!parsed) return [];
  return parsed.issues.flatMap((candidate) => {
    const start = Math.max(0, Math.floor(candidate.start));
    const end = Math.min(sourceText.length, Math.floor(candidate.end));
    const category = normaliseCategory(candidate.category);
    const severity = candidate.severity.toLocaleLowerCase() as IssueSeverity;
    if (!category || !VALID_SEVERITIES.has(severity) || end <= start) return [];
    const original = sourceText.slice(start, end);
    if (!original || original !== candidate.original) return [];
    const confidence = Math.max(0, Math.min(1, candidate.confidence ?? 0.72));
    const ruleId = candidate.ruleId?.slice(0, 80) || "ai-suggestion";
    const replacement = candidate.replacement.slice(0, 1000);
    return [{
      id: `ai-${chunkId ?? "full"}-${start}-${end}-${aiIssueFingerprint(ruleId, original, replacement)}`,
      ruleId,
      chunkId,
      start,
      end,
      original,
      replacement,
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
    source: "local+ai",
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export const PROVIDER_CONCURRENCY = 3;
export const MAX_AI_CHUNKS_PER_ANALYSIS = 10;
export const MAX_AI_CHARS_PER_ANALYSIS = 50_000;

export async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  options: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<Array<PromiseSettledResult<R>>> {
  if (!items.length) return [];
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  const concurrency = Math.max(1, Math.min(items.length, Math.floor(options.concurrency ?? PROVIDER_CONCURRENCY)));
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      if (options.signal?.aborted) throw abortError();
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  const workerResults = await Promise.allSettled(Array.from({ length: concurrency }, () => runWorker()));
  if (options.signal?.aborted) throw abortError();
  const workerFailure = workerResults.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (workerFailure) throw workerFailure.reason;
  return results;
}

export interface ProviderRequestMetrics {
  requests: number;
  httpRequests: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  retries: number;
  retryDelayMs: number;
}

function createProviderRequestMetrics(): ProviderRequestMetrics {
  return { requests: 0, httpRequests: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, retries: 0, retryDelayMs: 0 };
}

function recordProviderRequest(metrics: ProviderRequestMetrics, settings: ProviderSettings, messages: Array<{ role: "system" | "user"; content: string }>) {
  metrics.requests += 1;
  metrics.estimatedInputTokens += estimateTokens(messages.map((message) => message.content).join("\n"));
  metrics.estimatedOutputTokens += Math.max(100, Math.min(4_000, settings.maxTokens));
}

function providerRequestObservers(metrics: ProviderRequestMetrics) {
  return {
    onRequest: () => { metrics.httpRequests += 1; },
    onRetry: (observation: RetryObservation) => {
      metrics.retries += 1;
      metrics.retryDelayMs += observation.delayMs;
    },
  };
}

function providerDiagnostics(metrics: ProviderRequestMetrics) {
  return {
    providerRequests: metrics.requests,
    providerHttpRequests: metrics.httpRequests,
    estimatedProviderInputTokens: metrics.estimatedInputTokens,
    estimatedProviderOutputTokens: metrics.estimatedOutputTokens,
    providerRetries: metrics.retries,
    providerRetryDelayMs: metrics.retryDelayMs,
  };
}

function triageDiagnostics(metrics: TriageMetrics, providerMetrics: ProviderRequestMetrics) {
  return {
    ...providerDiagnostics(providerMetrics),
    classifierRetries: metrics.classifierRetries,
    classifierRetryDelayMs: metrics.classifierRetryDelayMs,
  };
}

export function selectProviderWorkload(
  chunks: AnalysisChunk[],
  options: Pick<ProviderAnalysisOptions, "changedRange" | "maxAiChunks" | "maxAiChars" | "triageDecisions">,
) {
  const maxChunks = Math.max(0, Math.floor(options.maxAiChunks ?? MAX_AI_CHUNKS_PER_ANALYSIS));
  const maxChars = Math.max(0, Math.floor(options.maxAiChars ?? MAX_AI_CHARS_PER_ANALYSIS));
  const decisions = new Map((options.triageDecisions ?? []).map((decision) => [decision.chunkId, decision]));
  const ranked = chunks
    .map((chunk, index) => ({
      chunk,
      index,
      changed: Boolean(options.changedRange && chunk.contentStartOffset < options.changedRange.end && chunk.contentEndOffset > options.changedRange.start),
      semanticPriority: decisions.get(chunk.id)?.decision === "ai-needed" ? 2 : decisions.get(chunk.id)?.decision === "uncertain" ? 1 : 0,
      confidence: decisions.get(chunk.id)?.confidence ?? 0,
    }))
    .sort((left, right) =>
      Number(right.changed) - Number(left.changed)
      || right.semanticPriority - left.semanticPriority
      || right.confidence - left.confidence
      || left.index - right.index);
  const selected: AnalysisChunk[] = [];
  let characters = 0;
  for (const item of ranked) {
    if (selected.length >= maxChunks || characters + item.chunk.text.length > maxChars) continue;
    selected.push(item.chunk);
    characters += item.chunk.text.length;
  }
  selected.sort((left, right) => chunks.indexOf(left) - chunks.indexOf(right));
  return {
    selected,
    skipped: Math.max(0, chunks.length - selected.length),
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
  providerConcurrency?: number;
  maxAiChunks?: number;
  maxAiChars?: number;
  triageDecisions?: ClassifierChunkDecision[];
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
  const workload = selectProviderWorkload(chunks, options);
  const providerMetrics = createProviderRequestMetrics();
  if (!workload.selected.length) {
    const diagnostics = createAnalysisDiagnostics(local.issues.length, startedAt, "provider", providerDiagnostics(providerMetrics));
    return {
      ...local,
      analysedText: text,
      source: "local" as const,
      changedRange: options.changedRange ?? undefined,
      aiCoverage: { requestedChunks: chunks.length, attemptedChunks: 0, successfulChunks: 0, failedChunks: 0, skippedChunks: workload.skipped },
      ...(diagnostics ? { diagnostics } : {}),
    } satisfies AnalysisResult;
  }
  const settled = await mapWithConcurrency(workload.selected, async (chunk) => {
    const messages = [
      { role: "system", content: "You are a privacy-first writing assistant. Do not return HTML, markdown, or secrets." },
      { role: "user", content: analysisPrompt(chunk, goals, preferences) },
    ] as Array<{ role: "system" | "user"; content: string }>;
    recordProviderRequest(providerMetrics, settings, messages);
    return {
      chunk,
      response: await requestProvider(settings, messages, options.signal, options.timeoutMs, providerRequestObservers(providerMetrics)),
    };
  }, { concurrency: options.providerConcurrency, signal: options.signal });
  const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failed = settled.filter((result) => result.status === "rejected").length;
  if (!successful.length) {
    const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (firstFailure && !(firstFailure.reason instanceof ProviderError && firstFailure.reason.code === "invalid-json")) throw firstFailure.reason;
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
    source: successful.length ? "local+ai" : "local",
    changedRange: options.changedRange ?? undefined,
    aiCoverage: {
      requestedChunks: chunks.length,
      attemptedChunks: workload.selected.length,
      successfulChunks: successful.length,
      failedChunks: failed,
      skippedChunks: workload.skipped,
    },
    ...(diagnostics ? { diagnostics: { ...diagnostics, ...providerDiagnostics(providerMetrics) } } : {}),
  } satisfies AnalysisResult;
}

function localRewrite(text: string, instruction: string): string {
  const lower = instruction.toLocaleLowerCase();
  let result = text;

  if (lower.includes("shorten") || lower.includes("concise")) {
    result = result
      .replace(/\bin order to\b/giu, "to")
      .replace(/\bat this point in time\b/giu, "now")
      .replace(/\bdue to the fact that\b/giu, "because")
      .replace(/\bin the event that\b/giu, "if");
  }

  if (lower.includes("formal") || lower.includes("professional") || lower.includes("academic")) {
    result = result
      .replace(/\bcan't\b/giu, "cannot")
      .replace(/\bwon't\b/giu, "will not")
      .replace(/\bdon't\b/giu, "do not")
      .replace(/\bdoesn't\b/giu, "does not")
      .replace(/\bdidn't\b/giu, "did not")
      .replace(/\bisn't\b/giu, "is not")
      .replace(/\baren't\b/giu, "are not")
      .replace(/\bwasn't\b/giu, "was not")
      .replace(/\bweren't\b/giu, "were not")
      .replace(/\bcouldn't\b/giu, "could not")
      .replace(/\bwouldn't\b/giu, "would not")
      .replace(/\bshouldn't\b/giu, "should not");
  }

  if (lower.includes("casual") || lower.includes("friendly")) {
    result = result
      .replace(/\bcannot\b/giu, "can't")
      .replace(/\bwill not\b/giu, "won't")
      .replace(/\bdo not\b/giu, "don't")
      .replace(/\bdoes not\b/giu, "doesn't")
      .replace(/\bis not\b/giu, "isn't")
      .replace(/\bare not\b/giu, "aren't");
  }

  if (lower.includes("simplify")) {
    result = result
      .replace(/\butilize\b/giu, "use")
      .replace(/\bcommence\b/giu, "start")
      .replace(/\bpurchase\b/giu, "buy")
      .replace(/\bassist\b/giu, "help");
  }

  return result || text;
}

type ProtectedTokenKind =
  | "url"
  | "email"
  | "date"
  | "currency"
  | "percentage"
  | "identifier"
  | "uuid"
  | "filename"
  | "model"
  | "quote"
  | "number";

const PROTECTED_TOKEN_PATTERNS: Array<{ kind: Exclude<ProtectedTokenKind, "quote" | "number">; pattern: RegExp }> = [
  { kind: "url", pattern: /https?:\/\/[^\s)]+/giu },
  { kind: "email", pattern: /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu },
  { kind: "date", pattern: /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*|\s+)\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})\b/giu },
  { kind: "currency", pattern: /(?:[$€£¥]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:usd|eur|gbp|jpy)\b)/giu },
  { kind: "percentage", pattern: /\b\d[\d,.]*%/gu },
  { kind: "identifier", pattern: /\b(?:id|ticket|case|ref(?:erence)?)[#\s:-]*[a-z0-9][a-z0-9_-]{2,}\b|\b[A-Z][A-Z0-9]{1,}(?:-[A-Z0-9]+)+\b/giu },
  { kind: "uuid", pattern: /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu },
  { kind: "filename", pattern: /\b[\w.-]+\.(?:pdf|docx?|csv|xlsx?|json|ts|tsx|js|jsx|md|png|jpe?g|gif)\b/giu },
  { kind: "model", pattern: /\b(?:gpt|claude|gemini|llama|model|v)\s*[-_.]?\d[\w.-]*/giu },
];

const QUOTED_PASSAGE_PATTERN = /[“"'](?:[^“"']|[“"']{1,2})+[”"']/gu;
const GENERIC_NUMBER_PATTERN = /\b\d[\d,.]*\b/gu;

interface ProtectedRange {
  start: number;
  end: number;
}

function rangesOverlap(left: ProtectedRange, right: ProtectedRange) {
  return left.start < right.end && left.end > right.start;
}

function protectedKindsAllowedByInstruction(instruction: string) {
  const value = String(instruction || "");
  const edit = String.raw`\b(?:change|update|replace|adjust|convert|reformat|correct)\b[\s\S]{0,100}`;
  const directNegation = String.raw`\b(?:do\s+not|don't|dont|never)\s+(?:change|update|replace|adjust|convert|reformat|correct)\b(?:(?![,.;!?]).){0,100}`;
  const withoutChange = String.raw`\bwithout\s+(?:changing|updating|replacing|adjusting|converting|reformatting|correcting)\b(?:(?![,.;!?]).){0,100}`;
  const allowed = new Set<ProtectedTokenKind>();
  const permits = (target: string) => {
    const denied = new RegExp(directNegation + target, "iu").test(value) || new RegExp(withoutChange + target, "iu").test(value);
    return !denied && new RegExp(edit + target, "iu").test(value);
  };
  if (permits(String.raw`\bdates?\b`)) allowed.add("date");
  if (permits(String.raw`\b(?:percentage|percent)s?\b`)) allowed.add("percentage");
  if (permits(String.raw`\bcurrenc(?:y|ies)\b`)) allowed.add("currency");
  if (permits(String.raw`\b(?:url|link)s?\b`)) allowed.add("url");
  if (permits(String.raw`\bemail(?:\s+address)?s?\b`)) allowed.add("email");
  if (permits(String.raw`\b(?:id|identifier|ticket|reference|case)s?\b`)) {
    allowed.add("identifier");
    allowed.add("uuid");
  }
  if (permits(String.raw`\b(?:quote|quotation|quoted\s+passage)s?\b`)) allowed.add("quote");
  if (permits(String.raw`\b(?:filename|file\s+name)s?\b`)) allowed.add("filename");
  if (permits(String.raw`\b(?:model|version)s?\b`)) allowed.add("model");
  if (permits(String.raw`\b(?:number|value)s?\b`)) allowed.add("number");
  return allowed;
}

function normaliseAllowedTokensInQuote(value: string, allowedKinds: Set<ProtectedTokenKind>) {
  let result = value;
  for (const { kind, pattern } of PROTECTED_TOKEN_PATTERNS) {
    if (!allowedKinds.has(kind)) continue;
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[${kind}]`);
  }
  if (allowedKinds.has("number")) {
    GENERIC_NUMBER_PATTERN.lastIndex = 0;
    result = result.replace(GENERIC_NUMBER_PATTERN, "[number]");
  }
  return result;
}

function protectedTokenCounts(text: string, allowedKinds = new Set<ProtectedTokenKind>()) {
  const counts = new Map<string, number>();
  const claimed: ProtectedRange[] = [];
  const add = (kind: ProtectedTokenKind, token: string) => {
    if (allowedKinds.has(kind)) return;
    const key = `${kind}\u001f${token}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  for (const { kind, pattern } of PROTECTED_TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const range = { start, end: start + match[0].length };
      if (claimed.some((existing) => rangesOverlap(existing, range))) continue;
      claimed.push(range);
      add(kind, match[0]);
    }
  }

  const quotedRanges: ProtectedRange[] = [];
  QUOTED_PASSAGE_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(QUOTED_PASSAGE_PATTERN)) {
    const start = match.index ?? 0;
    const range = { start, end: start + match[0].length };
    quotedRanges.push(range);
    if (!allowedKinds.has("quote")) add("quote", normaliseAllowedTokensInQuote(match[0], allowedKinds));
  }

  GENERIC_NUMBER_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(GENERIC_NUMBER_PATTERN)) {
    const start = match.index ?? 0;
    const range = { start, end: start + match[0].length };
    if (claimed.some((existing) => rangesOverlap(existing, range)) || quotedRanges.some((existing) => rangesOverlap(existing, range))) continue;
    add("number", match[0]);
  }
  return counts;
}

function hasExactProtectedTokenMultiset(original: string, replacement: string, allowedKinds: Set<ProtectedTokenKind>) {
  const originalTokens = protectedTokenCounts(original, allowedKinds);
  const replacementTokens = protectedTokenCounts(replacement, allowedKinds);
  if (originalTokens.size !== replacementTokens.size) return false;
  for (const [token, count] of originalTokens) {
    if (replacementTokens.get(token) !== count) return false;
  }
  return true;
}

function preserveBoundaryWhitespace(original: string, replacement: string) {
  const leading = original.match(/^\s*/u)?.[0] ?? "";
  const trailing = original.match(/\s*$/u)?.[0] ?? "";
  return `${leading}${replacement.trim()}${trailing}`;
}

function validateRewrite(original: string, replacement: string, options: { allowAllProtectedChanges?: boolean; allowedKinds?: Set<ProtectedTokenKind> } = {}) {
  if (!replacement.trim()) throw new ProviderError("invalid-json", "The provider returned an empty rewrite. Nothing was changed.");
  if (/<[^>]+>/u.test(replacement)) throw new ProviderError("invalid-json", "The provider returned markup. Nothing was changed.");
  if (!options.allowAllProtectedChanges && !hasExactProtectedTokenMultiset(original, replacement, options.allowedKinds ?? new Set())) {
    throw new ProviderError("invalid-json", "The rewrite changed, removed, duplicated, or introduced a protected URL, value, identifier, or quoted passage outside the requested change. Nothing was changed.");
  }
  return preserveBoundaryWhitespace(original, replacement);
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
  ], signal, 25_000, { responseKind: "rewrite" });
  const parsed = parseJsonContent(response);
  if (!isRecord(parsed) || typeof parsed.replacement !== "string" || !parsed.replacement.trim()) throw new ProviderError("invalid-json", "The provider returned an invalid rewrite. Nothing was changed.");
  const explanation = typeof parsed.explanation === "string" ? parsed.explanation : "";
  const rewriteProtection = {
    allowAllProtectedChanges: request.allowProtectedChanges === true,
    allowedKinds: request.allowProtectedChanges === true ? new Set<ProtectedTokenKind>() : protectedKindsAllowedByInstruction(request.instruction),
  };
  const replacement = validateRewrite(request.text, parsed.replacement, rewriteProtection);
  const alternatives = Array.isArray(parsed.alternatives)
    ? parsed.alternatives
      .filter((alternative): alternative is string => typeof alternative === "string" && Boolean(alternative.trim()) && alternative.trim() !== replacement)
      .slice(0, 2)
      .flatMap((alternative) => {
        try {
          return [validateRewrite(request.text, alternative, rewriteProtection)];
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
  baseUrl: "https://classifier.dev",
  uncertainPolicy: "provider",
  timeoutMs: 8_000,
  maxExcerptChars: 500,
};

export const CLASSIFIER_MAX_EXCERPT_CHARS = 500;
export const CLASSIFIER_MAX_BATCH_CHUNKS = 100;
export const CLASSIFIER_BATCH_SIZES = [5, 10, 25, 50, 100] as const;
export const TRIAGE_LABEL_FORMULATIONS = {
  "semantic-v2": [
    "The local writing checks are sufficient; no semantic AI review is needed.",
    "A semantic AI writing review would likely find useful issues the local checks cannot reliably detect.",
  ],
  "direct-v1": [
    "Local writing checks are sufficient.",
    "Semantic AI review would likely add useful feedback.",
  ],
  "explicit-v1": [
    "No additional semantic review is needed beyond the local writing checks.",
    "A semantic writing model would likely identify useful issues the local checks cannot reliably detect.",
  ],
  "compact-v1": [
    "Local checks are enough for this passage.",
    "An AI writing review would likely add useful feedback.",
  ],
} as const;
export type TriageLabelFormulationId = keyof typeof TRIAGE_LABEL_FORMULATIONS;
export const TRIAGE_LABEL_FORMULATION_ID: TriageLabelFormulationId = "semantic-v2";
export const CLASSIFIER_TRIAGE_LABELS = TRIAGE_LABEL_FORMULATIONS[TRIAGE_LABEL_FORMULATION_ID];
export interface TriageConfidenceThresholds {
  aiNeeded: number;
  locallySufficient: number;
}
export const TRIAGE_CONFIDENCE_THRESHOLDS: TriageConfidenceThresholds = {
  aiNeeded: 0.75,
  locallySufficient: 0.80,
};

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
  const path = parsed.pathname.replace(/\/+$/u, "");
  if (path.endsWith("/classify")) parsed.pathname = path;
  else if (path.endsWith("/v1")) parsed.pathname = path + "/classify";
  else parsed.pathname = path + "/v1/classify";
  return parsed.toString();
}

function classifierErrorForStatus(status: number) {
  if (status === 401 || status === 403) return new ClassifierError("unauthorized", "The classifier rejected this API key.", status);
  if (status === 400) return new ClassifierError("invalid-request", "The classifier rejected the request shape or labels.", status);
  if (status === 404) return new ClassifierError("invalid-url", "The classifier endpoint was not found.", status);
  if (status === 429) return new ClassifierError("rate-limited", "The classifier is rate-limiting requests. Local checks remain available.", status);
  if (status >= 500) return new ClassifierError("network", "The classifier service is temporarily unavailable.", status);
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
    .replace(/-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH) )?PRIVATE KEY-----[\s\S]*?-----END (?:(?:RSA|EC|DSA|OPENSSH) )?PRIVATE KEY-----/gu, "[private-key]")
    .replace(/-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/gu, "[private-key]")
    .replace(/-----BEGIN (?:(?:RSA|EC|DSA|OPENSSH) )?PRIVATE KEY-----[\s\S]*/gu, "[private-key]")
    .replace(/-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*/gu, "[private-key]")
    .replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s<>"']+/giu, "[connection-string]")
    .replace(/https?:\/\/[^\s<>"']+/giu, "[url]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu, "[email]")
    .replace(/["“'](?:sk[-_][A-Za-z0-9_-]{8,}|[A-Za-z0-9+/=_-]{24,})["”']/gu, "[quoted-secret]")
    .replace(/\b(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gu, "[token]")
    .replace(/\b(?:github_pat|npm)_[A-Za-z0-9_-]{12,}\b/gu, "[token]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, "[token]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/gu, "[token]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/giu, "[bearer-token]")
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu, "[jwt]")
    .replace(/\b(?:api[_ -]?key|access[_ -]?token|secret|password|authorization)\s*[:=]\s*["']?[A-Za-z0-9_./+=:-]{6,}["']?/giu, "[secret]")
    .replace(/\b(?:GPT|Claude|Gemini|Llama|OpenAI)\s*[-_ ]?\d+[A-Za-z]?(?:\.\d+){0,3}(?:[-_][A-Za-z0-9]+)?\b/giu, "[model]")
    .replace(/\b[\w.-]+\.(?:pdf|docx?|xlsx?|csv|tsv|json|xml|md|png|jpe?g|zip|tar|gz)\b/giu, "[filename]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, "[uuid]")
    .replace(/\b(?:v|version|release)[-_]?\d+(?:\.\d+){0,3}\b/giu, "[version]")
    .replace(/\b(?:id|ticket|ref(?:erence)?|case|order|invoice|account|request)[\s:#=-]+(?=[A-Za-z0-9_/-]*[0-9_-][A-Za-z0-9_/-]*\b)[A-Za-z0-9][A-Za-z0-9_/-]{2,}\b/giu, "[identifier]")
    .replace(/\b[A-Z]{2,}(?:[-_][A-Z0-9]{2,})+\b/gu, "[identifier]")
    .replace(/(?:£|\$|€|¥|₹)\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\b\d+(?:[.,]\d+)?\s?(?:USD|GBP|EUR|JPY)\b/giu, "[currency]")
    .replace(/\b\d+(?:[.,]\d+)?\s?%/gu, "[percentage]")
    .replace(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4})\b/giu, "[date]")
    .replace(/\b(?:\+?\d[\d().\s-]{7,}\d)\b/gu, "[phone]")
    .replace(/\b\d{6,}\b/gu, "[number]");
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
const HEDGE_PATTERN = /\b(might|maybe|perhaps|possibly|uncertain|sort of|kind of)\b/iu;
const SHORT_AMBIGUITY_PATTERN = /\b(clear|ready|complete|completed|approved|reviewed|recorded|stored|available|open|done|fine|good)\b/iu;
const LEGAL_REVIEW_PATTERN = /\b(subject to|shall|attached schedule|agreed period|retain evidence|supplier)\b/iu;
const ABSOLUTE_TONE_PATTERN = /\b(without exception|completely and irreversibly|entire project will fail|best .* ever)\b/iu;
const SEMANTIC_REVIEW_PATTERN = /\b(?:not made explicit|harder to distinguish|does not explain|doesn't explain|without explaining|decision rule|may not know what action|no indication|does not distinguish|wrong mental model|combined meaning|without (?:signalling|signaling)|what the [^.!?]{0,60} meant|unsure whether|could reasonably assume|could interpret|could change [^.!?]{0,60} conclusion|change in recommendation|how [^.!?]{0,60} relate|without variation|direct address|same [^.!?]{0,60} different)\b/iu;
const PROTECTED_TOKEN_PATTERN = /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[\w.-]+\.(?:pdf|docx?|xlsx?|csv|tsv|json|xml|md|png|jpe?g|zip|tar|gz)\b|(?:\u00a3|\$|\u20ac|\u00a5|\u20b9)\s?\d|\b\d+(?:[.,]\d+)?\s?%/iu;

export function hasSemanticReviewSignal(text: string) {
  const value = String(text || "");
  if (SEMANTIC_REVIEW_PATTERN.test(value) || LEGAL_REVIEW_PATTERN.test(value) || ABSOLUTE_TONE_PATTERN.test(value)) return true;
  const hasDiscourse = /\b(?:but|although|yet|however|while|without|so that|even though|rather than|which)\b/iu.test(value);
  const hasMeaningSignal = /\b(?:meaning|relationship|distinguish|explain|assume|interpret|conclusion|claims|recommendation|cause|importance|relate|variation)\b/iu.test(value);
  return hasDiscourse && hasMeaningSignal;
}

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

function goalSupportsEngagementReview(goals?: WritingGoals) {
  return goals?.intent === "persuade" || goals?.audience === "casual" || goals?.tone === "friendly";
}

function goalAllowsPassiveConstruction(goals?: WritingGoals) {
  if (!goals || goals.audience === "casual" || goals.tone === "casual" || goals.intent === "persuade") return false;
  return ["academic", "professional", "technical"].includes(goals.audience) || goals.intent === "describe";
}

export function inferTriageCategories(chunkText: string, issuesInChunk: WritingIssue[], goals?: WritingGoals): TriageCategory[] {
  const mapped = issuesInChunk.map((issue) => mapLocalCategoryToTriage(issue.category));
  const signals = collectChunkSignals(chunkText, issuesInChunk);
  const extra: TriageCategory[] = [];
  if (signals.hasLongSentence) extra.push("structure");
  if (signals.hasVagueOrFiller) extra.push("clarity");
  if (signals.hasPassiveOrWordiness) extra.push("style");
  if (issuesInChunk.length === 0 && chunkText.trim().split(/\s+/u).length > 25 && goalSupportsEngagementReview(goals)) extra.push("engagement");
  if (HEDGE_PATTERN.test(chunkText)) extra.push("tone");
  if (issuesInChunk.filter((issue) => issue.ruleId === "dialect-spelling").length >= 2) extra.push("consistency");
  const merged = [...new Set([...mapped, ...extra])];
  return merged.length ? merged.slice(0, 4) as TriageCategory[] : ["other"];
}

export interface UnresolvedAssessment {
  unresolved: boolean;
  reasons: string[];
  categories: TriageCategory[];
}

/** Local-first heuristic: decide whether a chunk is unresolved/ambiguous and may need AI. */
export function isChunkUnresolved(chunkText: string, issuesInChunk: WritingIssue[], goals?: WritingGoals): UnresolvedAssessment {
  const text = String(chunkText || "");
  const trimmed = text.trim();
  const categories = inferTriageCategories(text, issuesInChunk, goals);
  const semanticReviewSignal = hasSemanticReviewSignal(text);
  const hasDialectConflict = issuesInChunk.filter((issue) => issue.ruleId === "dialect-spelling").length >= 2;
  const shortCorrectionOnly = issuesInChunk.length > 0
    && issuesInChunk.every((issue) => ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category))
    && issuesInChunk.every((issue) => Number.isFinite(issue.confidence) && (issue.confidence ?? 0) >= 0.8);
  if (/^clean so far\.?$/iu.test(trimmed)) {
    return { unresolved: false, reasons: ["explicit-clean-status"], categories: [] };
  }
  if (PROTECTED_TOKEN_PATTERN.test(text)) {
    return { unresolved: true, reasons: ["protected-token-review"], categories: categories.length ? categories : ["other"] };
  }
  if (hasDialectConflict) {
    return { unresolved: true, reasons: ["dialect-consistency-review"], categories: [...new Set([...categories, "consistency"])] as TriageCategory[] };
  }
  if (trimmed.length < 20) {
    const wordCount = trimmed.split(/\s+/u).filter(Boolean).length;
    if (shortCorrectionOnly) {
      return { unresolved: false, reasons: ["short-correction-only-local"], categories: [] };
    }
    if (issuesInChunk.length || (trimmed.match(/[.!?]/gu) ?? []).length >= 2 || (wordCount <= 5 && SHORT_AMBIGUITY_PATTERN.test(trimmed))) {
      return { unresolved: true, reasons: ["short-fragment"], categories: ["structure"] };
    }
    return { unresolved: false, reasons: ["too-short"], categories: [] };
  }
  const signals = collectChunkSignals(text, issuesInChunk);
  const wordCount = trimmed.split(/\s+/u).filter(Boolean).length;
  if (shortCorrectionOnly && wordCount <= 5) {
    return { unresolved: false, reasons: ["short-correction-only-local"], categories: [] };
  }
  if (wordCount <= 5 && SHORT_AMBIGUITY_PATTERN.test(trimmed)) {
    return { unresolved: true, reasons: ["short-fragment"], categories: ["structure"] };
  }
  if (!issuesInChunk.length) {
    if (semanticReviewSignal) {
      return { unresolved: true, reasons: ["semantic-ambiguity-signals"], categories: categories.length ? categories : ["clarity"] };
    }
    if (signals.hasLongSentence || signals.hasVagueOrFiller || signals.hasPassiveOrWordiness) {
      return { unresolved: true, reasons: ["no-local-issues-but-ambiguous-signals"], categories };
    }
    const words = wordCount;
    if (words > 40 || /[;:—–]/.test(trimmed) || HEDGE_PATTERN.test(trimmed)) {
      return { unresolved: true, reasons: ["long-or-nuanced-clean-text"], categories };
    }
    // Low-engagement clean text: longer, no direct address, no questions.
    // Needs AI for engagement/structure even when local finds nothing.
    if (words > 25 && goalSupportsEngagementReview(goals) && !/\b(you|we|our|your|us|\?)\b/iu.test(trimmed)) {
      return { unresolved: true, reasons: ["low-engagement-clean-text"], categories: categories.length ? categories : ["engagement"] };
    }
    return { unresolved: false, reasons: ["clean"], categories: [] };
  }
  const correctnessOnly = issuesInChunk.every((issue) =>
    ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category),
  );
  const correctnessConfidenceSafe = issuesInChunk.every((issue) => Number.isFinite(issue.confidence) && (issue.confidence ?? 0) >= 0.8);
  const passiveOnlyOrCorrectness = issuesInChunk.every((issue) =>
    ["spelling", "grammar", "punctuation", "capitalization", "passive voice"].includes(issue.category),
  );
  if (semanticReviewSignal) {
    return { unresolved: true, reasons: ["semantic-ambiguity-signals"], categories };
  }
  if (goalAllowsPassiveConstruction(goals)
    && passiveOnlyOrCorrectness
    && issuesInChunk.some((issue) => issue.category === "passive voice")
    && !signals.hasLongSentence
    && !signals.hasVagueOrFiller) {
    return { unresolved: false, reasons: ["goal-aligned-passive"], categories: [] };
  }
  const hasLowConfidence = issuesInChunk.some((issue) => !Number.isFinite(issue.confidence) || issue.confidence < 0.85);
  if (correctnessOnly && correctnessConfidenceSafe && !signals.hasLongSentence && !signals.hasVagueOrFiller && !signals.hasPassiveOrWordiness) {
    return { unresolved: false, reasons: ["correction-only-local-confidence"], categories: [] };
  }
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
    const onlyHighConfidenceCorrectness = issuesInChunk.every((issue) =>
      ["spelling", "grammar", "punctuation", "capitalization"].includes(issue.category) && (issue.confidence ?? 0) >= 0.9,
    );
    if (!onlyHighConfidenceCorrectness) {
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
  goals?: WritingGoals,
): Array<{ chunk: AnalysisChunk; issues: WritingIssue[]; assessment: UnresolvedAssessment }> {
  return chunks.map((chunk) => {
    const issues = localIssues.filter((issue) => issue.start < chunk.endOffset && issue.end > chunk.startOffset);
    return { chunk, issues, assessment: isChunkUnresolved(chunk.text, issues, goals) };
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

function normaliseClassifierLabel(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function getTriageLabels(formulationId: TriageLabelFormulationId = TRIAGE_LABEL_FORMULATION_ID) {
  return TRIAGE_LABEL_FORMULATIONS[formulationId] ?? CLASSIFIER_TRIAGE_LABELS;
}

function isKnownClassifierLabel(value: string, labels: readonly string[] = CLASSIFIER_TRIAGE_LABELS) {
  const normalised = normaliseClassifierLabel(value);
  return labels.some((label) => normaliseClassifierLabel(label) === normalised);
}

export function mapClassifierLabel(
  label: string,
  confidence: number,
  labels: readonly string[] = CLASSIFIER_TRIAGE_LABELS,
  thresholds: TriageConfidenceThresholds = TRIAGE_CONFIDENCE_THRESHOLDS,
): TriageDecision {
  const normalised = normaliseClassifierLabel(label);
  const localLabel = normaliseClassifierLabel(labels[0]);
  const aiLabel = normaliseClassifierLabel(labels[1]);
  if (normalised === localLabel && confidence >= thresholds.locallySufficient) return "locally-sufficient";
  if (normalised === aiLabel && confidence >= thresholds.aiNeeded) return "ai-needed";
  return "uncertain";
}

/**
 * Validate the classifier.dev response contract. Results are deliberately
 * paired by response order: classifier.dev returns one result per input and
 * does not know Draftwise chunk IDs.
 */
export function parseClassifierDecisions(
  value: unknown,
  expectedInputs: ClassifierChunkInput[],
  labels: readonly string[] = CLASSIFIER_TRIAGE_LABELS,
  thresholds: TriageConfidenceThresholds = TRIAGE_CONFIDENCE_THRESHOLDS,
): Array<ClassifierChunkDecision | null> {
  const rawList = isRecord(value) && Array.isArray(value.results)
    ? value.results
    : Array.isArray(value)
      ? value
      : [];
  return rawList.slice(0, expectedInputs.length).map((raw, index): ClassifierChunkDecision | null => {
    if (!isRecord(raw) || typeof raw.label !== "string") return null;
    const confidenceRaw = raw.confidence;
    if (typeof confidenceRaw !== "number" || !Number.isFinite(confidenceRaw)) return null;
    const confidence = Math.max(0, Math.min(1, confidenceRaw));
    const label = raw.label.trim();
    if (!label) return null;
    const input = expectedInputs[index];
    const decision = mapClassifierLabel(label, confidence, labels, thresholds);
    return {
      chunkId: input.chunkId,
      decision,
      label,
      categories: input.categories.length ? input.categories : ["other"],
      confidence,
      reason: ("classifier.dev label: " + label).slice(0, 300),
      fallback: !isKnownClassifierLabel(label, labels),
    };
  });
}

export interface ClassifierRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  labelFormulationId?: TriageLabelFormulationId;
  thresholds?: TriageConfidenceThresholds;
  onRequest?: () => void;
  onRetry?: (observation: RetryObservation) => void;
}

async function requestClassifierDecisions(
  inputs: ClassifierChunkInput[],
  settings: ClassifierSettings,
  options: ClassifierRequestOptions = {},
): Promise<Array<ClassifierChunkDecision | null>> {
  if (!inputs.length) return [];
  const endpoint = endpointForClassifier(settings.baseUrl);
  const labels = getTriageLabels(options.labelFormulationId);
  const timeoutMs = Math.max(1_000, Math.min(30_000, options.timeoutMs ?? settings.timeoutMs ?? 8_000));
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const cancel = () => timeoutController.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = settings.apiKey?.trim();
    if (apiKey) headers.Authorization = "Bearer " + apiKey;
    const response = await fetchWithRetry(
      () => fetch(endpoint, {
        method: "POST",
        signal: timeoutController.signal,
        headers,
        body: JSON.stringify({
          inputs: inputs.map((input) => input.excerpt),
          labels,
          instructions: "Choose exactly one label for each input. Return results in the same order as inputs. Do not rewrite or quote the input.",
        }),
      }),
      { service: "classifier", signal: timeoutController.signal, onRequest: options.onRequest, onRetry: options.onRetry },
    );
    if (!response.ok) throw classifierErrorForStatus(response.status);
    let responseText: string;
    try {
      const body = await readResponseTextLimited(response, 500_000);
      if (body.truncated) throw new ClassifierError("invalid-json", "The classifier response was too large.");
      responseText = body.text;
    } catch (error) {
      if (error instanceof ClassifierError) throw error;
      throw new ClassifierError("invalid-json", "The classifier returned an unreadable response.");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new ClassifierError("invalid-json", "The classifier returned invalid JSON.");
    }
    const parsed = parseClassifierDecisions(payload, inputs, labels, options.thresholds);
    return parsed.length < inputs.length
      ? [...parsed, ...Array.from({ length: inputs.length - parsed.length }, () => null)]
      : parsed;
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
    decision: "ai-needed",
    categories: input.categories.length ? input.categories : ["other"],
    confidence: 0.65,
    reason: reason.slice(0, 300),
    fallback: true,
  };
}

export interface TriageOptions {
  signal?: AbortSignal;
  classifier?: ClassifierSettings | null;
  uncertainPolicy?: UncertainPolicy;
  labelFormulationId?: TriageLabelFormulationId;
  thresholds?: TriageConfidenceThresholds;
  goals?: WritingGoals;
  classifierBatchSize?: number;
  maxExcerptChars?: number;
  timeoutMs?: number;
}

export interface TriageOutcome {
  decisions: ClassifierChunkDecision[];
  candidateCount: number;
  metrics: TriageMetrics;
  coverage?: TriageCoverage;
}

function buildTriageMetrics(
  chunks: AnalysisChunk[],
  decisions: ClassifierChunkDecision[],
  candidateChunks: number,
  uncertainPolicy: UncertainPolicy,
  classifierRequests: number,
  classifiedChunks: number,
  classifierFailures: number,
  omittedClassifierResults: number,
  providerRequests = 0,
  providerHttpRequests = providerRequests,
  classifierHttpRequests = classifierRequests,
  classifierRetries = 0,
  classifierRetryDelayMs = 0,
): TriageMetrics {
  const providerChunks = decisions.filter((decision) => decision.decision === "ai-needed" || (decision.decision === "uncertain" && uncertainPolicy === "provider")).length;
  const decisionCount = decisions.length;
  const confidentLocalChunks = decisions.filter((decision) => decision.decision === "locally-sufficient").length;
  const confidentAiChunks = decisions.filter((decision) => decision.decision === "ai-needed" && !decision.fallback).length;
  const uncertainChunks = decisions.filter((decision) => decision.decision === "uncertain").length;
  const fallbackChunks = decisions.filter((decision) => decision.fallback).length;
  return {
    candidateChunks,
    classifierRequests,
    classifierHttpRequests,
    classifiedChunks,
    locallySufficientChunks: confidentLocalChunks,
    aiNeededChunks: decisions.filter((decision) => decision.decision === "ai-needed").length,
    uncertainChunks,
    classifierFailures,
    omittedClassifierResults,
    providerRequests,
    providerHttpRequests,
    providerChunks,
    avoidedProviderChunks: Math.max(0, chunks.length - providerChunks),
    confidentLocalRate: decisionCount ? confidentLocalChunks / decisionCount : 0,
    confidentAiRate: decisionCount ? confidentAiChunks / decisionCount : 0,
    uncertainRate: decisionCount ? uncertainChunks / decisionCount : 0,
    fallbackRate: decisionCount ? fallbackChunks / decisionCount : 0,
    actualProviderAvoidanceRate: chunks.length ? Math.max(0, chunks.length - providerChunks) / chunks.length : 1,
    classifierRetries,
    classifierRetryDelayMs,
  };
}

/** Local-first triage: local rules, optional classifier.dev gate, then provider only when policy allows. */
export async function triageChunks(
  chunks: AnalysisChunk[],
  localIssues: WritingIssue[],
  options: TriageOptions = {},
): Promise<TriageOutcome> {
  const assessed = selectTriageCandidates(chunks, localIssues, options.goals);
  const locallySufficient = assessed.filter((item) => !item.assessment.unresolved);
  const inputs = buildClassifierInputs(assessed, options.maxExcerptChars ?? CLASSIFIER_MAX_EXCERPT_CHARS);
  const decisions: ClassifierChunkDecision[] = locallySufficient.map((item) => ({
    chunkId: item.chunk.id,
    decision: "locally-sufficient" as const,
    categories: [],
    confidence: 0.9,
    reason: "locally sufficient: " + (item.assessment.reasons.join(",") || "clean"),
  }));
  if (!inputs.length) {
    return {
      decisions,
      candidateCount: 0,
      metrics: buildTriageMetrics(chunks, decisions, 0, options.uncertainPolicy ?? "provider", 0, 0, 0, 0),
    };
  }
  const classifier = options.classifier;
  if (!classifier?.baseUrl?.trim()) {
    // No classifier endpoint is configured: unresolved candidates are sent to the provider.
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
      metrics: buildTriageMetrics(chunks, decisions, inputs.length, options.uncertainPolicy ?? "provider", 0, 0, 0, 0),
    };
  }
  const inputBatches: ClassifierChunkInput[][] = [];
  const batchSize = Math.max(1, Math.min(CLASSIFIER_MAX_BATCH_CHUNKS, Math.floor(options.classifierBatchSize ?? CLASSIFIER_MAX_BATCH_CHUNKS)));
  for (let offset = 0; offset < inputs.length; offset += batchSize) {
    inputBatches.push(inputs.slice(offset, offset + batchSize));
  }
  let classifierRequests = 0;
  let classifierHttpRequests = 0;
  let classifierRetries = 0;
  let classifierRetryDelayMs = 0;
  try {
    const results: Array<ClassifierChunkDecision | null> = [];
    for (const inputBatch of inputBatches) {
      classifierRequests += 1;
      results.push(...await requestClassifierDecisions(inputBatch, classifier, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? classifier.timeoutMs,
        labelFormulationId: options.labelFormulationId,
        thresholds: options.thresholds,
        onRequest: () => { classifierHttpRequests += 1; },
        onRetry: (observation) => {
          classifierRetries += 1;
          classifierRetryDelayMs += observation.delayMs;
        },
      }));
    }
    let omittedClassifierResults = 0;
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      const found = results[index];
      if (found) decisions.push(found);
      else {
        omittedClassifierResults += 1;
        decisions.push(fallbackDecision(input, "classifier omitted a result; provider review required"));
      }
    }
    return {
      decisions,
      candidateCount: inputs.length,
      metrics: buildTriageMetrics(chunks, decisions, inputs.length, options.uncertainPolicy ?? "provider", classifierRequests, results.filter((result) => result !== null).length, 0, omittedClassifierResults, 0, 0, classifierHttpRequests, classifierRetries, classifierRetryDelayMs),
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // A classifier outage is observable and never silently downgrades the unresolved work.
    for (const input of inputs) {
      const message = error instanceof ClassifierError ? error.message : "classifier unavailable";
      const code = error instanceof ClassifierError ? " [" + error.code + "]" : "";
      decisions.push(fallbackDecision(input, "classifier failure" + code + ": " + message + "; provider review required"));
    }
    return {
      decisions,
      candidateCount: inputs.length,
      metrics: buildTriageMetrics(chunks, decisions, inputs.length, options.uncertainPolicy ?? "provider", classifierRequests, 0, 1, 0, 0, 0, classifierHttpRequests, classifierRetries, classifierRetryDelayMs),
    };
  }
}

export function filterChunksForProvider(
  chunks: AnalysisChunk[],
  decisions: ClassifierChunkDecision[],
  uncertainPolicy: UncertainPolicy = "provider",
) {
  const byId = new Map(decisions.map((decision) => [decision.chunkId, decision]));
  return chunks.filter((chunk) => {
    const decision = byId.get(chunk.id);
    if (!decision) return false;
    if (decision.decision === "ai-needed") return true;
    if (decision.decision === "uncertain" && uncertainPolicy === "provider") return true;
    return false;
  });
}


export interface ProviderTriageOptions extends ProviderAnalysisOptions {
  classifier?: ClassifierSettings | null;
  triageEnabled?: boolean;
  uncertainPolicy?: UncertainPolicy;
  labelFormulationId?: TriageLabelFormulationId;
  triageThresholds?: TriageConfidenceThresholds;
  classifierBatchSize?: number;
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
  const uncertainPolicy = options.uncertainPolicy ?? options.classifier?.uncertainPolicy ?? "provider";
  const triage = await triageChunks(chunks, local.issues, {
    signal: options.signal,
    classifier: options.classifier ?? null,
    uncertainPolicy,
    labelFormulationId: options.labelFormulationId,
    thresholds: options.triageThresholds,
    goals,
    classifierBatchSize: options.classifierBatchSize,
    maxExcerptChars: options.classifier?.maxExcerptChars,
    timeoutMs: options.classifierTimeoutMs ?? options.classifier?.timeoutMs,
  });
  const aiChunks = filterChunksForProvider(chunks, triage.decisions, uncertainPolicy);
  const providerMetrics = createProviderRequestMetrics();
  if (!aiChunks.length) {
    const stats = getWritingStats(text);
    const diagnostics = createAnalysisDiagnostics(local.issues.length, startedAt, "provider", triageDiagnostics(triage.metrics, providerMetrics));
    return {
      ...local,
      analysedText: text,
      issues: mergeAnalysisIssues([...local.issues]),
      scores: scoreWriting(stats, local.issues, goals, text),
      stats,
      source: "local" as const,
      changedRange: options.changedRange ?? undefined,
      triage: {
        decisions: triage.decisions,
        metrics: triage.metrics,
        coverage: { candidateChunks: triage.candidateCount, providerChunks: 0, skippedDueToLimit: 0 },
      },
      aiCoverage: { requestedChunks: 0, attemptedChunks: 0, successfulChunks: 0, failedChunks: 0, skippedChunks: 0 },
      ...(diagnostics ? { diagnostics } : {}),
    } as AnalysisResult & { triage: TriageOutcome };
  }
  const workload = selectProviderWorkload(aiChunks, { ...options, triageDecisions: triage.decisions });
  if (!workload.selected.length) {
    const stats = getWritingStats(text);
    const diagnostics = createAnalysisDiagnostics(local.issues.length, startedAt, "provider", triageDiagnostics(triage.metrics, providerMetrics));
    return {
      ...local,
      analysedText: text,
      issues: mergeAnalysisIssues([...local.issues]),
      scores: scoreWriting(stats, local.issues, goals, text),
      stats,
      source: "local" as const,
      changedRange: options.changedRange ?? undefined,
      triage: {
        decisions: triage.decisions,
        metrics: {
          ...triage.metrics,
          providerRequests: 0,
          providerHttpRequests: 0,
          providerChunks: 0,
          avoidedProviderChunks: Math.max(0, chunks.length),
          actualProviderAvoidanceRate: chunks.length ? 1 : 1,
        },
        coverage: { candidateChunks: triage.candidateCount, providerChunks: 0, skippedDueToLimit: workload.skipped },
      },
      aiCoverage: { requestedChunks: aiChunks.length, attemptedChunks: 0, successfulChunks: 0, failedChunks: 0, skippedChunks: workload.skipped },
      ...(diagnostics ? { diagnostics } : {}),
    } as AnalysisResult & { triage: TriageOutcome };
  }
  const settled = await mapWithConcurrency(workload.selected, async (chunk) => {
    const messages = [
      { role: "system", content: "You are a privacy-first writing assistant. Do not return HTML, markdown, or secrets." },
      { role: "user", content: analysisPrompt(chunk, goals, preferences) },
    ] as Array<{ role: "system" | "user"; content: string }>;
    recordProviderRequest(providerMetrics, settings, messages);
    return {
      chunk,
      response: await requestProvider(settings, messages, options.signal, options.timeoutMs, providerRequestObservers(providerMetrics)),
    };
  }, { concurrency: options.providerConcurrency, signal: options.signal });
  const successful = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failed = settled.filter((result) => result.status === "rejected").length;
  if (!successful.length) {
    const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (firstFailure && !(firstFailure.reason instanceof ProviderError && firstFailure.reason.code === "invalid-json")) throw firstFailure.reason;
  }
  const aiIssues = successful.flatMap(({ chunk, response }) => {
    return parseAnalysisIssues(response, chunk.text, chunk.id)
      .map((issue) => mapChunkIssue(issue, chunk, text))
      .filter((issue): issue is WritingIssue => Boolean(issue));
  });
  const issues = mergeAnalysisIssues([...local.issues, ...aiIssues]);
  const stats = getWritingStats(text);
  const diagnostics = createAnalysisDiagnostics(issues.length, startedAt, "provider", triageDiagnostics(triage.metrics, providerMetrics));
  return {
    ...local,
    analysedText: text,
    issues,
    scores: scoreWriting(stats, issues, goals, text),
    stats,
    source: successful.length ? "local+ai" : "local",
    changedRange: options.changedRange ?? undefined,
    triage: {
      decisions: triage.decisions,
      metrics: {
        ...triage.metrics,
        providerRequests: workload.selected.length,
        providerHttpRequests: providerMetrics.httpRequests,
        providerChunks: workload.selected.length,
        avoidedProviderChunks: Math.max(0, chunks.length - workload.selected.length),
        actualProviderAvoidanceRate: chunks.length ? Math.max(0, chunks.length - workload.selected.length) / chunks.length : 1,
      },
      coverage: { candidateChunks: triage.candidateCount, providerChunks: workload.selected.length, skippedDueToLimit: workload.skipped },
    },
    aiCoverage: {
      requestedChunks: aiChunks.length,
      attemptedChunks: workload.selected.length,
      successfulChunks: successful.length,
      failedChunks: failed,
      skippedChunks: workload.skipped,
    },
    ...(diagnostics ? { diagnostics } : {}),
  } as AnalysisResult & { triage: TriageOutcome };
}
