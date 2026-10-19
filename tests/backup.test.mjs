import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKUP_KIND,
  BACKUP_VERSION,
  MAX_BACKUP_DOCUMENTS,
  buildBackup,
  oversizedBackupFile,
  parseBackup,
  readRawActivityLog,
  serializeBackup,
} from "../lib/backup.ts";
import { MemoryDocumentBackend, createDocument } from "../lib/documents.ts";
import { DocumentLifecycle } from "../lib/document-lifecycle.ts";
import { DEFAULT_WORKSPACE } from "../packages/types/src/index.ts";

const seed = { title: "Untitled draft", draft: "" };

function workspace() {
  return DEFAULT_WORKSPACE();
}

function sampleBackup() {
  const essay = createDocument("Essay", "The essay body.", 1_000, { audience: "academic", intent: "explain", tone: "formal" });
  const email = createDocument("Email", "A quick note.", 2_000);
  return buildBackup({
    documents: [essay, email],
    workspace: workspace(),
    activity: { version: 1, days: [{ date: "2026-10-17", words: 120, activeMs: 60_000 }] },
    exportedAt: "2026-10-17T00:00:00.000Z",
  });
}

test("a backup round-trips documents, goals, settings, and activity", () => {
  const backup = sampleBackup();
  const result = parseBackup(serializeBackup(backup));
  assert.equal(result.ok, true);
  assert.equal(result.backup.documents.length, 2);
  assert.deepEqual(result.backup.documents[0].goals, { audience: "academic", intent: "explain", tone: "formal" });
  assert.deepEqual(result.backup.workspace.goals, workspace().goals);
  assert.deepEqual(result.backup.activity.days, [{ date: "2026-10-17", words: 120, activeMs: 60_000 }]);
  assert.equal(result.backup.exportedAt, "2026-10-17T00:00:00.000Z");
  assert.deepEqual(result.warnings, []);
});

test("hostile and malformed backups are refused without changing anything", () => {
  assert.equal(parseBackup("not json").ok, false);
  assert.equal(parseBackup(JSON.stringify({ kind: "draftwise-profile", version: 1 })).ok, false);
  assert.equal(
    parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 999, documents: [], workspace: workspace() })).ok,
    false,
  );
  // Settings must validate as a whole: a backup carrying a bad provider URL
  // cannot restore half a configuration over the writer's own.
  const badWorkspace = { ...workspace(), provider: { ...workspace().provider, baseUrl: "http://evil.invalid" } };
  const refused = parseBackup(serializeBackup(buildBackup({
    documents: [createDocument("Doc", "Text.")],
    workspace: badWorkspace,
    activity: { version: 1, days: [] },
  })));
  assert.equal(refused.ok, false);
  // No readable documents means nothing to restore.
  const empty = parseBackup(serializeBackup(buildBackup({
    documents: [{ id: "", draft: 42 }],
    workspace: workspace(),
    activity: { version: 1, days: [] },
  })));
  assert.equal(empty.ok, false);
});

test("unreadable document entries are skipped and reported, not fatal", () => {
  const backup = sampleBackup();
  backup.documents.push({ id: "", draft: 42 });
  const result = parseBackup(serializeBackup(backup));
  assert.equal(result.ok, true);
  assert.equal(result.backup.documents.length, 2);
  assert.equal(result.backup.skippedDocuments, 1);
  assert.equal(result.warnings.length, 1);
});

test("unreadable activity is dropped with a warning while documents restore", () => {
  const backup = sampleBackup();
  backup.activity = { version: 1, days: [{ date: "yesterday", words: "lots", activeMs: -3 }] };
  const result = parseBackup(serializeBackup(backup));
  assert.equal(result.ok, true);
  assert.deepEqual(result.backup.activity.days, []);
  assert.equal(result.backup.activityDropped, true);
});

test("oversized backups are refused before and after reading", () => {
  assert.ok(oversizedBackupFile({ size: 26_000_000 }));
  assert.equal(oversizedBackupFile({ size: 100 }), null);
  assert.equal(parseBackup("x".repeat(21_000_000)).ok, false);
  const tooMany = { ...sampleBackup(), documents: new Array(MAX_BACKUP_DOCUMENTS + 1).fill(createDocument("D", "t")) };
  assert.equal(parseBackup(JSON.stringify(tooMany)).ok, false);
});

