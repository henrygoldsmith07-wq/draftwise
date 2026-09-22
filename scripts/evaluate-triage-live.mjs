import { readFile } from "node:fs/promises";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { createAnalysisChunks } from "../packages/analysis/src/index.ts";
import {
  CLASSIFIER_BATCH_SIZES,
  TRIAGE_LABEL_FORMULATIONS,
  mapClassifierLabel,
  triageChunks,
} from "../packages/ai/src/index.ts";

const corpus = JSON.parse(await readFile(new URL("../evaluation/triage-corpus.json", import.meta.url), "utf8"));
const classifierUrl = process.env.CLASSIFIER_BASE_URL || "https://classifier.dev";
const classifier = {
  baseUrl: classifierUrl,
  apiKey: process.env.CLASSIFIER_API_KEY || undefined,
  timeoutMs: Number(process.env.CLASSIFIER_TIMEOUT_MS || 8_000),
  maxExcerptChars: 500,
};
const defaultGoals = { audience: "general", intent: "inform", tone: "professional" };
const aiThresholds = [0.65, 0.70, 0.75, 0.80, 0.85];
const localThresholds = [0.70, 0.75, 0.80, 0.85, 0.90];
const metricFields = [
  "candidateChunks",
  "classifierRequests",
  "classifiedChunks",
  "locallySufficientChunks",
  "aiNeededChunks",
  "uncertainChunks",
  "classifierFailures",
  "omittedClassifierResults",
];
const limitArgument = process.argv.find((value) => value.startsWith("--limit="));
const limit = Math.max(0, Math.min(corpus.length, Number(limitArgument?.split("=")[1] || corpus.length)));
const benchmarkBatching = process.argv.includes("--benchmark-batching");
const nativeFetch = globalThis.fetch;
let fetchCalls = 0;
let classifierBytesSent = 0;
const classifierLatencySamples = [];
const excerptSizes = [];

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
    // Request observability must never change validation or fallback behaviour.
  }
  const startedAt = performance.now();
  const response = await nativeFetch(...args);
  classifierLatencySamples.push(performance.now() - startedAt);
  return response;
};

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}

function predictedDecision(decisions) {
  if (decisions.some((decision) => decision.decision === "ai-needed")) return "ai-needed";
  if (decisions.some((decision) => decision.decision === "uncertain")) return "uncertain";
  return "locally-sufficient";
}

function remapDecision(decision, labels, thresholds) {
  if (!decision.label) return decision;
  return {
    ...decision,
    decision: mapClassifierLabel(decision.label, decision.confidence, labels, thresholds),
  };
}

function providerChunkCount(decisions) {
  return decisions.filter((decision) => decision.decision === "ai-needed" || decision.decision === "uncertain").length;
}

async function collectFormulation(formulationId, classifierBatchSize = 100) {
  const observations = [];
  for (const entry of corpus.slice(0, limit)) {
    const startedAt = performance.now();
    const goals = entry.goals || defaultGoals;
    const local = analyzeLocally(entry.text, { dialect: "en-GB" }, goals);
    const chunks = createAnalysisChunks(entry.text);
    const outcome = await triageChunks(chunks, local.issues, {
      classifier,
      goals,
      uncertainPolicy: "provider",
      labelFormulationId: formulationId,
      classifierBatchSize,
      thresholds: { aiNeeded: 0, locallySufficient: 0 },
    });
    observations.push({
      entry,
      chunks,
      outcome,
      latencyMs: performance.now() - startedAt,
    });
  }
  return observations;
}

