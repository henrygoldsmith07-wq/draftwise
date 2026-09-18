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
  getWritingStats,
  inferTone,
  scoreWriting,
  type GrammarOptions,
} from "../../grammar/src/index.ts";
import type {
  AnalysisResult,
  IssueCategory,
  IssueSeverity,
  ProviderErrorCode,
  ProviderSettings,
  RewriteRequest,
  RewriteResult,
  StylePreferences,
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
  const parsed = parseProviderPayload(value);
  if (!parsed) return null;
  const local = analyzeLocally(sourceText, options.preferences, options.goals);
  const aiIssues = parseAnalysisIssues(value, sourceText);
  const issues = mergeAnalysisIssues([...local.issues, ...aiIssues]);
  const stats = getWritingStats(sourceText);
  const scores = scoreWriting(stats, issues, options.goals, sourceText);
  return {
    analysedText: sourceText,
    issues,
    tone: parsed.tone.length ? parsed.tone.slice(0, 4) : inferTone(sourceText),
    scores,
    stats,
    source: aiIssues.length ? "local+ai" : "local",
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
  return {
    ...local,
    analysedText: text,
    issues,
    scores: scoreWriting(stats, issues, goals, text),
    stats,
    source: aiIssues.length ? "local+ai" : "local",
    changedRange: options.changedRange ?? undefined,
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
    /\b(?:\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*|\s+)\d{2,4})\b/giu,
    /(?:[$€£¥]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:usd|eur|gbp|jpy)\b)/giu,
    /\b\d[\d,.]*%/gu,
    /\b(?:id|ticket|case|ref(?:erence)?)[#\s:-]*[a-z0-9][a-z0-9_-]{2,}\b/giu,
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