test("raw activity reads tolerate missing and corrupt storage", () => {
  assert.deepEqual(readRawActivityLog(null).days, []);
  assert.deepEqual(readRawActivityLog("garbage").days, []);
  const log = readRawActivityLog(JSON.stringify({ version: 1, days: [{ date: "2026-10-17", words: 5, activeMs: 9 }] }));
  assert.deepEqual(log.days, [{ date: "2026-10-17", words: 5, activeMs: 9 }]);
});

test("replaceAll swaps the whole library and persists it", async () => {
  const backend = new MemoryDocumentBackend();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  const incoming = sampleBackup().documents;
  const result = await lifecycle.replaceAll(incoming, incoming[1].id);
  assert.deepEqual(result, { ok: true });
  assert.equal(lifecycle.activeId, incoming[1].id);
  assert.deepEqual(
    lifecycle.documents.map((document) => document.id).sort(),
    incoming.map((document) => document.id).sort(),
  );

  // A reload over the same backend sees the restored library.
  const reloaded = new DocumentLifecycle(backend, seed);
  await reloaded.load();
  assert.equal(reloaded.documents.length, 2);
  assert.deepEqual(reloaded.getDocument(incoming[0].id)?.goals, {
    audience: "academic",
    intent: "explain",
    tone: "formal",
  });
});

test("mergeAll adds alongside current work without touching it", async () => {
  const backend = new MemoryDocumentBackend();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  const current = lifecycle.getActive();
  lifecycle.updateActive({ draft: "My current work." });
  await lifecycle.flush();

  const incoming = sampleBackup().documents;
  const result = await lifecycle.mergeAll(incoming);
  assert.equal(result.ok, true);
  assert.deepEqual(result.merged, { added: 2, skipped: 0, renamed: 0 });
  // Current work survives untouched and stays the active document.
  assert.equal(lifecycle.activeId, current.id);
  assert.equal(lifecycle.getActive()?.draft, "My current work.");
  assert.equal(lifecycle.documents.length, 3);
  // Imported history, goals and timestamps arrive intact.
  assert.deepEqual(lifecycle.getDocument(incoming[0].id)?.goals, {
    audience: "academic",
    intent: "explain",
    tone: "formal",
  });
  await lifecycle.flush();

  // A reload over the same backend sees the merged library.
  const reloaded = new DocumentLifecycle(backend, seed);
  await reloaded.load();
  assert.equal(reloaded.documents.length, 3);
});

test("mergeAll skips identical documents and copies conflicting ones", async () => {
  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), seed);
  await lifecycle.load();
  const current = lifecycle.getActive();

  const identical = { ...current, draft: current.draft };
  const conflicting = { ...current, draft: "Different text under the same identity." };
  const fresh = createDocument("Fresh", "New words.");
  const result = await lifecycle.mergeAll([identical, conflicting, fresh]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.merged, { added: 1, skipped: 1, renamed: 1 });
  // The conflicting text is kept as a titled copy under a fresh identity;
  // the original is never overwritten.
  const copy = lifecycle.documents.find((document) => document.title === `${current.title} (imported)`);
  assert.ok(copy);
  assert.notEqual(copy.id, current.id);
  assert.equal(copy.draft, "Different text under the same identity.");
  assert.equal(lifecycle.getDocument(current.id)?.draft, current.draft);
  assert.equal(lifecycle.documents.length, 3);
});

test("mergeAll refuses an empty backup and reports storage failure", async () => {
  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), seed);
  await lifecycle.load();
  assert.equal((await lifecycle.mergeAll([])).ok, false);

  const failing = new DocumentLifecycle(
    {
      list: async () => [],
      get: async () => null,
      put: async () => { throw new Error("disk is full"); },
      remove: async () => {},
      clear: async () => {},
    },
    seed,
  );
  await failing.load();
  const result = await failing.mergeAll(sampleBackup().documents);
  assert.equal(result.ok, false);
});

test("replaceAll refuses an empty library and reports storage failure", async () => {
  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), seed);
  await lifecycle.load();
  assert.equal((await lifecycle.replaceAll([])).ok, false);

  const failing = new DocumentLifecycle(
    {
      list: async () => [],
      get: async () => null,
      put: async () => { throw new Error("disk is full"); },
      remove: async () => {},
      clear: async () => {},
    },
    seed,
  );
  await failing.load();
  const result = await failing.replaceAll(sampleBackup().documents);
  assert.equal(result.ok, false);
});
