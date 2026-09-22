import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const classifierUrl = new URL("../extension/field-classification.js", import.meta.url);

function loadClassifier() {
  const context = { console };
  return readFile(classifierUrl, "utf8").then((source) => {
    vm.runInNewContext(source, context, { filename: "field-classification.js" });
    return context.DraftwiseFieldClassifier;
  });
}

function field({ name = "", id = "", aria = "", placeholder = "" } = {}) {
  return {
    type: "text",
    name,
    id,
    labels: [],
    disabled: false,
    readOnly: false,
    hidden: false,
    getAttribute(key) {
      return ({ "aria-label": aria, placeholder, autocomplete: "", "aria-labelledby": "", "aria-hidden": "" })[key] || "";
    },
    closest(selector) {
      return selector === "form" ? { name: "", id: "", getAttribute: () => "" } : null;
    },
  };
}

test("camelCase and alpha-numeric metadata cannot bypass sensitive-field blocking", async () => {
  const { isSensitiveField, metadataTokens } = await loadClassifier();

  for (const sensitive of [
    field({ name: "creditCardNumber" }),
    field({ id: "bankAccountNumber" }),
    field({ aria: "oneTimeCode" }),
    field({ placeholder: "apiKey" }),
    field({ name: "routingNumber2" }),
  ]) {
    assert.equal(isSensitiveField(sensitive), true);
  }

  assert.deepEqual(Array.from(metadataTokens(field({ name: "creditCardNumber2" }))), ["credit", "card", "number", "2"]);
});

test("normal camelCase writing metadata remains eligible", async () => {
  const { isSensitiveField } = await loadClassifier();
  for (const normal of [
    field({ name: "articleBody" }),
    field({ id: "writingNotes2" }),
    field({ aria: "projectSummary" }),
  ]) {
    assert.equal(isSensitiveField(normal), false);
  }
});
