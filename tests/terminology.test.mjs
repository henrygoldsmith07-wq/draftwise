import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanTerminologyList,
  formatTerminologyList,
  parseTerminologyList,
} from "../lib/terminology.ts";
import {
  MemoryDocumentBackend,
  createDocument,
  sanitiseStoredDocument,
} from "../lib/documents.ts";
import { DocumentLifecycle } from "../lib/document-lifecycle.ts";

/**
 * Per-document terminology: the local rules already enforce
 * required/forbidden terms per document, but until the goal-bar editor landed
 * the only way to set them was editing stored JSON. These tests pin the
 * parsing rule and the per-document persistence the editor relies on.
 */

test("parse splits on commas and newlines, trims, and dedupes case-insensitively", () => {
  assert.deepEqual(parseTerminologyList("runbook, Runbook ,  webhook\nrunbook"), ["runbook", "webhook"]);
  assert.deepEqual(parseTerminologyList("  , ,\n "), []);
  assert.deepEqual(parseTerminologyList("in order to, sign in"), ["in order to", "sign in"]);
});

test("parse collapses inner whitespace and drops overlong terms", () => {
  assert.deepEqual(parseTerminologyList("sign   in"), ["sign in"]);
  assert.equal(parseTerminologyList(`${"a".repeat(81)}`).length, 0);
  assert.equal(parseTerminologyList(`${"a".repeat(80)}`).length, 1);
});

test("parse caps the list so a pasted wall of terms cannot pin analysis", () => {
  const input = Array.from({ length: 200 }, (_, i) => `term${i}`).join(", ");
  assert.equal(parseTerminologyList(input).length, 50);
});

test("format round-trips through parse", () => {
  const terms = ["runbook", "sign in"];
  assert.deepEqual(parseTerminologyList(formatTerminologyList(terms)), terms);
  assert.equal(formatTerminologyList(undefined), "");
});

test("clean drops non-strings and overlong entries from stored values", () => {
  assert.deepEqual(cleanTerminologyList(["runbook", 7, "", "  ", null, "webhook"]), ["runbook", "webhook"]);
  assert.deepEqual(cleanTerminologyList("runbook"), []);
  assert.deepEqual(cleanTerminologyList(undefined), []);
});

const seed = { title: "Untitled draft", draft: "" };

test("each document keeps its own terminology while the other is edited", async () => {
  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), seed);
  await lifecycle.load();
  const first = lifecycle.getActive();
  lifecycle.updateActive({
    goals: { audience: "technical", intent: "inform", tone: "neutral", requiredTerminology: ["runbook"], forbiddenTerminology: ["manual"] },
  });

  const second = lifecycle.createNew("Email", "Quick note.", { audience: "professional", intent: "inform", tone: "casual" });
  assert.deepEqual(second.goals?.requiredTerminology ?? [], []);
  lifecycle.open(first.id);
  assert.deepEqual(lifecycle.getActive()?.goals?.requiredTerminology, ["runbook"]);
  assert.deepEqual(lifecycle.getActive()?.goals?.forbiddenTerminology, ["manual"]);
  await lifecycle.flush();
});

test("terminology survives sanitise and duplicate", async () => {
  const goals = { audience: "technical", intent: "inform", tone: "neutral", requiredTerminology: ["runbook"], forbiddenTerminology: ["synergy"] };
  const kept = sanitiseStoredDocument({ id: "a", draft: "Text.", goals });
  assert.deepEqual(kept?.goals?.requiredTerminology, ["runbook"]);

  const broken = sanitiseStoredDocument({
    id: "b",
    draft: "Text.",
    goals: { audience: "technical", intent: "inform", tone: "neutral", requiredTerminology: "runbook" },
  });
  assert.equal(broken?.goals, undefined);

  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), seed);
  await lifecycle.load();
  lifecycle.updateActive({ goals });
  const copy = lifecycle.duplicate(lifecycle.activeId);
  assert.deepEqual(copy?.goals?.forbiddenTerminology, ["synergy"]);
});

test("createDocument stores its own copy of the terminology", () => {
  const goals = { audience: "technical", intent: "inform", tone: "neutral", requiredTerminology: ["runbook"] };
  const document = createDocument("Essay", "Body.", Date.now(), goals);
  goals.requiredTerminology?.push("mutated");
  assert.deepEqual(document.goals?.requiredTerminology, ["runbook"]);
});
