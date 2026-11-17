import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chooseVoice, speakableText, speechSegments } from "../lib/read-aloud.ts";

const hookUrl = new URL("../hooks/useReadAloud.ts", import.meta.url);

async function hookSource() {
  return readFile(hookUrl, "utf8");
}

// Read aloud is only useful if the highlight and the voice agree on what is
// being said, so the tests are mostly about offsets: every segment must be a
// contiguous piece of the draft, in order, covering the prose and nothing else.

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

// The hook itself drives the browser's speech engine, which cannot be exercised
// in this suite: it needs a React renderer and `window.speechSynthesis` /
// `SpeechSynthesisUtterance`, neither of which exists in Node, and it imports
// the `@/...` path alias that Node's ESM loader does not resolve. This repo has
// no jsdom / react-test-renderer / testing-library harness (see package.json),
// and its established way to pin hook lifecycle rules — e.g.
// `rewrite-lifecycle.test.mjs` and `editor-state.test.mjs` — is to assert on the
// hook's source. The pure, browser-free behaviour (segmentation, voice choice)
// is covered behaviourally by the tests above; the lifecycle invariants below
// are pinned statically so a queued start cannot leak into a new view.

test("the deferred first segment keeps its timer id so a queued start can be cancelled", async () => {
  const source = await hookSource();
  // Cancelling and speaking in the same task makes Chrome drop the utterance,
  // so the zero-delay setTimeout is load-bearing and must stay.
  assert.match(source, /same task makes Chrome/u, "the reason for the deferred start is preserved");
  assert.match(source, /useRef<number \| null>\(null\)/u, "the deferred start's timer id is held in a ref");
  assert.match(source, /clearPendingStart/u, "a helper clears the pending timer");

  const start = source.match(/const start = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/u);
  assert.ok(start, "start callback should exist");
  const body = start[1];
  // A new run supersedes any start still queued from the previous one.
  const clearAt = body.indexOf("clearPendingStart()");
  const scheduleAt = body.indexOf("window.setTimeout(");
  assert.ok(clearAt !== -1 && scheduleAt !== -1 && clearAt < scheduleAt, "the previous timer is cleared before a new one is queued");
  assert.match(body, /startTimerRef\.current = window\.setTimeout\(\(\) => \{[\s\S]*?speakFrom\(0, run\)[\s\S]*?\}, 0\);/u);
  assert.match(body, /startTimerRef\.current = null;/u, "a timer that fires clears its own id");
});

test("unmount clears a queued start and invalidates its run token", async () => {
  const source = await hookSource();
  const cleanupStart = source.indexOf("useEffect(() => () => {");
  const returnStart = source.indexOf("return { supported,", cleanupStart);
  assert.notEqual(cleanupStart, -1, "unmount cleanup should exist");
  assert.notEqual(returnStart, -1, "the hook return should follow cleanup");
  const cleanup = source.slice(cleanupStart, returnStart);
  assert.match(cleanup, /clearPendingStart\(\)/u, "the queued first-segment timer is cleared");
  assert.match(cleanup, /runRef\.current \+= 1/u, "the run token is invalidated if the callback was already dispatched");
  assert.match(cleanup, /cancelEngine\(\)/u, "the engine is still stopped");
  const clearAt = cleanup.indexOf("clearPendingStart()");
  const invalidateAt = cleanup.indexOf("runRef.current += 1");
  const cancelAt = cleanup.indexOf("cancelEngine()");
  assert.ok(clearAt < invalidateAt && invalidateAt < cancelAt, "both guards run before the engine is cancelled");
});

test("stopping or a draft change also drops a queued start", async () => {
  const source = await hookSource();
  const resetStart = source.indexOf("const reset = useCallback((");
  const speakStart = source.indexOf("const speakFrom = useCallback((", resetStart);
  assert.notEqual(resetStart, -1, "reset callback should exist");
  assert.notEqual(speakStart, -1, "speakFrom callback should follow reset");
  const reset = source.slice(resetStart, speakStart);
  assert.match(reset, /clearPendingStart\(\)/u, "reset clears a start queued for the next tick");
  assert.match(reset, /runRef\.current \+= 1/u, "reset also invalidates the run token");
});

test("a stale queued callback still cannot start speech on its own", async () => {
  const source = await hookSource();
  const speak = source.match(/const speakFrom = useCallback\(\(index: number, run: number\) => \{([\s\S]*?)\n  \}, \[/u);
  assert.ok(speak, "speakFrom callback should exist");
  assert.match(speak[1], /if \(!engine \|\| run !== runRef\.current\) return;/u, "the run token gates every utterance");
});
