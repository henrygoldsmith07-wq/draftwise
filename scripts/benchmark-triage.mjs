import { readFile } from "node:fs/promises";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { createAnalysisChunks } from "../packages/analysis/src/index.ts";
import {
  CLASSIFIER_TRIAGE_LABELS,
  estimateTokens,
  filterChunksForProvider,
  triageChunks,
} from "../packages/ai/src/index.ts";

const corpus = JSON.parse(await readFile(new URL("../evaluation/triage-corpus.json", import.meta.url), "utf8"));
const classifier = { baseUrl: "https://classifier.dev", timeoutMs: 8_000, maxExcerptChars: 500 };
const providerPromptOverheadTokens = 120;

function deterministicLabel(excerpt, labels = CLASSIFIER_TRIAGE_LABELS) {
  const lower = excerpt.toLocaleLowerCase();
  const short = lower.trim().split(/\s+/u).filter(Boolean).length <= 5;
  const protectedTokens = /\[(?:url|email|filename|identifier|token|secret|model|uuid|phone)\]/u.test(lower);
  const legalStyle = /\b(subject to|shall|attached schedule|agreed period|retain evidence|supplier)\b/u.test(lower);
  const borderline = short || protectedTokens || legalStyle || (excerpt.length < 80 && /(really clear|make a decision|was reviewed|ready(?: for review)?|ready\.|set\.|go\.)/u.test(lower));
  const semanticSignals = /(thing|stuff|various|somehow|in order to|at the end of the day|game changer|leverage synergies|without a verb|nested|might|possibly|perhaps|extremely|passive)/u.test(lower);
  if (borderline) return { label: labels[0], confidence: 0.55 };
  return { label: labels[1], confidence: semanticSignals ? 0.88 : 0.82 };
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function providerTokens(chunks) {
  return chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.text) + providerPromptOverheadTokens, 0);
}

function predictedDecision(decisions) {
  if (decisions.some((decision) => decision.decision === "ai-needed")) return "ai-needed";
  if (decisions.some((decision) => decision.decision === "uncertain")) return "uncertain";
  return "locally-sufficient";
}

const originalFetch = globalThis.fetch;
const classifierLatency = [];
globalThis.fetch = async (_url, init) => {
  const startedAt = performance.now();
  const body = JSON.parse(init.body);
  const response = new Response(JSON.stringify({
    tier: "benchmark",
    model: "deterministic-fixture",
    results: body.inputs.map((input) => {
      const result = deterministicLabel(String(input), body.labels);
      return { label: result.label, confidence: result.confidence, scores: { [result.label]: result.confidence } };
    }),
  }), { status: 200, headers: { "content-type": "application/json" } });
  classifierLatency.push(performance.now() - startedAt);
  return response;
};

const baselineLatencies = [];
const triageLatencies = [];
const baseline = { providerChunks: 0, providerRequests: 0, providerInputTokens: 0, providerHttpRequests: 0 };
const triage = { providerChunks: 0, providerRequests: 0, providerInputTokens: 0, providerHttpRequests: 0, classifierRequests: 0, classifierHttpRequests: 0, classifierFailures: 0, fallbackChunks: 0, avoidedProviderChunks: 0 };
const examples = [];

try {
  for (const entry of corpus) {
    const goals = entry.goals || { audience: "general", intent: "inform", tone: "professional" };
    const localStartedAt = performance.now();
    const local = analyzeLocally(entry.text, { dialect: "en-GB" }, goals);
    const chunks = createAnalysisChunks(entry.text);
    const localMs = performance.now() - localStartedAt;
    const baselineStartedAt = performance.now();
    baseline.providerChunks += chunks.length;
    baseline.providerRequests += chunks.length;
    baseline.providerInputTokens += providerTokens(chunks);
    baselineLatencies.push(performance.now() - baselineStartedAt + localMs);

    const triageStartedAt = performance.now();
    const outcome = await triageChunks(chunks, local.issues, { classifier, goals, uncertainPolicy: "provider" });
    const providerChunks = filterChunksForProvider(chunks, outcome.decisions, "provider");
    triage.providerChunks += providerChunks.length;
    triage.providerRequests += providerChunks.length;
    triage.providerInputTokens += providerTokens(providerChunks);
    triage.classifierRequests += outcome.metrics.classifierRequests;
    triage.classifierHttpRequests += outcome.metrics.classifierHttpRequests;
    triage.classifierFailures += outcome.metrics.classifierFailures;
    triage.fallbackChunks += outcome.metrics.fallbackRate * outcome.decisions.length;
    triage.avoidedProviderChunks += Math.max(0, chunks.length - providerChunks.length);
    triageLatencies.push(performance.now() - triageStartedAt + localMs);
    const predicted = predictedDecision(outcome.decisions);
    examples.push({ id: entry.id, expected: entry.expectedDecision, predicted, correct: predicted === entry.expectedDecision });
  }
} finally {
  globalThis.fetch = originalFetch;
}

