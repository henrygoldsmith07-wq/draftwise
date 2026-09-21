import { readFile } from "node:fs/promises";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import {
  buildClassifierExcerpt,
  isChunkUnresolved,
  parseClassifierDecisions,
} from "../packages/ai/src/index.ts";

const corpus = JSON.parse(await readFile(new URL("../evaluation/triage-corpus.json", import.meta.url), "utf8"));

// Deterministic mock for classifier.dev without network: mirrors the contract
// (decision only, never rewrites) using the same excerpt minimisation.
// Borderline (short, single low-severity signal) -> uncertain; otherwise unresolved -> ai-needed.
function mockClassifierPayload(text, assessment, localIssueCount) {
  const excerpt = buildClassifierExcerpt(text, 500);
  if (!assessment.unresolved) {
    return { results: [{ chunkId: "chunk-0", decision: "locally-sufficient", categories: [], confidence: 0.9, reason: "mock: clean" }] };
  }
  const borderline =
    excerpt.length < 60 &&
    localIssueCount <= 1 &&
    !assessment.categories.includes("structure") &&
    !assessment.categories.includes("engagement");
  if (borderline) {
    return { results: [{ chunkId: "chunk-0", decision: "uncertain", categories: ["other"], confidence: 0.55, reason: "mock: borderline" }] };
  }
  return { results: [{ chunkId: "chunk-0", decision: "ai-needed", categories: assessment.categories.slice(0, 3), confidence: 0.82, reason: "mock: unresolved" }] };
}

const details = [];
let tp = 0;
let fp = 0;
let fn = 0;
let tn = 0;
let uncertainCorrect = 0;
let fallbackCount = 0;
let totalLatencyMs = 0;
let totalExcerptChars = 0;
let totalOriginalChars = 0;

for (const entry of corpus) {
  const startedAt = performance.now();
  const local = analyzeLocally(entry.text, { dialect: "en-GB" });
  const assessment = isChunkUnresolved(entry.text, local.issues);
  const mockPayload = mockClassifierPayload(entry.text, assessment, local.issues.length);
  const inputs = [{ chunkId: "chunk-0", excerpt: buildClassifierExcerpt(entry.text, 500), startOffset: 0, endOffset: entry.text.length, signals: { localIssueCount: local.issues.length, localCategories: [], hasLongSentence: false, hasVagueOrFiller: false, hasPassiveOrWordiness: false }, categories: assessment.categories }];
  const parsed = parseClassifierDecisions(mockPayload, inputs);
  const predicted = parsed[0]?.decision ?? "uncertain";
  const latencyMs = performance.now() - startedAt;
  totalLatencyMs += latencyMs;
  totalExcerptChars += inputs[0].excerpt.length;
  totalOriginalChars += entry.text.length;

  const expected = entry.expectedDecision;
  const needsAI = expected === "ai-needed";
  const predictedAI = predicted === "ai-needed";
  if (needsAI && predictedAI) tp += 1;
  else if (!needsAI && predictedAI) fp += 1;
  else if (needsAI && !predictedAI) fn += 1;
  else tn += 1;
  if (expected === "uncertain" && predicted === "uncertain") uncertainCorrect += 1;
  if (parsed[0]?.fallback) fallbackCount += 1;

  details.push({
    id: entry.id,
    expected,
    predicted,
    latencyMs: Number(latencyMs.toFixed(2)),
    excerptChars: inputs[0].excerpt.length,
    originalChars: entry.text.length,
    localIssues: local.issues.length,
    reasons: assessment.reasons,
    categories: assessment.categories,
    expectedCategories: entry.expectedCategories,
  });
}

const total = corpus.length;
const expectedAINeeded = corpus.filter((e) => e.expectedDecision === "ai-needed").length;
const predictedAINeeded = details.filter((d) => d.predicted === "ai-needed").length;
const recall = expectedAINeeded ? tp / expectedAINeeded : 1;
const falseFiltering = expectedAINeeded ? fn / expectedAINeeded : 0;
const precision = predictedAINeeded ? tp / predictedAINeeded : 1;
const modelCallsAvoided = total ? (total - predictedAINeeded) / total : 1;
const avgLatencyMs = total ? totalLatencyMs / total : 0;
const minimisationRatio = totalOriginalChars ? totalExcerptChars / totalOriginalChars : 1;

// Cloud calls per session: simulate editing sessions of 5 chunks, classifier batches 5 per request.
const SESSION_SIZE = 5;
const BATCH = 5;
let sessions = 0;
let classifierCallsTotal = 0;
let providerCallsTotal = 0;
for (let i = 0; i < details.length; i += SESSION_SIZE) {
  const session = details.slice(i, i + SESSION_SIZE);
  sessions += 1;
  // Candidates = unresolved (ai-needed + uncertain) that would reach classifier
  const candidates = session.filter((d) => d.predicted !== "locally-sufficient").length;
  // Heuristic-only would still need classifier for candidates; clean chunks avoid both calls.
  // Without triage, provider would be called once per chunk (session size).
  // With triage (skip policy), provider only for ai-needed.
  classifierCallsTotal += Math.ceil(candidates / BATCH);
  providerCallsTotal += session.filter((d) => d.predicted === "ai-needed").length;
}
const avgClassifierCallsPerSession = sessions ? classifierCallsTotal / sessions : 0;
const avgProviderCallsPerSession = sessions ? providerCallsTotal / sessions : 0;
const avgCloudCallsPerSession = avgClassifierCallsPerSession + avgProviderCallsPerSession;
const withoutTriagePerSession = SESSION_SIZE;
const avoidedPerSession = withoutTriagePerSession - avgProviderCallsPerSession;

const summary = {
  corpusSize: total,
  expectedAINeeded,
  predictedAINeeded,
  truePositives: tp,
  falsePositives: fp,
  falseNegatives: fn,
  trueNegatives: tn,
  uncertainCorrect,
  recall: Number(recall.toFixed(3)),
  precision: Number(precision.toFixed(3)),
  falseFiltering: Number(falseFiltering.toFixed(3)),
  modelCallsAvoided: Number(modelCallsAvoided.toFixed(3)),
  avgLatencyMs: Number(avgLatencyMs.toFixed(2)),
  minimisationRatio: Number(minimisationRatio.toFixed(3)),
  sessions,
  classifierCallsTotal,
  providerCallsTotal,
  avgClassifierCallsPerSession: Number(avgClassifierCallsPerSession.toFixed(2)),
  avgProviderCallsPerSession: Number(avgProviderCallsPerSession.toFixed(2)),
  avgCloudCallsPerSession: Number(avgCloudCallsPerSession.toFixed(2)),
  avoidedProviderCallsPerSession: Number(avoidedPerSession.toFixed(2)),
  fallbackCount,
};

console.log(JSON.stringify({ ...summary, examples: details }, null, 2));

if (process.argv.includes("--strict") && (recall < 0.75 || falseFiltering > 0.25 || modelCallsAvoided < 0.25)) {
  console.error(`triage strict gate failed: recall=${recall.toFixed(3)} falseFiltering=${falseFiltering.toFixed(3)} avoided=${modelCallsAvoided.toFixed(3)}`);
  process.exit(1);
}
