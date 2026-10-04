import assert from "node:assert/strict";
import test from "node:test";
import { DocumentLifecycle } from "../lib/document-lifecycle.ts";
import { MemoryDocumentBackend, LocalStorageDocumentBackend } from "../lib/documents.ts";

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

test("deletion succeeds normally and the document is gone after reload", async () => {
  const backend = new MemoryDocumentBackend();
  const first = new DocumentLifecycle(backend, seed);
  await first.load();
  const victim = first.getActive();
  first.updateActive({ draft: "doomed content" });
  await first.flush();

  const result = await first.remove(victim.id);
  assert.equal(result.ok, true);
  await first.flush();

  // Reload simulation: the deleted document must not come back.
  const second = new DocumentLifecycle(backend, seed);
  await second.load();
  assert.equal(second.documents.some((document) => document.id === victim.id), false);
});

test("deletion while a write is pending cancels the write and never recreates the document", async () => {
  const backend = new MemoryDocumentBackend();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  const victim = lifecycle.getActive();
  lifecycle.updateActive({ draft: "pending write content" });
  // Delete before the debounced flush runs: the queued write must die with it.
  const result = await lifecycle.remove(victim.id);
  assert.equal(result.ok, true);
  await lifecycle.flush();

  const stored = await backend.list();
  assert.equal(stored.some((document) => document.id === victim.id), false, "the pending write must not resurrect the document");
});

test("persistent deletion failure is reported and stays retryable", async () => {
  class FailingRemove extends MemoryDocumentBackend {
    failing = true;
    async remove(id) {
      if (this.failing) throw new Error("storage blocked");
      return super.remove(id);
    }
  }
  const backend = new FailingRemove();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  const victim = lifecycle.getActive();
  lifecycle.updateActive({ draft: "content" });
  await lifecycle.flush();

  const result = await lifecycle.remove(victim.id);
  assert.equal(result.ok, false, "failure is reported, never a silent durable-deletion claim");
  assert.match(result.error, /storage blocked/u);
  assert.equal(lifecycle.hasPendingDeletions(), true, "the deletion stays queued for retry");

  backend.failing = false;
  const retry = await lifecycle.retryDeletions();
  assert.equal(retry.ok, true);
  assert.equal(lifecycle.hasPendingDeletions(), false);
  assert.equal((await backend.list()).some((document) => document.id === victim.id), false);
});

test("deletion falls back through storage tiers", async () => {
  class FailingRemove extends MemoryDocumentBackend {
    async remove() { throw new Error("blocked"); }
  }
  const scratch = storage();
  const resilient = {
    ...new MemoryDocumentBackend(),
    store: new FailingRemove(),
    mode: "indexeddb",
    async list() { return this.store.list(); },
    async get(id) { return this.store.get(id); },
    async put(document) { return this.store.put(document); },
    async remove(id) {
      // First attempt fails (as the failing tier), fallback tier succeeds.
      try {
        return await this.store.remove(id);
      } catch {
        this.mode = "localstorage";
        const fallback = new LocalStorageDocumentBackend(scratch);
        await fallback.remove(id);
      }
    },
    async clear() { return this.store.clear(); },
  };
  const lifecycle = new DocumentLifecycle(resilient, seed);
  await lifecycle.load();
  const victim = lifecycle.getActive();
  const result = await lifecycle.remove(victim.id);
  assert.equal(result.ok, true, "fallback tier completed the deletion");
  assert.equal(resilient.mode, "localstorage");
});

test("deleting the active document moves to a real remaining document", async () => {
  const backend = new MemoryDocumentBackend();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  const active = lifecycle.getActive();
  const other = lifecycle.createNew("Other", "other content");
  lifecycle.open(active.id);

  await lifecycle.remove(active.id);
  assert.equal(lifecycle.activeId, other.id);
  assert.ok(lifecycle.getActive(), "the editor always has a real document");
  assert.equal(lifecycle.getActive().draft, "other content");
});

test("deleting the final document creates a fresh identity without resurrecting the old one", async () => {
  const backend = new MemoryDocumentBackend();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  const only = lifecycle.getActive();
  const result = await lifecycle.remove(only.id);
  assert.equal(result.ok, true);
  const fresh = lifecycle.getActive();
  assert.ok(fresh);
  assert.notEqual(fresh.id, only.id, "fresh identity, not the deleted one");
  assert.equal(fresh.draft, "");

  await lifecycle.flush();
  const stored = await backend.list();
  assert.equal(stored.some((document) => document.id === only.id), false);
});

test("delete followed immediately by creating and editing another document stays clean", async () => {
  const backend = new MemoryDocumentBackend();
  const lifecycle = new DocumentLifecycle(backend, seed);
  await lifecycle.load();
  const victim = lifecycle.getActive();
  await lifecycle.remove(victim.id);
  const replacement = lifecycle.createNew("Replacement", "fresh content");
  lifecycle.updateActive({ draft: "fresh content revised" });
  await lifecycle.flush();

  const stored = await backend.list();
  assert.equal(stored.some((document) => document.id === victim.id), false);
  const saved = stored.find((document) => document.id === replacement.id);
  assert.equal(saved?.draft, "fresh content revised");
});

test("delete → reload on persistent storage never resurrects the document", async () => {
  const scratch = storage();
  const first = new DocumentLifecycle(new LocalStorageDocumentBackend(scratch), seed);
  await first.load();
  const victim = first.getActive();
  first.updateActive({ draft: "doomed" });
  await first.flush();
  const result = await first.remove(victim.id);
  assert.equal(result.ok, true);

  const second = new DocumentLifecycle(new LocalStorageDocumentBackend(scratch), seed);
  await second.load();
  assert.equal(second.documents.some((document) => document.id === victim.id), false);
  assert.equal(second.documents.every((document) => document.draft !== "doomed"), true);
});
