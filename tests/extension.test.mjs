import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);
const file = (name) => new URL(name, root);

test("extension manifest keeps host access optional and includes generated shared bundles", async () => {
  const manifest = JSON.parse(await readFile(file("extension/manifest.json"), "utf8"));
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"));
  assert.deepEqual(manifest.permissions, ["storage", "activeTab"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
  assert.deepEqual(manifest.content_scripts[0].js, ["shared-analysis.js", "content.js"]);
  await readFile(file("extension/shared-analysis.js"), "utf8");
  await readFile(file("extension/shared-provider.js"), "utf8");
});

test("extension scripts parse and keep provider secrets out of the content script", async () => {
  for (const name of ["extension/content.js", "extension/background.js", "extension/options.js", "extension/shared-analysis.js", "extension/shared-provider.js"]) {
    const result = spawnSync(process.execPath, ["--check", name], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
  const content = await readFile(file("extension/content.js"), "utf8");
  assert.ok(!/apiKey|innerHTML|dangerouslySetInnerHTML/iu.test(content));
  assert.match(content, /textContent/iu);
  const background = await readFile(file("extension/background.js"), "utf8");
  assert.match(background, /chrome\.storage\.local\.get/iu);
  assert.match(background, /shared-provider/iu);
});
