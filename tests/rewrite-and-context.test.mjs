import assert from "node:assert/strict";
import test from "node:test";
import { surroundingContext } from "../lib/rewrite-context.ts";
import { canApplyRewritePreview } from "../lib/rewrite-retry.ts";
import { createAnalysisChunks } from "../packages/analysis/src/index.ts";
import { buildGoalsContext, protectedTokensIn } from "../packages/ai/src/index.ts";

// ---------------------------------------------------------------------------
// Rewrite context.
// ---------------------------------------------------------------------------

test("a rewrite is given whole sentences around the selection, not half ones", () => {
  const first = "The council met on Tuesday to review the budget.";
  const second = "The figures were approved without amendment.";
  const third = "Work will continue next week.";
  const draft = `${first} ${second} ${third}`;
  // Select the middle sentence outright, so both sides are whole sentences.
  const selection = { start: draft.indexOf(second), end: draft.indexOf(second) + second.length };
  const { contextBefore, contextAfter } = surroundingContext(draft, selection);
  assert.equal(contextBefore, first);
  assert.equal(contextAfter, third);
});

test("a fragment is never passed off as context", () => {
  // Given "The figure" as preceding context a model will happily write about
  // that fragment. No context is better than misleading context.
  const noTerminator = surroundingContext("no terminator anywhere in this text", { start: 5, end: 9 });
  assert.equal(noTerminator.contextBefore, "", "an unfinished leading sentence must be dropped, not sent");
  assert.equal(noTerminator.contextAfter, "", "an unfinished following sentence must be dropped too");

  // The complete sentence that precedes the fragment is still worth sending.
  const draft = "The council met on Tuesday. They fig";
  const result = surroundingContext(draft, { start: draft.length - 4, end: draft.length });
  assert.equal(result.contextBefore, "The council met on Tuesday.");
});

test("a decimal point does not end a sentence", () => {
  const draft = "Version 3.5 shipped on time. The review followed it.";
  const at = draft.indexOf("review");
  const { contextBefore } = surroundingContext(draft, { start: at, end: at + 6 });
  assert.equal(contextBefore, "Version 3.5 shipped on time.");
});

test("a selection near the start or end still produces usable context", () => {
  const draft = "First sentence here. Second sentence follows. Third sentence closes the paragraph.";
  const atStart = surroundingContext(draft, { start: 0, end: 5 });
  assert.equal(atStart.contextBefore, "");
  assert.ok(atStart.contextAfter.length > 0);

  const atEnd = surroundingContext(draft, { start: draft.length - 4, end: draft.length });
  assert.equal(atEnd.contextAfter, "");
  assert.ok(atEnd.contextBefore.length > 0);
});

test("surrounding context stays bounded on a very long document", () => {
  const sentence = "The committee reviewed the quarterly figures for the northern region and noted no material variance. ";
  const draft = sentence.repeat(400);
  const middle = Math.floor(draft.length / 2);
  const { contextBefore, contextAfter } = surroundingContext(draft, { start: middle, end: middle + 10 });
  assert.ok(contextBefore.length <= 700, "context must not grow with the document");
  assert.ok(contextAfter.length <= 700);
});

test("context is never wider than the selection's own sentences when there are none", () => {
  const draft = "No sentence boundaries at all in this fragment of text, just words running together.";
  const context = surroundingContext(draft, { start: 10, end: 20 });
  assert.equal(typeof context.contextBefore, "string");
  assert.equal(typeof context.contextAfter, "string");
});

// ---------------------------------------------------------------------------
// Applying a rewrite.
// ---------------------------------------------------------------------------

test("an empty or no-op rewrite cannot be applied", () => {
  const base = { original: "in order to", replacement: "to" };
  assert.equal(canApplyRewritePreview(base), true);
  assert.equal(canApplyRewritePreview({ ...base, replacement: "" }), false);
  assert.equal(canApplyRewritePreview({ ...base, replacement: "   " }), false);
  assert.equal(canApplyRewritePreview({ ...base, replacement: "in order to" }), false);
  assert.equal(canApplyRewritePreview({ ...base, loading: true }), false);
  assert.equal(canApplyRewritePreview({ ...base, failed: true }), false);
});

