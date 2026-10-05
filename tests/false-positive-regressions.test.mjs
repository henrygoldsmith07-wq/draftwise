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

test("passive voice does not report stative adjectives ending in -ed", () => {
  // The pattern matched any \p{L}+ed after a form of "be", so ordinary prose
  // like "the walls are red" was reported as a passive construction.
  for (const text of ["The walls are red.", "He was tired.", "The path was narrow.", "They were pleased."]) {
    const passive = analyzeLocally(text, style).issues.filter((issue) => issue.ruleId === "style-passive-voice");
    assert.deepEqual(passive.map((issue) => issue.original), [], `"${text}" is not passive voice`);
  }
  const real = analyzeLocally("The report was reviewed last week.", style).issues.filter((issue) => issue.ruleId === "style-passive-voice");
  assert.ok(real.length > 0, "a genuine passive construction must still be reported");
});

test("capitalization does not fire after an abbreviation", () => {
  for (const text of ["Mr. smith wrote it.", "Dr. jones will call.", "St. mary parish.", "etc. the rest is fine.", "vs. the other option.", "i.e. this is the plan."]) {
    const found = analyzeLocally(text, style).issues.filter((issue) => issue.ruleId === "capitalization-sentence-start");
    assert.deepEqual(found.map((issue) => issue.original), [], `"${text}" is correct as written`);
  }
  const real = analyzeLocally("He left. then nobody spoke.", style).issues.filter((issue) => issue.ruleId === "capitalization-sentence-start");
  assert.deepEqual(real.map((issue) => issue.original), ["t"], "a real lowercase sentence start must still be reported");
});

test("indented markdown lines are not reported as extra spaces", () => {
  const list = analyzeLocally("Intro line here.\n\n  - first item\n  - second item", style).issues.filter((issue) => issue.ruleId === "punctuation-extra-space");
  assert.deepEqual(list, [], "list indentation is written that way on purpose");
  const nested = analyzeLocally("Intro line here.\n\n- outer\n    - inner", style).issues.filter((issue) => issue.ruleId === "punctuation-extra-space");
  assert.deepEqual(nested, [], "nested list indentation is not a stray double space");
  const real = analyzeLocally("The start of a sentence here.  The rest follows.", style).issues.filter((issue) => issue.ruleId === "punctuation-extra-space");
  assert.equal(real.length, 1, "a genuine double space mid-line must still be reported");
});

test("article agreement does not shout the replacement", () => {
  // preserveCase treated a single capital letter as all-caps, so "A hour"
  // became "AN hour".
  const found = analyzeLocally("A hour of work with the team.", style).issues.filter((issue) => issue.ruleId === "grammar-article-agreement");
  assert.deepEqual(found.map((issue) => issue.replacement), ["An"]);
  const shouty = analyzeLocally("we plan an hour of work.", style).issues.filter((issue) => issue.ruleId === "grammar-article-agreement");
  assert.deepEqual(shouty.map((issue) => issue.replacement), [], "a correct article is not reported");
});

test("metre/meter is left alone because the homograph cannot be resolved", () => {
  // "A parking meter" is "meter" in British English too. Rewriting it to
  // "metre" is not a dialect preference, it is wrong.
  for (const dialect of ["en-GB", "en-US"]) {
    const found = analyzeLocally("The meter in the driveway shows 45000 kWh. A parking meter took coins.", { ...style, dialect }).issues
      .filter((issue) => issue.ruleId === "dialect-spelling" && issue.original.toLowerCase() === "meter");
    assert.deepEqual(found, [], `"meter" must not be rewritten under ${dialect}`);
  }
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
