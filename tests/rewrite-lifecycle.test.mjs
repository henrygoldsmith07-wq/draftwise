import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rewriteUrl = new URL("../hooks/useRewrite.ts", import.meta.url);

async function rewriteSource() {
  return readFile(rewriteUrl, "utf8");
}

test("cancelling a rewrite invalidates the logical run and releases its controller", async () => {
  const source = await rewriteSource();
  const cancelStart = source.indexOf("const cancel = useCallback(() => {");
  const nextCallback = source.indexOf("const selectAlternative", cancelStart);
  assert.notEqual(cancelStart, -1, "cancel callback should exist");
  assert.notEqual(nextCallback, -1, "the next callback should exist");
  const cancel = source.slice(cancelStart, nextCallback);
  assert.ok(cancel.includes("runId.current += 1;"));
  assert.ok(cancel.includes("abort.current?.abort();"));
  assert.ok(cancel.includes("abort.current = null;"));
  assert.ok(cancel.includes("setPreview(null);"));
});

test("settled and unmounted rewrites release transport state and invalidate stale work", async () => {
  const source = await rewriteSource();
  assert.ok(source.includes("if (currentRun === runId.current && abort.current === controller) abort.current = null;"));

  const cleanupStart = source.indexOf("useEffect(() => () => {");
  const returnStart = source.indexOf("return { preview, run, cancel, selectAlternative }", cleanupStart);
  assert.notEqual(cleanupStart, -1, "unmount cleanup should exist");
  assert.notEqual(returnStart, -1, "hook return should follow cleanup");
  const cleanup = source.slice(cleanupStart, returnStart);
  assert.ok(cleanup.includes("runId.current += 1;"));
  assert.ok(cleanup.includes("abort.current?.abort();"));
  assert.ok(cleanup.includes("abort.current = null;"));
});
