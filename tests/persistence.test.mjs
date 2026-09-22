import assert from "node:assert/strict";
import test from "node:test";
import { clearWorkspaceStorage, isClassifierSettings, isWorkspace, readWorkspaceFromStorage, shouldSkipAutosave, writeWorkspaceToStorage } from "../hooks/useDraftPersistence.ts";
import { DEFAULT_WORKSPACE } from "../packages/types/src/index.ts";

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("versioned persistence hydrates the saved draft instead of the initial draft", () => {
  const initial = DEFAULT_WORKSPACE("initial draft");
  const saved = { ...initial, version: 2, title: "Saved", draft: "saved draft", aiEnabled: true };
  const loaded = readWorkspaceFromStorage(initial, storage({ "draftwise:workspace:v2": JSON.stringify(saved) }));
  assert.equal(loaded.draft, "saved draft");
  assert.equal(loaded.title, "Saved");
  assert.equal(loaded.aiEnabled, true);
});

test("legacy split keys migrate without crashing on malformed optional values", () => {
  const initial = DEFAULT_WORKSPACE("initial draft");
  const loaded = readWorkspaceFromStorage(initial, storage({
    "draftwise:draft": "legacy draft",
    "draftwise:goals": "{not-json",
    "draftwise:ai-enabled": "true",
  }));
  assert.equal(loaded.draft, "legacy draft");
  assert.equal(loaded.aiEnabled, true);
  assert.equal(loaded.goals.audience, initial.goals.audience);
});

test("partially corrupted versioned workspaces keep valid fields and default invalid fields", () => {
  const initial = DEFAULT_WORKSPACE("initial draft");
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
  assert.equal(loaded.title, "Valid title");
  assert.equal(loaded.draft, "Valid draft");
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
  const initial = DEFAULT_WORKSPACE("initial draft");
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

test("failed local writes return an error instead of a false saved state", () => {
  const initial = DEFAULT_WORKSPACE("draft");
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

test("clearing persistence removes the versioned workspace and every legacy key", () => {
  const store = storage({
    "draftwise:workspace:v2": "workspace",
    "draftwise:draft": "draft",
    "draftwise:goals": "goals",
    "draftwise:provider": "provider",
    "draftwise:theme": "theme",
    "draftwise:ai-enabled": "true",
    "unrelated": "keep",
  });

  assert.deepEqual(clearWorkspaceStorage(store), { ok: true });
  assert.equal(store.getItem("draftwise:workspace:v2"), null);
  assert.equal(store.getItem("draftwise:draft"), null);
  assert.equal(store.getItem("draftwise:goals"), null);
  assert.equal(store.getItem("draftwise:provider"), null);
  assert.equal(store.getItem("draftwise:theme"), null);
  assert.equal(store.getItem("draftwise:ai-enabled"), null);
  assert.equal(store.getItem("unrelated"), "keep");
});

test("the cleared in-memory snapshot is not immediately auto-saved, but later edits are", () => {
  const cleared = DEFAULT_WORKSPACE("sample");
  assert.equal(shouldSkipAutosave(cleared, cleared), true);
  assert.equal(shouldSkipAutosave({ ...cleared, draft: "new text" }, cleared), false);
  assert.equal(shouldSkipAutosave(cleared, null), false);
});

test("clear attempts every Draftwise key even if one removal fails", () => {
  const removed = [];
  const store = {
    ...storage(),
    removeItem(key) {
      removed.push(key);
      if (key === "draftwise:draft") throw new Error("blocked");
    },
  };

  const result = clearWorkspaceStorage(store);
  assert.equal(result.ok, false);
  assert.match(result.error, /blocked/i);
  assert.deepEqual(removed, [
    "draftwise:workspace:v2",
    "draftwise:draft",
    "draftwise:goals",
    "draftwise:provider",
    "draftwise:theme",
    "draftwise:ai-enabled",
  ]);
});
