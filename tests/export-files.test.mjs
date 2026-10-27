import assert from "node:assert/strict";
import test from "node:test";
import {
  exportAsText,
  exportAsMarkdown,
  safeFilename,
} from "../lib/import-export.ts";

/**
 * The export helpers must round-trip the draft byte for byte: the writer's
 * text leaves the editor exactly as it entered, with only the filename and
 * MIME type shaped around it.
 */

test("plain-text export preserves the draft exactly and names it from the title", () => {
  const draft = "First line.\n\nSecond   line,  kept as written.";
  const result = exportAsText("Quarterly report", draft);
  assert.equal(result.content, draft);
  assert.equal(result.type, "text/plain;charset=utf-8");
  assert.equal(result.filename, "Quarterly report.txt");
});

test("markdown export prefixes the title when the draft is not already markdown", () => {
  const result = exportAsMarkdown("My essay", "Body text.");
  assert.equal(result.type, "text/markdown;charset=utf-8");
  assert.match(result.content, /^# My essay\n\nBody text\.$/u);
  assert.equal(result.filename, "My essay.md");
});

test("markdown export never double-heads a draft that already starts with a heading", () => {
  const draft = "# Already a title\n\nBody.";
  const result = exportAsMarkdown("My essay", draft);
  assert.equal(result.content, draft);
});

test("titles are flattened into safe cross-platform filenames", () => {
  assert.equal(safeFilename('Report: final "draft" <v2>?'), "Report- final -draft- -v2-");
  assert.equal(safeFilename("a/b\\c*d?e\"f<g>h|i"), "a-b-c-d-e-f-g-h-i");
  // Control characters cannot appear in a filename.
  assert.equal(safeFilename("line\u0000one"), "line-one");
  // Long titles are truncated to at most 80 characters rather than rejected.
  assert.ok(safeFilename("word ".repeat(40)).length <= 80);
  // Empty titles fall back to "draft" so the file always has a name.
  assert.equal(safeFilename(""), "draft");
  assert.equal(safeFilename("///"), "draft");
});
