import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { analyzeLocally } from "../packages/grammar/src/index.ts";

const goals = { audience: "general", intent: "inform", tone: "professional" };
const style = {
  dialect: "en-GB", personalDictionary: [], names: [], ignoredWords: [], ignoredRuleIds: [],
  reducedRuleIds: [], preferredTerminology: {}, oxfordComma: true, allowContractions: true,
  passiveVoiceSensitivity: "normal", preferredSentenceLength: "balanced", blockedWords: [],
};

const stickyOf = (text) => analyzeLocally(text, style, goals)
  .issues.filter((issue) => issue.ruleId === "structure-sticky-sentence");

// The sentence that motivated the rule: correct, within the length limit, and
// containing no filler word, yet impossible to tell what happened.
const DENSE = "The fact of the matter is that the implementation of the system in the context of the organisation will be the subject of a review by the committee.";

test("sticky sentences are detected and explain the ratio that triggered them", () => {
  const found = stickyOf(DENSE);
  assert.equal(found.length, 1);
  // The explanation has to state the measurement, because a bare "this is
  // dense" gives the writer nothing to check or argue with.
  assert.match(found[0].explanation, /68% of this sentence's \d+ words/u);
  assert.equal(found[0].category, "readability");
  assert.equal(found[0].replacement, "");
  // No replacement is offered: the fix is a rewrite the writer has to judge,
  // so inventing one would be worse than saying so.
});

test("ordinary correct prose is never reported as sticky", async () => {
  // Drawn from evaluation/clean-prose.json rather than hand-picked, because
  // hand-picked examples are exactly where a bad threshold hides. The
  // corpus-level check below is the real guard; this one confirms the rule
  // does not fire on plain declarative prose.
  const clean = JSON.parse(await readFile(new URL("../evaluation/clean-prose.json", import.meta.url), "utf8"));
  const flagged = clean.filter((example) => stickyOf(example.text).length > 0);
  assert.deepEqual(flagged.map((example) => example.id), []);
});

test("short sentences are exempt regardless of glue-word share", () => {
  // "It was good" is 50% glue words and perfectly clear. Below 20 words the
  // ratio cannot separate clear from dense — evaluation/corpus.json holds
  // correct 15-word sentences at 67% glue ("We can send the draft when you
  // are ready, and we can review it together") — so the rule must not apply
  // at all down here, whatever the share.
  for (const sentence of [
    "It was good.",
    "The dog is in the boat.",
    "We are here.",
    "We can send the draft when you are ready, and we can review it together.",
    "You can send the draft when you are ready, and we can review it together.",
  ]) {
    assert.equal(stickyOf(sentence).length, 0, sentence);
  }
});

test("the entire clean-prose corpus produces no sticky-sentence false positives", async () => {
  const clean = JSON.parse(await readFile(new URL("../evaluation/clean-prose.json", import.meta.url), "utf8"));
  let hits = 0;
  for (const example of clean) hits += stickyOf(example.text).length;
  // This is the guard that keeps the threshold honest. It was 52 before the
  // threshold was calibrated against this very file; a regression here means
  // the constant drifted away from the corpora that justify it.
  assert.equal(hits, 0);
});

test("a writer can turn sticky-sentence findings off", () => {
  const muted = analyzeLocally(DENSE, { ...style, ignoredRuleIds: ["structure-sticky-sentence"] }, goals);
  assert.equal(muted.issues.filter((issue) => issue.ruleId === "structure-sticky-sentence").length, 0);
});
