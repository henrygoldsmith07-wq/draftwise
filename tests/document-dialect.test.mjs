import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryDocumentBackend,
  createDocument,
  resolveDocumentStyle,
  sanitiseStoredDocument,
  summariseDocuments,
} from "../lib/documents.ts";
import { DocumentLifecycle } from "../lib/document-lifecycle.ts";
import { DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

const seed = { title: "Untitled draft", draft: "" };

test("resolveDocumentStyle overlays the document dialect and falls back cleanly", () => {
  const base = { ...DEFAULT_STYLE_PREFERENCES, dialect: "en-GB" };
  const overlaid = resolveDocumentStyle(base, "en-US");
  assert.equal(overlaid.dialect, "en-US");
  assert.equal(base.dialect, "en-GB");
  // No overlay needed: return the same object so memoised consumers stay stable.
  assert.equal(resolveDocumentStyle(base, "en-GB"), base);
  assert.equal(resolveDocumentStyle(base, undefined), base);
});

test("sanitise keeps a valid dialect and drops a bogus one without losing the document", () => {
  assert.equal(sanitiseStoredDocument({ id: "a", draft: "Text.", dialect: "en-US" })?.dialect, "en-US");
  const dropped = sanitiseStoredDocument({ id: "b", draft: "Text.", dialect: "en-AU" });
  assert.equal(dropped?.draft, "Text.");
  assert.equal(dropped?.dialect, undefined);
  assert.equal(sanitiseStoredDocument({ id: "c", draft: "Text." })?.dialect, undefined);
});

test("each document keeps its own dialect while the other is edited", async () => {
  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), seed);
  await lifecycle.load();
  const first = lifecycle.getActive();
  lifecycle.updateActive({ dialect: "en-US" });

  const second = lifecycle.createNew("Second", "Second body.", undefined, "en-GB");
  assert.equal(lifecycle.getActive()?.dialect, "en-GB");

  lifecycle.open(first.id);
  assert.equal(lifecycle.getActive()?.dialect, "en-US");

  lifecycle.updateActive({ dialect: "en-GB" });
  lifecycle.open(second.id);
  assert.equal(lifecycle.getActive()?.dialect, "en-GB");
  await lifecycle.flush();
});

test("a dialect survives a reload and travels with duplicates", async () => {
  const backend = new MemoryDocumentBackend();
  const first = new DocumentLifecycle(backend, seed);
  await first.load();
  const active = first.getActive();
  first.updateActive({ dialect: "en-US" });
  await first.flush();

  const second = new DocumentLifecycle(backend, seed);
  await second.load();
  assert.equal(second.getDocument(active.id)?.dialect, "en-US");

  const copy = second.duplicate(active.id);
  assert.ok(copy);
  assert.equal(copy.dialect, "en-US");
});

test("createDocument stores the dialect and summaries carry it", () => {
  const document = createDocument("Doc", "Body.", Date.now(), undefined, "en-US");
  assert.equal(document.dialect, "en-US");
  const summaries = summariseDocuments([document]);
  assert.equal(summaries[0].dialect, "en-US");
  const plain = summariseDocuments([createDocument("Plain", "Body.")]);
  assert.equal(plain[0].dialect, undefined);
});
