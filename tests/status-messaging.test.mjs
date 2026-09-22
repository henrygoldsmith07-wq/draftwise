import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const editorUrl = new URL("../components/draftwise/EditorWorkspace.tsx", import.meta.url);
const settingsUrl = new URL("../components/draftwise/ProviderSettingsDialog.tsx", import.meta.url);

test("empty suggestion messaging depends on analysis work, not persistence status", async () => {
  const [page, editor] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(editorUrl, "utf8"),
  ]);
  assert.doesNotMatch(page, /statusLabel=\{/u);
  assert.doesNotMatch(editor, /statusLabel:/u);
  assert.match(editor, /props\.analyzing \? "Checking deeper analysis" : "Clean so far"/u);
  assert.match(editor, /Local checks are complete while deeper analysis runs\./u);
});

test("settings never claim an unverified local save", async () => {
  const settings = await readFile(settingsUrl, "utf8");
  assert.doesNotMatch(settings, /Saved locally/u);
  assert.doesNotMatch(settings, /setSaved/u);
  assert.match(settings, /const done = \(\) => onOpenChange\(false\);/u);
  assert.match(settings, /<Button onClick=\{done\}><ShieldCheck size=\{14\} \/> Done<\/Button>/u);
});