const expectedAi = examples.filter((example) => example.expected === "ai-needed").length;
const truePositives = examples.filter((example) => example.expected === "ai-needed" && example.predicted === "ai-needed").length;
const falsePositives = examples.filter((example) => example.expected !== "ai-needed" && example.predicted === "ai-needed").length;
const falseNegatives = examples.filter((example) => example.expected === "ai-needed" && example.predicted !== "ai-needed").length;
const classifierAccuracy = examples.length ? examples.filter((example) => example.correct).length / examples.length : 1;
const aiPrecision = truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : 1;
const aiRecall = expectedAi ? truePositives / expectedAi : 1;
const providerChunkReduction = baseline.providerChunks ? (baseline.providerChunks - triage.providerChunks) / baseline.providerChunks : 1;
const providerTokenSavings = baseline.providerInputTokens - triage.providerInputTokens;

console.log(JSON.stringify({
  mode: "offline-deterministic",
  corpusSize: corpus.length,
  baseline: {
    path: "local -> provider for every analysis chunk",
    providerChunks: baseline.providerChunks,
    providerRequests: baseline.providerRequests,
    providerHttpRequests: baseline.providerHttpRequests,
    estimatedProviderInputTokens: baseline.providerInputTokens,
    latencyMs: { p50: Number(percentile(baselineLatencies, 0.5).toFixed(2)), p95: Number(percentile(baselineLatencies, 0.95).toFixed(2)) },
  },
  triage: {
    path: "local -> classifier -> provider for selected chunks",
    providerChunks: triage.providerChunks,
    providerRequests: triage.providerRequests,
    providerHttpRequests: triage.providerHttpRequests,
    classifierRequests: triage.classifierRequests,
    classifierHttpRequests: triage.classifierHttpRequests,
    classifierFailures: triage.classifierFailures,
    fallbackChunks: Math.round(triage.fallbackChunks),
    estimatedProviderInputTokens: triage.providerInputTokens,
    latencyMs: { p50: Number(percentile(triageLatencies, 0.5).toFixed(2)), p95: Number(percentile(triageLatencies, 0.95).toFixed(2)) },
  },
  savings: {
    providerChunkReduction: Number(providerChunkReduction.toFixed(3)),
    providerChunksAvoided: baseline.providerChunks - triage.providerChunks,
    providerInputTokensSaved: providerTokenSavings,
    classifierOverheadRequests: triage.classifierRequests,
    providerAvoidanceRate: Number(providerChunkReduction.toFixed(3)),
  },
  quality: {
    accuracy: Number(classifierAccuracy.toFixed(3)),
    aiPrecision: Number(aiPrecision.toFixed(3)),
    aiRecall: Number(aiRecall.toFixed(3)),
    falseFilterRate: Number((expectedAi ? falseNegatives / expectedAi : 0).toFixed(3)),
    truePositives,
    falsePositives,
    falseNegatives,
  },
  classifierLatencyMs: { p50: Number(percentile(classifierLatency, 0.5).toFixed(2)), p95: Number(percentile(classifierLatency, 0.95).toFixed(2)) },
  assumptions: {
    providerExecution: "count-only; no provider calls are made by this benchmark",
    estimatedProviderPromptOverheadTokens: providerPromptOverheadTokens,
    providerOutputTokens: "not estimated because output length is provider-dependent",
  },
  examples,
}, null, 2));

if (process.argv.includes("--strict") && (classifierAccuracy < 0.7 || aiRecall < 0.75 || providerChunkReduction <= 0)) process.exit(1);