function scoreFormulation(observations, formulationId, thresholds) {
  const labels = TRIAGE_LABEL_FORMULATIONS[formulationId];
  const details = observations.map((observation) => {
    const decisions = observation.outcome.decisions.map((decision) => remapDecision(decision, labels, thresholds));
    const predicted = predictedDecision(decisions);
    return {
      id: observation.entry.id,
      expected: observation.entry.expectedDecision,
      predicted,
      candidateSelected: observation.outcome.metrics.candidateChunks > 0,
      correct: predicted === observation.entry.expectedDecision,
      classifierDecisions: decisions.map((decision) => ({
        label: decision.label || null,
        confidence: decision.confidence,
        decision: decision.decision,
        fallback: Boolean(decision.fallback),
      })),
      providerChunks: providerChunkCount(decisions),
      latencyMs: Number(observation.latencyMs.toFixed(2)),
    };
  });
  const total = details.length;
  const expectedAi = details.filter((item) => item.expected === "ai-needed").length;
  const truePositives = details.filter((item) => item.expected === "ai-needed" && item.predicted === "ai-needed").length;
  const falsePositives = details.filter((item) => item.expected !== "ai-needed" && item.predicted === "ai-needed").length;
  const falseNegatives = details.filter((item) => item.expected === "ai-needed" && item.predicted !== "ai-needed").length;
  const predictedAi = details.filter((item) => item.predicted === "ai-needed").length;
  const expectedCandidates = details.filter((item) => item.expected !== "locally-sufficient").length;
  const candidateTruePositives = details.filter((item) => item.candidateSelected && item.expected !== "locally-sufficient").length;
  const candidateFalsePositives = details.filter((item) => item.candidateSelected && item.expected === "locally-sufficient").length;
  const candidateFalseNegatives = details.filter((item) => !item.candidateSelected && item.expected !== "locally-sufficient").length;
  const providerChunks = details.reduce((sum, item) => sum + item.providerChunks, 0);
  const totalChunks = observations.reduce((sum, item) => sum + item.chunks.length, 0);
  const metrics = Object.fromEntries(metricFields.map((field) => [
    field,
    observations.reduce((sum, item) => sum + Number(item.outcome.metrics[field] || 0), 0),
  ]));
  metrics.providerRequests = providerChunks;
  metrics.providerChunks = providerChunks;
  metrics.avoidedProviderChunks = Math.max(0, totalChunks - providerChunks);
  const expectedReviews = details.filter((item) => item.expected !== "locally-sufficient").length;
  const reviewTruePositives = details.filter((item) => item.expected !== "locally-sufficient" && item.providerChunks > 0).length;
  const reviewFalsePositives = details.filter((item) => item.expected === "locally-sufficient" && item.providerChunks > 0).length;
  const reviewFalseNegatives = details.filter((item) => item.expected !== "locally-sufficient" && item.providerChunks === 0).length;
  return {
    formulationId,
    thresholds,
    corpusSize: total,
    classification: {
      accuracy: round(total ? details.filter((item) => item.correct).length / total : 1),
      aiPrecision: round(predictedAi ? truePositives / predictedAi : 1),
      aiRecall: round(expectedAi ? truePositives / expectedAi : 1),
      falseFilterRate: round(expectedAi ? falseNegatives / expectedAi : 0),
      uncertainRate: round(total ? details.filter((item) => item.predicted === "uncertain").length / total : 0),
      truePositives,
      falsePositives,
      falseNegatives,
    },
    candidateSelection: {
      precision: round(candidateTruePositives + candidateFalsePositives ? candidateTruePositives / (candidateTruePositives + candidateFalsePositives) : 1),
      recall: round(expectedCandidates ? candidateTruePositives / expectedCandidates : 1),
      falseFilterRate: round(expectedCandidates ? candidateFalseNegatives / expectedCandidates : 0),
      selectedCandidates: details.filter((item) => item.candidateSelected).length,
      expectedCandidates,
      falsePositives: candidateFalsePositives,
      falseNegatives: candidateFalseNegatives,
    },
    providerRouting: {
      reviewPrecision: round(reviewTruePositives + reviewFalsePositives ? reviewTruePositives / (reviewTruePositives + reviewFalsePositives) : 1),
      reviewRecall: round(expectedReviews ? reviewTruePositives / expectedReviews : 1),
      falseFilterRate: round(expectedReviews ? reviewFalseNegatives / expectedReviews : 0),
      selectedReviews: details.filter((item) => item.providerChunks > 0).length,
      expectedReviews,
      falsePositives: reviewFalsePositives,
      falseNegatives: reviewFalseNegatives,
    },
    calls: {
      providerChunksWouldBe: providerChunks,
      avoidedProviderChunks: metrics.avoidedProviderChunks,
      providerAvoidanceRate: round(totalChunks ? metrics.avoidedProviderChunks / totalChunks : 1),
    },
    latencyMs: {
      p50: Number(percentile(details.map((item) => item.latencyMs), 0.5).toFixed(2)),
      p95: Number(percentile(details.map((item) => item.latencyMs), 0.95).toFixed(2)),
    },
    metrics,
    details,
  };
}

