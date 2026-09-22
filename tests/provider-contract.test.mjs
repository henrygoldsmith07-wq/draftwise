import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeWithProvider,
  fetchWithRetry,
  mapWithConcurrency,
  PROVIDER_CONCURRENCY,
  parseAnalysisIssues,
  parseCustomHeaders,
  ProviderError,
  rewriteWithProvider,
  validateProviderUrl,
} from "../packages/ai/src/index.ts";
import { createAnalysisChunks } from "../packages/analysis/src/index.ts";
import { isAiCoverageConsistent } from "../packages/types/src/index.ts";

const settings = {
  provider: "openai-compatible",
  baseUrl: "https://example.com/v1",
  model: "test-model",
  apiKey: "test-key",
  temperature: 0.2,
  maxTokens: 900,
  customHeaders: "",
};

const goals = { audience: "general", intent: "inform", tone: "neutral" };

async function runChunkFailureCase(mode) {
  const originalFetch = globalThis.fetch;
  const text = Array.from({ length: 6 }, (_, index) => `Section ${index}. ${"context ".repeat(72)} repeatd${index}.`).join("\n\n");
  const expectedChunks = createAnalysisChunks(text, { maxChars: 500, contextWindow: 0 });
  assert.ok(expectedChunks.length >= 3);
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(init.body);
    const prompt = payload.messages[1].content;
    const chunkId = prompt.match(/Text for (chunk-[^:]+):/u)?.[1];
    const chunkIndex = expectedChunks.findIndex((chunk) => chunk.id === chunkId);
    const chunkText = prompt.split(/Text for chunk-[^:]+:\n/u)[1] || "";
    const marker = chunkText.match(/repeatd\d+/u)?.[0];
    calls.push({ chunkIndex, marker, failed: false });
    const shouldFail = mode === "all" || (mode === "first" && chunkIndex === 0) || (mode === "middle" && chunkIndex === 1) || (mode === "final" && chunkIndex === expectedChunks.length - 1) || (mode === "multiple" && chunkIndex % 2 === 1);
    calls[calls.length - 1].failed = shouldFail;
    if (shouldFail) throw new TypeError("simulated provider failure");
    const start = marker ? chunkText.indexOf(marker) : -1;
    const issues = marker && start >= 0 ? [{ start, end: start + marker.length, original: marker, replacement: marker.replace("repeatd", "repeated"), category: "spelling", severity: "high", confidence: 0.99, title: "Spelling", explanation: "Use the standard spelling." }] : [];
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues, tone: ["direct"], scores: {} }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await analyzeWithProvider(text, goals, settings, { maxChunkChars: 500, contextWindow: 0 });
    return { result, calls, text };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("provider URL validation requires HTTPS except for localhost", () => {
  assert.equal(validateProviderUrl("https://example.com/v1").protocol, "https:");
  assert.equal(validateProviderUrl("http://localhost:4000/v1").hostname, "localhost");
  assert.throws(() => validateProviderUrl("http://example.com/v1"), (error) => error instanceof ProviderError && error.code === "insecure-url");
});

test("custom headers cannot override credential or transport headers", () => {
  const headers = parseCustomHeaders(JSON.stringify({ "X-Trace": "test", Authorization: "bad", Cookie: "secret", "Content-Length": "1" }));
  assert.deepEqual(headers, { "X-Trace": "test" });
});

test("malformed provider issues are discarded while exact ranges survive", () => {
  const source = "This is repeatd.";
  const issues = parseAnalysisIssues({
    issues: [
      { start: 8, end: 15, original: "repeatd", replacement: "repeated", category: "spelling", severity: "high", confidence: 0.99, title: "Spelling", explanation: "Fix it." },
      { start: 0, end: 4, original: "wrong", replacement: "right", category: "spelling", severity: "high", title: "Unsafe", explanation: "Reject me." },
      { start: 0, end: 1, original: "T", replacement: "t", category: "unknown", severity: "low", title: "Unknown", explanation: "Reject me." },
    ],
  }, source);
  assert.equal(issues.length, 1);
  assert.equal(source.slice(issues[0].start, issues[0].end), issues[0].original);
});

