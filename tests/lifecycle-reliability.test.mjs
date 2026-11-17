import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DocumentHistoryStore, HISTORY_CHAR_BUDGET_PER_DOCUMENT, HISTORY_LIMIT_PER_DOCUMENT } from "../lib/document-history.ts";
import { DocumentLifecycle } from "../lib/document-lifecycle.ts";
import { MemoryDocumentBackend, ResilientDocumentBackend, LocalStorageDocumentBackend } from "../lib/documents.ts";

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

// --- P0: undo can never cross document boundaries ---

test("edit A, switch to B, edit B, undo: B returns to its own previous state and A is untouched", () => {
  const history = new DocumentHistoryStore();
  history.open("doc-a", "A original");
  history.commit("doc-a", "A edited");
  history.open("doc-b", "B original");
  history.commit("doc-b", "B edited");

  const undone = history.undo("doc-b");
  assert.equal(undone, "B original", "undo in B restores B's own previous state");
  assert.equal(history.undo("doc-a"), "A original", "A's history is independent");
  assert.notEqual(undone, "A edited", "A's text can never appear via B's undo");
});

test("edit A, switch to B, undo immediately: text from A never appears", () => {
  const history = new DocumentHistoryStore();
  history.open("doc-a", "A original");
  history.commit("doc-a", "A edited text");
  history.open("doc-b", "B original");
  // Undo in B without any B edit: nothing to undo, and certainly not A's text.
  assert.equal(history.undo("doc-b"), null, "B has no undo steps of its own yet");
  assert.equal(history.snapshot("doc-b").canUndo, false);
});

test("a new document starts with one blank state: undo cannot reach the previous document", () => {
  const history = new DocumentHistoryStore();
  history.open("doc-a", "Secret essay content");
  history.commit("doc-a", "More secret content");
  history.open("doc-new", "");
  assert.equal(history.undo("doc-new"), null);
  assert.equal(history.snapshot("doc-new").canUndo, false);
  assert.equal(history.snapshot("doc-new").values, 1);
});

test("import and duplicate start from their own text as the sole initial state", () => {
  const history = new DocumentHistoryStore();
  history.open("doc-imported", "Imported markdown body");
  history.open("doc-copy", "Copied body");
  assert.equal(history.snapshot("doc-imported").values, 1);
  assert.equal(history.snapshot("doc-copy").values, 1);
  assert.equal(history.undo("doc-imported"), null);
  assert.equal(history.undo("doc-copy"), null);
});

test("opening another document never appends to the previous document's undo chain", () => {
  const history = new DocumentHistoryStore();
  history.open("doc-a", "A text v1");
  history.commit("doc-a", "A text v2");
  const beforeA = history.snapshot("doc-a");
  history.open("doc-b", "B text v1");
  history.open("doc-a", "A text v2");
  assert.equal(history.snapshot("doc-a").values, beforeA.values, "reopening A adds no state");
});

test("delete cleans the deleted document's history; clear-all removes every history", () => {
  const history = new DocumentHistoryStore();
  history.open("doc-a", "A");
  history.open("doc-b", "B");
  history.remove("doc-a");
  assert.equal(history.snapshot("doc-a").values, 0);
  assert.equal(history.undo("doc-a"), null);
  history.clear();
  assert.equal(history.snapshot("doc-b").values, 0);
});

test("histories stay bounded by count and character budget", () => {
  const history = new DocumentHistoryStore();
  history.open("doc", "start");
  for (let index = 0; index < HISTORY_LIMIT_PER_DOCUMENT + 20; index += 1) {
    history.commit("doc", `state ${index}`);
  }
  assert.ok(history.snapshot("doc").values <= HISTORY_LIMIT_PER_DOCUMENT, "count-bounded");

  const budgeted = new DocumentHistoryStore();
  budgeted.open("big", "x");
  const heavy = "y".repeat(Math.floor(HISTORY_CHAR_BUDGET_PER_DOCUMENT / 3));
  budgeted.commit("big", heavy);
  budgeted.commit("big", `${heavy}2`);
  budgeted.commit("big", `${heavy}3`);
  assert.ok(budgeted.snapshot("big").values <= 3);
  const totalChars = budgeted.histories.get("big").values.reduce((sum, value) => sum + value.length, 0);
  assert.ok(totalChars <= HISTORY_CHAR_BUDGET_PER_DOCUMENT + heavy.length, "budget-bounded with newest always kept");
});

