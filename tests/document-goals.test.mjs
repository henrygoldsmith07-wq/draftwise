import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryDocumentBackend,
  createDocument,
  sanitiseStoredDocument,
  summariseDocuments,
} from "../lib/documents.ts";
import { DocumentLifecycle } from "../lib/document-lifecycle.ts";

const seed = { title: "Untitled draft", draft: "" };
const essayGoals = { audience: "academic", intent: "explain", tone: "formal" };
const emailGoals = { audience: "professional", intent: "inform", tone: "casual" };

test("createDocument stores its own copy of the goals", () => {
  const goals = { ...essayGoals };
  const document = createDocument("Essay", "Body text.", Date.now(), goals);
  goals.audience = "casual";
  assert.deepEqual(document.goals, essayGoals);
});

test("sanitise keeps valid goals and drops malformed ones without losing the document", () => {
  const valid = sanitiseStoredDocument({ id: "a", draft: "Text.", goals: essayGoals });
  assert.deepEqual(valid?.goals, essayGoals);

  const missing = sanitiseStoredDocument({ id: "b", draft: "Text." });
  assert.equal(missing?.goals, undefined);

  const broken = sanitiseStoredDocument({
    id: "c",
    draft: "Text.",
    goals: { audience: "everyone", intent: "inform", tone: "formal" },
  });
  assert.equal(broken?.draft, "Text.");
  assert.equal(broken?.goals, undefined);
});

test("each document keeps its own goals while the other is edited", async () => {
  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), seed);
  await lifecycle.load();
  const first = lifecycle.getActive();
  lifecycle.updateActive({ goals: { ...essayGoals } });

  const second = lifecycle.createNew("Email", "Quick note.", { ...emailGoals });
  assert.deepEqual(lifecycle.getActive()?.goals, emailGoals);

  lifecycle.open(first.id);
  assert.deepEqual(lifecycle.getActive()?.goals, essayGoals);

  // Editing one document's goals never leaks into the other.
  lifecycle.updateActive({ goals: { ...emailGoals } });
  lifecycle.open(second.id);
  assert.deepEqual(lifecycle.getActive()?.goals, emailGoals);
  await lifecycle.flush();
});

test("goals survive a reload through the backend", async () => {
  const backend = new MemoryDocumentBackend();
  const first = new DocumentLifecycle(backend, seed);
  await first.load();
  const active = first.getActive();
  first.updateActive({ goals: { ...essayGoals } });
  await first.flush();

  const second = new DocumentLifecycle(backend, seed);
  await second.load();
  assert.deepEqual(second.getDocument(active.id)?.goals, essayGoals);
});

test("duplicating a document carries its goals to the copy", async () => {
  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), seed);
  await lifecycle.load();
  lifecycle.updateActive({ goals: { ...essayGoals } });
  const copy = lifecycle.duplicate(lifecycle.activeId);
  assert.ok(copy);
  assert.deepEqual(copy.goals, essayGoals);
});

test("summaries carry goals so the dashboard can show them per document", () => {
  const withGoals = { ...createDocument("Essay", "Body.", Date.now(), essayGoals), updatedAt: 2_000 };
  const without = { ...createDocument("Notes", "More.", 1_000), updatedAt: 1_000 };
  const summaries = summariseDocuments([withGoals, without]);
  assert.deepEqual(summaries[0].goals, essayGoals);
  assert.equal(summaries[1].goals, undefined);
});
