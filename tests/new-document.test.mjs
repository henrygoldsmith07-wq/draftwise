import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("starting a new draft requires confirmation for non-empty content", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /Start a new draft\?/u);
  assert.match(page, /if \(!workspace\.draft\.trim\(\)\)/u);
  assert.match(page, /setNewDraftOpen\(true\)/u);
});

test("starting a new draft remains undoable instead of resetting history", async () => {
  const page = await readFile(pageUrl, "utf8");
  const start = page.match(/const startNewDocument = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[commit, updateWorkspace\]\);/u);
  assert.ok(start, "startNewDocument callback should exist");
  assert.match(start[1], /commit\(""\)/u);
  assert.doesNotMatch(start[1], /resetHistory/u);
});
