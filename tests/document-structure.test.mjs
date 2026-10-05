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
  const pathological = (count) => Array.from({ length: count }, (_, index) => `This is possibly maybe perhaps a very weak paragraph number ${index} with definitely everyone agreeing obviously about this claim.`).join("\n\n");
  const twelve = findDocumentStructure(pathological(12), style, goals);
  // Bounded, and still bounded when the document gets much longer. The budget
  // used to be a flat five, which meant a draft full of hedged claims and
  // repeated paragraphs could only ever hear about five of them; it now scales
  // with length and stops well short of one note per paragraph.
  assert.ok(twelve.length > 0 && twelve.length <= 12, `expected a bounded set of structural notes, got ${twelve.length}`);
  const long = findDocumentStructure(pathological(200), style, goals);
  assert.ok(long.length <= 24, `structural notes must stay bounded on a long draft, got ${long.length}`);
  assert.ok(long.length < 200, "structural notes must not scale one-to-one with paragraphs");
});

test("every kind of structural problem is still reported when a draft has all of them", () => {
  // Regression: one shared budget let repeated ideas and unsupported claims use
  // it all, so hedging and abrupt transitions were never checked at all on a
  // long draft that was full of them.
  const goals2 = { audience: "academic", intent: "persuade", tone: "formal" };
  const repeat = (index) => `The committee reviewed the quarterly budget figures for the northern region and agreed the revised totals on schedule this year ${index}.`;
  const claim = (index) => `This clearly demonstrates that the policy is effective and it will improve outcomes significantly for everyone involved ${index}.`;
  const hedge = (index) => `It could perhaps possibly arguably seem that the result might be reasonably good for most people ${index}.`;
  const paragraphs = [];
  for (let index = 0; index < 40; index += 1) paragraphs.push(repeat(index), claim(index), hedge(index));
  const found = findDocumentStructure(paragraphs.join("\n\n"), style, goals2);
  const kinds = new Set(found.map((issue) => issue.ruleId));
  for (const kind of ["structure-note-repeated-idea", "structure-note-unsupported-claim", "structure-note-hedging", "structure-note-weak-transition"]) {
    assert.ok(kinds.has(kind), `${kind} should still be reported when a draft contains it`);
  }
});

test("a repeated paragraph is still found without comparing every paragraph to every other", () => {
  // The candidate search is indexed. Two paragraphs that are near-identical can
  // still share none of a handful of "rarest" words, so indexing only those
  // missed genuine repeats; indexing every content word finds them.
  const pair = [
    "The proposed transit expansion will reduce congestion across the city centre and give commuters a reliable alternative to driving every morning into work.",
    "Earlier in this document we explained that the transit expansion will reduce congestion across the city centre, giving commuters a reliable alternative to driving into work.",
  ];
  const found = findDocumentStructure(pair.join("\n\n"), style, goals);
  assert.equal(found.filter((issue) => issue.ruleId === "structure-note-repeated-idea").length, 1);

  // A draft that repeats itself throughout is the opposite case: every word is
  // common, so an index that skipped common words would index nothing at all.
  const uniform = Array.from({ length: 150 }, (_, index) => `The committee reviewed the quarterly budget figures for the northern region and agreed the revised totals on schedule this year ${index}.`).join("\n\n");
  assert.ok(findDocumentStructure(uniform, style, goals).some((issue) => issue.ruleId === "structure-note-repeated-idea"));
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