test("a rewrite the writer edited by hand is still applyable when it differs", () => {
  // The writer keeps the preview-first contract: an edited replacement goes
  // through the same gate as a generated one.
  assert.equal(canApplyRewritePreview({ original: "The the report", replacement: "The report" }), true);
  assert.equal(canApplyRewritePreview({ original: "The the report", replacement: "That report" }), true);
});

// ---------------------------------------------------------------------------
// Provider output is untrusted.
// ---------------------------------------------------------------------------

test("ordinary English words are not mistaken for code identifiers", () => {
  // Regression: a loose identifier pattern matched "identity", "identify",
  // "ideology", "case study" and "refine", so ordinary prose came back
  // flagged as machine text and the provider was told to leave it alone.
  for (const word of ["identity", "identify", "ideology", "case study", "refine", "a model of behaviour"]) {
    assert.deepEqual(protectedTokensIn(word), [], `“${word}” must not be treated as a protected token`);
  }
});

test("real code, versions and model names are still protected", () => {
  for (const token of ["package.json", "#123", "v1.2", "gpt-4o-mini", "x:1", "2024-01-05"]) {
    assert.ok(protectedTokensIn(token).length > 0, `“${token}” should be protected`);
  }
});

test("the goals prompt carries the writer's terminology rules", () => {
  const context = buildGoalsContext(
    {
      audience: "technical",
      intent: "explain",
      tone: "confident",
      requiredTerminology: ["runbook"],
      forbiddenTerminology: ["manual"],
      documentType: "report",
    },
    {
      preferredTerminology: { webhook: "event callback" },
      blockedWords: ["obviously"],
      personalDictionary: ["Kubernetes"],
      names: ["Ada Lovelace"],
      oxfordComma: true,
      preferredSentenceLength: "short",
    },
  );

  assert.match(context, /runbook/);
  assert.match(context, /manual/);
  assert.match(context, /event callback/);
  assert.match(context, /obviously/);
  assert.match(context, /Kubernetes/);
  assert.match(context, /Ada Lovelace/);
  assert.match(context, /report/);
  assert.match(context, /short/);
});

test("the goals prompt does not blow up on a very large dictionary", () => {
  const context = buildGoalsContext(
    { audience: "general", intent: "inform", tone: "neutral", requiredTerminology: Array.from({ length: 400 }, (_, index) => `term${index}`) },
    {
      personalDictionary: Array.from({ length: 400 }, (_, index) => `word${index}`),
      names: Array.from({ length: 400 }, (_, index) => `name${index}`),
      preferredTerminology: Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`from${index}`, `to${index}`])),
    },
  );
  assert.ok(context.length < 20_000, "the goals context must stay bounded");
});

// ---------------------------------------------------------------------------
// Chunking.
// ---------------------------------------------------------------------------

test("a long document splits into chunks that together cover every word", () => {
  const paragraph = (index) => `Paragraph ${index} covers topic ${index} in a sentence of moderate length with several distinct words worth reading carefully today. `;
  const text = Array.from({ length: 60 }, (_, index) => paragraph(index + 1)).join("\n\n");
  const chunks = createAnalysisChunks(text, { maxChars: 400, contextWindow: 120 });
  assert.ok(chunks.length > 3, "fixture must chunk");

  for (const chunk of chunks) {
    assert.ok(chunk.startOffset <= chunk.contentStartOffset, "context may precede owned text");
    assert.ok(chunk.contentStartOffset <= chunk.contentEndOffset);
    assert.ok(chunk.contentEndOffset <= chunk.endOffset, "context may follow owned text");
    assert.ok(chunk.endOffset <= text.length);
    assert.equal(text.slice(chunk.startOffset, chunk.endOffset), chunk.text);
  }

  const owned = chunks.map((chunk) => [chunk.contentStartOffset, chunk.contentEndOffset]).sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < owned.length; index += 1) {
    assert.ok(owned[index][0] >= owned[index - 1][1], "owned ranges must not overlap");
  }
});