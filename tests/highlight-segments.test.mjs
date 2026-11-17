import assert from "node:assert/strict";
import test from "node:test";
import { buildHighlightSegments } from "../lib/highlight-segments.ts";

/** Minimal WritingIssue-shaped object; the helper only needs id/start/end. */
function issue(id, start, end, extra = {}) {
  return { id, start, end, category: "grammar", ...extra };
}

function seg(start, end, text, issue = null, isSpoken = false, isActive = false) {
  return { start, end, text, issue, isSpoken, isActive };
}

/** Concatenating every run must rebuild the draft exactly. */
function rebuild(segments) {
  return segments.map((segment) => segment.text).join("");
}

test("no issues: one plain run covering the whole draft", () => {
  const text = "Hello world";
  assert.deepEqual(buildHighlightSegments(text, []), [seg(0, 11, "Hello world")]);
});

test("empty text produces no runs", () => {
  assert.deepEqual(buildHighlightSegments("", []), []);
  assert.deepEqual(buildHighlightSegments("", [issue("i1", 0, 1)]), []);
});

test("one issue splits the draft into plain / highlighted / plain", () => {
  const text = "The cat sat";
  const cat = issue("i1", 4, 7);
  assert.deepEqual(buildHighlightSegments(text, [cat]), [
    seg(0, 4, "The "),
    seg(4, 7, "cat", cat),
    seg(7, 11, " sat"),
  ]);
  assert.equal(rebuild(buildHighlightSegments(text, [cat])), text);
});

test("activeIssueId marks only the matching issue run", () => {
  const text = "The cat sat";
  const cat = issue("i1", 4, 7);
  assert.deepEqual(buildHighlightSegments(text, [cat], null, "i1"), [
    seg(0, 4, "The "),
    seg(4, 7, "cat", cat, false, true),
    seg(7, 11, " sat"),
  ]);
  assert.deepEqual(buildHighlightSegments(text, [cat], null, "other"), [
    seg(0, 4, "The "),
    seg(4, 7, "cat", cat),
    seg(7, 11, " sat"),
  ]);
});

test("multiple sorted issues each get their own run with plain gaps", () => {
  const text = "abc def ghi";
  const def = issue("i1", 4, 7);
  const ghi = issue("i2", 8, 11);
  const segments = buildHighlightSegments(text, [def, ghi]);
  assert.deepEqual(segments, [
    seg(0, 4, "abc "),
    seg(4, 7, "def", def),
    seg(7, 8, " "),
    seg(8, 11, "ghi", ghi),
  ]);
  assert.equal(rebuild(segments), text);
});

test("unsorted input is sorted by start then end, like the original JSX", () => {
  const text = "abc def ghi";
  const ghi = issue("i2", 8, 11);
  const def = issue("i1", 4, 7);
  assert.deepEqual(buildHighlightSegments(text, [ghi, def]), buildHighlightSegments(text, [def, ghi]));
});

test("overlapping issues: the first in (start, end) order colours the shared run", () => {
  const text = "abcdefghij";
  const a = issue("a", 0, 6);
  const b = issue("b", 2, 8);
  const segments = buildHighlightSegments(text, [a, b]);
  assert.deepEqual(segments, [
    seg(0, 2, "ab", a),
    seg(2, 6, "cdef", a),
    seg(6, 8, "gh", b),
    seg(8, 10, "ij"),
  ]);
  assert.equal(rebuild(segments), text);
});

test("overlapping issues with the same start resolve by shorter end first", () => {
  const text = "abcdefgh";
  const longer = issue("long", 1, 7);
  const shorter = issue("short", 1, 4);
  assert.deepEqual(buildHighlightSegments(text, [longer, shorter]), [
    seg(0, 1, "a"),
    seg(1, 4, "bcd", shorter),
    seg(4, 7, "efg", longer),
    seg(7, 8, "h"),
  ]);
});

test("issues at the very start and very end of the text", () => {
  const text = "hello";
  const first = issue("first", 0, 2);
  const last = issue("last", 3, 5);
  assert.deepEqual(buildHighlightSegments(text, [first, last]), [
    seg(0, 2, "he", first),
    seg(2, 3, "l"),
    seg(3, 5, "lo", last),
  ]);
});