test("version restore produces a sensible undo state: restore is itself recoverable", () => {
  const history = new DocumentHistoryStore();
  history.open("doc", "original");
  history.commit("doc", "current draft");
  history.reset("doc", ["current draft", "restored content"]);
  assert.equal(history.undo("doc"), "current draft", "undo after restore returns the pre-restore draft");
  assert.equal(history.redo("doc"), "restored content");
});

test("restore history stays in range when more states than the limit are reset", () => {
  const history = new DocumentHistoryStore();
  history.open("doc", "original");
  const texts = Array.from({ length: HISTORY_LIMIT_PER_DOCUMENT + 10 }, (_, index) => `state ${index}`);
  history.reset("doc", texts);
  const snapshot = history.snapshot("doc");
  assert.equal(snapshot.values, HISTORY_LIMIT_PER_DOCUMENT);
  assert.ok(snapshot.index >= 0 && snapshot.index < HISTORY_LIMIT_PER_DOCUMENT,
    "the current index must point inside the trimmed history");
  assert.equal(history.undo("doc"), texts[texts.length - 2],
    "undo after a large restore returns real text, not undefined");
});

// --- P0: persistence success is truthful ---

class FailingBackend extends MemoryDocumentBackend {
  failing = false;
  async put(document) {
    if (this.failing) throw new Error("quota exceeded");
    return super.put(document);
  }
}

test("a failed write never reports saved and stays queued for retry", async () => {
  const backend = new FailingBackend();
  const lifecycle = new DocumentLifecycle(backend, { title: "Untitled draft", draft: "" });
  await lifecycle.load();
  const active = lifecycle.getActive();
  // Fail only the edit's write: the document itself already exists.
  backend.failing = true;
  lifecycle.updateActive({ draft: "Unsaved work." });
  assert.equal(await lifecycle.flush(), false, "callers can await the real write result");
  assert.equal(lifecycle.getSnapshot().saveStatus, "error", "failure is reported, never 'saved'");
  assert.equal(lifecycle.hasPendingWrites(), true, "the write stays queued");
  assert.equal((await backend.get(active.id))?.draft, "", "nothing half-written is claimed as saved");

  backend.failing = false;
  assert.equal(await lifecycle.flush(), true);
  assert.equal(lifecycle.getSnapshot().saveStatus, "saved");
  assert.equal((await backend.get(active.id))?.draft, "Unsaved work.");
});

test("two documents with out-of-order pending writes stay keyed by id", async () => {
  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), { title: "Untitled draft", draft: "" });
  await lifecycle.load();
  const first = lifecycle.getActive();
  lifecycle.updateActive({ draft: "FIRST-TEXT" });
  const second = lifecycle.createNew("Second", "SECOND-TEXT");
  lifecycle.updateActive({ draft: "SECOND-TEXT-REVISED" });
  lifecycle.open(first.id);
  lifecycle.updateActive({ draft: "FIRST-TEXT-REVISED" });
  await lifecycle.flush();
  assert.equal((lifecycle.getDocument(first.id)).draft, "FIRST-TEXT-REVISED");
  assert.equal((lifecycle.getDocument(second.id)).draft, "SECOND-TEXT-REVISED");
});

