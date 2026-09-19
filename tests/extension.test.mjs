import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);
const file = (name) => new URL(name, root);

function browserLikeContext() {
  const listeners = { installed: [], startup: [], changed: [], removed: [], clicked: [], message: [] };
  const storage = { values: { siteAccess: [], disabledSites: [], aiEnabled: false, provider: { apiKey: "" } }, writes: 0 };
  const event = (name) => ({ addListener(handler) { listeners[name].push(handler); } });
  const context = {
    URL,
    console,
    DOMException,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }),
  };
  context.importScripts = (...names) => {
    for (const name of names) vm.runInNewContext(readFileSync(file(`extension/${name}`), "utf8"), context, { filename: name });
  };
  context.chrome = {
    runtime: { lastError: undefined, onInstalled: event("installed"), onStartup: event("startup"), onMessage: event("message"), openOptionsPage() {} },
    action: { onClicked: event("clicked") },
    storage: {
      local: {
        get(_keys, callback) { callback(storage.values); },
        set(value, callback) { storage.values = { ...storage.values, ...value }; storage.writes += 1; callback?.(); },
      },
      onChanged: event("changed"),
    },
    permissions: {
      contains(_value, callback) { callback(true); },
      getAll(callback) { callback({ origins: [] }); },
      onRemoved: event("removed"),
    },
    scripting: {
      registerContentScripts(_value, callback) { callback?.(); },
      unregisterContentScripts(_value, callback) { callback?.(); },
    },
  };
  return { context, listeners, storage };
}

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

test("generated bundles load at runtime and the service worker starts without reference errors", async () => {
  const runtime = browserLikeContext();
  assert.doesNotThrow(() => vm.runInNewContext(readFileSync(file("extension/shared-analysis.js"), "utf8"), runtime.context, { filename: "shared-analysis.js" }));
  assert.equal(typeof runtime.context.DraftwiseGrammar?.analyzeLocally, "function");
  assert.doesNotThrow(() => vm.runInNewContext(readFileSync(file("extension/shared-provider.js"), "utf8"), runtime.context, { filename: "shared-provider.js" }));
  assert.equal(typeof runtime.context.DraftwiseProvider?.analyzeWithProvider, "function");
  const result = await runtime.context.DraftwiseProvider.analyzeWithProvider("", { audience: "general", intent: "inform", tone: "neutral" }, { apiKey: "", baseUrl: "https://example.com/v1", model: "test-model", temperature: 0.2, maxTokens: 900, customHeaders: "" });
  assert.equal(result.analysedText, "");

  const serviceWorker = browserLikeContext();
  assert.doesNotThrow(() => vm.runInNewContext(readFileSync(file("extension/background.js"), "utf8"), serviceWorker.context, { filename: "background.js" }));
  assert.equal(serviceWorker.listeners.startup.length, 1);
  serviceWorker.listeners.startup[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(serviceWorker.storage.writes >= 1);
});

test("extension scripts parse and keep provider secrets out of the content script", async () => {
  for (const name of ["extension/content.js", "extension/background.js", "extension/options.js", "extension/field-classification.js", "extension/permissions.js", "extension/dom-utils.js", "extension/shared-analysis.js", "extension/shared-provider.js"]) {
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

function fakeElement(tagName, children = []) {
  const element = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: children,
    parentNode: null,
    matches(selector) {
      const lower = tagName.toLowerCase();
      return (selector.includes("textarea") && lower === "textarea") || (selector.includes("input") && lower === "input") || (selector.includes("contenteditable") && this.contentEditable === true);
    },
    getAttribute(name) { return name === "contenteditable" && this.contentEditable === true ? "true" : ""; },
    querySelectorAll(selector) {
      const found = [];
      const visit = (node) => {
        for (const child of node.childNodes || []) {
          if (child.matches?.(selector)) found.push(child);
          visit(child);
        }
      };
      visit(this);
      return found;
    },
  };
  for (const child of children) child.parentNode = element;
  return element;
}

function fakeText(value) {
  return { nodeType: 3, nodeName: "#text", textContent: value, childNodes: [], parentNode: null };
}

test("contenteditable text maps preserve paragraphs, br nodes, nested spans, and DOM ranges", async () => {
  const source = await readFile(file("extension/dom-utils.js"), "utf8");
  const ranges = [];
  const context = { console, document: { createRange() { const range = { setStart(node, offset) { range.start = { node, offset }; }, setEnd(node, offset) { range.end = { node, offset }; }, }; ranges.push(range); return range; } } };
  vm.runInNewContext(source, context);
  const hello = fakeText("Hello ");
  const world = fakeText("world");
  const first = fakeElement("p", [hello, fakeElement("span", [world])]);
  const next = fakeElement("p", [fakeText("Next"), fakeElement("br"), fakeText("line")]);
  const rootElement = fakeElement("div", [first, next]);
  const map = context.DraftwiseDom.buildEditableTextMap(rootElement);
  assert.equal(map.text, "Hello world\nNext\nline");
  const worldRange = map.rangeFor(6, 11);
  assert.equal(worldRange.start.node, world);
  assert.equal(worldRange.start.offset, 0);
  assert.equal(worldRange.end.node, world);
  assert.equal(worldRange.end.offset, 5);
  const breakRange = map.rangeFor(16, 17);
  assert.equal(breakRange.start.node.tagName, "P");
  assert.equal(breakRange.end.offset, 2);
  assert.equal(ranges.length, 2);
});

test("mutation handling binds only added editable subtrees", async () => {
  const source = await readFile(file("extension/dom-utils.js"), "utf8");
  const context = { console };
  vm.runInNewContext(source, context);
  const added = Array.from({ length: 400 }, (_, index) => fakeElement("textarea", [fakeText(String(index))]));
  const unrelated = fakeElement("div", added);
  const bound = [];
  context.DraftwiseDom.handleAddedNodes([{ type: "attributes", addedNodes: added }, { type: "childList", addedNodes: [unrelated] }], (node) => bound.push(node));
  assert.equal(bound.length, 400);
  assert.equal(new Set(bound).size, 400);
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
