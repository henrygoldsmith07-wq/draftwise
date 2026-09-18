import assert from "node:assert/strict";
import test from "node:test";
import { readWorkspaceFromStorage } from "../hooks/useDraftPersistence.ts";
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