test("a slow backend completing after a switch cannot overwrite the wrong document", async () => {
  const deferred = [];
  class SlowBackend extends MemoryDocumentBackend {
    slow = false;
    async put(document) {
      if (this.slow) await new Promise((resolve) => deferred.push(resolve));
      return super.put(document);
    }
  }
  const backend = new SlowBackend();
  const lifecycle = new DocumentLifecycle(backend, { title: "Untitled draft", draft: "" });
  await lifecycle.load();
  backend.slow = true;
  const first = lifecycle.getActive();
  lifecycle.updateActive({ draft: "A content queued" });
  const flushA = lifecycle.flush();
  const second = lifecycle.createNew("B", "B content");
  lifecycle.updateActive({ draft: "B content revised" });
  const flushB = lifecycle.flush();
  // Complete the writes out of order.
  deferred.reverse().forEach((resolve) => resolve());
  await Promise.all([flushA, flushB]);
  assert.equal((await backend.get(first.id))?.draft, "A content queued");
  assert.equal((await backend.get(second.id))?.draft, "B content revised");
});

test("a failed write cannot replace a newer queued version of the same document", async () => {
  class SelectiveFailBackend extends MemoryDocumentBackend {
    rejectDrafts = new Set();
    async put(document) {
      if (this.rejectDrafts.has(document.draft)) throw new Error("quota exceeded");
      return super.put(document);
    }
  }
  const backend = new SelectiveFailBackend();
  const lifecycle = new DocumentLifecycle(backend, { title: "Untitled draft", draft: "" });
  await lifecycle.load();
  const active = lifecycle.getActive();
  backend.rejectDrafts.add("v1");
  lifecycle.updateActive({ draft: "v1" });
  const firstFlush = lifecycle.flush();
  // A newer edit lands while the rejected write is still in flight.
  lifecycle.updateActive({ draft: "v2" });
  await firstFlush;
  assert.equal(lifecycle.hasPendingWrites(), true, "the failed v1 write stays queued");
  backend.rejectDrafts.clear();
  await lifecycle.flush();
  assert.equal((await backend.get(active.id))?.draft, "v2", "the newest text is what gets persisted");
});

test("a stale in-flight write that fails cannot requeue over a newer written version", async () => {
  const held = [];
  class DeferredFailBackend extends MemoryDocumentBackend {
    holdDraft = null;
    rejectDraft = null;
    async put(document) {
      if (document.draft === this.holdDraft) {
        await new Promise((resolve) => held.push({ document, resolve }));
      }
      if (document.draft === this.rejectDraft) throw new Error("quota exceeded");
      return super.put(document);
    }
  }
  const backend = new DeferredFailBackend();
  const lifecycle = new DocumentLifecycle(backend, { title: "Untitled draft", draft: "" });
  await lifecycle.load();
  const active = lifecycle.getActive();

  // v2 is held in flight and will reject. While it is held, v3 is queued and
  // written successfully by a second flush, leaving nothing in `pending`.
  backend.holdDraft = "v2";
  backend.rejectDraft = "v2";
  lifecycle.updateActive({ draft: "v2" });
  const staleFlush = lifecycle.flush();
  lifecycle.updateActive({ draft: "v3" });
  assert.equal(await lifecycle.flush(), true, "v3 is written while v2 is still in flight");

  const pending = held.find((entry) => entry.document.draft === "v2");
  assert.ok(pending, "v2's write is still waiting");
  pending.resolve();
  await staleFlush;

  // The old v2 rejection arrived after a newer version was already persisted;
  // it must not requeue v2 and become the next write that overwrites v3.
  assert.equal(lifecycle.hasPendingWrites(), false);
  await lifecycle.flush();
  assert.equal((await backend.get(active.id))?.draft, "v3", "the newest text survives the stale rejection");
});