test("long-document provider calls keep the full analysed text", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [], tone: ["direct"], scores: {} }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const text = `${"A useful sentence about writing. ".repeat(400)}`;
    const result = await analyzeWithProvider(text, { audience: "general", intent: "inform", tone: "neutral" }, { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "test", apiKey: "test", temperature: 0.2, maxTokens: 900, customHeaders: "" }, { maxChunkChars: 800 });
    assert.ok(calls.length > 1);
    assert.equal(result.analysedText.length, text.length);
    assert.equal(result.stats.words, text.trim().split(/\s+/u).length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("partial chunk failures preserve the original chunk pairing", async () => {
  for (const mode of ["middle", "first", "final", "multiple"]) {
    const { result, calls } = await runChunkFailureCase(mode);
    assert.ok(isAiCoverageConsistent(result.aiCoverage));
    const successfulMarkers = calls.filter((call) => !call.failed && call.marker).map((call) => call.marker);
    for (const marker of successfulMarkers) assert.ok(result.issues.some((issue) => issue.source === "ai" && issue.original === marker), `${mode} lost ${marker}`);
  }
});

test("all chunk failures surface an error instead of silently returning mis-mapped AI issues", async () => {
  await assert.rejects(() => runChunkFailureCase("all"), (error) => error instanceof ProviderError && error.code === "cors");
});

test("malformed content arrays and huge responses stay safe while local analysis survives", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: [{ unexpected: true }] } }] }), { status: 200 });
  try {
    const result = await analyzeWithProvider("This is repeatd.", goals, settings);
    assert.ok(result.issues.some((issue) => issue.source === "local" && issue.original === "repeatd"));
    assert.equal(result.aiCoverage?.failedChunks, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP 200 response semantics distinguish missing content from valid zero-issue analysis", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 });
  try {
    const failed = await analyzeWithProvider("This is repeatd.", goals, settings);
    assert.equal(failed.source, "local");
    assert.deepEqual(failed.aiCoverage, { requestedChunks: 1, attemptedChunks: 1, successfulChunks: 0, failedChunks: 1, skippedChunks: 0 });
    assert.ok(isAiCoverageConsistent(failed.aiCoverage));
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [], tone: [], scores: {} }) } }] }), { status: 200 });
  try {
    const successful = await analyzeWithProvider("This is repeatd.", goals, settings);
    assert.equal(successful.source, "local+ai");
    assert.deepEqual(successful.aiCoverage, { requestedChunks: 1, attemptedChunks: 1, successfulChunks: 1, failedChunks: 0, skippedChunks: 0 });
    assert.equal(successful.diagnostics?.providerRequests, 1);
    assert.equal(successful.diagnostics?.providerHttpRequests, 1);
    assert.ok(isAiCoverageConsistent(successful.aiCoverage));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unsupported response formats retry without replacing local results", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("response_format is unsupported", { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [], tone: [], scores: {} }) } }] }), { status: 200 });
  };
  try {
    const result = await analyzeWithProvider("This is repeatd.", goals, settings);
    assert.equal(calls, 2);
    assert.ok(result.issues.some((issue) => issue.source === "local" && issue.original === "repeatd"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rate limits and invalid provider URLs expose stable error codes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("slow down", { status: 429 });
  try {
    await assert.rejects(() => analyzeWithProvider("A short sentence.", goals, settings), (error) => error instanceof ProviderError && error.code === "rate-limited");
  } finally {
    globalThis.fetch = originalFetch;
  }
  await assert.rejects(() => analyzeWithProvider("A short sentence.", goals, { ...settings, baseUrl: "https://user:pass@example.com/v1" }), (error) => error instanceof ProviderError && error.code === "invalid-url");
});

test("provider requests use bounded concurrency", async () => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let maximum = 0;
  globalThis.fetch = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 8));
    active -= 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [], tone: [], scores: {} }) } }] }), { status: 200 });
  };
  try {
    const text = Array.from({ length: 12 }, (_, index) => "Section " + index + " " + "context ".repeat(72)).join("\n\n");
    await analyzeWithProvider(text, goals, settings, { maxChunkChars: 500, contextWindow: 0, providerConcurrency: 2, maxAiChunks: 12 });
    assert.ok(maximum <= 2);
    assert.equal(PROVIDER_CONCURRENCY, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider worker pool preserves order and honours cancellation", async () => {
  const settled = await mapWithConcurrency([0, 1, 2, 3, 4], async (value) => {
    await new Promise((resolve) => setTimeout(resolve, (4 - value) * 3));
    return value * 2;
  }, { concurrency: 3 });
  assert.deepEqual(settled.map((result) => result.status === "fulfilled" ? result.value : null), [0, 2, 4, 6, 8]);

  const controller = new AbortController();
  const pending = mapWithConcurrency([0, 1, 2], async (value) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return value;
  }, { concurrency: 3, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
});

test("provider workload limits expose skipped AI coverage", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [], tone: [], scores: {} }) } }] }), { status: 200 });
  };
  try {
    const text = Array.from({ length: 8 }, (_, index) => "Section " + index + " " + "context ".repeat(72)).join("\n\n");
    const result = await analyzeWithProvider(text, goals, settings, { maxChunkChars: 500, contextWindow: 0, maxAiChunks: 2, maxAiChars: 1_000 });
    assert.ok(calls <= 2);
    assert.ok(result.aiCoverage);
    assert.ok(result.aiCoverage.skippedChunks > 0);
    assert.equal(result.aiCoverage.successfulChunks, calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transient external failures retry with bounded attempts while client errors do not", async () => {
  let calls = 0;
  let requests = 0;
  const retries = [];
  const recovered = await fetchWithRetry(async () => {
    calls += 1;
    return calls === 1 ? new Response("busy", { status: 503, headers: { "retry-after": "0" } }) : new Response("ok", { status: 200 });
  }, { service: "provider", maxRetries: 2, onRequest: () => { requests += 1; }, onRetry: (observation) => retries.push(observation) });
  assert.equal(recovered.status, 200);
  assert.equal(calls, 2);
  assert.equal(requests, 2);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].service, "provider");
  calls = 0;
  const rejected = await fetchWithRetry(async () => {
    calls += 1;
    return new Response("bad request", { status: 400 });
  }, { service: "classifier", maxRetries: 2 });
  assert.equal(rejected.status, 400);
  assert.equal(calls, 1);
});

