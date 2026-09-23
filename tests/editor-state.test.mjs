import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const rewriteUrl = new URL("../hooks/useRewrite.ts", import.meta.url);
const settingsUrl = new URL("../components/draftwise/ProviderSettingsDialog.tsx", import.meta.url);

test("new drafts require confirmation and preserve the previous text in session history", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /Start a new draft\?/u);
  assert.match(page, /if \(!workspace\.draft\.trim\(\)\)/u);
  const start = page.match(/const startNewDocument = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/u);
  assert.ok(start);
  assert.match(start[1], /commit\(""\)/u);
  assert.doesNotMatch(start[1], /resetHistory/u);
});

test("destructive local-data clearing is confirmed and editor shortcuts do not fire behind dialogs", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /Clear all local Draftwise data\?/u);
  assert.match(page, /settingsOpen \|\| shortcutsOpen \|\| newDraftOpen \|\| clearDataOpen/u);
  assert.match(page, /setClearDataOpen\(true\)/u);
});

test("rewrite-context changes cancel stale previews and requests", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /const updateProvider = useCallback[\s\S]*cancelRewrite\(\)[\s\S]*updateWorkspace\(\{ provider \}\)/u);
  assert.match(page, /const updateStyle = useCallback[\s\S]*cancelRewrite\(\)[\s\S]*updateWorkspace\(\{ style \}\)/u);
  assert.match(page, /const updateGoals = useCallback[\s\S]*cancelRewrite\(\)/u);
  assert.match(page, /if \(!aiEnabled\) cancelRewrite\(\)/u);

  const rewrite = await readFile(rewriteUrl, "utf8");
  assert.match(rewrite, /replacement: "", explanation:/u);
  const cleanup = rewrite.match(/useEffect\(\(\) => \(\) => \{([\s\S]*?)\n  \}, \[\]\);/u);
  assert.ok(cleanup, "rewrite unmount cleanup should exist");
  assert.match(cleanup[1], /runId\.current \+= 1/u);
  assert.match(cleanup[1], /abort\.current\?\.abort\(\)/u);
  assert.match(cleanup[1], /abort\.current = null/u);
});


test("forgetting cloud credentials clears custom headers too", async () => {
  const settings = await readFile(settingsUrl, "utf8");
  assert.match(settings, /onSettingsChange\(\{ \.\.\.settings, apiKey: "", customHeaders: "" \}\)/u);
  assert.match(settings, /Forget cloud credentials/u);
});

test("Save & close remains open when immediate persistence fails", async () => {
  const settings = await readFile(settingsUrl, "utf8");
  assert.match(settings, /const result = onSave\?\.\(\);/u);
  assert.match(settings, /if \(result && !result\.ok\) return;/u);
  assert.match(settings, /onOpenChange\(false\);/u);
});

test("undo and redo cancel stale rewrite state and reset selection", async () => {
  const page = await readFile(pageUrl, "utf8");
  const applyHistory = page.match(/const applyHistory = useCallback\(\(next: string \| undefined\) => \{([\s\S]*?)\n  \}, \[[^\]]*\]\);/u);
  assert.ok(applyHistory, "applyHistory callback should exist");
  assert.match(applyHistory[1], /cancelRewrite\(\)/u);
  assert.match(applyHistory[1], /updateDraft\(next, false\)/u);
  assert.match(applyHistory[1], /setSelection\(\{ start: 0, end: 0 \}\)/u);
  assert.match(applyHistory[1], /setActiveIssueId\(null\)/u);
});
