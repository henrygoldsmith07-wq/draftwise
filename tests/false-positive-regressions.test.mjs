import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLocally, prioritiseSuggestions } from "../packages/grammar/src/index.ts";
import { DEFAULT_STYLE_PREFERENCES } from "../packages/types/src/index.ts";

const style = DEFAULT_STYLE_PREFERENCES;
const goals = (audience, intent = "inform", tone = "professional") => ({ audience, intent, tone });

function displayed(text, goalSet) {
  const raw = analyzeLocally(text, style, goalSet);
  const result = prioritiseSuggestions(raw.issues, { goals: goalSet, preferences: style, text });
  return result.displayed;
}

test("passive voice no longer matches non-participles like 'often' and 'even'", () => {
  const text = "The results are often surprising and the effect is even visible in the smaller samples collected during the study.";
  const passive = analyzeLocally(text, style).issues.filter((issue) => issue.ruleId === "style-passive-voice");
  assert.deepEqual(passive.map((issue) => issue.original), [], "adverbs ending in -en are not participles");
});

test("idiomatic reporting passives in reports are not nagged", () => {
  const text = "Q3 revenue grew 12%. The support backlog was cleared by the end of September and the follow-up items are assigned to owners.";
  const goalSet = goals("professional", "inform", "professional");
  const passive = displayed(text, goalSet).filter((issue) => issue.ruleId === "style-passive-voice");
  assert.deepEqual(passive.map((issue) => issue.original), [], "deliberate reporting voice is correct prose");
});

test("a passive where the actor matters still gets a note", () => {
  const text = "The decision was made without consulting the regional teams that depend on the outcome.";
  const passive = analyzeLocally(text, style).issues.filter((issue) => issue.ruleId === "style-passive-voice");
  assert.equal(passive.length >= 1, true, "a hidden actor is exactly where the passive costs the reader");
});

test("filler words are not flagged in casual voice", () => {
  const text = "ok so basically i just think we should maybe try the other route first";
  const casual = displayed(text, goals("casual", "describe", "casual")).filter((issue) => issue.ruleId === "conciseness-filler" || issue.ruleId === "style-intensifier");
  assert.deepEqual(casual.map((issue) => issue.original), [], "casual voice carries tone in these words");
});

test("filler words are still flagged in formal prose", () => {
  const text = "The committee basically decided that the proposal would just require further review before any final decision could be made.";
  const formal = displayed(text, goals("professional", "inform", "formal")).filter((issue) => issue.ruleId === "conciseness-filler");
  assert.ok(formal.length >= 1, "padding words in formal prose are worth removing");
});

test("'very' is not double-reported as both filler and intensifier", () => {
  const text = "The study was very thorough and the results were very clear to everyone involved.";
  const all = analyzeLocally(text, style).issues.filter((issue) => issue.original.toLowerCase() === "very");
  const kinds = new Set(all.map((issue) => issue.ruleId));
  assert.ok(kinds.size <= 1, `expected one rule family for 'very', got ${[...kinds].join(", ")}`);
});

test("hedging words are only a problem when stacked in formal registers", () => {
  const single = "The result is perhaps the clearest evidence presented so far in this report.";
  assert.deepEqual(analyzeLocally(single, style).issues.filter((issue) => issue.ruleId === "structure-note-hedging"), []);
  const stacked = "This might perhaps possibly deliver results and could seemingly help the region over the coming decade according to projections presented here.";
  assert.ok(analyzeLocally(stacked, style, goals("academic", "persuade", "formal")).issues.some((issue) => issue.ruleId === "structure-note-hedging"));
});
