import { z } from "zod";
import type {
  AnalysisResult,
  IssueCategory,
  IssueSeverity,
  ProviderSettings,
  RewriteRequest,
  RewriteResult,
  WritingGoals,
  WritingIssue,
} from "../../types/src/index.js";
import { analyzeLocally, getWritingStats, mergeWritingIssues, scoreWriting } from "../../grammar/src/index.js";

const issueSchema = z.object({
  start: z.number(),
  end: z.number(),
  original: z.string(),
  replacement: z.string(),
  category: z.string(),
  severity: z.string(),
  title: z.string(),
  explanation: z.string(),
});

const responseSchema = z.object({
  issues: z.array(issueSchema).default([]),
  tone: z.array(z.string()).default([]),
  scores: z.object({
    grammar: z.number(),
    clarity: z.number(),
    conciseness: z.number(),
    overall: z.number(),
  }).partial().default({}),
});

const CATEGORIES = new Set<IssueCategory>([
  "spelling", "grammar", "punctuation", "clarity", "conciseness", "word choice",
  "repetition", "tone", "formality", "readability", "fluency", "passive voice", "sentence structure",
]);

const SEVERITIES = new Set<IssueSeverity>(["low", "medium", "high"]);
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function parseCustomHeaders(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, item]) => typeof item === "string") as Array<[string, string]>,
    );
  } catch {
    return {};
  }
}