test("clear-all awaits the live store reset before sweeping storage", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const clear = page.match(/const clearLocalData = useCallback\(async \(\) => \{[\s\S]*?historyStore\.clear\(\);/u);
  assert.ok(clear, "clearLocalData should be async");
  // A fire-and-forget reset could persist its fresh seed after the sweep had
  // removed the fallback key, leaving a document behind after "clear all".
  assert.match(clear[0], /await documents\.clearAll\(\{ title: "Untitled draft", draft: "" \}\)/u);
  assert.match(clear[0], /await clearAllLocalData\(\{ documentBackend: documents\.backend \}\)/u);
  assert.doesNotMatch(clear[0], /onClearMemory/u);
});

test("the canonical save waits for document writes before reporting success", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const saveAll = page.match(/const saveAll = useCallback\(async \(\) => \{[\s\S]*?\}, \[documents, saveNow\]\)/u);
  assert.ok(saveAll, "saveAll should be the async canonical save");
  // Read synchronously from a stale React state snapshot, the old version
  // reported success even when the awaited document write had failed.
  assert.match(saveAll[0], /await documents\.flush\(\)/u);
  assert.match(saveAll[0], /writesSucceeded/u);
});

test("flushSync keeps a rejected exit write queued for the next flush", async () => {
  class FailOnceBackend extends MemoryDocumentBackend {
    failNext = true;
    async put(document) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("quota exceeded");
      }
      return super.put(document);
    }
  }
  const backend = new FailOnceBackend();
  const lifecycle = new DocumentLifecycle(backend, { title: "Untitled draft", draft: "" });
  await lifecycle.load();
  const active = lifecycle.getActive();
  // load() writes the seed document, so arm the failure only after hydration.
  backend.failNext = true;
  lifecycle.updateActive({ draft: "Work from this tab" });
  lifecycle.flushSync();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifecycle.hasPendingWrites(), true,
    "a rejected exit write must not vanish just because the tab was left");
  await lifecycle.flush();
  assert.equal((await backend.get(active.id))?.draft, "Work from this tab");
});

// --- P0: IndexedDB failure falls back safely ---

test("resilient backend falls back to localStorage when writes fail, preserving documents", async () => {
  class AlwaysFailing {
    mode = "indexeddb";
    async list() { throw new Error("blocked"); }
    async get() { throw new Error("blocked"); }
    async put() { throw new Error("blocked"); }
    async remove() { throw new Error("blocked"); }
    async clear() { throw new Error("blocked"); }
  }
  const scratch = storage();
  const resilient = new ResilientDocumentBackend(scratch);
  // Force the failing tier in.
  resilient.current = new AlwaysFailing();
  await resilient.put({ id: "doc-1", title: "Essay", draft: "Draft text", createdAt: 1, updatedAt: 1, wordCount: 2, snapshots: [] });
  assert.equal(resilient.mode, "localstorage", "fell back to localStorage");
  const restored = await resilient.list();
  assert.equal(restored.length, 1, "the document survived the tier change");
  assert.equal(restored[0].draft, "Draft text");
});

test("resilient backend degrades to memory when localStorage is also unavailable", async () => {
  class ExplodingStorage {
    getItem() { throw new Error("denied"); }
    setItem() { throw new Error("denied"); }
    removeItem() { throw new Error("denied"); }
  }
  class AlwaysFailing {
    mode = "indexeddb";
    async list() { throw new Error("blocked"); }
    async get() { throw new Error("blocked"); }
    async put() { throw new Error("blocked"); }
    async remove() { throw new Error("blocked"); }
    async clear() { throw new Error("blocked"); }
  }
  const resilient = new ResilientDocumentBackend(new ExplodingStorage());
  resilient.current = new AlwaysFailing();
  await resilient.put({ id: "doc-1", title: "Essay", draft: "Memory only", createdAt: 1, updatedAt: 1, wordCount: 2, snapshots: [] });
  assert.equal(resilient.mode, "memory", "memory-only is reported, never claimed as persistent");
  const documents = await resilient.list();
  assert.equal(documents[0]?.draft, "Memory only", "the write is kept in memory rather than lost");
});

