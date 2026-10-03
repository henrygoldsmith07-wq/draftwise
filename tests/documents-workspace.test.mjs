import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryDocumentBackend,
  LocalStorageDocumentBackend,
  countWords,
  createDocument,
  recordSnapshot,
  sanitiseStoredDocument,
  summariseDocuments,
  MAX_SNAPSHOTS_PER_DOCUMENT,
} from "../lib/documents.ts";
import { exportAsMarkdown, exportAsText, importDocument, titleFromFilename } from "../lib/import-export.ts";
import { rewriteActionsFor, significantRewriteInstruction } from "../lib/rewrite-actions.ts";

const goals = (audience, intent = "inform", tone = "professional") => ({ audience, intent, tone });

test("documents count words, summarise by recency, and search titles and text", () => {
  const older = { ...createDocument("Quarterly report", "Revenue grew twelve percent."), updatedAt: 1_000 };
  const newer = { ...createDocument("Essay", "Attention is generosity."), updatedAt: 2_000 };
  const summaries = summariseDocuments([older, newer]);
  assert.deepEqual(summaries.map((item) => item.title), ["Essay", "Quarterly report"]);
  assert.equal(summaries[1].wordCount, 4);
  assert.deepEqual(summariseDocuments([older, newer], "revenue").map((item) => item.title), ["Quarterly report"]);
  assert.equal(countWords("  one   two three "), 3);
});

test("autosave snapshots are rate-limited but manual snapshots always record", () => {
  let document = createDocument("Doc", "first draft", 1_000);
  document = recordSnapshot(document, "autosave", 1_000);
  assert.equal(document.snapshots.length, 1);
  const quickEdit = { ...document, draft: "first draft edited", updatedAt: 1_200 };
  assert.equal(recordSnapshot(quickEdit, "autosave", 1_200).snapshots.length, 1);
  const slowEdit = { ...document, draft: "first draft revised", updatedAt: 60_000 };
  assert.equal(recordSnapshot(slowEdit, "autosave", 60_000).snapshots.length, 2);
  const manual = { ...quickEdit, draft: "manual save point" };
  assert.equal(recordSnapshot(manual, "manual", 1_300).snapshots.length, 2);
});

test("snapshot history stays bounded regardless of how often it is saved", () => {
  let document = createDocument("Doc", "draft", 0);
  for (let index = 0; index < MAX_SNAPSHOTS_PER_DOCUMENT + 5; index += 1) {
    document = { ...document, draft: `draft ${index}` };
    document = recordSnapshot(document, "manual", index * 1_000);
  }
  assert.equal(document.snapshots.length, MAX_SNAPSHOTS_PER_DOCUMENT);
});

test("the memory and localStorage document backends round-trip and delete documents", async () => {
  for (const backend of [new MemoryDocumentBackend(), new LocalStorageDocumentBackend(storage())]) {
    const document = createDocument("Report", "The report body.");
    await backend.put(document);
    assert.equal((await backend.get(document.id))?.title, "Report");
    assert.equal((await backend.list()).length, 1);
    await backend.remove(document.id);
    assert.equal((await backend.get(document.id)), null);
  }
});

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("corrupted stored documents are rejected or repaired instead of crashing", () => {
  assert.equal(sanitiseStoredDocument(null), null);
  assert.equal(sanitiseStoredDocument("not-an-object"), null);
  assert.equal(sanitiseStoredDocument({ title: "no id" }), null);
  const repaired = sanitiseStoredDocument({ id: "doc-1", title: 42, draft: "hello world", createdAt: "bad", snapshots: [{ text: "saved" }, { bogus: true }] });
  assert.equal(repaired.title, "Untitled draft");
  assert.equal(repaired.wordCount, 2);
  assert.equal(repaired.snapshots.length, 1);
  assert.equal(sanitiseStoredDocument({ id: "doc-2", title: "T", draft: "", snapshots: [{ text: "a" }] })?.snapshots.length, 1);
});

test("import accepts text and markdown but rejects oversized or binary content", () => {
  const text = importDocument("notes.txt", "Just some words.");
  assert.equal(text.ok, true);
  assert.equal(text.format, "text");
  assert.equal(text.title, "notes");
  const markdown = importDocument("meeting-notes.md", "# Heading\n\nBody");
  assert.equal(markdown.ok, true);
  assert.equal(markdown.format, "markdown");
  assert.equal(importDocument("huge.txt", "x".repeat(600_000)).ok, false);
  assert.equal(importDocument("image.png", "PNG\u0000\u0001\u0002data").ok, false);
  assert.equal(titleFromFilename("my_draft-final.md"), "my draft final");
});

test("export keeps text verbatim and adds a heading to bare markdown", () => {
  assert.equal(exportAsText("Report", "Body").content, "Body");
  assert.equal(exportAsMarkdown("Report", "Body").content, "# Report\n\nBody");
  assert.equal(exportAsMarkdown("Report", "# Already headed").content, "# Already headed");
  assert.equal(exportAsText("a/b:c*?\"<>|", "x").filename, "a-b-c-.txt");
});

test("rewrite actions adapt to audience, intent, and selection size", () => {
  const academic = rewriteActionsFor("a precise claim about method and findings", goals("academic", "explain", "formal"));
  assert.ok(academic.some((action) => action.label === "Strengthen argument"));
  assert.ok(academic.some((action) => action.label === "Explain more simply"));
  assert.ok(academic.some((action) => action.label === "Fix grammar"));
  const casual = rewriteActionsFor("hey can you check this", goals("casual", "describe", "casual"));
  assert.ok(casual.some((action) => action.label === "Make more natural"));
  assert.equal(casual.some((action) => action.label === "Make more formal"), false);
  const long = rewriteActionsFor("word ".repeat(60), goals("professional", "inform", "professional"));
  assert.ok(long.some((action) => action.label === "Remove repetition"));
  const short = rewriteActionsFor("two words", goals("professional", "inform", "professional"));
  assert.equal(short.some((action) => action.label === "Remove repetition"), false);
  assert.ok(short.some((action) => action.label === "Expand"));
});

test("significant rewrites ask for meaningful alternatives", () => {
  const instruction = significantRewriteInstruction("Improve clarity while preserving the exact meaning");
  assert.match(instruction, /2 meaningfully different alternatives/u);
});

test("every adaptive action carries a distinct label and an instruction", () => {
  const actions = rewriteActionsFor("a selection of text with several words in it", goals("technical", "explain", "neutral"));
  const labels = actions.map((action) => action.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(actions.every((action) => action.instruction.length > 10));
  assert.ok(actions.some((action) => action.significant));
});
