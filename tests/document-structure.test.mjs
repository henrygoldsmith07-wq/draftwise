import assert from "node:assert/strict";
import test from "node:test";
import { findDocumentStructure } from "../packages/grammar/src/structure.ts";
import { analyzeLocally } from "../packages/grammar/src/index.ts";
import { DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

const style = DEFAULT_STYLE_PREFERENCES;
const goals = { audience: "academic", intent: "persuade", tone: "formal" };

test("repeated ideas are flagged with the shared topic, tied to the passage", () => {
  const text = [
    "The proposed transit expansion will reduce congestion across the city centre and give commuters a reliable alternative to driving every morning into work.",
    "Earlier in this document we explained that the transit expansion will reduce congestion across the city centre, giving commuters a reliable alternative to driving into work.",
  ].join("\n\n");
  const issues = findDocumentStructure(text, style, goals);
  const repeated = issues.find((issue) => issue.ruleId === "structure-note-repeated-idea");
  assert.ok(repeated, "expected a repeated-idea note");
  assert.match(repeated.explanation, /covers nearly the same ground/u);
  assert.match(repeated.explanation, /What Draftwise noticed/u);
  assert.match(repeated.explanation, /Why it may matter/u);
  assert.match(repeated.explanation, /Consider/u);
  assert.ok(repeated.confidence <= 0.65, "structural notes stay below objective confidence");
});

test("a strong claim without support is flagged only in formal registers", () => {
  const text = "This policy will obviously transform the region. Everyone can see the potential.";
  const formal = findDocumentStructure(text, style, goals);
  assert.ok(formal.some((issue) => issue.ruleId === "structure-note-unsupported-claim"));
  const casual = findDocumentStructure(text, style, { audience: "casual", intent: "describe", tone: "casual" });
  assert.equal(casual.some((issue) => issue.ruleId === "structure-note-unsupported-claim"), false);
});

test("claims with support nearby are left alone", () => {
  const text = "This policy will obviously transform the region because the data from the pilot study shows sustained growth.";
  assert.equal(findDocumentStructure(text, style, goals).some((issue) => issue.ruleId === "structure-note-unsupported-claim"), false);
});

test("stacked hedges are flagged once with the words named", () => {
  const text = "The proposal might perhaps possibly deliver results, and it could seemingly help the region over the coming decade according to projections.";
  const issues = findDocumentStructure(text, style, goals);
  const hedging = issues.find((issue) => issue.ruleId === "structure-note-hedging");
  assert.ok(hedging);
  assert.match(hedging.explanation, /hedges/u);
});

test("a conclusion introducing new material is flagged, a summarising one is not", () => {
  const introduce = [
    "The evidence from the northern region supports the expansion plan and its funding model.",
    "Data from the southern district shows the same pattern of growth year after year.",
    "Therefore the expansion deserves support, though the aviation levy now under discussion would change the funding picture entirely.",
  ].join("\n\n");
  assert.ok(findDocumentStructure(introduce, style, goals).some((issue) => issue.ruleId === "structure-note-conclusion-new-idea"));

  const summarise = [
    "The evidence from the northern region supports the expansion plan and its funding model.",
    "Data from the southern district shows the same pattern of growth year after year.",
    "Therefore the expansion and its funding model deserve support from the council.",
  ].join("\n\n");
  assert.equal(findDocumentStructure(summarise, style, goals).some((issue) => issue.ruleId === "structure-note-conclusion-new-idea"), false);
});

test("a genuine transition is not flagged as abrupt", () => {
  const text = [
    "The railway programme transformed regional trade and the movement of goods across borders.",
    "This railway programme also changed where people chose to live and work across the region.",
  ].join("\n\n");
  assert.equal(findDocumentStructure(text, style, goals).some((issue) => issue.ruleId === "structure-note-weak-transition"), false);
});

test("structural notes never fire on a short single paragraph and stay bounded", () => {
  assert.deepEqual(findDocumentStructure("A single short paragraph.", style, goals), []);
  const many = Array.from({ length: 12 }, (_, index) => `This is possibly maybe perhaps a very weak paragraph number ${index} with definitely everyone agreeing obviously about this claim.`).join("\n\n");
  const issues = findDocumentStructure(many, style, goals);
  assert.ok(issues.length <= 5, `expected at most 5 structural notes, got ${issues.length}`);
});

test("structural notes are editorial judgement, not objective errors", () => {
  const text = [
    "The proposed transit expansion will reduce congestion across the city centre and give commuters a reliable alternative to driving every morning into work.",
    "Earlier we explained that the transit expansion will reduce congestion across the city centre and give commuters a reliable alternative to driving.",
  ].join("\n\n");
  const result = analyzeLocally(text, style, goals);
  const structural = result.issues.filter((issue) => issue.ruleId.startsWith("structure-note-"));
  assert.ok(structural.length > 0);
  for (const issue of structural) {
    assert.ok(issue.confidence < 0.9, "structural confidence stays below objective rules");
    assert.equal(issue.replacement, "", "structural notes have no auto-replacement");
  }
});
