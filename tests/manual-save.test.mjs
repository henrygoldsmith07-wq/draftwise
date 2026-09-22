import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const persistenceUrl = new URL("../hooks/useDraftPersistence.ts", import.meta.url);

test("Ctrl/Cmd+S invokes the explicit local save path", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /saveNow/u);
  assert.match(page, /event\.key\.toLowerCase\(\) === "s"\) \{ event\.preventDefault\(\); saveNow\(\); return; \}/u);
});

test("manual save refuses to overwrite storage before hydration and reports write results", async () => {
  const persistence = await readFile(persistenceUrl, "utf8");
  const callback = persistence.match(/const saveNow = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[hydrated, workspace\]\);/u);
  assert.ok(callback, "saveNow callback should exist");
  assert.match(callback[1], /if \(!hydrated\)/u);
  assert.match(callback[1], /writeWorkspaceToStorage\(workspace, window\.localStorage\)/u);
  assert.match(callback[1], /setSaveStatus\("saved"\)/u);
  assert.match(callback[1], /setSaveStatus\("error"\)/u);
});
