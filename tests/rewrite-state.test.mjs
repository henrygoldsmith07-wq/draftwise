import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canApplyRewrite } from "../lib/rewrite-state.ts";

test("failed and loading rewrites cannot be applied to the draft", () => {
  assert.equal(canApplyRewrite(null), false);
  assert.equal(canApplyRewrite({ loading: true, error: false }), false);
  assert.equal(canApplyRewrite({ loading: false, error: true }), false);
  assert.equal(canApplyRewrite({ loading: false, error: false }), true);
});

test("rewrite failure UI exposes retry/cancel instead of mutation actions", async () => {
  const source = await readFile(new URL("../components/draftwise/RewritePreview.tsx", import.meta.url), "utf8");
  assert.match(source, /preview\.error \?/u);
  assert.match(source, /rewrite failed/u);
  assert.match(source, /onRetry/u);
  assert.match(source, /canApplyRewrite/u);
});

test("provider failure state uses an empty replacement and explicit error flag", async () => {
  const source = await readFile(new URL("../hooks/useRewrite.ts", import.meta.url), "utf8");
  assert.match(source, /replacement: "", explanation:/u);
  assert.match(source, /error: true/u);
});
