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

function field({ name = "", id = "", aria = "", placeholder = "", title = "", describedBy = "", referenced = {} } = {}) {
  return {
    type: "text",
    name,
    id,
    labels: [],
    disabled: false,
    readOnly: false,
    hidden: false,
    getAttribute(key) {
      return ({ "aria-label": aria, placeholder, title, autocomplete: "", "aria-labelledby": "", "aria-describedby": describedBy, "aria-hidden": "" })[key] || "";
    },
    closest(selector) {
      return selector === "form" ? { name: "", id: "", getAttribute: () => "" } : null;
    },
    ownerDocument: {
      getElementById(referenceId) {
        return Object.prototype.hasOwnProperty.call(referenced, referenceId) ? { textContent: referenced[referenceId] } : null;
      },
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

test("sensitive accessible helper text and title metadata block analysis", async () => {
  const { isSensitiveField } = await loadClassifier();
  assert.equal(isSensitiveField(field({ describedBy: "hint privacy", referenced: { hint: "Enter your access token", privacy: "Account credential" } })), true);
  assert.equal(isSensitiveField(field({ describedBy: "card-help", referenced: { "card-help": "Your credit card number" } })), true);
  assert.equal(isSensitiveField(field({ title: "API key" })), true);
});

test("normal writing metadata remains eligible and described-by lookup is bounded", async () => {
  const { isSensitiveField } = await loadClassifier();
  for (const normal of [
    field({ name: "articleBody" }),
    field({ id: "writingNotes2" }),
    field({ aria: "projectSummary" }),
    field({ title: "Draft introduction" }),
    field({ describedBy: "help", referenced: { help: "Write a short project summary" } }),
  ]) {
    assert.equal(isSensitiveField(normal), false);
  }

  const ids = Array.from({ length: 20 }, (_, index) => `hint-${index}`).join(" ");
  const referenced = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`hint-${index}`, index === 10 ? "password" : "ordinary writing help"]));
  assert.equal(isSensitiveField(field({ describedBy: ids, referenced })), false);
});
