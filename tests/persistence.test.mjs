import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_SAVE_DELAY_MS, LEGACY_STORAGE_KEYS, WORKSPACE_STORAGE_KEY, clearWorkspaceStorage, isClassifierSettings, isProviderSettings, isWorkspace, readWorkspaceFromStorage, resolveHydratedWorkspace, writeWorkspaceToStorage } from "../hooks/useDraftPersistence.ts";
import { DEFAULT_PROVIDER_SETTINGS, DEFAULT_WORKSPACE } from "../packages/types/src/index.ts";

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("versioned persistence hydrates saved configuration and ignores legacy document content", () => {
  const initial = DEFAULT_WORKSPACE();
  const saved = { ...initial, version: 2, title: "Saved", draft: "saved draft", aiEnabled: true, activeDocumentId: "doc-42" };
  const loaded = readWorkspaceFromStorage(initial, storage({ "draftwise:workspace:v2": JSON.stringify(saved) }));
  // Document content lives in the document store; workspace persistence holds
  // global configuration plus the last-opened document id only.
  assert.equal(loaded.aiEnabled, true);
  assert.equal(loaded.activeDocumentId, "doc-42");
  assert.equal("draft" in loaded, false);
  assert.equal("title" in loaded, false);
});

test("legacy split keys migrate without crashing on malformed optional values", () => {
  const initial = DEFAULT_WORKSPACE();
  const loaded = readWorkspaceFromStorage(initial, storage({
    "draftwise:draft": "legacy draft",
    "draftwise:goals": "{not-json",
    "draftwise:ai-enabled": "true",
  }));
  // The legacy draft key is document content and is no longer read into the
  // workspace; configuration still migrates safely.
  assert.equal("draft" in loaded, false);
  assert.equal(loaded.aiEnabled, true);
  assert.equal(loaded.goals.audience, initial.goals.audience);
});

test("partially corrupted versioned workspaces keep valid fields and default invalid fields", () => {
  const initial = DEFAULT_WORKSPACE();
  const loaded = readWorkspaceFromStorage(initial, storage({
    "draftwise:workspace:v2": JSON.stringify({
      version: "old",
      title: "Valid title",
      draft: "Valid draft",
      goals: { audience: "academic", intent: "not-an-intent", tone: "formal" },
      style: { ...initial.style, dialect: "pirate", ignoredWords: "not-an-array" },
      provider: { ...initial.provider, model: "", temperature: "hot", apiKey: "valid-key" },
      classifier: { baseUrl: "https://classifier.dev", model: "legacy-model", uncertainPolicy: "provider" },
      aiEnabled: true,
      theme: "neon",
    }),
  }));
  assert.equal("title" in loaded, false);
  assert.equal("draft" in loaded, false);
  assert.equal(loaded.goals.audience, "academic");
  assert.equal(loaded.goals.intent, initial.goals.intent);
  assert.equal(loaded.style.dialect, initial.style.dialect);
  assert.deepEqual(loaded.style.ignoredWords, initial.style.ignoredWords);
  assert.equal(loaded.provider.apiKey, "valid-key");
  assert.equal(loaded.provider.model, initial.provider.model);
  assert.equal(loaded.classifier?.uncertainPolicy, "provider");
  assert.equal("model" in (loaded.classifier || {}), false);
  assert.equal(loaded.theme, initial.theme);
});

test("invalid JSON, unexpected shapes, and incorrect arrays never escape the migration boundary", () => {
  const initial = DEFAULT_WORKSPACE();
  for (const value of ["{not-json", "[]", "null", JSON.stringify({ goals: [], style: {}, provider: [] })]) {
    const loaded = readWorkspaceFromStorage(initial, storage({ "draftwise:workspace:v2": value }));
    assert.ok(isWorkspace(loaded));
  }
});

test("runtime validators reject malformed classifier settings", () => {
  assert.ok(isClassifierSettings({ baseUrl: "https://classifier.dev", uncertainPolicy: "provider" }));
  assert.equal(isClassifierSettings({ baseUrl: "http://classifier.dev", uncertainPolicy: "provider" }), false);
  assert.equal(isClassifierSettings({ baseUrl: "https://classifier.dev", uncertainPolicy: "maybe" }), false);
});

