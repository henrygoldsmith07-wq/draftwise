import assert from "node:assert/strict";
import test from "node:test";
import { exportProfile, importProfile } from "../lib/profile-transfer.ts";
import { DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

/**
 * Style-profile portability: the writer's learned language data survives a
 * browser switch as a file they own.
 *
 * Two promises are pinned. First, secrets never travel: the export shape is
 * asserted to contain no provider, key, header, or AI-toggle fields, so a
 * future field addition cannot silently leak credentials. Second, import is
 * additive and hostile-input-safe: malformed files are refused with plain
 * messages, malformed entries are dropped, and nothing already present is
 * removed or overwritten.
 */

function profiled(overrides = {}) {
  return {
    ...DEFAULT_STYLE_PREFERENCES,
    personalDictionary: ["brontosaurus"],
    names: ["Achebe"],
    ignoredWords: ["colour"],
    blockedWords: ["very"],
    preferredTerminology: { utilise: "use" },
    learned: [
      { id: "l1", kind: "dismissal-pattern", label: "Filler", detail: "", family: "conciseness-filler", createdAt: 1, source: "learned" },
    ],
    ...overrides,
  };
}

test("an export carries language data and no secrets", () => {
  const exported = exportProfile(profiled());
  assert.equal(exported.kind, "draftwise-profile");
  assert.equal(exported.version, 1);
  assert.deepEqual(exported.profile.personalDictionary, ["brontosaurus"]);
  assert.deepEqual(exported.profile.preferredTerminology, { utilise: "use" });
  const serialised = JSON.stringify(exported);
  for (const forbidden of ["apiKey", "customHeaders", "baseUrl", "aiEnabled", "provider", "classifier", "temperature", "maxTokens"]) {
    assert.ok(!serialised.includes(`\"${forbidden}\"`), `export must not contain ${forbidden}`);
  }
});

test("a round trip merges additively and reports counts", () => {
  const file = JSON.stringify(exportProfile(profiled({
    personalDictionary: ["brontosaurus", "newterm"],
    preferredTerminology: { utilise: "use", "in order to": "to" },
  })));
  const result = importProfile(profiled(), file);
  assert.equal(result.ok, true);
  assert.match(result.message, /Imported 2 items/);
  assert.ok(result.merged.personalDictionary.includes("newterm"));
  assert.equal(result.merged.preferredTerminology["in order to"], "to");
  // Existing entries survive untouched.
  assert.ok(result.merged.personalDictionary.includes("brontosaurus"));
  assert.equal(result.merged.preferredTerminology.utilise, "use");
  assert.equal(result.merged.learned.length, 1);
});

test("an identical file imports nothing and says so", () => {
  const file = JSON.stringify(exportProfile(profiled()));
  const result = importProfile(profiled(), file);
  assert.equal(result.ok, false);
  assert.match(result.message, /Nothing new to import/);
  assert.equal(result.merged, undefined);
});

test("malformed files are refused with plain messages", () => {
  assert.match(importProfile(profiled(), "not json").message, /could not be read as JSON/);
  assert.match(importProfile(profiled(), "{}").message, /not a Draftwise profile export/);
  assert.match(importProfile(profiled(), JSON.stringify({ kind: "draftwise-profile", version: 99, profile: {} })).message, /newer Draftwise/);
  assert.match(importProfile(profiled(), JSON.stringify({ kind: "draftwise-profile", version: 1, profile: {} })).message, /missing its language setting/);
});

test("malformed entries are dropped while valid ones import", () => {
  const file = JSON.stringify({
    kind: "draftwise-profile",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: {
      dialect: "en-GB",
      personalDictionary: ["good", 42, null, "  ", "good", "x".repeat(500)],
      names: "not-an-array",
      ignoredWords: [],
      blockedWords: [],
      preferredTerminology: { ok: "fine", bad: 7, "": "empty", "ok2": "  " },
      learned: [
        { id: "l2", kind: "accepted-pattern", label: "Short", detail: "", family: "clarity", createdAt: 2, source: "learned" },
        { id: "l1", kind: "dismissal-pattern", label: "Dupe id", detail: "", family: "x", createdAt: 3, source: "learned" },
        { id: "l3", kind: "unknown-kind", label: "Bad kind", detail: "", family: "x", createdAt: 4, source: "learned" },
        null,
      ],
    },
  });
  const result = importProfile(profiled(), file);
  assert.equal(result.ok, true);
  assert.ok(result.merged.personalDictionary.includes("good"));
  assert.ok(!result.merged.personalDictionary.includes("42"));
  assert.ok(result.merged.personalDictionary.some((word) => word.startsWith("xxx") && word.length <= 80));
  assert.deepEqual(result.merged.names, ["Achebe"]);
  assert.equal(result.merged.preferredTerminology.ok, "fine");
  assert.ok(!("bad" in result.merged.preferredTerminology));
  // l2 is new; l1 keeps the local record (duplicate id ignored); l3 dropped.
  assert.equal(result.merged.learned.length, 2);
  assert.ok(result.merged.learned.some((entry) => entry.id === "l2"));
  assert.equal(result.merged.learned.find((entry) => entry.id === "l1").label, "Filler");
});

test("existing terminology is never overwritten by an import", () => {
  const file = JSON.stringify(exportProfile(profiled({ preferredTerminology: { utilise: "employ" } })));
  const current = profiled({ preferredTerminology: { utilise: "use" } });
  const result = importProfile(current, file);
  assert.equal(result.ok, false);
  assert.equal(current.preferredTerminology.utilise, "use");
});

test("enormous files are bounded, not trusted", () => {
  const huge = Array.from({ length: 10_000 }, (_, index) => `word${index}`);
  const file = JSON.stringify({
    kind: "draftwise-profile",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: { dialect: "en-US", personalDictionary: huge, names: [], ignoredWords: [], blockedWords: [], preferredTerminology: {}, learned: [] },
  });
  const result = importProfile(profiled({ personalDictionary: [] }), file);
  assert.equal(result.ok, true);
  assert.ok(result.merged.personalDictionary.length <= 2000);
});
