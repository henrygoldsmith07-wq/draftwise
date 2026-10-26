import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";
/**
 * The toolbar popup.
 *
 * The popup is the extension's front door, and it answers a question a
 * writer asks constantly: "is this field clean, and what would you change?"
 *
 * Two things are worth pinning here. The first is the wording: a writer told
 * "nothing found" when the truth is "Draftwise is not running here" will
 * believe their writing was checked when it was not, and will carry on
 * believing they are being helped. The second is the boundary: the popup
 * must not need, or be given, any more access than the extension already
 * has.
 */

const root = new URL("../", import.meta.url);
const file = (name) => new URL(name, root);
const read = (name) => readFileSync(file(name), "utf8");

function popupLogic() {
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(read("extension/popup-logic.js"), context, { filename: "popup-logic.js" });
  return context.DraftwisePopupLogic;
}

test("the popup says how many suggestions there are, in plain words", () => {
  const logic = popupLogic();
  assert.equal(logic.countLabel([]), "");
  assert.equal(logic.countLabel(undefined), "");
  assert.equal(logic.countLabel([{ title: "One" }]), "1 suggestion");
  assert.equal(logic.countLabel([{ title: "One" }, { title: "Two" }]), "2 suggestions");
});

test("a clean field is named, so the writer knows what was checked", () => {
  const logic = popupLogic();
  const clean = logic.cleanState({ fieldHint: "Message body" });
  assert.match(clean.title, /Nothing to fix/u);
  // Naming the field is what makes the message reassuring: "nothing to fix
  // here" could otherwise mean "nothing to fix anywhere".
  assert.match(clean.detail, /Message body/u);

  // Without a label it still has to say something useful.
  const unnamed = logic.cleanState({});
  assert.match(unnamed.title, /Nothing to fix/u);
  assert.ok(unnamed.detail.length > 0);
});

test("the popup tells the truth about a page it is not checking", () => {
  const logic = popupLogic();
  // Two different problems with two different fixes, so two different
  // sentences. Telling a writer who has switched Draftwise off for a site
  // that "nothing was found" would be a lie in the writer's favour.
  const disabled = logic.blockedState({ code: "disabled", reason: "Draftwise is switched off for this site." });
  assert.match(disabled.title, /switched off/u);
  assert.match(disabled.detail, /switched off for this site/u);

  const noField = logic.blockedState({ code: "no-field" });
  assert.match(noField.title, /Nothing is being checked/u);
  assert.match(noField.detail, /text field/u);

  // A page the extension does not run on at all is not an error.
  const notRunning = logic.notRunningState();
  assert.match(notRunning.title, /not running/u);
  assert.match(notRunning.detail, /Grant access/u);
});

test("the popup never says the field is clean when it was never checked", () => {
  const logic = popupLogic();
  // The clean-state message is only ever for a field that was checked. Every
  // other state must use a different one.
  const blocked = logic.blockedState({ code: "no-field" });
  assert.doesNotMatch(blocked.title, /Nothing to fix/u);
  const notRunning = logic.notRunningState();
  assert.doesNotMatch(notRunning.title, /Nothing to fix/u);
});

