import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDocumentBackend, LocalStorageDocumentBackend } from "../lib/documents.ts";
import { DocumentLifecycle } from "../lib/document-lifecycle.ts";
import { clearAllLocalData, DOCUMENTS_LOCAL_STORAGE_KEY } from "../lib/clear-local-data.ts";

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key),
  };
}

const seed = { title: "Untitled draft", draft: "" };

function createLifecycle(backend = new MemoryDocumentBackend()) {
  const lifecycle = new DocumentLifecycle(backend, seed);
  return { lifecycle, backend };
}

test("create → edit → reload keeps the edited draft", async () => {
  const backend = new MemoryDocumentBackend();
  const first = new DocumentLifecycle(backend, seed);
  await first.load();
  const active = first.getActive();
  assert.ok(active);
  first.updateActive({ draft: "The edited draft body." });
  await first.flush();

  // Simulate reload: a fresh lifecycle over the same backend.
  const second = new DocumentLifecycle(backend, seed);
  await second.load();
  const reloaded = second.getDocument(active.id);
  assert.equal(reloaded?.draft, "The edited draft body.");
  assert.equal(reloaded?.wordCount, 4);
});

test("create → edit → switch document → switch back keeps both drafts intact", async () => {
  const { lifecycle } = createLifecycle();
  await lifecycle.load();
  const first = lifecycle.getActive();
  lifecycle.updateActive({ draft: "First document body." });
  const second = lifecycle.createNew("Second", "Second document body.");
  lifecycle.updateActive({ draft: "Second document body revised." });
  assert.equal(lifecycle.getActive().id, second.id);

  // Switch back: both documents must carry their own text.
  assert.equal(lifecycle.open(first.id), true);
  assert.equal(lifecycle.getActive().draft, "First document body.");
  lifecycle.open(second.id);
  assert.equal(lifecycle.getActive().draft, "Second document body revised.");
  await lifecycle.flush();
  assert.equal((await backendList(lifecycle)).length, 2);
});

async function backendList(lifecycle) {
  // Read through the lifecycle's own documents for assertions after flush.
  return lifecycle.summaries();
}

test("duplicate → edit duplicate leaves the original unchanged", async () => {
  const backend = new MemoryDocumentBackend();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  lifecycle.updateActive({ title: "Original", draft: "Original body text." });
  const copy = lifecycle.duplicate(lifecycle.activeId);
  assert.ok(copy);
  assert.equal(copy.title, "Original (copy)");
  assert.equal(lifecycle.activeId, copy.id, "duplicate becomes the active document");
  lifecycle.updateActive({ draft: "Copy edited beyond recognition." });

  const original = lifecycle.getDocument(copy.id === lifecycle.activeId ? lifecycle.documents.find((d) => d.title === "Original").id : "");
  assert.ok(original);
  assert.equal(original.draft, "Original body text.");
});

test("deleting the active document moves the editor to a real document", async () => {
  const backend = new MemoryDocumentBackend();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  const first = lifecycle.getActive();
  lifecycle.remove(first.id);
  const active = lifecycle.getActive();
  assert.ok(active, "a real document always backs the editor");
  assert.notEqual(active.id, first.id);
  assert.equal(active.draft, "");
  await lifecycle.flush();
  const stored = await backend.list();
  assert.equal(stored.some((document) => document.id === first.id), false);
});

test("deleting the last document creates a fresh blank draft instead of orphaning the editor", async () => {
  const backend = new MemoryDocumentBackend();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  const only = lifecycle.getActive();
  lifecycle.remove(only.id);
  assert.equal(lifecycle.documents.length, 1);
  assert.equal(lifecycle.getActive().draft, "");
  assert.notEqual(lifecycle.getActive().id, only.id);
});

test("imported documents behave exactly like normal documents", async () => {
  const { lifecycle } = createLifecycle();
  await lifecycle.load();
  const imported = lifecycle.createNew("Imported notes", "Imported body text.");
  lifecycle.updateActive({ draft: "Imported body text, then edited." });
  await lifecycle.flush();
  lifecycle.open(imported.id);
  assert.equal(lifecycle.getActive().draft, "Imported body text, then edited.");

  const copy = lifecycle.duplicate(imported.id);
  assert.equal(copy?.draft, "Imported body text, then edited.");
  assert.equal(lifecycle.summaries().length, 3, "seed + imported + copy");
});

