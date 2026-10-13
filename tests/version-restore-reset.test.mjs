import test from "node:test";
import assert from "node:assert/strict";

// Version restore replaces a document's text in place, keeping the same document
// id. These tests pin what the store guarantees about that, because the UI relies
// on it: the opened-finding override must be reset to the restored text, and the
// restored text must be what the UI is handed to reset it with.
import { DocumentLifecycle } from "../lib/document-lifecycle.ts";

function memoryBackend(seed = []) {
  const rows = new Map(seed.map((document) => [document.id, document]));
  return {
    list: async () => [...rows.values()],
    get: async (id) => rows.get(id) ?? null,
    put: async (document) => { rows.set(document.id, document); },
    delete: async (id) => { rows.delete(id); },
  };
}

test("restoreSnapshot replaces the text but keeps the document identity", () => {
  const backend = memoryBackend();
  const store = new DocumentLifecycle(backend, { title: "Untitled", draft: "" });
  const created = store.createNew("Draft", "first version of the text");
  const id = created?.id ?? "";
  assert.ok(id, "a document should have been created");

  store.updateActive({ draft: "second version, much longer than the first" });
  store.saveSnapshot("manual");
  store.updateActive({ draft: "third version, the one being abandoned" });

  const snapshots = store.findById(id)?.snapshots ?? [];
  assert.ok(snapshots.length > 0, "a snapshot should exist to restore");

  const target = snapshots[0];
  const restored = store.restoreSnapshot(id, target.id);
  assert.equal(restored, true, "restore should succeed");

  const after = store.findById(id);
  assert.equal(after?.id, id, "the document id must not change across a restore");
  assert.equal(after?.draft, target.text, "the draft must become the snapshot text");
});

test("the snapshot text is what the UI resets its override against", () => {
  // The UI calls resetUnhidden(snapshot.text). If the store restored different
  // text than the snapshot carries, the override baseline would be wrong and a
  // stale id could survive into the restored draft.
  const backend = memoryBackend();
  const store = new DocumentLifecycle(backend, { title: "Untitled", draft: "" });
  const created = store.createNew("Draft", "original wording here");
  const id = created?.id ?? "";
  store.updateActive({ draft: "edited wording, different length entirely" });
  store.saveSnapshot("manual");

  const snapshot = (store.findById(id)?.snapshots ?? [])[0];
  assert.ok(snapshot);
  store.restoreSnapshot(id, snapshot.id);

  // The draft becomes exactly the snapshot's text, which is the value handed to
  // resetUnhidden — so the override baseline always matches what the editor shows.
  assert.equal(store.findById(id)?.draft, snapshot.text);
  assert.equal(snapshot.text, "edited wording, different length entirely");
});

test("restoring twice is stable and does not accumulate drift", () => {
  const backend = memoryBackend();
  const store = new DocumentLifecycle(backend, { title: "Untitled", draft: "" });
  const created = store.createNew("Draft", "baseline text");
  const id = created?.id ?? "";
  store.saveSnapshot("manual");
  const snapshot = (store.findById(id)?.snapshots ?? [])[0];

  store.updateActive({ draft: "changed once" });
  store.restoreSnapshot(id, snapshot.id);
  const first = store.findById(id)?.draft;
  store.updateActive({ draft: "changed again" });
  store.restoreSnapshot(id, snapshot.id);
  const second = store.findById(id)?.draft;

  assert.equal(first, second, "restoring the same snapshot must be deterministic");
  assert.equal(second, "baseline text");
});
