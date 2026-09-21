import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  analyzeWithTriage,
  buildClassifierExcerpt,
  createTriageScheduler,
  filterChunksForProvider,
  isChunkUnresolved,
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
  baseUrl: "https://classifier.dev/v1",
  model: "draftwise-triage-v1",
  apiKey: "clf-key",
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
  assert.ok(redactExcerptForClassifier("Budget £1,250.50 is 20%").includes("[number]") || redactExcerptForClassifier("Budget £1,250.50 is 20%").includes("[percent]"));
});

test("classifier responses never rewrite: replacement fields are discarded", () => {
  const inputs = [{ chunkId: "chunk-0", excerpt: "hello", startOffset: 0, endOffset: 5, signals: { localIssueCount: 0, localCategories: [], hasLongSentence: false, hasVagueOrFiller: false, hasPassiveOrWordiness: false }, categories: ["clarity"] }];
  const decisions = parseClassifierDecisions({
    results: [{
      chunkId: "chunk-0",
      decision: "ai-needed",
      categories: ["clarity"],
      confidence: 0.9,
      reason: "needs depth",
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

test("other/fallback handling: unknown decisions and categories map to uncertain/other", () => {
  const inputs = [{ chunkId: "chunk-0", excerpt: "hello world test", startOffset: 0, endOffset: 16, signals: { localIssueCount: 0, localCategories: [], hasLongSentence: false, hasVagueOrFiller: false, hasPassiveOrWordiness: false }, categories: ["clarity"] }];
  const unknown = parseClassifierDecisions({ results: [{ chunkId: "chunk-0", decision: "mystery", categories: ["nonsense"], confidence: 2 }] }, inputs);
  assert.equal(unknown[0].decision, "uncertain");
  assert.deepEqual(unknown[0].categories, ["other"]);
  assert.equal(unknown[0].fallback, true);
  const missing = parseClassifierDecisions({ results: [] }, inputs);
  assert.equal(missing.length, 0);
});

test("classifier URL validation requires HTTPS except localhost", () => {
  assert.equal(validateClassifierUrl("https://classifier.dev/v1").protocol, "https:");
  assert.equal(validateClassifierUrl("http://localhost:4000/v1").hostname, "localhost");
  assert.throws(() => validateClassifierUrl("http://classifier.dev/v1"), (e) => e instanceof ClassifierError && e.code === "insecure-url");
  assert.throws(() => validateClassifierUrl("https://user:pass@classifier.dev/v1"), (e) => e instanceof ClassifierError && e.code === "invalid-url");
});

test("triage preserves incremental ranges: decisions pair by chunkId and map to absolute offsets", async () => {
  const text = `${"The writer reviews the draft and shares clear feedback. ".repeat(20)}This thing is really useful for various aspects of the work and stuff. ${"The team shares the next steps with the client. ".repeat(20)}`;
  const local = analyzeLocally(text, { dialect: "en-GB" });
  const chunks = createAnalysisChunks(text, { maxChars: 500, contextWindow: 16 });
  assert.ok(chunks.length >= 2);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ results: chunks.map((c) => ({ chunkId: c.id, decision: "locally-sufficient", categories: [], confidence: 0.9, reason: "mock" })) }), { status: 200 });
  try {
    const outcome = await triageChunks(chunks, local.issues, { classifier });
    assert.equal(outcome.decisions.length, chunks.length);
    const filtered = filterChunksForProvider(chunks, outcome.decisions, "skip");
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
    if (target.includes("classifier.dev")) return new Response(JSON.stringify({ results: [{ chunkId: "chunk-0-53", decision: "locally-sufficient", categories: [], confidence: 0.9 }] }), { status: 200 });
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
      const chunkId = body.inputs[0].chunkId;
      return new Response(JSON.stringify({ results: [{ chunkId, decision: "ai-needed", categories: ["clarity"], confidence: 0.85, reason: "mock" }] }), { status: 200 });
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

test("classifier failure falls back to local without expensive AI (skip policy)", async () => {
  const text = "This thing is really useful for various aspects that might need review.";
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("classifier.dev")) return new Response("bad", { status: 500 });
    providerCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [], tone: [], scores: {} }) } }] }), { status: 200 });
  };
  try {
    const result = await analyzeWithTriage(text, goals, provider, { classifier, uncertainPolicy: "skip" });
    assert.equal(providerCalls, 0);
    assert.equal(result.source, "local");
    assert.ok(result.triage.metrics.fallbackCount >= 1);
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

test("scheduler batches, debounces and caches classifier decisions", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ results: body.inputs.map((i) => ({ chunkId: i.chunkId, decision: "locally-sufficient", categories: [], confidence: 0.9 })) }), { status: 200 });
  };
  try {
    const scheduler = createTriageScheduler({ classifier, debounceMs: 30, maxBatchChunks: 5 });
    const inputs = [0, 1, 2].map((n) => ({
      chunkId: `chunk-${n}`,
      excerpt: `excerpt ${n} with enough text to be unique and stable for caching tests`,
      startOffset: n * 10,
      endOffset: n * 10 + 10,
      signals: { localIssueCount: 0, localCategories: [], hasLongSentence: false, hasVagueOrFiller: false, hasPassiveOrWordiness: false },
      categories: ["other"],
    }));
    const first = await scheduler.schedule(inputs);
    assert.equal(first.length, 3);
    assert.equal(fetchCalls, 1);
    // Second identical schedule hits cache without network
    const second = await scheduler.schedule(inputs);
    assert.equal(second.length, 3);
    assert.equal(fetchCalls, 1);
    scheduler.cancel();
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
