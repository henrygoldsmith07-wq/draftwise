import { readFile } from "node:fs/promises";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { createAnalysisChunks } from "../packages/analysis/src/index.ts";
import { TRIAGE_LABEL_FORMULATION_ID, triageChunks } from "../packages/ai/src/index.ts";

const corpus = JSON.parse(await readFile(new URL("../evaluation/triage-corpus.json", import.meta.url), "utf8"));
const classifierUrl = process.env.CLASSIFIER_BASE_URL || "https://classifier.dev";
const classifier = {
  baseUrl: classifierUrl,
  apiKey: process.env.CLASSIFIER_API_KEY || undefined,
  timeoutMs: Number(process.env.CLASSIFIER_TIMEOUT_MS || 8_000),
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
const latencySamples = [];
const localLatencySamples = [];
const classifierLatencySamples = [];
const excerptSizes = [];
let classifierBytesSent = 0;
const details = [];
let fetchCalls = 0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  fetchCalls += 1;
  const init = args[1] || {};
  try {
    const body = JSON.parse(String(init.body || "{}"));
    if (Array.isArray(body.inputs)) {
      classifierBytesSent += new TextEncoder().encode(String(init.body || "")).length;
      excerptSizes.push(...body.inputs.map((input) => String(input).length));
    }
  } catch {
    // The triage client validates the response; observability must not alter it.
  }
  const startedAt = performance.now();
  const response = await nativeFetch(...args);
  classifierLatencySamples.push(performance.now() - startedAt);
  return response;
};

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

const limit = Number(process.argv.find((value) => value.startsWith("--limit="))?.split("=")[1] || corpus.length);
for (const entry of corpus.slice(0, Math.max(0, limit))) {
  const startedAt = performance.now();
  const localStartedAt = performance.now();
  const local = analyzeLocally(entry.text, { dialect: "en-GB" });
  localLatencySamples.push(performance.now() - localStartedAt);
  const outcome = await triageChunks(createAnalysisChunks(entry.text), local.issues, { classifier, uncertainPolicy: "provider" });
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
    classifierFailures: outcome.metrics.classifierFailures,
    omittedClassifierResults: outcome.metrics.omittedClassifierResults,
    latencyMs: Number(latencyMs.toFixed(2)),
  });
}
globalThis.fetch = nativeFetch;

const total = details.length;
const expectedAi = details.filter((item) => item.expected === "ai-needed").length;
const truePositives = details.filter((item) => item.expected === "ai-needed" && item.predicted === "ai-needed").length;
const falsePositives = details.filter((item) => item.expected !== "ai-needed" && item.predicted === "ai-needed").length;
const falseNegatives = details.filter((item) => item.expected === "ai-needed" && item.predicted !== "ai-needed").length;
const predictedAi = details.filter((item) => item.predicted === "ai-needed").length;
const accuracy = total ? details.filter((item) => item.correct).length / total : 1;
const aiPrecision = predictedAi ? truePositives / predictedAi : 1;
const aiRecall = expectedAi ? truePositives / expectedAi : 1;
const falseFilterRate = expectedAi ? falseNegatives / expectedAi : 0;
const uncertainRate = total ? details.filter((item) => item.predicted === "uncertain").length / total : 0;
const expectedCandidates = details.filter((item) => item.expected !== "locally-sufficient").length;
const selectedCandidates = details.filter((item) => item.candidateSelected).length;
const candidateTruePositives = details.filter((item) => item.candidateSelected && item.expected !== "locally-sufficient").length;
const candidateFalsePositives = details.filter((item) => item.candidateSelected && item.expected === "locally-sufficient").length;
const candidateFalseNegatives = details.filter((item) => !item.candidateSelected && item.expected !== "locally-sufficient").length;
const report = {
  mode: "live",
  classifierUrl,
  labelFormulationId: TRIAGE_LABEL_FORMULATION_ID,
  corpusSize: total,
  fetchCalls,
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
    averageChars: excerptSizes.length ? Number((excerptSizes.reduce((sum, value) => sum + value, 0) / excerptSizes.length).toFixed(2)) : 0,
    p95Chars: Number(percentile(excerptSizes, 0.95).toFixed(2)),
    maxChars: excerptSizes.length ? Math.max(...excerptSizes) : 0,
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
    classifierBytesSent,
    providerRequests: totals.providerRequests,
    providerLatencyMs: null,
    providerTokensEstimate: null,
    providerAvoidanceRate: Number((totals.providerChunks + totals.avoidedProviderChunks
      ? totals.avoidedProviderChunks / (totals.providerChunks + totals.avoidedProviderChunks)
      : 1).toFixed(3)),
  },
  details,
};

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--strict") && (aiRecall < 0.75 || falseFilterRate > 0.25)) {
  console.error("live triage strict gate failed");
  process.exit(1);
}
