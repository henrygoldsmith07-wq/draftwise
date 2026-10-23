import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLocally } from "../packages/grammar/src/index.ts";

const agreement = (text, dialect = "en-GB") => analyzeLocally(text, { dialect }).issues.filter((issue) => issue.ruleId === "grammar-subject-verb-agreement");
const splices = (text) => analyzeLocally(text, { dialect: "en-GB" }).issues.filter((issue) => issue.ruleId === "punctuation-comma-splice");

test("singular subject with a base-form verb is corrected to the -s form", () => {
  const issues = agreement("The result show promise.");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].original, "show");
  assert.equal(issues[0].replacement, "shows");
});

test("singular-subject agreement fires for everyday verbs", () => {
  const issues = agreement("My dog eat bones daily.");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].replacement, "eats");
});

test("en-GB collective nouns keep plural agreement", () => {
  assert.deepEqual(agreement("Our team show great promise this season."), []);
  assert.deepEqual(agreement("The committee need more time."), []);
});

test("en-US collective nouns take singular agreement", () => {
  const issues = agreement("Our team show great promise this season.", "en-US");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].replacement, "shows");
});

test("past tenses identical to the base form are left alone", () => {
  assert.deepEqual(agreement("The report cost millions to produce."), []);
  assert.deepEqual(agreement("She put the keys on the table."), []);
});

test("mandative subjunctives are left alone", () => {
  assert.deepEqual(agreement("We demand the result show improvement."), []);
  assert.deepEqual(agreement("They insist that the report cover every case."), []);
});

test("noun readings of the candidate are left alone", () => {
  assert.deepEqual(agreement("The take was huge."), []);
  assert.deepEqual(agreement("The right show to watch tonight is sold out.").filter((issue) => issue.ruleId === "grammar-subject-verb-agreement"), []);
  assert.deepEqual(agreement("The one show I like is cancelled.").filter((issue) => issue.ruleId === "grammar-subject-verb-agreement"), []);
  assert.deepEqual(agreement("The work offer stands firm despite the criticism."), []);
  assert.deepEqual(agreement("The show start times vary by venue."), []);
});

test("plural-by-meaning subjects are left alone", () => {
  assert.deepEqual(agreement("The poor show little interest."), []);
  assert.deepEqual(agreement("The first show courage under pressure."), []);
  assert.deepEqual(agreement("The data show a clear trend."), []);
  assert.deepEqual(agreement("The sheep show no sign of disease."), []);
});

test("participial adjectives are not mistaken for subjects", () => {
  assert.deepEqual(agreement("The project closes after the owner accepts the delivered work."), []);
});

test("modals in subject position are left alone", () => {
  assert.deepEqual(agreement("That would give us a day to recover."), []);
});

test("dependent clauses before the comma are not splices", () => {
  assert.deepEqual(splices("After lunch, the meeting is over."), []);
  assert.deepEqual(splices("If the text changed, the rewrite is rejected."), []);
});

test("caseless messages are not judged on sentence boundaries", () => {
  assert.deepEqual(splices("just heard back from the garage, the bill is bigger than we thought"), []);
});

test("clause-final your/its confusion is corrected", () => {
  const your = analyzeLocally("Hope your well.", { dialect: "en-GB" }).issues.filter((issue) => issue.ruleId === "grammar-confused-your");
  assert.equal(your.length, 1);
  assert.equal(your[0].replacement, "you're");
  const its = analyzeLocally("I think its late.", { dialect: "en-GB" }).issues.filter((issue) => issue.ruleId === "grammar-confused-its");
  assert.equal(its.length, 1);
  assert.equal(its[0].replacement, "it's");
});

test("already-covered confusion words flag exactly once", () => {
  assert.equal(analyzeLocally("Your right.", { dialect: "en-GB" }).issues.filter((issue) => issue.ruleId === "grammar-confused-your").length, 1);
  assert.equal(analyzeLocally("Its ready.", { dialect: "en-GB" }).issues.filter((issue) => issue.ruleId === "grammar-confused-its").length, 1);
});

test("possessive your/its before a noun or after for/a preposition stays silent", () => {
  for (const text of ["It is for your own good.", "The bucket fell down your well.", "We draw your well water daily.", "Your late arrival upset the schedule.", "Your free trial ends soon."]) {
    const issues = analyzeLocally(text, { dialect: "en-GB" }).issues.filter((issue) => issue.ruleId === "grammar-confused-your");
    assert.deepEqual(issues, [], text);
  }
});

test("correct agreement stays silent", () => {
  assert.deepEqual(agreement("The results show growth."), []);
  assert.deepEqual(agreement("Our team shows promise."), []);
});

test("comma splice before a demonstrative subject starts a new sentence", () => {
  const issues = splices("The committee made one mistake, the other two are ready.");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].original, ", the");
  assert.equal(issues[0].replacement, ". The");
});

test("adjacent demonstrative splices are caught", () => {
  const issues = splices("She left early, this is certain.");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].replacement, ". This");
});

test("fragments and idioms before the comma are not splices", () => {
  assert.deepEqual(splices("Yes, this is the right venue for the event."), []);
  assert.deepEqual(splices("He won, that is to say, unexpectedly."), []);
});
