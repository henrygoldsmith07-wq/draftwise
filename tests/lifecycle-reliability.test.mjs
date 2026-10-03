import assert from "node:assert/strict";
import test from "node:test";
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
  await lifecycle.flush();
  assert.equal(lifecycle.getSnapshot().saveStatus, "error", "failure is reported, never 'saved'");
  assert.equal(lifecycle.hasPendingWrites(), true, "the write stays queued");
  assert.equal((await backend.get(active.id))?.draft, "", "nothing half-written is claimed as saved");

  backend.failing = false;
  await lifecycle.flush();
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
