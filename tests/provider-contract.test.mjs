import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeWithProvider,
  parseAnalysisIssues,
  parseCustomHeaders,
  ProviderError,
  validateProviderUrl,
} from "../packages/ai/src/index.ts";

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