test("rapid switching with pending writes never cross-contaminates documents", async () => {
  const { lifecycle } = createLifecycle();
  await lifecycle.load();
  const first = lifecycle.getActive();
  lifecycle.updateActive({ draft: "FIRST-DOCUMENT-TEXT" });
  // Switch immediately without flushing: the pending write is keyed by id.
  const second = lifecycle.createNew("Second", "SECOND-DOCUMENT-TEXT");
  lifecycle.updateActive({ draft: "SECOND-DOCUMENT-TEXT-REVISED" });
  lifecycle.open(first.id);
  lifecycle.updateActive({ draft: "FIRST-DOCUMENT-TEXT-REVISED" });
  await lifecycle.flush();

  assert.equal(lifecycle.getDocument(first.id).draft, "FIRST-DOCUMENT-TEXT-REVISED");
  assert.equal(lifecycle.getDocument(second.id).draft, "SECOND-DOCUMENT-TEXT-REVISED");
});

test("failed backend writes stay queued and report an error instead of silently losing text", async () => {
  let failing = false;
  const wrapped = {
    ...new MemoryDocumentBackend(),
    store: new MemoryDocumentBackend(),
    async list() { return this.store.list(); },
    async get(id) { return this.store.get(id); },
    async put(document) {
      if (failing) throw new Error("quota exceeded");
      return this.store.put(document);
    },
    async remove(id) { return this.store.remove(id); },
    async clear() { return this.store.clear(); },
  };
  const lifecycle = new DocumentLifecycle(wrapped, seed);
  await lifecycle.load();
  const active = lifecycle.getActive();
  // Fail only the edit's write; the document itself already exists.
  failing = true;
  lifecycle.updateActive({ draft: "Unsaved work." });
  await lifecycle.flush();
  assert.equal(lifecycle.getSnapshot().saveStatus, "error");
  assert.equal(lifecycle.hasPendingWrites(), true, "failed write stays queued for retry");
  assert.equal((await wrapped.store.get(active.id))?.draft, "", "nothing half-written lands");

  failing = false;
  await lifecycle.flush();
  assert.equal(lifecycle.getSnapshot().saveStatus, "saved");
  assert.equal((await wrapped.store.get(active.id))?.draft, "Unsaved work.");
});

test("flushSync covers page exit: queued writes reach storage", async () => {
  const backend = new MemoryDocumentBackend();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  const active = lifecycle.getActive();
  lifecycle.updateActive({ draft: "Work in progress." });
  lifecycle.flushSync();
  // flushSync is fire-and-forget; await the microtask queue for the put.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await backend.get(active.id))?.draft, "Work in progress.");
  assert.equal(lifecycle.hasPendingWrites(), false);
});

test("autosave snapshots stay rate-limited while manual checkpoints always record", async () => {
  const { lifecycle } = createLifecycle();
  await lifecycle.load();
  lifecycle.updateActive({ draft: "draft one" }, "autosave");
  const afterFirst = lifecycle.getActive();
  assert.equal(afterFirst.snapshots.length, 1);
  lifecycle.updateActive({ draft: "draft two" }, "autosave");
  assert.equal(lifecycle.getActive().snapshots.length, 1, "rapid autosave does not pile up snapshots");
  lifecycle.updateActive({ draft: "draft three" }, "manual");
  assert.equal(lifecycle.getActive().snapshots.length, 2, "manual checkpoint always records");
});