test("the popup is declared, and its files are there", async () => {
  const manifest = JSON.parse(read("extension/manifest.json"));
  assert.equal(manifest.action.default_popup, "popup.html");
  // A popup replaces the old behaviour where the toolbar button opened the
  // options page in a new tab, which took the writer away from what they
  // were writing.
  assert.notEqual(manifest.action.default_title, "Draftwise settings");
  // The popup is loaded by the browser, so every file it names has to be
  // in the extension.
  assert.ok(read("extension/popup.html").includes('src="popup-logic.js"'));
  assert.ok(read("extension/popup.html").includes('src="popup.js"'));
});
test("the popup scripts parse", () => {
  for (const name of ["extension/popup.js", "extension/popup-logic.js"]) {
    const result = spawnSync(process.execPath, ["--check", name], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test("the popup builds its text with DOM nodes, never with interpolated HTML", () => {
  // The extension's UI echoes the writer's own text, so it is built from
  // text nodes. A page that granted access must not be able to inject markup
  // into the extension's own interface.
  const popup = read("extension/popup.js");
  assert.doesNotMatch(popup, /innerHTML/u);
  assert.doesNotMatch(popup, /outerHTML/u);
  assert.doesNotMatch(popup, /insertAdjacentHTML/u);
  assert.match(popup, /textContent/u);
});

test("the popup asks the page for the findings rather than working them out", () => {
  // The findings live in the content script, where the text is. The popup
  // must not go looking for the field itself.
  const popup = read("extension/popup.js");
  assert.match(popup, /chrome\.tabs\.sendMessage/u);
  assert.match(popup, /draftwise-popup-state/u);
  // It must not read the tab's address: the extension has no permission to,
  // and the popup does not need it. The site switch is flipped by the
  // content script, which already knows which host it is running on.
  assert.doesNotMatch(popup, /tab\.url/u);
  assert.match(popup, /draftwise-popup-disable-site/u);
});

test("the popup asks for no permission the extension does not already hold", () => {
  const manifest = JSON.parse(read("extension/manifest.json"));
  // "tabs" would give the extension a view of every URL the writer visits.
  // The popup reads the tab id and the load status, and nothing else.
  assert.deepEqual(manifest.permissions, ["storage", "scripting"]);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.host_permissions.length, 0);
});

test("only the extension's own pages can ask the content script for the state", () => {
  const content = read("extension/content.js");
  const handler = content.match(/chrome\.runtime\.onMessage\.addListener\([\s\S]*?\n  \}\);/u);
  assert.ok(handler, "the content script listens for messages");
  // A web page cannot reach this listener, and the check makes the boundary
  // explicit rather than assumed.
  assert.match(handler[0], /sender\.id !== chrome\.runtime\.id/u);
  // And it answers only the three questions the popup asks.
  assert.match(handler[0], /draftwise-popup-state/u);
  assert.match(handler[0], /draftwise-popup-apply/u);
  assert.match(handler[0], /draftwise-popup-dismiss/u);
  assert.match(handler[0], /draftwise-popup-disable-site/u);
});

test("the popup's view of the field never carries the field's text", () => {
  // The suggestions themselves are the ones the writer is already being
  // shown in the page. The field's value is not, and must not be.
  const content = read("extension/content.js");
  const state = content.match(/function popupState\(\)[\s\S]*?\n  \}/u);
  assert.ok(state, "the content script builds the popup state");
  assert.doesNotMatch(state[0], /textOf\(/u);
  assert.doesNotMatch(state[0], /\.value/u);
  // The hint is a label, never the content.
  const hint = content.match(/function fieldHint\(\)[\s\S]*?\n  \}/u);
  assert.ok(hint, "the content script describes the field");
  assert.match(hint[0], /aria-label/u);
  assert.doesNotMatch(hint[0], /\.value/u);
});

/**
 * A small DOM, enough for the popup.
 *
 * The popup is mostly plumbing: ask the page, build some nodes, put them in
 * the document. That plumbing is exactly what goes wrong silently — a
 * missing element, a helper that did not load, a message that is never
 * sent — so it is exercised here against a stub the test controls.
 */
function stubElement(tag) {
  const element = {
    tagName: String(tag).toUpperCase(),
    className: "",
    hidden: false,
    children: [],
    listeners: {},
    style: {
      values: {},
      setProperty(name, value) { this.values[name] = value; },
    },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, handler) {
      (this.listeners[type] = this.listeners[type] || []).push(handler);
    },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    click() { for (const handler of this.listeners.click || []) handler(); },
    get textContent() {
      return (this._text || "") + this.children.map((child) => child.textContent).join("");
    },
    set textContent(value) { this._text = value; },
  };
  return element;
}

