import assert from "node:assert/strict";
import test from "node:test";
import { canApplyRewritePreview, createRewriteRetryArgs } from "../lib/rewrite-retry.ts";
import { ProviderError, rewriteWithProvider } from "../packages/ai/src/index.ts";

const settings = { provider: "openai-compatible", baseUrl: "https://example.com/v1", model: "test-model", apiKey: "key", temperature: 0.2, maxTokens: 900, customHeaders: "" };
const goals = { audience: "technical", intent: "explain", tone: "professional" };
const style = { dialect: "en-GB", personalDictionary: [], names: [], ignoredWords: [], ignoredRuleIds: [], preferredTerminology: {}, oxfordComma: true, allowContractions: true, passiveVoiceSensitivity: "normal", preferredSentenceLength: "balanced", blockedWords: [] };

test("rewrite retry preserves the exact instruction and original context", () => {
  const instructions = [
    ["Improve", "Improve writing while preserving meaning"],
    ["Shorten", "Shorten without losing facts"],
    ["Formal", "Make more formal and professional"],
    ["Custom rewrite", "Rewrite this for a skeptical CTO without changing the API names"],
  ];
  for (const [label, instruction] of instructions) {
    const preview = { label, instruction, original: "Use the Draftwise API.", selection: { start: 4, end: 25 }, goals, style, aiEnabled: true, replacement: "Use Draftwise's API.", alternatives: [], explanation: "", source: "ai" };
    const retry = createRewriteRetryArgs(preview, settings);
    assert.equal(retry.instruction, instruction);
    assert.deepEqual(retry.goals, goals);
    assert.deepEqual(retry.style, style);
    assert.deepEqual(retry.selection, preview.selection);
    assert.equal(retry.text, preview.original);
  }
});

test("provider-failure previews retain retry context", () => {
  const preview = { label: "Custom rewrite", instruction: "Keep the legal terms and shorten this", original: "A long contract sentence.", selection: { start: 0, end: 25 }, goals, style, aiEnabled: true, replacement: "A long contract sentence.", alternatives: [], explanation: "The provider is unavailable.", source: "local" };
  const retry = createRewriteRetryArgs(preview, settings);
  assert.equal(retry.instruction, "Keep the legal terms and shorten this");
  assert.equal(retry.aiEnabled, true);
});

test("AI rewrite success receives each preset and custom instruction unchanged", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body.messages[1].content);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ replacement: "A clearer sentence.", alternatives: [], explanation: "Preserved the meaning." }) } }] }), { status: 200 });
  };
  try {
    for (const instruction of ["Improve clarity", "Shorten without losing facts", "Make it formal", "Rewrite this for a skeptical CTO without changing API names"]) {
      const result = await rewriteWithProvider({ text: "A sentence.", instruction, goals, preferences: style }, settings);
      assert.equal(result.source, "ai");
    }
    for (const instruction of ["Improve clarity", "Shorten without losing facts", "Make it formal", "Rewrite this for a skeptical CTO without changing API names"]) assert.ok(seen.some((prompt) => prompt.includes(`Instruction: ${instruction}`)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI provider failure remains an explicit retryable failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("provider unavailable"); };
  try {
    await assert.rejects(() => rewriteWithProvider({ text: "A sentence.", instruction: "Shorten this", goals, preferences: style }, settings), (error) => error instanceof ProviderError && error.code === "cors");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("failed or unchanged rewrite previews cannot be applied", () => {
  assert.equal(canApplyRewritePreview({ original: "Keep this.", replacement: "Keep this.", failed: true }), false);
  assert.equal(canApplyRewritePreview({ original: "Keep this.", replacement: "Keep this." }), false);
  assert.equal(canApplyRewritePreview({ original: "Keep this.", replacement: "", loading: true }), false);
  assert.equal(canApplyRewritePreview({ original: "Keep this.", replacement: "Use this." }), true);
});
