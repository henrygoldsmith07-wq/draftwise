import assert from "node:assert/strict";
import test from "node:test";
import { describeDiff, diffText, tokenizeForDiff } from "../lib/text-diff.ts";

/** Rebuild an input from the diff, which is the invariant the UI relies on. */
function rebuild(parts, kind) {
  return parts
    .filter((part) => part.kind === "same" || part.kind === (kind === "before" ? "removed" : "added"))
    .map((part) => part.text)
    .join("");
}

test("an unchanged draft is reported as identical, not as a change", () => {
  const text = "The draft is unchanged.\n\nSecond paragraph.";
  const diff = diffText(text, text);
  assert.equal(diff.summary.changedBlocks, 0);
  assert.equal(diff.summary.addedWords, 0);
  assert.equal(describeDiff(diff), "This version is identical to the current draft.");
  assert.deepEqual(diff.parts, [{ kind: "same", text }]);
});

test("an edited word is one change, with the old and new text preserved", () => {
  const diff = diffText("The report was sent yesterday.", "The report was sent today.");
  assert.equal(rebuild(diff.parts, "before"), "The report was sent yesterday.");
  assert.equal(rebuild(diff.parts, "after"), "The report was sent today.");
  assert.equal(diff.summary.changedBlocks, 1);
  assert.equal(diff.summary.addedWords, 1);
  assert.equal(diff.summary.removedWords, 1);
  assert.equal(
    diff.parts.filter((part) => part.kind !== "same").map((part) => `${part.kind}:${part.text.trim()}`).join(" "),
    "removed:yesterday added:today",
  );
  assert.equal(describeDiff(diff), "1 change · +1 word · −1 word");
});

test("an insertion keeps the surrounding text untouched", () => {
  const diff = diffText("We shipped the release.", "We shipped the release on Friday.");
  assert.equal(rebuild(diff.parts, "before"), "We shipped the release.");
  assert.equal(rebuild(diff.parts, "after"), "We shipped the release on Friday.");
  assert.equal(diff.summary.addedWords, 2);
  assert.equal(diff.summary.removedWords, 0);
  // The whole insertion reads as one change rather than four.
  assert.equal(diff.summary.changedBlocks, 1);
});

test("a deletion reads as a removal, not as a rewrite of the document", () => {
  const before = "First paragraph stays.\n\nA whole paragraph that goes away.\n\nLast paragraph stays.";
  const after = "First paragraph stays.\n\nLast paragraph stays.";
  const diff = diffText(before, after);
  assert.equal(rebuild(diff.parts, "before"), before);
  assert.equal(rebuild(diff.parts, "after"), after);
  assert.equal(diff.summary.addedWords, 0);
  assert.equal(diff.summary.removedWords, 6);
});

test("separate edits count as separate changes", () => {
  const diff = diffText("Alpha beta gamma. Delta epsilon zeta.", "Alpha BETA gamma. Delta EPSILON zeta.");
  assert.equal(diff.summary.changedBlocks, 2);
  assert.equal(diff.summary.addedWords, 2);
  assert.equal(diff.summary.removedWords, 2);
});

test("punctuation stays attached to the word it belongs to", () => {
  // The full stop must not become its own removal, or every sentence would
  // look rewritten the moment one word changed.
  const diff = diffText("It was late.", "It was very late.");
  assert.deepEqual(
    diff.parts.filter((part) => part.kind !== "same").map((part) => part.text.trim()),
    ["very"],
  );
  assert.equal(diff.summary.addedWords, 1);
});

test("punctuation in a changed run is not counted as a word", () => {
  // The added part can begin with a comma; counting whitespace runs would
  // report two added words for ", revised".
  const diff = diffText("We shipped the release.", "We shipped the release, revised.");
  assert.equal(diff.summary.addedWords, 1);
  assert.equal(diff.summary.removedWords, 0);
  assert.equal(diff.summary.changedBlocks, 1);
});

test("empty drafts compare without throwing and rebuild correctly", () => {
  const fromEmpty = diffText("", "A first line.");
  assert.equal(rebuild(fromEmpty.parts, "after"), "A first line.");
  assert.equal(rebuild(fromEmpty.parts, "before"), "");
  assert.equal(fromEmpty.summary.addedWords, 3);

  const toEmpty = diffText("A first line.", "");
  assert.equal(rebuild(toEmpty.parts, "before"), "A first line.");
  assert.equal(rebuild(toEmpty.parts, "after"), "");
  assert.equal(toEmpty.summary.removedWords, 3);

  const both = diffText("", "");
  assert.deepEqual(both.parts, []);
  assert.equal(describeDiff(both), "This version is identical to the current draft.");
});

test("a large document falls back to paragraph comparison instead of stalling", () => {
  const paragraph = Array.from({ length: 130 }, (_, index) => `Sentence ${index} carries a steady rhythm of ordinary words.`).join(" ");
  const before = ["Opening line.", paragraph, "Closing line."].join("\n\n");
  const after = ["Opening line changed.", paragraph, "Closing line changed."].join("\n\n");
  const diff = diffText(before, after);
  assert.equal(diff.precise, false);
  assert.equal(rebuild(diff.parts, "before"), before);
  assert.equal(rebuild(diff.parts, "after"), after);
  assert.ok(diff.summary.changedBlocks >= 1);
});

test("repeated words do not confuse the comparison", () => {
  // A greedy matcher would consume the first "the" repeatedly and report a
  // change in the wrong place; the LCS table must align both occurrences.
  const diff = diffText("the cat sat on the mat", "the cat sat on the mat today");
  const changed = diff.parts.filter((part) => part.kind !== "same").map((part) => part.text.trim());
  assert.deepEqual(changed, ["today"]);
});

test("whitespace-only edits are a change with no words added or removed", () => {
  const diff = diffText("one two", "one  two");
  assert.equal(diff.summary.changedBlocks, 1);
  assert.equal(diff.summary.addedWords, 0);
  assert.equal(diff.summary.removedWords, 0);
  assert.equal(describeDiff(diff), "1 change");
});

test("tokenization keeps contractions and apostrophes whole", () => {
  assert.deepEqual(tokenizeForDiff("Don't stop"), ["Don't", " ", "stop"]);
  assert.deepEqual(tokenizeForDiff("it’s fine"), ["it’s", " ", "fine"]);
  // Punctuation stays separate so a changed word does not drag the full stop
  // into the diff with it.
  assert.deepEqual(tokenizeForDiff("fine."), ["fine", "."]);
});