function popupEnvironment(options) {
  const ids = {
    body: stubElement("div"),
    count: stubElement("span"),
    source: stubElement("span"),
    "disable-site": stubElement("button"),
    settings: stubElement("button"),
  };
  const sent = [];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    document: {
      getElementById: (id) => ids[id] || null,
      createElement: (tag) => stubElement(tag),
    },
    window: { close() { context.closed = true; } },
    chrome: {
      tabs: {
        query: async () => (options.tabId === undefined ? [] : [{ id: options.tabId }]),
        sendMessage: async (tabId, message) => {
          sent.push({ tabId, message });
          if (options.answer instanceof Error) throw options.answer;
          return typeof options.answer === "function" ? options.answer(message) : options.answer;
        },
      },
      runtime: { openOptionsPage() { context.openedOptions = true; } },
    },
  };
  context.globalThis = context;
  context.closed = false;
  context.openedOptions = false;
  vm.runInNewContext(read("extension/popup-logic.js"), context, { filename: "popup-logic.js" });
  vm.runInNewContext(read("extension/popup.js"), context, { filename: "popup.js" });
  return { context, ids, sent };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("the popup shows the suggestions the page found", async () => {
  const { ids, sent } = popupEnvironment({
    tabId: 5,
    answer: {
      ok: true,
      source: "Local",
      fieldHint: "Message body",
      findings: [
        { ruleId: "spelling", title: "Spelling", category: "spelling", severity: "high", explanation: "Check this word.", original: "seperate", replacement: "separate", tier: "fix-first", start: 4, end: 12 },
      ],
    },
  });
  await settle();

  assert.equal(sent[0].message.type, "draftwise-popup-state");
  assert.equal(sent[0].tabId, 5);
  // The count is in the header.
  assert.match(ids.count.textContent, /1 suggestion/u);
  // The finding is rendered with its reason and its replacement.
  assert.match(ids.body.textContent, /Spelling/u);
  assert.match(ids.body.textContent, /seperate/u);
  assert.match(ids.body.textContent, /separate/u);
  // And it is a button that can be pressed.
  const accept = ids.body.children[0].children
    .flatMap((child) => child.children || [])
    .find((node) => node.className === "dw-accept");
  assert.ok(accept, "the finding carries an Accept button");
  accept.click();
  await settle();
  const applied = sent.find((entry) => entry.message.type === "draftwise-popup-apply");
  assert.ok(applied, "accepting sends the finding back to the page");
  assert.equal(applied.message.finding.original, "seperate");
});

test("the popup says so when Draftwise is not running on the page", async () => {
  const { ids } = popupEnvironment({ tabId: 6, answer: new Error("Could not establish connection") });
  await settle();
  // A page the writer has not granted is the ordinary case, not an error.
  assert.match(ids.body.textContent, /not running here/u);
  assert.match(ids.body.textContent, /Grant access/u);
  // It must not claim the writing was checked.
  assert.doesNotMatch(ids.body.textContent, /reads cleanly/u);
});

test("the popup says so when there is no field to check", async () => {
  const { ids } = popupEnvironment({ tabId: 7, answer: { ok: false, code: "no-field" } });
  await settle();
  assert.match(ids.body.textContent, /Nothing is being checked/u);
  assert.doesNotMatch(ids.body.textContent, /reads cleanly/u);
});

test("the popup reports a clean field as clean", async () => {
  const { ids } = popupEnvironment({
    tabId: 8,
    answer: { ok: true, source: "Local", fieldHint: "Message body", findings: [] },
  });
  await settle();
  assert.match(ids.body.textContent, /Nothing to fix/u);
  assert.match(ids.body.textContent, /Message body/u);
});

test("the popup opens the settings when asked", async () => {
  const { context, ids } = popupEnvironment({
    tabId: 9,
    answer: { ok: true, source: "Local", fieldHint: "", findings: [] },
  });
  await settle();
  ids.settings.click();
  assert.equal(context.openedOptions, true);
});