test("an empty classifier URL is a valid 'triage off' setting, not corruption", () => {
  // If "" read as invalid, every saved workspace would fail isWorkspace() and
  // the writer would lose their goals and style preferences too.
  assert.ok(isClassifierSettings({ baseUrl: "", uncertainPolicy: "provider" }));
  const initial = DEFAULT_WORKSPACE();
  const loaded = readWorkspaceFromStorage(initial, storage({
    "draftwise:workspace:v2": JSON.stringify({ ...initial, classifier: { baseUrl: "", uncertainPolicy: "provider" }, theme: "dark" }),
  }));
  assert.ok(isWorkspace(loaded));
  assert.equal(loaded.classifier.baseUrl, "", "a cleared classifier must stay cleared across a reload");
  assert.equal(loaded.theme, "dark", "other preferences must survive alongside a disabled classifier");
});

test("a fresh install has no classifier endpoint configured", () => {
  // The product's claim is that drafts never leave the device. This shipped as
  // "https://classifier.dev", which meant a user who added their own provider
  // key and switched AI on started sending draft excerpts to that endpoint
  // without ever having configured one.
  const workspace = DEFAULT_WORKSPACE();
  assert.equal(workspace.classifier.baseUrl, "", "classifier triage must be off until an endpoint is entered");
  assert.equal(workspace.aiEnabled, false, "AI must stay off until the user asks for it");
});

test("custom headers are bounded before they reach localStorage", () => {
  // People paste tenant tokens into custom headers. It is persisted verbatim,
  // so an unbounded value is an unbounded secret left on disk.
  const oversized = { ...DEFAULT_PROVIDER_SETTINGS, customHeaders: "x".repeat(20_000) };
  assert.equal(isProviderSettings(oversized), false);
  const loaded = readWorkspaceFromStorage(DEFAULT_WORKSPACE(), storage({
    "draftwise:workspace:v2": JSON.stringify({ ...DEFAULT_WORKSPACE(), provider: oversized }),
  }));
  assert.ok(isWorkspace(loaded));
  assert.notEqual(loaded.provider.customHeaders.length, 20_000, "an oversized customHeaders value must be dropped on load");
});

test("failed local writes return an error instead of a false saved state", () => {
  const initial = DEFAULT_WORKSPACE();
  const result = writeWorkspaceToStorage(initial, {
    ...storage(),
    setItem() {
      const error = new Error("quota");
      error.name = "QuotaExceededError";
      throw error;
    },
  });
  assert.deepEqual(result, { ok: false, error: "Local storage is full." });
});


test("clear local storage removes both current and legacy workspace keys", () => {
  const target = storage({
    [WORKSPACE_STORAGE_KEY]: "current",
    ...Object.fromEntries(LEGACY_STORAGE_KEYS.map((key) => [key, "legacy"])),
    "unrelated:key": "keep",
  });
  assert.deepEqual(clearWorkspaceStorage(target), { ok: true });
  assert.equal(target.getItem(WORKSPACE_STORAGE_KEY), null);
  for (const key of LEGACY_STORAGE_KEYS) assert.equal(target.getItem(key), null);
  assert.equal(target.getItem("unrelated:key"), "keep");
});

test("autosave delay is intentionally debounced instead of per-keystroke", () => {
  assert.ok(AUTO_SAVE_DELAY_MS >= 250);
  assert.ok(AUTO_SAVE_DELAY_MS <= 1_000);
});


test("clear attempts every Draftwise key even when one removal fails", () => {
  const removed = [];
  const target = {
    ...storage(),
    removeItem(key) {
      removed.push(key);
      if (key === LEGACY_STORAGE_KEYS[0]) throw new Error("blocked removal");
    },
  };
  const result = clearWorkspaceStorage(target);
  assert.equal(result.ok, false);
  assert.match(result.error, /blocked removal/u);
  assert.deepEqual(removed, [WORKSPACE_STORAGE_KEY, ...LEGACY_STORAGE_KEYS]);
});


test("corrupt versioned storage falls back to recoverable legacy configuration", () => {
  const initial = DEFAULT_WORKSPACE();
  const loaded = readWorkspaceFromStorage(initial, storage({
    [WORKSPACE_STORAGE_KEY]: "{not-json",
    "draftwise:draft": "legacy recovery draft",
    "draftwise:ai-enabled": "true",
  }));
  // Legacy document content stays in the document store; configuration still
  // recovers from the legacy keys.
  assert.equal("draft" in loaded, false);
  assert.equal(loaded.aiEnabled, true);
});

test("pre-hydration edits win over a late local-storage read", () => {
  const initial = DEFAULT_WORKSPACE();
  const current = { ...initial, activeDocumentId: "typed-before-hydration" };
  const loaded = { ...initial, activeDocumentId: "older-saved-id" };
  assert.equal(resolveHydratedWorkspace(current, loaded, true).activeDocumentId, "typed-before-hydration");
  assert.equal(resolveHydratedWorkspace(current, loaded, false).activeDocumentId, "older-saved-id");
});