test("a fallback tier is remembered so a stale IndexedDB copy cannot shadow newer work", async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = { open: () => { throw new Error("blocked"); } };
  const scratch = storage();
  try {
    const first = new ResilientDocumentBackend(scratch);
    assert.equal(first.mode, "indexeddb", "starts with IndexedDB while it is available");
    await first.put({
      id: "doc-1", title: "Essay", draft: "Newer fallback text",
      createdAt: 1, updatedAt: 1, wordCount: 3, snapshots: [],
    });
    assert.equal(first.mode, "localstorage", "a failed write demotes to localStorage");
    assert.equal(scratch.getItem("draftwise:documents:v1:tier"), "localstorage",
      "the chosen tier must survive a reload");

    const second = new ResilientDocumentBackend(scratch);
    assert.equal(second.mode, "localstorage", "a fresh backend honours the remembered tier");
    assert.equal((await second.list())[0]?.draft, "Newer fallback text");
  } finally {
    globalThis.indexedDB = previousIndexedDb;
  }
});

test("a failed remove does not persist an empty fallback tier", async () => {
  class FailingRemove {
    mode = "indexeddb";
    async list() { return []; }
    async get() { return null; }
    async put() {}
    async remove() { throw new Error("blocked"); }
    async clear() {}
  }
  const scratch = storage();
  const backend = new ResilientDocumentBackend(scratch);
  backend.current = new FailingRemove();
  await backend.remove("doc-1");
  // Unlike demote(), the remove fallback copies nothing. Remembering it
  // would hide an intact IndexedDB library on the next reload.
  assert.equal(scratch.getItem("draftwise:documents:v1:tier"), null);
});

test("clear-all removes the remembered tier and every tier ever used", async () => {
  class AlwaysFailing {
    mode = "indexeddb";
    async list() { throw new Error("blocked"); }
    async get() { throw new Error("blocked"); }
    async put() { throw new Error("blocked"); }
    async remove() { throw new Error("blocked"); }
    async clear() { throw new Error("blocked"); }
  }
  const scratch = storage();
  const resilient = new ResilientDocumentBackend(scratch);
  resilient.current = new AlwaysFailing();
  await resilient.put({
    id: "doc-1", title: "Essay", draft: "Draft text",
    createdAt: 1, updatedAt: 1, wordCount: 2, snapshots: [],
  });
  assert.equal(scratch.getItem("draftwise:documents:v1:tier"), "localstorage");
  await resilient.clear();
  assert.equal(scratch.getItem("draftwise:documents:v1:tier"), null,
    "a cleared library must not keep a stale tier hint");
  assert.equal((await resilient.list()).length, 0);
});

test("localStorage quota errors surface as failures rather than silent success", async () => {
  class QuotaStorage {
    getItem() { return null; }
    setItem() { throw new Error("QuotaExceededError"); }
    removeItem() {}
  }
  const backend = new LocalStorageDocumentBackend(new QuotaStorage());
  await assert.rejects(
    backend.put({ id: "doc-1", title: "T", draft: "x", createdAt: 1, updatedAt: 1, wordCount: 1, snapshots: [] }),
    /QuotaExceededError/u,
  );
});

test("replaceAll reports failure when documents can only be kept in memory", async () => {
  // put() intentionally swallows a failed write and demotes to a lower tier,
  // so a try/catch cannot see a memory-only restore. The caller reloads right
  // after a successful replace, which would drop every memory-only document.
  const doc = (id) => ({ id, title: id, draft: "text", createdAt: 1, updatedAt: 1, wordCount: 1, snapshots: [] });
  const failing = {
    mode: "indexeddb",
    async list() { return []; },
    async get() { return null; },
    async put() { throw new Error("blocked"); },
    async remove() {},
    async clear() {},
  };
  let storage = new Map();
  const localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: () => { throw new Error("quota"); },
    removeItem: (k) => storage.delete(k),
  };
  const backend = new ResilientDocumentBackend(localStorage);
  backend.current = failing;
  const lifecycle = new DocumentLifecycle(backend, { title: "Untitled draft", draft: "" });
  await lifecycle.load();
  const result = await lifecycle.replaceAll([doc("a")]);
  assert.equal(result.ok, false, "a memory-only restore must not be reported as success");
  assert.match(result.error, /durably/u);
  assert.equal(lifecycle.getSnapshot().saveStatus, "error");
});