test("provider timeout and invalid model are explicit failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  try {
    await assert.rejects(() => analyzeWithProvider("A short sentence.", goals, settings, { timeoutMs: 1_000 }), (error) => error instanceof ProviderError && error.code === "timeout");
  } finally {
    globalThis.fetch = originalFetch;
  }
  await assert.rejects(() => analyzeWithProvider("A short sentence.", goals, { ...settings, model: "" }), (error) => error instanceof ProviderError && error.code === "invalid-model");
});

test("rewrite validation protects structured values and supports explicit exceptions", async () => {
  const originalFetch = globalThis.fetch;
  const request = { text: "Email a@b.com on 2026-09-18 for £20, see ticket ABC-123 in report.pdf and keep \"this quote\".", instruction: "Make it concise.", goals, allowProtectedChanges: false };
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replacement: "Email someone and make it concise.", explanation: "Shorter." }) } }] }), { status: 200 });
  try {
    await assert.rejects(() => rewriteWithProvider(request, settings), (error) => error instanceof ProviderError && error.code === "invalid-json");
  } finally {
    globalThis.fetch = originalFetch;
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replacement: "Email someone and make it concise.", alternatives: ["Another version."], explanation: "Shorter." }) } }] }), { status: 200 });
  try {
    const result = await rewriteWithProvider({ ...request, allowProtectedChanges: true }, settings);
    assert.equal(result.alternatives.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replacement: request.text, alternatives: ["Email someone and change the date."] }) } }] }), { status: 200 });
  try {
    const result = await rewriteWithProvider(request, settings);
    assert.equal(result.replacement, request.text);
    assert.deepEqual(result.alternatives, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rewrite protection keeps currencies, percentages, dates, identifiers, models, and filenames intact", async () => {
  const originalFetch = globalThis.fetch;
  const protectedText = "Budget £1,250.50 is 20% for 18 September 2026; contact user@example.com about GPT-5.6 in report-v2.pdf under ABC-123.";
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replacement: "Budget £1,250.00 is 20% for 18 September 2026; contact user@example.com about GPT-5.6 in report-v2.pdf under ABC-123." }) } }] }), { status: 200 });
  try {
    await assert.rejects(() => rewriteWithProvider({ text: protectedText, instruction: "Make this concise.", goals, allowProtectedChanges: false }, settings), (error) => error instanceof ProviderError && error.code === "invalid-json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local formal rewrites expand contractions without changing unrelated verbs", async () => {
  const result = await rewriteWithProvider(
    {
      text: "I get tired, but I can't rest.",
      instruction: "Make this formal.",
      goals,
    },
    { ...settings, apiKey: "" },
  );
  assert.equal(result.source, "local");
  assert.equal(result.replacement, "I get tired, but I cannot rest.");
});

test("local confident rewrites do not inflate uncertainty into certainty", async () => {
  const text = "It could rain tomorrow, and the plan might change.";
  const result = await rewriteWithProvider(
    {
      text,
      instruction: "Make this sound more confident.",
      goals,
    },
    { ...settings, apiKey: "" },
  );
  assert.equal(result.replacement, text);
});

test("local concise rewrites preserve meaningful intensifiers and limiting words", async () => {
  const text = "I just need very little time in order to finish at this point in time.";
  const result = await rewriteWithProvider(
    {
      text,
      instruction: "Shorten this.",
      goals,
    },
    { ...settings, apiKey: "" },
  );
  assert.equal(result.replacement, "I just need very little time to finish now.");
});
