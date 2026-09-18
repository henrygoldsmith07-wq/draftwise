import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);
const file = (name) => new URL(name, root);

test("extension manifest keeps host access optional and includes generated shared bundles", async () => {
  const manifest = JSON.parse(await readFile(file("extension/manifest.json"), "utf8"));
  assert.ok(!JSON.stringify(manifest).includes("<all_urls>"));
  assert.deepEqual(manifest.permissions, ["storage", "activeTab", "scripting"]);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*", "http://*/*"]);
  assert.equal(manifest.content_scripts, undefined);
  await readFile(file("extension/shared-analysis.js"), "utf8");
  await readFile(file("extension/shared-provider.js"), "utf8");
  await readFile(file("extension/field-classification.js"), "utf8");
  await readFile(file("extension/permissions.js"), "utf8");
});

test("extension scripts parse and keep provider secrets out of the content script", async () => {
  for (const name of ["extension/content.js", "extension/background.js", "extension/options.js", "extension/field-classification.js", "extension/permissions.js", "extension/shared-analysis.js", "extension/shared-provider.js"]) {
    const result = spawnSync(process.execPath, ["--check", name], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
  const content = await readFile(file("extension/content.js"), "utf8");
  assert.ok(!/apiKey|innerHTML|dangerouslySetInnerHTML/iu.test(content));
  assert.match(content, /textContent/iu);
  assert.match(content, /analyzeLocallyIncremental/iu);
  const background = await readFile(file("extension/background.js"), "utf8");
  assert.match(background, /chrome\.storage\.local\.get/iu);
  assert.match(background, /shared-provider/iu);
  assert.match(background, /registerContentScripts/iu);
  assert.match(background, /providerPattern/iu);
});

test("sensitive field classification uses explicit tokens without blocking normal writing fields", async () => {
  const source = await readFile(file("extension/field-classification.js"), "utf8");
  const context = { URL, console };
  vm.runInNewContext(source, context);
  const classify = context.DraftwiseFieldClassifier.isSensitiveField;
  const field = ({ type = "text", name = "", id = "", autocomplete = "", aria = "", placeholder = "" } = {}) => ({
    type, name, id, disabled: false, readOnly: false, hidden: false,
    getAttribute(key) { return ({ autocomplete, "aria-label": aria, placeholder })[key] || ""; },
    closest() { return { getAttribute: () => "" }; },
  });
  for (const normal of [field({ name: "author" }), field({ name: "authority" }), field({ placeholder: "Authentication explanation" }), field({ name: "notes" }), field({ name: "search" }), field({ name: "title" })]) assert.equal(classify(normal), false);
  for (const sensitive of [field({ type: "password" }), field({ name: "auth_token" }), field({ name: "api_key" }), field({ name: "cvv" }), field({ name: "otp" }), field({ name: "pin" })]) assert.equal(classify(sensitive), true);
});

test("permission helpers derive narrow site and provider origins", async () => {
  const source = await readFile(file("extension/permissions.js"), "utf8");
  const context = { URL };
  vm.runInNewContext(source, context);
  const permissions = context.DraftwisePermissions;
  assert.deepEqual(Array.from(permissions.sitePatterns("www.example.com")), ["https://example.com/*", "http://example.com/*"]);
  assert.equal(permissions.providerPattern("https://api.openai.com/v1"), "https://api.openai.com/*");
  assert.throws(() => permissions.normaliseHostname("example.com/path"));
});
