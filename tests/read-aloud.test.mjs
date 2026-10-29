import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chooseVoice, speakableText, speechSegments } from "../lib/read-aloud.ts";

const hookSource = await readFile(new URL("../hooks/useReadAloud.ts", import.meta.url), "utf8");

// Read aloud is only useful if the highlight and the voice agree on what is
// being said, so the tests are mostly about offsets: every segment must be a
// contiguous piece of the draft, in order, covering the prose and nothing else.

test("a queued utterance does not undo a pause requested before it starts", () => {
  const onstart = hookSource.match(/utterance\.onstart = \(\) => \{([\s\S]*?)\n      \};/u)?.[1];
  assert.ok(onstart, "utterance start handler should exist");
  assert.match(onstart, /statusRef\.current !== "paused"/u,
    "the deferred utterance must preserve a pause requested before its onstart event");
  assert.match(hookSource, /statusRef\.current = "paused";[\s\S]*?setStatus\("paused"\)/u,
    "pause must update the synchronous status before the queued onstart callback runs");
});

test("segments are ordered, contiguous pieces of the draft", () => {
  const text = "The first sentence is here. The second one follows it! Is there a third?";
  const segments = speechSegments(text);
  assert.deepEqual(segments.map((segment) => segment.spoken), [
    "The first sentence is here.",
    "The second one follows it!",
    "Is there a third?",
  ]);
  for (const segment of segments) {
    assert.equal(text.slice(segment.start, segment.end), segment.spoken, "offsets must point at the spoken text");
  }
  assert.equal(segments.at(-1).end, text.length, "the last segment ends at the end of the draft");
});

test("headings and list markers are spoken as prose, not as punctuation", () => {
  const text = "# Quarterly update\n\n- Revenue grew by twelve percent.\n- Costs stayed flat.";
  const segments = speechSegments(text);
  assert.deepEqual(segments.map((segment) => segment.spoken), [
    "Quarterly update",
    "Revenue grew by twelve percent.",
    "Costs stayed flat.",
  ]);
  // The offset still covers the marker so the highlight includes the bullet.
  assert.equal(text.slice(segments[1].start, segments[1].end), "- Revenue grew by twelve percent.");
});

test("markdown emphasis and links are spoken without their syntax", () => {
  assert.equal(speakableText("This is **very** important and _fairly_ well `documented`."), "This is very important and fairly well documented.");
  assert.equal(speakableText("Read the [drafting guide](https://example.com/guide) first."), "Read the drafting guide first.");
  assert.equal(speakableText("![A chart of revenue](revenue.png) shows the trend."), "A chart of revenue shows the trend.");
  // A raw URL is not read out as a sequence of letters.
  assert.equal(speakableText("Contact <support@example.com> for help."), "Contact for help.");
});

test("fenced code is not read aloud", () => {
  const text = "Explain the function first.\n\n```js\nconst value = compute(1, 2);\n```\n\nThen describe the result.";
  const segments = speechSegments(text);
  assert.deepEqual(segments.map((segment) => segment.spoken), [
    "Explain the function first.",
    "Then describe the result.",
  ]);
  assert.ok(!segments.some((segment) => segment.spoken.includes("const value")), "source code is not prose");
});

test("a very long sentence is split so one utterance cannot be truncated", () => {
  // Chrome drops an utterance after roughly fifteen seconds of speech, so a
  // whole paragraph in one utterance stops silently. Each piece must stay
  // short, and every piece must still be a slice of the draft.
  const sentence = `${"The writer keeps adding clauses to a single sentence, ".repeat(12)}and then stops.`;
  const segments = speechSegments(sentence);
  assert.ok(segments.length > 1, "a long sentence needs more than one utterance");
  for (const segment of segments) {
    assert.ok(segment.spoken.length <= 220, `segment is ${segment.spoken.length} characters`);
    assert.ok(sentence.includes(segment.spoken), "the spoken text is a slice of the draft");
  }
  assert.equal(segments.map((segment) => segment.spoken).join(" ").replace(/\s+/gu, " "), sentence.replace(/\s+/gu, " "));
});

test("an empty or whitespace-only draft has nothing to read", () => {
  assert.deepEqual(speechSegments(""), []);
  assert.deepEqual(speechSegments("   \n\n \t"), []);
});

test("a draft that is only a code fence produces no segments", () => {
  assert.deepEqual(speechSegments("```\nconst value = 1;\n```"), []);
});

test("the voice matches the draft dialect, and prefers a local one", () => {
  const voices = [
    { name: "English (United States)", lang: "en-US", localService: true },
    { name: "English (United Kingdom)", lang: "en-GB", localService: false },
    { name: "Deutsch", lang: "de-DE", localService: true },
  ];
  assert.equal(chooseVoice(voices, "en-GB")?.lang, "en-GB", "the draft's dialect wins over the default");
  assert.equal(chooseVoice(voices, "en-US")?.lang, "en-US");
});

test("a local voice is preferred over a network voice in the same language", () => {
  const voices = [
    { name: "Network English", lang: "en-US", localService: false },
    { name: "System English", lang: "en-US", localService: true },
  ];
  assert.equal(chooseVoice(voices, "en-US")?.name, "System English", "offline reading must not depend on a server");
});

test("voice selection falls back sensibly and never invents a voice", () => {
  assert.equal(chooseVoice([], "en-GB"), null);
  // Only a different English dialect is installed: still better than a German
  // voice reading English, and the dialect preference is a preference.
  assert.equal(chooseVoice([{ name: "English", lang: "en-AU" }], "en-GB")?.lang, "en-AU");
  // No English at all: leave the utterance's default in charge.
  assert.equal(chooseVoice([{ name: "Deutsch", lang: "de-DE" }], "en-GB"), null);
  assert.equal(chooseVoice([{ name: "English", lang: "en_GB" }], "en-GB")?.lang, "en_GB", "underscore locales are common");
});
