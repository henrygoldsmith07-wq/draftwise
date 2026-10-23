import assert from "node:assert/strict";
import test from "node:test";
import { testProviderConnection } from "../packages/ai/src/index.ts";

const SETTINGS = { baseUrl: "https://api.openai.com/v1", apiKey: "sk-test", customHeaders: "" };

function stubFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("refuses to test without an API key", async () => {
  const result = await testProviderConnection({ ...SETTINGS, apiKey: "  " });
  assert.equal(result.ok, false);
  assert.match(result.message, /API key/iu);
});

test("reports an invalid base URL without any network call", async () => {
  let called = 0;
  const restore = stubFetch(async () => {
    called += 1;
    return new Response("{}", { status: 200 });
  });
  try {
    const result = await testProviderConnection({ ...SETTINGS, baseUrl: "not a url" });
    assert.equal(result.ok, false);
    assert.equal(called, 0);
  } finally {
    restore();
  }
});

test("reports a rejected API key on 401", async () => {
  const restore = stubFetch(async () => new Response("{}", { status: 401 }));
  try {
    const result = await testProviderConnection(SETTINGS);
    assert.equal(result.ok, false);
    assert.match(result.message, /rejected the API key/iu);
  } finally {
    restore();
  }
});

test("distinguishes a reachable host with no /models endpoint", async () => {
  const restore = stubFetch(async () => new Response("{}", { status: 404 }));
  try {
    const result = await testProviderConnection(SETTINGS);
    assert.equal(result.ok, false);
    assert.match(result.message, /no \/models endpoint/iu);
  } finally {
    restore();
  }
});

test("reports the model count on success and sends no draft text", async () => {
  let seenUrl = "";
  let seenInit;
  const restore = stubFetch(async (url, init) => {
    seenUrl = String(url);
    seenInit = init;
    return new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), { status: 200 });
  });
  try {
    const result = await testProviderConnection(SETTINGS);
    assert.equal(result.ok, true);
    assert.match(result.message, /2 models/iu);
    assert.ok(typeof result.latencyMs === "number");
    assert.ok(seenUrl.endsWith("/models"));
    assert.equal(seenInit?.method, "GET");
    assert.equal(seenInit?.body, undefined);
    assert.equal(seenInit?.headers?.Authorization, "Bearer sk-test");
  } finally {
    restore();
  }
});

test("a 2xx without a models body still counts as connected", async () => {
  const restore = stubFetch(async () => new Response("not json", { status: 200 }));
  try {
    const result = await testProviderConnection(SETTINGS);
    assert.equal(result.ok, true);
    assert.match(result.message, /accepted the API key/iu);
  } finally {
    restore();
  }
});

test("an unreachable endpoint explains itself", async () => {
  const restore = stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  try {
    const result = await testProviderConnection(SETTINGS);
    assert.equal(result.ok, false);
    assert.match(result.message, /Could not reach/iu);
  } finally {
    restore();
  }
});