test("version restore returns an earlier draft and checkpoints the current one first", async () => {
  const { lifecycle } = createLifecycle();
  await lifecycle.load();
  lifecycle.updateActive({ draft: "original body text" }, "manual");
  const checkpoint = lifecycle.getActive().snapshots[0];
  lifecycle.updateActive({ draft: "rewritten beyond recognition" }, "manual");

  assert.equal(lifecycle.restoreSnapshot(lifecycle.activeId, checkpoint.id), true);
  const active = lifecycle.getActive();
  assert.equal(active.draft, "original body text");
  // The pre-restore state is checkpointed, so restoring is itself reversible.
  assert.ok(active.snapshots.some((snapshot) => snapshot.text === "rewritten beyond recognition"));
  assert.equal(lifecycle.restoreSnapshot(lifecycle.activeId, "missing"), false);
});

test("duplicating a snapshot into a new document opens it and keeps the original intact", async () => {
  const { lifecycle } = createLifecycle();
  await lifecycle.load();
  lifecycle.updateActive({ title: "Essay", draft: "original essay body" }, "manual");
  const checkpoint = lifecycle.getActive().snapshots[0];
  lifecycle.updateActive({ draft: "revised essay body" });

  const copy = lifecycle.duplicateSnapshot(lifecycle.activeId, checkpoint.id);
  assert.ok(copy);
  assert.equal(copy.title, "Essay (restored)");
  assert.equal(copy.draft, "original essay body");
  assert.equal(lifecycle.activeId, copy.id);
  const original = lifecycle.documents.find((document) => document.title === "Essay");
  assert.equal(original.draft, "revised essay body", "original document keeps its current draft");
});

test("clear all local data removes every stored surface and starts clean", async () => {
  const backend = new LocalStorageDocumentBackend(storage(), DOCUMENTS_LOCAL_STORAGE_KEY);
  const scratch = storage({
    "draftwise:workspace:v2": JSON.stringify({ version: 2 }),
    "draftwise:draft": "legacy",
    [DOCUMENTS_LOCAL_STORAGE_KEY]: JSON.stringify([{ id: "doc-1", title: "Old", draft: "Old secret text" }]),
  });
  let memoryCleared = false;
  const result = await clearAllLocalData({
    storage: scratch,
    documentBackend: backend,
    deleteIndexedDb: async () => { memoryCleared = true; },
    onClearMemory: () => { memoryCleared = true; },
  });
  assert.equal(result.ok, true);
  assert.equal(scratch.getItem("draftwise:workspace:v2"), null);
  assert.equal(scratch.getItem("draftwise:draft"), null);
  assert.equal(scratch.getItem(DOCUMENTS_LOCAL_STORAGE_KEY), null);
  assert.equal((await backend.list()).length, 0);
  assert.equal(memoryCleared, true);
});

test("clear all local data leaves no credentials behind", async () => {
  const scratch = storage({
    "draftwise:workspace:v2": JSON.stringify({ version: 2, provider: { apiKey: "sk-secret" } }),
  });
  const result = await clearAllLocalData({ storage: scratch, documentBackend: new MemoryDocumentBackend() });
  assert.equal(result.ok, true);
  for (const key of ["draftwise:workspace:v2", "draftwise:draft", "draftwise:goals", "draftwise:provider", "draftwise:theme", "draftwise:ai-enabled", DOCUMENTS_LOCAL_STORAGE_KEY]) {
    assert.equal(scratch.getItem(key), null, `key ${key} must be removed`);
  }
});

test("after clear all, reloading does not restore old documents", async () => {
  const scratch = storage();
  const backend = new LocalStorageDocumentBackend(scratch, DOCUMENTS_LOCAL_STORAGE_KEY);
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  lifecycle.updateActive({ draft: "Should disappear." });
  await lifecycle.flush();
  assert.equal((await backend.list()).length, 1);

  await clearAllLocalData({ storage: scratch, documentBackend: backend, deleteIndexedDb: async () => {} });

  // Reload simulation: a fresh lifecycle over the same storage must start clean.
  const fresh = new DocumentLifecycle(new LocalStorageDocumentBackend(scratch, DOCUMENTS_LOCAL_STORAGE_KEY), seed);
  await fresh.load();
  assert.equal(fresh.documents.length, 1);
  assert.equal(fresh.getActive().draft, "");
  assert.notEqual(fresh.getActive().draft, "Should disappear.");
});
