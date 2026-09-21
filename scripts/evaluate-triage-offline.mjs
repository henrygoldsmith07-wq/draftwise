import { readFile } from "node:fs/promises";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { createAnalysisChunks } from "../packages/analysis/src/index.ts";
import {
  CLASSIFIER_TRIAGE_LABELS,
  TRIAGE_LABEL_FORMULATIONS,
  redactExcerptForClassifier,
  triageChunks,
} from "../packages/ai/src/index.ts";

const corpus = JSON.parse(await readFile(new URL("../evaluation/triage-corpus.json", import.meta.url), "utf8"));
const classifier = {
  baseUrl: "https://classifier.dev",
  timeoutMs: 8_000,
  maxExcerptChars: 500,
};
const metricFields = [
  "candidateChunks",
  "classifierRequests",
  "classifiedChunks",
  "locallySufficientChunks",
  "aiNeededChunks",
  "uncertainChunks",
  "classifierFailures",
  "omittedClassifierResults",
  "providerRequests",
  "providerChunks",
  "avoidedProviderChunks",
];
const totals = Object.fromEntries(metricFields.map((field) => [field, 0]));
const requestLog = [];
const latencySamples = [];
const localLatencySamples = [];
const classifierLatencySamples = [];
const details = [];

function addMetrics(metrics) {
  for (const field of metricFields) totals[field] += Number(metrics[field] || 0);
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function predictedDecision(decisions) {
  if (decisions.some((decision) => decision.decision === "ai-needed")) return "ai-needed";
  if (decisions.some((decision) => decision.decision === "uncertain")) return "uncertain";
  return "locally-sufficient";
}

function deterministicLabel(excerpt, labels = CLASSIFIER_TRIAGE_LABELS) {
  const lower = excerpt.toLocaleLowerCase();
  const borderline = excerpt.length < 80 && /(really clear|make a decision|was reviewed|ready(?: for review)?|ready\.|set\.|go\.)/u.test(lower);
  const semanticSignals = /(thing|stuff|various|somehow|in order to|at the end of the day|game changer|leverage synergies|without a verb|nested|might|possibly|perhaps|extremely|passive)/u.test(lower);
  if (borderline) return { label: labels[2], confidence: 0.55 };
  return { label: labels[1], confidence: semanticSignals ? 0.88 : 0.82 };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const requestStarted = performance.now();
  const body = JSON.parse(init.body);
  if (!Array.isArray(body.inputs) || !Array.isArray(body.labels) || JSON.stringify(body.labels) !== JSON.stringify(CLASSIFIER_TRIAGE_LABELS)) {
    throw new Error("offline mock received a non-classifier.dev request shape");
  }
  requestLog.push({
    url: String(url),
    inputs: body.inputs,
    bytes: new TextEncoder().encode(init.body).length,
  });
  const response = new Response(JSON.stringify({
    tier: "offline",
    model: "deterministic-fixture",
    results: body.inputs.map((input) => {
      const result = deterministicLabel(String(input), body.labels);
      return { label: result.label, confidence: result.confidence, scores: { [result.label]: result.confidence } };
    }),
  }), { status: 200, headers: { "content-type": "application/json" } });
  classifierLatencySamples.push(performance.now() - requestStarted);
  return response;
};

for (const entry of corpus) {
  const startedAt = performance.now();
  const localStartedAt = performance.now();
  const local = analyzeLocally(entry.text, { dialect: "en-GB" });
  localLatencySamples.push(performance.now() - localStartedAt);
  const chunks = createAnalysisChunks(entry.text);
  const outcome = await triageChunks(chunks, local.issues, { classifier, uncertainPolicy: "provider" });
  const latencyMs = performance.now() - startedAt;
  const predicted = predictedDecision(outcome.decisions);
  latencySamples.push(latencyMs);
  addMetrics(outcome.metrics);
  details.push({
    id: entry.id,
    expected: entry.expectedDecision,
    predicted,
    candidateSelected: outcome.metrics.candidateChunks > 0,
    correct: predicted === entry.expectedDecision,
    expectedCategories: entry.expectedCategories,
    predictedCategories: [...new Set(outcome.decisions.flatMap((decision) => decision.categories))],
    latencyMs: Number(latencyMs.toFixed(2)),
  });
}

const fallbackOriginalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response("offline classifier outage", { status: 503 });
const fallbackText = "This thing is really useful for various aspects of the work and stuff.";
const fallbackLocal = analyzeLocally(fallbackText, { dialect: "en-GB" });
const fallbackOutcome = await triageChunks(createAnalysisChunks(fallbackText), fallbackLocal.issues, { classifier, uncertainPolicy: "provider" });
globalThis.fetch = fallbackOriginalFetch;
const fallbackCheck = {
  classifierFailures: fallbackOutcome.metrics.classifierFailures,
  aiNeededChunks: fallbackOutcome.metrics.aiNeededChunks,
  providerChunks: fallbackOutcome.metrics.providerChunks,
  passes: fallbackOutcome.metrics.classifierFailures === 1 && fallbackOutcome.metrics.aiNeededChunks > 0 && fallbackOutcome.metrics.providerChunks > 0,
};

globalThis.fetch = originalFetch;

const formulationResults = [];
for (const [formulationId, labels] of Object.entries(TRIAGE_LABEL_FORMULATIONS)) {
  const formulationDetails = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (JSON.stringify(body.labels) !== JSON.stringify(labels)) throw new Error("formulation labels were not sent as configured");
    return new Response(JSON.stringify({
      results: body.inputs.map((input) => {
        const result = deterministicLabel(String(input), labels);
        return { label: result.label, confidence: result.confidence, scores: { [result.label]: result.confidence } };
      }),
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  for (const entry of corpus) {
    const local = analyzeLocally(entry.text, { dialect: "en-GB" });
    const outcome = await triageChunks(createAnalysisChunks(entry.text), local.issues, {
      classifier,
      uncertainPolicy: "provider",
      labelFormulationId: formulationId,
    });
    const predicted = predictedDecision(outcome.decisions);
    formulationDetails.push({ expected: entry.expectedDecision, predicted });
  }
  const expectedAiForFormulation = formulationDetails.filter((item) => item.expected === "ai-needed").length;
  const truePositivesForFormulation = formulationDetails.filter((item) => item.expected === "ai-needed" && item.predicted === "ai-needed").length;
  const falsePositivesForFormulation = formulationDetails.filter((item) => item.expected !== "ai-needed" && item.predicted === "ai-needed").length;
  const falseNegativesForFormulation = formulationDetails.filter((item) => item.expected === "ai-needed" && item.predicted !== "ai-needed").length;
  const uncertainForFormulation = formulationDetails.filter((item) => item.predicted === "uncertain").length;
  formulationResults.push({
    id: formulationId,
    accuracy: Number((formulationDetails.filter((item) => item.expected === item.predicted).length / formulationDetails.length).toFixed(3)),
    aiPrecision: Number((truePositivesForFormulation + falsePositivesForFormulation ? truePositivesForFormulation / (truePositivesForFormulation + falsePositivesForFormulation) : 1).toFixed(3)),
    aiRecall: Number((expectedAiForFormulation ? truePositivesForFormulation / expectedAiForFormulation : 1).toFixed(3)),
    falseFilterRate: Number((expectedAiForFormulation ? falseNegativesForFormulation / expectedAiForFormulation : 0).toFixed(3)),
    uncertainRate: Number((uncertainForFormulation / formulationDetails.length).toFixed(3)),
  });
}
globalThis.fetch = originalFetch;

const truePositives = details.filter((item) => item.expected === "ai-needed" && item.predicted === "ai-needed").length;
const falsePositives = details.filter((item) => item.expected !== "ai-needed" && item.predicted === "ai-needed").length;
const falseNegatives = details.filter((item) => item.expected === "ai-needed" && item.predicted !== "ai-needed").length;
const expectedAi = details.filter((item) => item.expected === "ai-needed").length;
const accuracy = details.length ? details.filter((item) => item.correct).length / details.length : 1;
const aiPrecision = truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : 1;
const aiRecall = expectedAi ? truePositives / expectedAi : 1;
const falseFilterRate = expectedAi ? falseNegatives / expectedAi : 0;
const uncertainRate = details.length ? details.filter((item) => item.predicted === "uncertain").length / details.length : 0;
const expectedCandidates = details.filter((item) => item.expected !== "locally-sufficient").length;
const selectedCandidates = details.filter((item) => item.candidateSelected).length;
const candidateTruePositives = details.filter((item) => item.candidateSelected && item.expected !== "locally-sufficient").length;
const candidateFalsePositives = details.filter((item) => item.candidateSelected && item.expected === "locally-sufficient").length;
const candidateFalseNegatives = details.filter((item) => !item.candidateSelected && item.expected !== "locally-sufficient").length;
const excerpts = requestLog.flatMap((request) => request.inputs.map((input) => String(input).length));
const redactionProbes = [
  "https://example.com/help",
  "support@example.com",
  "+44 20 7946 0958",
  "£1,250.50",
  "20%",
  "2026-09-21",
  "ABC-123",
  "draft.docx",
  "GPT-4o-mini",
  "123e4567-e89b-12d3-a456-426614174000",
  "API_KEY=secret-value",
  "token \"sk-test-123456789\"",
];
const redactionPassed = redactionProbes.every((probe) => !redactExcerptForClassifier(probe).includes(probe));
const report = {
  mode: "offline",
  corpusSize: corpus.length,
  metrics: totals,
  classification: {
    accuracy: Number(accuracy.toFixed(3)),
    aiPrecision: Number(aiPrecision.toFixed(3)),
    aiRecall: Number(aiRecall.toFixed(3)),
    falseFilterRate: Number(falseFilterRate.toFixed(3)),
    uncertainRate: Number(uncertainRate.toFixed(3)),
    truePositives,
    falsePositives,
    falseNegatives,
  },
  labelFormulations: formulationResults,
  candidateSelection: {
    precision: Number((candidateTruePositives + candidateFalsePositives ? candidateTruePositives / (candidateTruePositives + candidateFalsePositives) : 1).toFixed(3)),
    recall: Number((expectedCandidates ? candidateTruePositives / expectedCandidates : 1).toFixed(3)),
    falseFilterRate: Number((expectedCandidates ? candidateFalseNegatives / expectedCandidates : 0).toFixed(3)),
    selectedCandidates,
    expectedCandidates,
    falsePositives: candidateFalsePositives,
    falseNegatives: candidateFalseNegatives,
  },
  calls: {
    classifierRequests: totals.classifierRequests,
    providerRequestsWouldBe: totals.providerChunks,
    totalCloudRequestsWouldBe: totals.classifierRequests + totals.providerChunks,
    avoidedProviderChunks: totals.avoidedProviderChunks,
  },
  latencyMs: {
    p50: Number(percentile(latencySamples, 0.5).toFixed(2)),
    p95: Number(percentile(latencySamples, 0.95).toFixed(2)),
  },
  excerptSize: {
    averageChars: excerpts.length ? Number((excerpts.reduce((sum, value) => sum + value, 0) / excerpts.length).toFixed(2)) : 0,
    p95Chars: Number(percentile(excerpts, 0.95).toFixed(2)),
    maxChars: excerpts.length ? Math.max(...excerpts) : 0,
  },
  observability: {
    localAnalysisMs: {
      p50: Number(percentile(localLatencySamples, 0.5).toFixed(2)),
      p95: Number(percentile(localLatencySamples, 0.95).toFixed(2)),
    },
    classifierLatencyMs: {
      p50: Number(percentile(classifierLatencySamples, 0.5).toFixed(2)),
      p95: Number(percentile(classifierLatencySamples, 0.95).toFixed(2)),
    },
    classifierBytesSent: requestLog.reduce((sum, request) => sum + request.bytes, 0),
    providerRequests: totals.providerRequests,
    providerLatencyMs: null,
    providerTokensEstimate: null,
    providerAvoidanceRate: Number((totals.providerChunks + totals.avoidedProviderChunks
      ? totals.avoidedProviderChunks / (totals.providerChunks + totals.avoidedProviderChunks)
      : 1).toFixed(3)),
  },
  redactionPassed,
  fallbackCheck,
  examples: details,
};

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--strict") && (accuracy < 0.7 || aiRecall < 0.75 || falseFilterRate > 0.25 || !redactionPassed || !fallbackCheck.passes)) {
  console.error("offline triage strict gate failed");
  process.exit(1);
}
