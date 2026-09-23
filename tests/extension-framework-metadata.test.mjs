import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const sourceUrl = new URL("../extension/field-classification.js", import.meta.url);

async function classifier() {
  const source = await readFile(sourceUrl, "utf8");
  const context = { console };
  vm.runInNewContext(source, context);
  return context.DraftwiseFieldClassifier;
}

function element({ attributes = {}, form = null } = {}) {
  return {
    type: "text",
    name: "",
    id: "",
    labels: [],
    disabled: false,
    readOnly: false,
    hidden: false,
    getAttribute(name) { return attributes[name] || ""; },
    closest(selector) { return selector === "form" ? form : null; },
  };
}

function form(attributes = {}) {
  return {
    name: "",
    id: "",
    getAttribute(name) { return attributes[name] || ""; },
  };
}

test("framework field metadata cannot hide sensitive inputs behind generic DOM names", async () => {
  const { isSensitiveField } = await classifier();

  for (const attributes of [
    { "data-testid": "creditCardNumber" },
    { "data-test": "one-time-code-input" },
    { "data-field": "apiKey" },
    { "data-name": "bankAccountNumber" },
    { "data-purpose": "accessToken" },
  ]) {
    assert.equal(isSensitiveField(element({ attributes })), true, JSON.stringify(attributes));
  }
});

test("sensitive framework form metadata protects generic descendant fields", async () => {
  const { isSensitiveField } = await classifier();

  assert.equal(isSensitiveField(element({ form: form({ "data-testid": "paymentCheckout" }) })), true);
  assert.equal(isSensitiveField(element({ form: form({ "data-purpose": "authenticationToken" }) })), true);
});

test("ordinary framework metadata remains eligible for writing assistance", async () => {
  const { isSensitiveField } = await classifier();

  for (const attributes of [
    { "data-testid": "articleBody" },
    { "data-field": "draftNotes" },
    { "data-purpose": "writingEditor" },
  ]) {
    assert.equal(isSensitiveField(element({ attributes })), false, JSON.stringify(attributes));
  }
  assert.equal(isSensitiveField(element({ form: form({ "data-testid": "articlePublishForm" }) })), false);
});

test("framework metadata inspection remains bounded", async () => {
  const { metadataTokens } = await classifier();
  const tokens = metadataTokens(element({ attributes: { "data-testid": `article-${"x".repeat(20_000)}` } }));
  assert.ok(tokens.join(" ").length < 600);
});