test("invalid issues are ignored: negative start, past end, and empty ranges", () => {
  const text = "abcdef";
  const valid = issue("ok", 1, 3);
  const negative = issue("neg", -2, 2);
  const pastEnd = issue("past", 4, 99);
  const empty = issue("empty", 2, 2);
  const reversed = issue("rev", 5, 4);
  assert.deepEqual(buildHighlightSegments(text, [negative, valid, pastEnd, empty, reversed]), [
    seg(0, 1, "a"),
    seg(1, 3, "bc", valid),
    seg(3, 6, "def"),
  ]);
});

test("spoken range adds boundaries and marks fully-contained runs", () => {
  const text = "The quick brown fox";
  const brown = issue("brown", 10, 15);
  const segments = buildHighlightSegments(text, [brown], { start: 4, end: 15 });
  assert.deepEqual(segments, [
    seg(0, 4, "The "),
    seg(4, 10, "quick ", null, true),
    seg(10, 15, "brown", brown, true),
    seg(15, 19, " fox"),
  ]);
  assert.equal(rebuild(segments), text);
});

test("an invalid spoken range is treated as absent", () => {
  const text = "abcdef";
  assert.deepEqual(buildHighlightSegments(text, [], { start: 2, end: 2 }), [seg(0, 6, "abcdef")]);
  assert.deepEqual(buildHighlightSegments(text, [], { start: -1, end: 3 }), [seg(0, 6, "abcdef")]);
  assert.deepEqual(buildHighlightSegments(text, [], { start: 1, end: 99 }), [seg(0, 6, "abcdef")]);
});

test("large input: hundreds of issues resolve correctly in linear time", () => {
  const count = 400;
  const spacing = 10;
  const text = "abcdefghij".repeat(count);
  const issues = [];
  for (let index = 0; index < count; index += 1) {
    issues.push(issue(`i${index}`, index * spacing + 2, index * spacing + 6));
  }

  const segments = buildHighlightSegments(text, issues);

  // Boundaries are 0, each issue start/end, and text.length: one leading plain
  // run, then a highlighted + plain run per issue (the trailing plain run of
  // one unit merges with the leading plain run of the next).
  assert.equal(segments.length, count * 2 + 1);
  assert.equal(rebuild(segments), text);

  assert.deepEqual(segments[0], seg(0, 2, text.slice(0, 2)));
  for (let index = 0; index < count; index += 1) {
    const base = index * spacing;
    const plainEnd = index + 1 < count ? (index + 1) * spacing + 2 : text.length;
    assert.deepEqual(segments[1 + index * 2], seg(base + 2, base + 6, text.slice(base + 2, base + 6), issues[index]));
    assert.deepEqual(segments[2 + index * 2], seg(base + 6, plainEnd, text.slice(base + 6, plainEnd)));
  }

  const active = buildHighlightSegments(text, issues, null, `i${count - 1}`).filter((segment) => segment.isActive);
  assert.equal(active.length, 1);
  assert.equal(active[0].issue.id, `i${count - 1}`);
});

test("large input: hundreds of overlapping issues still pick the first covering issue", () => {
  const count = 300;
  const spacing = 4;
  const text = "x".repeat(count * spacing + 10);
  const issues = [];
  for (let index = 0; index < count; index += 1) {
    // Each issue reaches into the next one, so every interior run is covered
    // by two issues and the earlier one must win.
    issues.push(issue(`i${index}`, index * spacing, index * spacing + spacing + 2));
  }

  const segments = buildHighlightSegments(text, issues);
  assert.equal(rebuild(segments), text);

  // Walk runs in order and confirm any highlighted run carries the earliest
  // still-covering issue, matching the original find() behaviour.
  for (const segment of segments) {
    if (!segment.issue) continue;
    const expected = issues.find((item) => item.start <= segment.start && item.end >= segment.end);
    assert.equal(segment.issue.id, expected.id, `run [${segment.start}, ${segment.end})`);
  }
});
