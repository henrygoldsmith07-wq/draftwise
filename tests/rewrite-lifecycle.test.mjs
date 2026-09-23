import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rewriteUrl = new URL("../hooks/useRewrite.ts", import.meta.url);

test("cancelling a rewrite invalidates the logical run and releases its controller", async () => {
  const source = await readFile(rewriteUrl, "utf8");
  const cancelStart = source.indexOf("const cancel = useCallback(() => {");
  const cancelEnd = source.indexOf("\n  }, []);", cancelStart);
  assert.notEqual(cancelStart, -1, "cancel callback should exist");
  assert.notEqual(cancelEnd, -1, "cancel callback should have a stable boundary");
  const cancel = source.slice(cancelStart, cancelEnd);
  assert.match(cancel, /runId\.current \+= 1/u);
  assert.match(cancel, /abort\.current\?\.abort\(\)/u);
  assert.match(cancel, /abort\.current = null/u);
  assert.match(cancel, /setPreview\(null\)/u);
});

test("settled and unmounted rewrites release transport state and invalidate stale work", async () => {
  const source = await readFile(rewriteUrl, "utf8");
  assert.match(source, /finally \{\s*if \(currentRun === runId\.current && abort\.current === controller\) abort\.current = null;\s*\}/u);
  assert.match(source, /useEffect\(\(\) => \(\) => \{\s*runId\.current \+= 1;\s*abort\.current\?\.abort\(\);\s*abort\.current = null;\s*\}, \[\]\)/u);
});
