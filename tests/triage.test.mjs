import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analyzeWithTriage,
  buildClassifierExcerpt,
  CLASSIFIER_TRIAGE_LABELS,
  filterChunksForProvider,
  isChunkUnresolved,
  mapClassifierLabel,
  parseClassifierDecisions,
  redactExcerptForClassifier,
  triageChunks,
  validateClassifierUrl,
  ClassifierError,
} from "../packages/ai/src/index.ts";
import { createAnalysisChunks } from "../packages/analysis/src/index.ts";
import { analyzeLocally } from "../packages/grammar/src/index.ts";

const goals = { audience: "general", intent: "inform", tone: "neutral" };
const provider = {
  provider: "openai-compatible",
  baseUrl: "https://example.com/v1",
  model: "test-model",
  apiKey: "test-key",
  temperature: 0.2,
  maxTokens: 900,
  customHeaders: "",
};
const classifier = {
  baseUrl: "https://classifier.dev",
  apiKey: "",
  timeoutMs: 5000,
  maxExcerptChars: 500,
};

test("local rules run first: clean text stays locally-sufficient without network", async () => {
  const text = "The writer reviews the draft and gives clear feedback.";
  const local = analyzeLocally(text, { dialect: "en-GB" });
  const assessment = isChunkUnresolved(text, local.issues);
  assert.equal(assessment.unresolved, false);
  // Heuristic-only triage must not call fetch
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called += 1; throw new Error("must not call"); };
  try {
    const chunks = createAnalysisChunks(text);
    const outcome = await triageChunks(chunks, local.issues, { classifier: null });
    assert.ok(outcome.decisions.every((d) => d.decision === "locally-sufficient"));
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("high-confidence typos stay local; ambiguous text becomes a triage candidate", () => {
  const typoLocal = analyzeLocally("This is teh final draft.", { dialect: "en-GB" });
  assert.equal(isChunkUnresolved("This is teh final draft.", typoLocal.issues).unresolved, false);
  const vagueLocal = analyzeLocally("This thing is really useful for various aspects of the work and stuff.", { dialect: "en-GB" });
  const vague = isChunkUnresolved("This thing is really useful for various aspects of the work and stuff.", vagueLocal.issues);
  assert.equal(vague.unresolved, true);
  assert.ok(vague.categories.includes("clarity") || vague.categories.includes("conciseness"));
});

test("classifier excerpts minimise transmitted text and redact structured tokens", () => {
  const long = `Contact support@example.com or visit https://example.com/help for ticket ABC-123. ${"word ".repeat(300)}`;
  const excerpt = buildClassifierExcerpt(long, 500);
  assert.ok(excerpt.length <= 500);
  assert.ok(!excerpt.includes("support@example.com"));
  assert.ok(!excerpt.includes("https://example.com/help"));
  assert.ok(excerpt.includes("[email]") || excerpt.includes("[url]"));
  const redacted = redactExcerptForClassifier("Budget £1,250.50 is 20% on 2026-09-21; use API_KEY=secret-value, model GPT-4o-mini, version v2, file draft.docx, id ABC-123, UUID 123e4567-e89b-12d3-a456-426614174000, phone +44 20 7946 0958, token \"sk-test-123456789\".");
  assert.match(redacted, /\[currency\]/u);
  assert.match(redacted, /\[percentage\]/u);
  assert.match(redacted, /\[date\]/u);
  assert.match(redacted, /\[secret\]/u);
  assert.match(redacted, /\[model\]/u);
  assert.match(redacted, /\[version\]/u);
  assert.match(redacted, /\[filename\]/u);
  assert.match(redacted, /\[identifier\]|\[uuid\]/u);
  assert.match(redacted, /\[phone\]/u);
  assert.match(redacted, /\[quoted-secret\]/u);
});

test("classifier responses never rewrite: replacement fields are discarded", () => {
  const inputs = [{ chunkId: "chunk-0", excerpt: "hello", startOffset: 0, endOffset: 5, signals: { localIssueCount: 0, localCategories: [], hasLongSentence: false, hasVagueOrFiller: false, hasPassiveOrWordiness: false }, categories: ["clarity"] }];
  const decisions = parseClassifierDecisions({
    results: [{
      label: CLASSIFIER_TRIAGE_LABELS[1],
      confidence: 0.9,
      scores: { [CLASSIFIER_TRIAGE_LABELS[1]]: 0.9 },
      replacement: "HACKED",
      rewrite: "HACKED",
      correctedText: "HACKED",
    }],
  }, inputs);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, "ai-needed");
  assert.ok(!("replacement" in decisions[0]));
  assert.ok(!("rewrite" in decisions[0]));
});

test("ordered classifier results map by input position and unknown labels stay uncertain", () => {
  const inputs = [{ chunkId: "chunk-0", excerpt: "hello world test", startOffset: 0, endOffset: 16, signals: { localIssueCount: 0, localCategories: [], hasLongSentence: false, hasVagueOrFiller: false, hasPassiveOrWordiness: false }, categories: ["clarity"] }];
  const unknown = parseClassifierDecisions({ results: [{ label: "mystery", scores: {}, confidence: 2 }] }, inputs);
  assert.equal(unknown[0].decision, "uncertain");
  assert.deepEqual(unknown[0].categories, ["clarity"]);
  assert.equal(unknown[0].fallback, true);
  const missing = parseClassifierDecisions({ results: [] }, inputs);
  assert.equal(missing.length, 0);
});

test("candidate selection respects writing goals for impersonal prose", () => {
  const text = "The study evaluates the reported method across three sites and compares the measured outcome with the documented baseline for the final analysis and subsequent comparison of the published findings.";
  const local = analyzeLocally(text, { dialect: "en-GB" });
  assert.equal(isChunkUnresolved(text, local.issues, { audience: "academic", intent: "inform", tone: "formal" }).unresolved, false);
  assert.equal(isChunkUnresolved(text, local.issues, { audience: "general", intent: "persuade", tone: "confident" }).unresolved, true);
});

test("two-label classifier outcomes derive uncertainty from confidence", () => {
  assert.equal(mapClassifierLabel(CLASSIFIER_TRIAGE_LABELS[1], 0.75), "ai-needed");
  assert.equal(mapClassifierLabel(CLASSIFIER_TRIAGE_LABELS[0], 0.80), "locally-sufficient");
  assert.equal(mapClassifierLabel(CLASSIFIER_TRIAGE_LABELS[1], 0.74), "uncertain");
  assert.equal(mapClassifierLabel(CLASSIFIER_TRIAGE_LABELS[0], 0.79), "uncertain");
  const input = [{ chunkId: "chunk-confidence", excerpt: "long enough input", startOffset: 0, endOffset: 18, signals: { localIssueCount: 0, localCategories: [], hasLongSentence: false, hasVagueOrFiller: false, hasPassiveOrWordiness: false }, categories: ["clarity"] }];
  const malformed = parseClassifierDecisions({ results: [{ label: CLASSIFIER_TRIAGE_LABELS[1], confidence: "high" }] }, input);
  assert.equal(malformed[0], null);
});

test("malformed ordered results leave an explicit hole instead of shifting chunk identity", () => {
  const inputs = [0, 1, 2].map((index) => ({
    chunkId: "chunk-" + index,
    excerpt: "hello world test " + index,
    startOffset: index * 20,
    endOffset: index * 20 + 18,
    signals: { localIssueCount: 0, localCategories: [], hasLongSentence: false, hasVagueOrFiller: false, hasPassiveOrWordiness: false },
    categories: ["clarity"],
  }));
  const decisions = parseClassifierDecisions({
    results: [
      { label: CLASSIFIER_TRIAGE_LABELS[0], confidence: 0.9 },
      { label: null, confidence: 0.9 },
      { label: CLASSIFIER_TRIAGE_LABELS[1], confidence: 0.9 },
    ],
  }, inputs);
  assert.equal(decisions.length, 3);
  assert.equal(decisions[0]?.chunkId, "chunk-0");
  assert.equal(decisions[1], null);
  assert.equal(decisions[2]?.chunkId, "chunk-2");
});

test("classifier URL validation requires HTTPS except localhost", () => {
  assert.equal(validateClassifierUrl("https://classifier.dev/v1").protocol, "https:");
  assert.equal(validateClassifierUrl("http://localhost:4000/v1").hostname, "localhost");
  assert.throws(() => validateClassifierUrl("http://classifier.dev/v1"), (e) => e instanceof ClassifierError && e.code === "insecure-url");
  assert.throws(() => validateClassifierUrl("https://user:pass@classifier.dev/v1"), (e) => e instanceof ClassifierError && e.code === "invalid-url");
});

test("classifier.dev request uses the official keyless ordered payload", async () => {
  const text = "This thing is really useful for various aspects of the work and stuff.";
  const local = analyzeLocally(text, { dialect: "en-GB" });
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ results: request.body.inputs.map(() => ({ label: CLASSIFIER_TRIAGE_LABELS[0], confidence: 0.55, scores: {} })) }), { status: 200 });
  };
  try {
    const outcome = await triageChunks(createAnalysisChunks(text), local.issues, { classifier: { baseUrl: "https://classifier.dev" } });
    assert.equal(request.url, "https://classifier.dev/v1/classify");
    assert.deepEqual(Object.keys(request.body).sort(), ["inputs", "instructions", "labels"]);
    assert.ok(request.body.inputs.every((input) => typeof input === "string"));
    assert.deepEqual(request.body.labels, CLASSIFIER_TRIAGE_LABELS);
    assert.equal(request.headers.Authorization, undefined);
    assert.equal(outcome.metrics.classifierRequests, 1);
    assert.equal(outcome.decisions.some((decision) => decision.decision === "uncertain"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uncertain policy can keep low-confidence classifier results local", async () => {
  const text = "This thing is really useful for various aspects of the work and stuff.";
  const local = analyzeLocally(text, { dialect: "en-GB" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      results: body.inputs.map(() => ({ label: CLASSIFIER_TRIAGE_LABELS[0], confidence: 0.55 })),
    }), { status: 200 });
  };
  try {
    const outcome = await triageChunks(createAnalysisChunks(text), local.issues, {
      classifier,
      uncertainPolicy: "local",
    });
    assert.ok(outcome.decisions.some((decision) => decision.decision === "uncertain"));
    assert.equal(outcome.metrics.providerChunks, 0);
    assert.equal(filterChunksForProvider(createAnalysisChunks(text), outcome.decisions, "local").length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("triage preserves incremental ranges: decisions pair by chunkId and map to absolute offsets", async () => {
  const text = `${"The writer reviews the draft and shares clear feedback. ".repeat(20)}This thing is really useful for various aspects of the work and stuff. ${"The team shares the next steps with the client. ".repeat(20)}`;
  const local = analyzeLocally(text, { dialect: "en-GB" });
  const chunks = createAnalysisChunks(text, { maxChars: 500, contextWindow: 16 });
  assert.ok(chunks.length >= 2);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ results: body.inputs.map(() => ({ label: CLASSIFIER_TRIAGE_LABELS[0], confidence: 0.9, scores: {} })) }), { status: 200 });
  };
  try {
    const outcome = await triageChunks(chunks, local.issues, { classifier });
    assert.equal(outcome.decisions.length, chunks.length);
    const filtered = filterChunksForProvider(chunks, outcome.decisions, "local");
    assert.equal(filtered.length, 0);
    // chunk ids preserved
    for (const d of outcome.decisions) assert.ok(chunks.some((c) => c.id === d.chunkId));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expensive AI only runs for ai-needed chunks (calls avoided)", async () => {
  const text = "The writer reviews the draft and gives clear feedback.";
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("classifier.dev")) return new Response(JSON.stringify({ results: [{ label: CLASSIFIER_TRIAGE_LABELS[0], confidence: 0.9, scores: {} }] }), { status: 200 });
    providerCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [], tone: [], scores: {} }) } }] }), { status: 200 });
  };
  try {
    const result = await analyzeWithTriage(text, goals, provider, { classifier, preferences: { dialect: "en-GB" } });
    assert.equal(result.analysedText, text);
    // Clean text: no classifier needed (heuristic filters first), no provider call
    assert.equal(providerCalls, 0);
    assert.ok(result.source === "local");
    assert.ok(result.triage);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ai-needed chunks reach the provider with absolute offsets intact", async () => {
  const text = "This thing is really useful for various aspects of the work and stuff that needs deeper review.";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("classifier.dev")) {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ results: body.inputs.map(() => ({ label: CLASSIFIER_TRIAGE_LABELS[1], confidence: 0.85, scores: {} })) }), { status: 200 });
    }
    calls.push(JSON.parse(init.body));
    // Echo a valid AI issue inside the chunk text
    const prompt = JSON.parse(init.body).messages[1].content;
    const chunkText = prompt.split("\n").slice(-1)[0] || text;
    // Find a word present in the chunk to return as a valid issue
    const word = "really";
    const start = chunkText.indexOf(word);
    const issues = start >= 0 ? [{ start, end: start + word.length, original: word, replacement: "", category: "conciseness", severity: "low", confidence: 0.8, title: "Filler", explanation: "Remove filler." }] : [];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues, tone: ["direct"], scores: {} }) } }] }), { status: 200 });
  };
  try {
    const result = await analyzeWithTriage(text, goals, provider, { classifier });
    assert.ok(calls.length >= 1);
    assert.ok(result.analysedText === text);
    // Preview-first: analysedText unchanged, issues carry ranges for user to accept
    for (const issue of result.issues) assert.equal(text.slice(issue.start, issue.end), issue.original);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("classifier failure is explicit and proceeds to the provider by default", async () => {
  const text = "This thing is really useful for various aspects that might need review.";
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("classifier.dev")) return new Response("bad", { status: 500 });
    providerCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [], tone: [], scores: {} }) } }] }), { status: 200 });
  };
  try {
    const result = await analyzeWithTriage(text, goals, provider, { classifier });
    assert.ok(providerCalls >= 1);
    assert.equal(result.source, "local+ai");
    assert.equal(result.triage.metrics.classifierFailures, 1);
    assert.ok(result.triage.metrics.aiNeededChunks >= 1);
    assert.ok(result.triage.metrics.providerChunks >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cancellation aborts triage and provider work", async () => {
  const text = "This thing is really useful for various aspects of the work and stuff that is long enough to need triage and provider calls.";
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  try {
    const pending = analyzeWithTriage(text, goals, provider, { classifier, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("content script keeps credentials out of page context", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  // No API keys, bearer tokens, or storage reads for secrets in page context.
  // (The `DraftwiseFieldClassifier` variable is field heuristics, not credentials.)
  assert.ok(!/apiKey/iu.test(content));
  assert.ok(!/Authorization/iu.test(content));
  assert.ok(!/Bearer\s/iu.test(content));
  assert.ok(!/chrome\.storage\.local\.get.*apiKey/iu.test(content));
  assert.ok(/requestAi|650/iu.test(content));
});

test("background keeps provider and classifier keys in the service worker", async () => {
  const background = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  assert.match(background, /chrome\.storage\.local\.get/);
  assert.match(background, /analyzeWithTriage/);
  assert.match(background, /classifier/iu);
  assert.match(background, /providerPattern/);
});
