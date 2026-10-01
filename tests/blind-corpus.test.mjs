import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const corpus = JSON.parse(await readFile(new URL("../evaluation/blind-corpus.json", import.meta.url), "utf8"));
const words = (text) => String(text || "").trim().split(/\s+/u).filter(Boolean).length;

const REQUIRED_STYLES = ["essay", "email", "report", "casual", "technical"];
const ERROR_CATEGORIES = new Set(["spelling", "grammar", "punctuation", "capitalization"]);

test("the blind corpus covers every required writing style", () => {
  const styles = new Set(corpus.map((example) => example.style));
  for (const style of REQUIRED_STYLES) {
    assert.ok(styles.has(style), "blind corpus must include " + style);
  }
});

test("the blind corpus is larger than the tuned clean-prose corpus in words", async () => {
  const cleanProse = JSON.parse(await readFile(new URL("../evaluation/clean-prose.json", import.meta.url), "utf8"));
  const blindWords = corpus.reduce((sum, example) => sum + words(example.text), 0);
  const cleanWords = cleanProse.reduce((sum, example) => sum + words(example.text), 0);
  assert.ok(blindWords > cleanWords, "blind corpus (" + blindWords + " words) should exceed clean-prose (" + cleanWords + ")");
});

test("every blind example is well formed and uniquely identified", () => {
  const ids = new Set();
  for (const example of corpus) {
    assert.equal(typeof example.id, "string", "example needs an id");
    assert.ok(!ids.has(example.id), "duplicate blind id: " + example.id);
    ids.add(example.id);
    assert.equal(typeof example.style, "string");
    assert.equal(typeof example.kind, "string");
    assert.equal(typeof example.text, "string");
    assert.ok(example.text.trim().length > 0, example.id + " has empty text");
    assert.ok(Array.isArray(example.expected), example.id + " needs an expected array");
  }
});

test("blind expectations name a known category and an original present in the text", () => {
  for (const example of corpus) {
    for (const expected of example.expected) {
      assert.ok(typeof expected.category === "string", example.id + " expectation needs a category");
      if (typeof expected.original === "string") {
        assert.ok(
          example.text.toLocaleLowerCase().includes(expected.original.toLocaleLowerCase()),
          example.id + " expects original " + JSON.stringify(expected.original) + " which is not in its text",
        );
      }
    }
  }
});

test("blind expectations keep a majority of clean text so false positives stay measurable", () => {
  const clean = corpus.filter((example) => example.expected.length === 0);
  assert.ok(clean.length >= corpus.length / 2, "at least half the blind corpus must be clean text");
  const cleanWords = clean.reduce((sum, example) => sum + words(example.text), 0);
  assert.ok(cleanWords >= 1500, "need enough clean words to measure false positives meaningfully");
});

test("the blind corpus is distinct from the tuned corpus", async () => {
  const tuned = JSON.parse(await readFile(new URL("../evaluation/corpus.json", import.meta.url), "utf8"));
  const tunedTexts = new Set(tuned.map((example) => example.text));
  for (const example of corpus) {
    assert.ok(!tunedTexts.has(example.text), example.id + " duplicates a tuned-corpus example");
  }
});

test("error-category expectations are labelled as errors", () => {
  const errorKinds = new Set(["spelling", "grammar", "punctuation", "capitalization"]);
  for (const example of corpus) {
    for (const expected of example.expected) {
      if (ERROR_CATEGORIES.has(expected.category)) {
        assert.ok(errorKinds.has(example.kind), example.id + " expects an error category but is kind " + example.kind);
      }
    }
  }
});