function rankResults(left, right) {
  return left.providerRouting.falseFilterRate - right.providerRouting.falseFilterRate
    || right.providerRouting.reviewRecall - left.providerRouting.reviewRecall
    || left.classification.falseFilterRate - right.classification.falseFilterRate
    || right.classification.aiRecall - left.classification.aiRecall
    || right.calls.providerAvoidanceRate - left.calls.providerAvoidanceRate
    || right.classification.accuracy - left.classification.accuracy;
}

const formulationReports = [];
for (const formulationId of Object.keys(TRIAGE_LABEL_FORMULATIONS)) {
  const observations = await collectFormulation(formulationId);
  const thresholdGrid = [];
  for (const aiNeeded of aiThresholds) {
    for (const locallySufficient of localThresholds) {
      thresholdGrid.push(scoreFormulation(observations, formulationId, { aiNeeded, locallySufficient }));
    }
  }
  thresholdGrid.sort(rankResults);
  formulationReports.push({
    id: formulationId,
    labels: TRIAGE_LABEL_FORMULATIONS[formulationId],
    best: thresholdGrid[0] || scoreFormulation([], formulationId, { aiNeeded: 0.75, locallySufficient: 0.80 }),
    thresholdGrid,
  });
}

const selected = formulationReports
  .map((report) => report.best)
  .sort(rankResults)[0] || {
  formulationId: "semantic-v2",
  thresholds: { aiNeeded: 0.75, locallySufficient: 0.80 },
  classification: { falseFilterRate: 0, aiRecall: 1, accuracy: 1 },
  providerRouting: { falseFilterRate: 0, reviewRecall: 1 },
  calls: { providerAvoidanceRate: 1 },
};

let batching = null;
if (benchmarkBatching && limit > 0) {
  batching = [];
  for (const batchSize of CLASSIFIER_BATCH_SIZES) {
    const startedAt = performance.now();
    const observations = await collectFormulation(selected.formulationId, batchSize);
    batching.push({
      batchSize,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      classifierRequests: observations.reduce((sum, item) => sum + item.outcome.metrics.classifierRequests, 0),
      classifierFailures: observations.reduce((sum, item) => sum + item.outcome.metrics.classifierFailures, 0),
      omittedClassifierResults: observations.reduce((sum, item) => sum + item.outcome.metrics.omittedClassifierResults, 0),
    });
  }
}

globalThis.fetch = nativeFetch;

const report = {
  mode: "live",
  classifierUrl,
  corpusSize: limit,
  fetchCalls,
  formulations: formulationReports,
  selected: {
    formulationId: selected.formulationId,
    thresholds: selected.thresholds,
    rationale: "Ranked by provider-routing false-filter rate and recall first, then exact semantic decision safety, provider-call avoidance, and overall accuracy.",
  },
  batching: {
    tested: Boolean(batching),
    recommendedDefault: 100,
    sizes: [...CLASSIFIER_BATCH_SIZES],
    results: batching,
  },
  observability: {
    classifierLatencyMs: {
      p50: Number(percentile(classifierLatencySamples, 0.5).toFixed(2)),
      p95: Number(percentile(classifierLatencySamples, 0.95).toFixed(2)),
    },
    classifierBytesSent,
    excerptSize: {
      averageChars: excerptSizes.length ? Number((excerptSizes.reduce((sum, value) => sum + value, 0) / excerptSizes.length).toFixed(2)) : 0,
      p95Chars: Number(percentile(excerptSizes, 0.95).toFixed(2)),
      maxChars: excerptSizes.length ? Math.max(...excerptSizes) : 0,
    },
    providerLatencyMs: null,
    providerTokensEstimate: null,
  },
};

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--strict") && (
  selected.providerRouting.reviewRecall < 0.75
  || selected.providerRouting.falseFilterRate > 0.25
)) {
  console.error("live triage strict gate failed");
  process.exit(1);
}
