import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CHARS,
  importDocument,
  oversizedImport,
} from "../lib/import-export.ts";

/**
 * The import size bounds, pinned with their rationale.
 *
 * A huge file used to be read fully into memory and only then refused, so the
 * byte check runs pre-read on `file.size` while the character check runs on
 * the decoded string. Both bounds must stay because neither implies the
 * other: ASCII text hits the character bound first (~0.5 MB), dense
 * multibyte text hits the byte bound first. These tests pin the ceilings and
 * the user-facing messages so a future bump is deliberate, not drift.
 */

test("the ceilings are the documented 2 MB / 500,000 characters", () => {
  assert.equal(MAX_IMPORT_BYTES, 2_000_000);
  assert.equal(MAX_IMPORT_CHARS, 500_000);
});

test("a file over 2 MB is refused before it is read, with a plain message", () => {
  const refusal = oversizedImport({ size: MAX_IMPORT_BYTES + 1 });
  assert.ok(refusal);
  assert.match(refusal, /2 MB/);
});

test("a file at exactly 2 MB passes the pre-read check", () => {
  assert.equal(oversizedImport({ size: MAX_IMPORT_BYTES }), null);
  assert.equal(oversizedImport({ size: 1024 }), null);
});

test("text over 500,000 characters is refused with a plain message", () => {
  const result = importDocument("draft.txt", "a".repeat(MAX_IMPORT_CHARS + 1));
  assert.equal(result.ok, false);
  assert.match(result.error, /500,000 characters/);
});

test("text at the character ceiling still imports", () => {
  const result = importDocument("draft.md", `# Title\n\n${"a".repeat(MAX_IMPORT_CHARS - 20)}`);
  assert.equal(result.ok, true);
});

test("binary-looking content is refused even under both ceilings", () => {
  // A NUL byte inside otherwise-short text: the control-character scan in
  // looksBinary must catch it before it reaches the analysers.
  const result = importDocument("draft.txt", "hello\u0000world");
  assert.equal(result.ok, false);
  assert.match(result.error, /binary/);
});
