import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryDocumentBackend,
  LocalStorageDocumentBackend,
  countWords,
  createDocument,
  recordSnapshot,
  sanitiseStoredDocument,
  summarise,
  summariseDocuments,
  documentMatchesQuery,
  matchingExcerpt,
  MAX_SNAPSHOTS_PER_DOCUMENT,
} from "../lib/documents.ts";
import { exportAsMarkdown, exportAsText, importDocument, titleFromFilename } from "../lib/import-export.ts";
import { rewriteActionsFor, significantRewriteInstruction } from "../lib/rewrite-actions.ts";
import { MAX_TERMS_PER_LIST } from "../lib/terminology.ts";

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

test("summarise excerpt is bounded and keeps the opening of short and long drafts", () => {
  const shortDraft = "Hello   world.\n\nThis  is  a  short  draft.";
  const short = createDocument("Short", shortDraft);
  assert.equal(summarise(short).excerpt, "Hello world. This is a short draft.");

  // A long draft: the excerpt is the first 120 normalised characters, drawn
  // from the opening and never from the far tail. A marker placed well past
  // the scan window must not leak into the card.
  const opening = "The opening paragraph introduces the topic with care.\n\n";
  const longDraft = opening + "body word ".repeat(120) + "NEVER_IN_EXCERPT " + "tail word ".repeat(50);
  const long = createDocument("Long", longDraft);
  const longExcerpt = summarise(long).excerpt;
  assert.equal(longExcerpt.length, 120);
  assert.match(longExcerpt, /^The opening paragraph/u);
  assert.equal(longExcerpt.includes("NEVER_IN_EXCERPT"), false);
  // wordCount still comes from the full stored draft, never the bounded scan.
  assert.equal(summarise(long).wordCount, countWords(longDraft));
  assert.ok(long.wordCount > 120);

  // Two documents sharing a long prefix but with different far-away tails
  // produce the same excerpt: changing text past the scan window cannot
  // change the card, no matter how large the draft grows.
  const sharedPrefix = "A long shared prefix. " + "common word ".repeat(100);
  const twinA = createDocument("A", sharedPrefix + "ONLY_IN_A ".repeat(50));
  const twinB = createDocument("B", sharedPrefix + "ONLY_IN_B ".repeat(50));
  assert.equal(summarise(twinA).excerpt, summarise(twinB).excerpt);
});

test("summarise caches by document identity and recomputes after an edit", () => {
  const document = createDocument("Cache", "First version of the draft.");
  const first = summarise(document);
  // Same object identity -> same cached summary object (not just equal value).
  assert.equal(summarise(document), first);

  const edited = { ...document, draft: "Second version of the draft.", wordCount: countWords("Second version of the draft.") };
  const afterEdit = summarise(edited);
  assert.notEqual(afterEdit, first);
  assert.equal(afterEdit.excerpt, "Second version of the draft.");
  // The original document still maps to its original cached summary.
  assert.equal(summarise(document), first);
  assert.equal(first.excerpt, "First version of the draft.");

  // summariseDocuments reuses those cached summaries when rebuilding the list.
  assert.equal(summariseDocuments([document])[0], first);
  const listA = summariseDocuments([document, edited]);
  const listB = summariseDocuments([document, edited]);
  assert.equal(listA.find((item) => item.id === document.id), first);
  assert.equal(listB.find((item) => item.id === document.id), first);
  assert.equal(listA.find((item) => item.id === edited.id), listB.find((item) => item.id === edited.id));
});

test("summariseDocuments keeps full-text search and excerpt behaviour", () => {
  const opening = "Visible opening line. ";
  const buried = "the buried phrase sits far into the draft ";
  const document = createDocument("Searchable", opening + "filler ".repeat(80) + buried + "closing.");
  const summary = summarise(document);

  // The card excerpt stays the opening, even though search reaches the middle.
  assert.match(summary.excerpt, /^Visible opening line\./u);
  assert.equal(summary.excerpt.includes("buried phrase"), false);
  assert.equal(documentMatchesQuery(document, "buried phrase"), true);
  assert.deepEqual(summariseDocuments([document], "buried phrase").map((item) => item.id), [document.id]);
  assert.deepEqual(summariseDocuments([document], "not anywhere in here"), []);

  // Matching excerpts (the passage shown while searching) are unchanged.
  const match = matchingExcerpt(document, "buried phrase");
  assert.ok(match);
  assert.match(match, /buried phrase/u);
  assert.match(match, /…/u);
});

test("search reaches the middle of a long draft, not just the card's excerpt", () => {
  const opening = "An opening line that every card already shows.\n\n";
  const middle = "Somewhere in the middle, the phrase quarterly forecast appears.\n\n";
  const closing = "A closing line.\n";
  const document = createDocument("Long draft", opening + middle + closing);

  // The dashboard used to filter on title and excerpt only, so this phrase was
  // unfindable even though the input promised to search the text.
  assert.equal(documentMatchesQuery(document, "quarterly forecast"), true);
  assert.equal(documentMatchesQuery(document, "QUARTERLY"), true);
  assert.equal(documentMatchesQuery(document, "long draft"), true);
  assert.equal(documentMatchesQuery(document, "not in this draft"), false);
  assert.equal(documentMatchesQuery(document, "   "), true);

  const excerpt = matchingExcerpt(document, "quarterly forecast");
  assert.ok(excerpt);
  assert.match(excerpt, /quarterly forecast/u);
  assert.match(excerpt, /…/u);
  assert.equal(matchingExcerpt(document, "long draft"), null);
  assert.equal(matchingExcerpt(document, ""), null);
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

test("sanitiseStoredDocument bounds hostile terminology lists but keeps normal goals", () => {
  const normalGoals = {
    audience: "academic",
    intent: "explain",
    tone: "formal",
    requiredTerminology: ["API"],
    forbiddenTerminology: ["sort of"],
    preferredReplacements: { login: "sign in" },
  };
  const normal = sanitiseStoredDocument({ id: "doc-normal", title: "Normal", draft: "Body.", goals: normalGoals });
  assert.deepEqual(normal.goals, normalGoals);

  const words = (prefix) => Array.from({ length: 2_000 }, (_, index) => `${prefix}-${index}`);
  const hostile = sanitiseStoredDocument({
    id: "doc-hostile",
    title: "Hostile",
    draft: "Body.",
    goals: {
      audience: "academic",
      intent: "explain",
      tone: "formal",
      requiredTerminology: words("required"),
      forbiddenTerminology: words("forbidden"),
      preferredReplacements: Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`from-${index}`, `to-${index}`])),
    },
  });
  assert.equal(hostile.goals.requiredTerminology.length, MAX_TERMS_PER_LIST);
  assert.equal(hostile.goals.forbiddenTerminology.length, MAX_TERMS_PER_LIST);
  assert.equal(Object.keys(hostile.goals.preferredReplacements).length, 50);
  // The other goals survive the cleaning.
  assert.equal(hostile.goals.audience, "academic");
  assert.equal(hostile.goals.tone, "formal");
});
