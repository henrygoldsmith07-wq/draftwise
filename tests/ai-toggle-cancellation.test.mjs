import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const rewriteUrl = new URL("../hooks/useRewrite.ts", import.meta.url);

test("turning AI off cancels an active rewrite before updating workspace state", async () => {
  const page = await readFile(pageUrl, "utf8");
  const callback = page.match(/const updateAiEnabled = useCallback\(\(aiEnabled: boolean\) => \{([\s\S]*?)\n  \}, \[cancelRewrite, updateWorkspace\]\);/u);
  assert.ok(callback, "updateAiEnabled callback should exist");
  const cancelIndex = callback[1].indexOf("cancelRewrite()");
  const updateIndex = callback[1].indexOf("updateWorkspace({ aiEnabled })");
  assert.ok(cancelIndex >= 0, "AI disable should cancel rewrites");
  assert.ok(updateIndex > cancelIndex, "rewrite cancellation should happen before state update");
  assert.match(page, /onAiEnabledChange=\{updateAiEnabled\}/u);
});

test("rewrite requests are aborted when the rewrite hook unmounts", async () => {
  const rewrite = await readFile(rewriteUrl, "utf8");
  assert.match(rewrite, /useEffect\(\(\) => \(\) => abort\.current\?\.abort\(\), \[\]\);/u);
});