function parseJsonContent(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export function parseAnalysisResponse(value: unknown, sourceText: string): AnalysisResult | null {
  const parsed = responseSchema.safeParse(parseJsonContent(value));
  if (!parsed.success) return null;
  const local = analyzeLocally(sourceText);
  const aiIssues: WritingIssue[] = [];
  for (const candidate of parsed.data.issues) {
    const start = Math.max(0, Math.floor(candidate.start));
    const end = Math.min(sourceText.length, Math.floor(candidate.end));
    if (end <= start) continue;
    const original = sourceText.slice(start, end);
    if (!original || (candidate.original && candidate.original.trim() !== original.trim())) continue;
    const category = candidate.category.toLowerCase() as IssueCategory;
    const severity = candidate.severity.toLowerCase() as IssueSeverity;
    if (!CATEGORIES.has(category) || !SEVERITIES.has(severity)) continue;
    aiIssues.push({
      id: `ai-${start}-${end}-${candidate.title.slice(0, 16)}`,
      start,
      end,
      original,
      replacement: candidate.replacement,
      category,
      severity,
      title: candidate.title.slice(0, 120),
      explanation: candidate.explanation.slice(0, 500),
      source: "ai",
    });
  }
  const issues = mergeWritingIssues([...local.issues, ...aiIssues]);
  const scores = {
    ...local.scores,
    grammar: clamp(parsed.data.scores.grammar ?? local.scores.grammar),
    clarity: clamp(parsed.data.scores.clarity ?? local.scores.clarity),
    conciseness: clamp(parsed.data.scores.conciseness ?? local.scores.conciseness),
    overall: clamp(parsed.data.scores.overall ?? local.scores.overall),
  };
  return {
    analysedText: sourceText,
    issues,
    tone: parsed.data.tone.length ? parsed.data.tone.slice(0, 4) : local.tone,
    scores: { ...scores, engagement: local.scores.engagement },
    stats: getWritingStats(sourceText),
    source: aiIssues.length ? "local+ai" : "local",
  };
}

function endpointFor(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function buildGoalsContext(goals: WritingGoals) {
  return `Audience: ${goals.audience}. Intent: ${goals.intent}. Desired tone: ${goals.tone}.`;
}

async function requestProvider(
  settings: ProviderSettings,
  messages: Array<{ role: "system" | "user"; content: string }>,
  signal?: AbortSignal,
) {
  if (!settings.apiKey.trim()) throw new Error("Add an API key in Settings to enable AI suggestions.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25_000);
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const response = await fetch(endpointFor(settings.baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey.trim()}`,
        ...parseCustomHeaders(settings.customHeaders),
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        response_format: { type: "json_object" },
        messages,
      }),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error("The provider rejected this API key.");
      if (response.status === 429) throw new Error("The provider is rate-limiting requests. Try again in a moment.");
      throw new Error(`Provider error (${response.status}).`);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    return payload.choices?.[0]?.message?.content ?? null;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function analyzeWithProvider(
  text: string,
  goals: WritingGoals,
  settings: ProviderSettings,
  signal?: AbortSignal,
) {
  const local = analyzeLocally(text);
  const promptText = text.length > 8_000 ? text.slice(-8_000) : text;
  const response = await requestProvider(settings, [
    {
      role: "system",
      content: `You are a precise writing editor. Return JSON only. ${buildGoalsContext(goals)}
Use character offsets relative to the provided text. Never invent an original string: it must exactly match the span. Suggest only useful changes. JSON shape: {"issues":[{"start":0,"end":4,"original":"text","replacement":"Text","category":"grammar","severity":"medium","title":"Short title","explanation":"Plain explanation."}],"tone":["friendly"],"scores":{"grammar":0,"clarity":0,"conciseness":0,"overall":0}}`,
    },
    { role: "user", content: promptText },
  ], signal);
  const parsed = parseAnalysisResponse(response, text);
  if (!parsed) throw new Error("The provider returned an invalid response. Your text is safe and local analysis is still available.");
  return {
    ...parsed,
    stats: getWritingStats(text),
    scores: parsed.scores ?? scoreWriting(local.stats, local.issues),
  } satisfies AnalysisResult;
}

function localRewrite(text: string, instruction: string): string {
  const lower = instruction.toLowerCase();
  let result = text.replace(/\s{2,}/g, " ").trim();
  if (lower.includes("shorten") || lower.includes("concise")) {
    result = result
      .replace(/\b(?:actually|basically|just|really|quite|very|perhaps|simply)\b\s*/gi, "")
      .replace(/\bin order to\b/gi, "to")
      .replace(/\bat this point in time\b/gi, "now");
  }
  if (lower.includes("formal") || lower.includes("professional")) {
    result = result.replace(/\bcan't\b/gi, "cannot").replace(/\bwon't\b/gi, "will not").replace(/\bget\b/gi, "receive");
  }
  if (lower.includes("casual") || lower.includes("friendly")) {
    result = result.replace(/\bcannot\b/gi, "can't").replace(/\bwill not\b/gi, "won't");
  }
  if (lower.includes("confident")) {
    result = result.replace(/\b(might|maybe|perhaps|could)\b/gi, "can");
  }
  if (lower.includes("explain") && result) {
    return `${result}\n\nWhy: I tightened the wording while keeping your original meaning and ${lower.includes("formal") ? "a more formal register" : "a clear, direct tone"}.`;
  }
  return result || text;
}

export async function rewriteWithProvider(
  request: RewriteRequest,
  settings: ProviderSettings,
  signal?: AbortSignal,
): Promise<RewriteResult> {
  if (!settings.enabled || !settings.apiKey.trim()) {
    return {
      replacement: localRewrite(request.text, request.instruction),
      explanation: "Local rewrite: your text stayed on this device because AI is disabled.",
      source: "local",
    };
  }
  const response = await requestProvider(settings, [
    {
      role: "system",
      content: `You are a careful writing partner. Return JSON only with {"replacement":"...","explanation":"..."}. ${buildGoalsContext(request.goals)} Preserve meaning, names, numbers, and URLs. Never include HTML or markdown fences.`,
    },
    { role: "user", content: `${request.instruction}\n\nText:\n${request.text}` },
  ], signal);
  const parsed = z.object({ replacement: z.string().min(1), explanation: z.string().default("") }).safeParse(parseJsonContent(response));
  if (!parsed.success) throw new Error("The provider returned an invalid rewrite. Nothing was changed.");
  return { ...parsed.data, source: "ai" };
}
