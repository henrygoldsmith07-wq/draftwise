import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAnalysisChunks,
  createAnalysisCacheKey,
  createAnalysisSettingsFingerprint,
  detectChangedRange,
  getIncrementalAnalysisRanges,
  mapChunkIssue,
  mergeAnalysisIssues,
  retainUnaffectedIssues,
} from "../packages/analysis/src/index.ts";
import { analyzeLocally, analyzeLocallyIncremental } from "../packages/grammar/src/index.ts";
import { buildSuggestionState } from "../lib/suggestions.ts";
import { DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

const style = DEFAULT_STYLE_PREFERENCES;
const goals = { audience: "academic", intent: "persuade", tone: "formal" };

test("analysis cache fingerprints are deterministic and exclude raw credential text", () => {
  const first = createAnalysisSettingsFingerprint({
    provider: { baseUrl: "https://provider.example/v1", model: "model-a", temperature: 0.2, maxTokens: 900 },
    classifier: { baseUrl: "https://classifier.dev", timeoutMs: 8000, maxExcerptChars: 500 },
    triagePolicy: "provider",
  });
  const reordered = createAnalysisSettingsFingerprint({
    triagePolicy: "provider",
    classifier: { maxExcerptChars: 500, timeoutMs: 8000, baseUrl: "https://classifier.dev" },
    provider: { maxTokens: 900, temperature: 0.2, model: "model-a", baseUrl: "https://provider.example/v1" },
  });
  const changed = createAnalysisSettingsFingerprint({
    provider: { baseUrl: "https://provider.example/v1", model: "model-a", temperature: 0.7, maxTokens: 900 },
  });
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
  const cacheKey = createAnalysisCacheKey("draft text", first, null);
  assert.ok(cacheKey.includes(first));
  assert.ok(!cacheKey.includes("sk-secret"));
});

test("analysis cache keys stay bounded and do not retain raw draft text", () => {
  const text = "private draft sentence ".repeat(2_000);
  const first = createAnalysisCacheKey(text, "settings-test", null);
  const second = createAnalysisCacheKey(text, "settings-test", null);
  const changed = createAnalysisCacheKey(`${text.slice(0, -1)}!`, "settings-test", null);
  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.ok(first.length < 120, `cache key unexpectedly grew to ${first.length} characters`);
  assert.equal(first.includes("private draft sentence"), false);
});

test("analysis settings invalidate for provider, classifier, policy, goals, and style changes", () => {
  const base = {
    engineVersion: "analysis-engine-v3",
    provider: { baseUrl: "https://provider.example/v1", model: "model-a", temperature: 0.2, maxTokens: 900 },
    classifier: { baseUrl: "https://classifier.dev", timeoutMs: 8000, maxExcerptChars: 500 },
    triagePolicy: "provider",
    goals: { audience: "general", intent: "inform", tone: "professional" },
    style: { dialect: "en-GB", passiveVoiceSensitivity: "normal" },
  };
  const fingerprint = (patch) => createAnalysisSettingsFingerprint({ ...base, ...patch });
  assert.notEqual(fingerprint({ provider: { ...base.provider, model: "model-b" } }), fingerprint({}));
  assert.notEqual(fingerprint({ provider: { ...base.provider, baseUrl: "https://other.example/v1" } }), fingerprint({}));
  assert.notEqual(fingerprint({ classifier: { ...base.classifier, baseUrl: "https://other-classifier.example" } }), fingerprint({}));
  assert.notEqual(fingerprint({ triagePolicy: "local" }), fingerprint({}));
  assert.notEqual(fingerprint({ goals: { ...base.goals, tone: "friendly" } }), fingerprint({}));
  assert.notEqual(fingerprint({ style: { ...base.style, dialect: "en-US" } }), fingerprint({}));
  assert.equal(
    fingerprint({ provider: { ...base.provider, apiKey: "first-secret" } }),
    fingerprint({ provider: { ...base.provider, apiKey: "second-secret" } }),
  );
});

test("changed ranges stay bounded and preserve the previous end offset", () => {
  const changed = detectChangedRange("before stable tail", "before changed stable tail");
  assert.deepEqual(changed, { start: 7, end: 15, previousEnd: 7 });
});

test("long documents are chunked without dropping the edited region", () => {
  const text = `${"word ".repeat(2_000)}edited ${"tail ".repeat(2_000)}`;
  const changed = detectChangedRange(text, text.replace("edited", "corrected"));
  assert.ok(changed);
  const chunks = createAnalysisChunks(text, { maxChars: 700, contextWindow: 48, startOffset: changed.start - 48, endOffset: changed.end + 48 });
  assert.ok(chunks.length >= 1);
  assert.ok(chunks.some((chunk) => chunk.contentStartOffset <= changed.start && chunk.contentEndOffset >= changed.end));
  assert.equal(chunks.at(-1)?.endOffset, changed.end + 48);
});

test("provider issue offsets map back to the original long document", () => {
  const text = `${"prefix ".repeat(200)}repeatd ${"suffix ".repeat(200)}`;
  const target = text.indexOf("repeatd");
  const chunk = createAnalysisChunks(text, { maxChars: 500, contextWindow: 32 }).find((item) => item.startOffset <= target && item.endOffset >= target + 7);
  assert.ok(chunk);
  const issue = {
    id: "ai-local",
    ruleId: "spelling-common-typo",
    start: target - chunk.startOffset,
    end: target - chunk.startOffset + 7,
    original: "repeatd",
    replacement: "repeated",
    category: "spelling",
    severity: "high",
    confidence: 0.99,
    title: "Spelling",
    explanation: "Use the standard spelling.",
    source: "ai",
  };
  const mapped = mapChunkIssue(issue, chunk, text);
  assert.equal(mapped?.start, target);
  assert.equal(mapped?.end, target + 7);
  assert.equal(text.slice(mapped.start, mapped.end), "repeatd");
});

test("overlapping issues keep the higher-confidence candidate", () => {
  const base = {
    ruleId: "test",
    chunkId: "chunk-1",
    start: 10,
    end: 15,
    original: "words",
    replacement: "word",
    category: "conciseness",
    severity: "low",
    title: "Tighten",
    explanation: "Use fewer words.",
    source: "ai",
  };
  const merged = mergeAnalysisIssues([
    { ...base, id: "low", confidence: 0.4 },
    { ...base, id: "high", confidence: 0.95, severity: "medium", replacement: "wording" },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "high");
});

test("issue merging compares the overlapping interval set and preserves disjoint issues", () => {
  const issue = (id, start, end, severity, confidence) => ({
    id,
    ruleId: "test",
    start,
    end,
    original: "x".repeat(end - start),
    replacement: "y",
    category: "clarity",
    severity,
    confidence,
    title: id,
    explanation: "",
    source: "ai",
  });
  const merged = mergeAnalysisIssues([
    issue("disjoint-high", 0, 3, "high", 0.99),
    issue("overlapped-low", 10, 20, "low", 0.4),
    issue("replacement", 12, 18, "medium", 0.9),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["disjoint-high", "replacement"]);
});

test("incremental issue retention shifts unaffected ranges and discards the edited context", () => {
  const previous = "Before stays. repeatd here. After stays.";
  const next = "Before stays. repeated here. After stays.";
  const changed = detectChangedRange(previous, next);
  const ranges = getIncrementalAnalysisRanges(previous, next, changed, 4);
  const retained = retainUnaffectedIssues([
    { id: "before", ruleId: "test", start: 0, end: 6, original: "Before", replacement: "Before", category: "style", severity: "low", confidence: 0.9, title: "Before", explanation: "", source: "local" },
    { id: "edited", ruleId: "test", start: previous.indexOf("repeatd"), end: previous.indexOf("repeatd") + 7, original: "repeatd", replacement: "repeated", category: "spelling", severity: "high", confidence: 0.9, title: "Edited", explanation: "", source: "local" },
    { id: "after", ruleId: "test", start: previous.indexOf("After"), end: previous.indexOf("After") + 5, original: "After", replacement: "After", category: "style", severity: "low", confidence: 0.9, title: "After", explanation: "", source: "local" },
  ], ranges, next);
  assert.deepEqual(retained.map((issue) => issue.id), ["before", "after"]);
  assert.equal(next.slice(retained[1].start, retained[1].end), "After");
});

test("incremental local analysis never retains merged AI issues", () => {
  const previous = "The draft is repeatd here. The stable tail remains.";
  const next = "The draft is repeated here. The stable tail remains.";
  const changed = detectChangedRange(previous, next);
  const result = analyzeLocallyIncremental(previous, next, [
    { id: "ai-stale", ruleId: "ai-clarity", start: previous.indexOf("stable"), end: previous.indexOf("stable") + 6, original: "stable", replacement: "clear", category: "clarity", severity: "low", confidence: 0.9, title: "AI suggestion", explanation: "", source: "ai" },
    { id: "local-typo", ruleId: "spelling-common-typo", start: previous.indexOf("repeatd"), end: previous.indexOf("repeatd") + 7, original: "repeatd", replacement: "repeated", category: "spelling", severity: "high", confidence: 0.99, title: "Spelling", explanation: "", source: "local" },
  ], changed, { dialect: "en-GB" });
  assert.equal(result.issues.some((issue) => issue.id === "ai-stale"), false);
  assert.equal(result.issues.some((issue) => issue.source === "local"), true);
});

test("issue merging stays deterministic for thousands of candidates", () => {
  const issues = Array.from({ length: 2_000 }, (_, index) => ({
    id: `issue-${index}`,
    ruleId: "stress",
    start: index * 4,
    end: index * 4 + 2,
    original: "aa",
    replacement: "bb",
    category: "clarity",
    severity: index % 11 === 0 ? "high" : "low",
    confidence: index % 11 === 0 ? 0.95 : 0.4,
    title: "Stress",
    explanation: "",
    source: "ai",
  }));
  const start = performance.now();
  const merged = mergeAnalysisIssues(issues);
  const elapsed = performance.now() - start;
  assert.equal(merged.length, issues.length);
  assert.ok(elapsed < 1_500, `merge took ${elapsed.toFixed(1)}ms`);
});


test("web analysis cache is cleared when private credential material changes", async () => {
  const hook = await readFile(new URL("../hooks/useAnalysis.ts", import.meta.url), "utf8");
  assert.match(hook, /cache\.current\.clear\(\);\s*\}, \[classifier\?\.apiKey, settings\.apiKey, settings\.customHeaders\]\);/u);
  assert.doesNotMatch(hook, /settingsFingerprint[\s\S]{0,500}apiKey:\s*settings\.apiKey/u);
});

test("analyzeLocally and analyzeLocallyIncremental hand back the parsed document", () => {
  const previous = "The draft is repeated here. The stable tail remains.";
  const next = "The draft is repeated here now. The stable tail remains.";
  const local = analyzeLocally(next, {}, goals);
  assert.ok(local.document, "analyzeLocally returns a document");
  assert.equal(local.document.text, next);
  assert.ok(local.document.tokens.length > 0);

  const changed = detectChangedRange(previous, next);
  const incremental = analyzeLocallyIncremental(previous, next, [], changed, {}, goals);
  assert.ok(incremental.document, "incremental path returns a document");
  assert.equal(incremental.document.text, next);

  // A wholesale change falls back to the full-analysis path; that document is
  // returned too.
  const wholesale = analyzeLocallyIncremental("a".repeat(80), "b".repeat(80), [], detectChangedRange("a".repeat(80), "b".repeat(80)));
  assert.ok(wholesale.document);
  assert.equal(wholesale.document.text, "b".repeat(80));
});

test("buildSuggestionState passes the analysed document through to prioritisation", () => {
  const text = "The report was wrote by the team. It are not accurate.";
  const analysis = analyzeLocally(text, {}, goals);
  const base = { issues: analysis.issues, goals, style, dismissedKeys: [] };

  // Wrap the returned document in a proxy. prioritiseSuggestions reads
  // document.tokens.length on every call, so the `get` trap fires only when the
  // exact object we supplied reaches it — proving reuse rather than a re-parse.
  let touched = false;
  const spied = new Proxy(analysis.document, {
    get(target, prop, receiver) {
      touched = true;
      return Reflect.get(target, prop, receiver);
    },
  });
  const viaDocument = buildSuggestionState({ ...base, text, document: spied });
  assert.equal(touched, true, "prioritisation used the provided document object");

  // Supplying the document is functionally identical to letting prioritise
  // parse the text itself.
  const viaText = buildSuggestionState({ ...base, text });
  assert.deepEqual(
    viaDocument.displayed.map((issue) => issue.id),
    viaText.displayed.map((issue) => issue.id),
  );

  // Callers that omit the document still work.
  assert.ok(Array.isArray(viaText.displayed));
});

test("incremental analysis agrees with a full analysis of the same text", () => {
  // A ~640-char slice cannot judge document-wide rules (repeated sentence
  // openings hundreds of chars apart, paragraph length, consistency). Deriving
  // them from the slice used to add/remove findings for identical text, so the
  // writer saw different scores depending on whether they had just typed.
  const paras = [
    "The committee reviewed the evidence carefully. Several members suggested alternative approaches to the problem. The final decision was deferred. Everyone agreed that more data would help.",
    "Writing is a craft that improves with deliberate practice. Draftwise keeps the writer in control of every suggestion. Local checks run without a network connection.",
    "Climate policy requires balancing competing priorities. Economists emphasise efficiency while advocates stress fairness. A workable compromise must respect both.",
  ];
  const text = paras.join("\n\n").repeat(4);
  const next = text.replace("more data would help", "more detailed data would help");
  const full = analyzeLocally(next, {}, goals);
  const previous = analyzeLocally(text, {}, goals);
  const incremental = analyzeLocallyIncremental(
    text, next, previous.issues, detectChangedRange(text, next), {}, goals,
  );
  const key = (result) => result.issues
    .map((issue) => `${issue.ruleId}@${issue.start}:${issue.original}`)
    .sort()
    .join("|");
  assert.equal(key(incremental), key(full), "same text must produce the same findings");
  assert.equal(incremental.scores.conciseness, full.scores.conciseness);
});
