import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

/**
 * The segmentation helper lives in the .tsx component (it is the single source
 * of truth for what the mirror layer paints). Node cannot import a .tsx file
 * directly, so we lift the pure, JSX-free helper out of that same file by its
 * markers, strip its TypeScript annotations, and import it from a data URL.
 */
const source = readFileSync(new URL("../components/draftwise/EditorPrimitives.tsx", import.meta.url), "utf8");
const startMarker = "// <highlight-segments-helper>";
const endMarker = "// </highlight-segments-helper>";
const from = source.indexOf(startMarker);
const to = source.indexOf(endMarker);
assert.notEqual(from, -1, "helper start marker missing in EditorPrimitives.tsx");
assert.notEqual(to, -1, "helper end marker missing in EditorPrimitives.tsx");
assert.ok(to > from, "helper markers are out of order");
const helperSource = source.slice(from + startMarker.length, to);
assert.ok(helperSource.includes("export function buildHighlightSegments"), "helper is not exported");
const jsSource = stripTypeScriptTypes(helperSource);
const { buildHighlightSegments } = await import(
  `data:text/javascript;base64,${Buffer.from(jsSource, "utf8").toString("base64")}`
);

const issue = (id, start, end, category = "grammar") => ({ id, start, end, category });

// Reduce a segment to the observable facts the mirror layer renders from it.
const shape = (segments) => segments.map(({ start, end, text, issue: found, isSpoken }) => ({
  start,
  end,
  text,
  issue: found ? found.id : null,
  isSpoken,
}));

test("no issues yields one plain run spanning the whole draft", () => {
  assert.deepEqual(shape(buildHighlightSegments("hello world", [], null)), [
    { start: 0, end: 11, text: "hello world", issue: null, isSpoken: false },
  ]);
});

test("a single issue splits the draft into a highlighted run and a plain tail", () => {
  const found = issue("only", 0, 5, "spelling");
  assert.deepEqual(shape(buildHighlightSegments("hello world", [found], null)), [
    { start: 0, end: 5, text: "hello", issue: "only", isSpoken: false },
    { start: 5, end: 11, text: " world", issue: null, isSpoken: false },
  ]);
});

test("adjacent issues produce neighbouring highlighted runs with no gap", () => {
  const issues = [
    issue("a", 0, 2),
    issue("b", 2, 4),
    issue("c", 4, 6),
  ];
  assert.deepEqual(shape(buildHighlightSegments("abcdef", issues, null)), [
    { start: 0, end: 2, text: "ab", issue: "a", isSpoken: false },
    { start: 2, end: 4, text: "cd", issue: "b", isSpoken: false },
    { start: 4, end: 6, text: "ef", issue: "c", isSpoken: false },
  ]);
});

test("overlapping issues attribute shared runs to the first in sorted order", () => {
  // Deliberately unsorted input. Sorted order is a[0,4], b[2,8].
  const issues = [
    issue("b", 2, 8, "style"),
    issue("a", 0, 4, "grammar"),
  ];
  // [2,4] is covered by both; `a` sorts first and must win, exactly as
  // safeIssues.find(...) did. After `a` ends, `b` takes over; then plain tail.
  assert.deepEqual(shape(buildHighlightSegments("abcdefghij", issues, null)), [
    { start: 0, end: 2, text: "ab", issue: "a", isSpoken: false },
    { start: 2, end: 4, text: "cd", issue: "a", isSpoken: false },
    { start: 4, end: 8, text: "efgh", issue: "b", isSpoken: false },
    { start: 8, end: 10, text: "ij", issue: null, isSpoken: false },
  ]);
});

test("nested issues keep the outer assignment until it ends, then fall through", () => {
  const issues = [
    issue("outer", 0, 10),
    issue("inner", 3, 6, "clarity"),
  ];
  assert.deepEqual(shape(buildHighlightSegments("abcdefghij", issues, null)), [
    { start: 0, end: 3, text: "abc", issue: "outer", isSpoken: false },
    { start: 3, end: 6, text: "def", issue: "outer", isSpoken: false },
    { start: 6, end: 10, text: "ghij", issue: "outer", isSpoken: false },
  ]);
});

test("zero-length, out-of-range, and edge ranges are ignored", () => {
  const issues = [
    issue("zero", 3, 3),
    issue("negative", -2, 3),
    issue("tooLong", 2, 999),
    issue("valid", 1, 3),
  ];
  assert.deepEqual(shape(buildHighlightSegments("abcdef", issues, null)), [
    { start: 0, end: 1, text: "a", issue: null, isSpoken: false },
    { start: 1, end: 3, text: "bc", issue: "valid", isSpoken: false },
    { start: 3, end: 6, text: "def", issue: null, isSpoken: false },
  ]);
});

test("edge cases: empty text and an empty issue list produce no runs", () => {
  assert.deepEqual(shape(buildHighlightSegments("", [], null)), []);
  assert.deepEqual(shape(buildHighlightSegments("a", [], null)), [
    { start: 0, end: 1, text: "a", issue: null, isSpoken: false },
  ]);
});

test("a spoken range cuts the draft and can overlap a finding", () => {
  const found = issue("a", 0, 6, "grammar");
  assert.deepEqual(shape(buildHighlightSegments("abcdefghij", [found], { start: 4, end: 8 })), [
    { start: 0, end: 4, text: "abcd", issue: "a", isSpoken: false },
    { start: 4, end: 6, text: "ef", issue: "a", isSpoken: true },
    { start: 6, end: 8, text: "gh", issue: null, isSpoken: true },
    { start: 8, end: 10, text: "ij", issue: null, isSpoken: false },
  ]);
});

test("an invalid spoken range is ignored", () => {
  const found = issue("a", 0, 2);
  assert.deepEqual(shape(buildHighlightSegments("abcdef", [found], { start: 2, end: 2 })), [
    { start: 0, end: 2, text: "ab", issue: "a", isSpoken: false },
    { start: 2, end: 6, text: "cdef", issue: null, isSpoken: false },
  ]);
});
