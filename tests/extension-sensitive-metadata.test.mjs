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

function field({ name = "", id = "", aria = "", placeholder = "", title = "", autocomplete = "", describedBy = "", referenced = {}, formAction = "", formName = "", formId = "", formAria = "", roleFormAria = "", roleFormPurpose = "", fieldsetLegend = "", fieldsetPurpose = "" } = {}) {
  const roleForm = roleFormAria || roleFormPurpose ? {
    name: "", id: "", getAttribute(key) { return ({ "aria-label": roleFormAria, "data-purpose": roleFormPurpose, autocomplete: "", action: "" })[key] || ""; },
  } : null;
  const fieldset = fieldsetLegend || fieldsetPurpose ? {
    getAttribute(key) { return ({ "data-purpose": fieldsetPurpose })[key] || ""; },
    querySelector(selector) { return selector === ":scope > legend" && fieldsetLegend ? { textContent: fieldsetLegend } : null; },
  } : null;
  return {
    type: "text", name, id, labels: [], disabled: false, readOnly: false, hidden: false,
    getAttribute(key) { return ({ "aria-label": aria, placeholder, title, autocomplete, "aria-labelledby": "", "aria-describedby": describedBy, "aria-hidden": "" })[key] || ""; },
    closest(selector) {
      if (selector === "form") {
        if (!(formAction || formName || formId || formAria)) return null;
        return { name: formName, id: formId, getAttribute(key) { return ({ "aria-label": formAria, autocomplete: "", action: formAction })[key] || ""; } };
      }
      if (selector === '[role="form"]') return roleForm;
      if (selector === "fieldset") return fieldset;
      return null;
    },
    ownerDocument: { getElementById(referenceId) { return Object.prototype.hasOwnProperty.call(referenced, referenceId) ? { textContent: referenced[referenceId] } : null; } },
  };
}

test("camelCase and alpha-numeric metadata cannot bypass sensitive-field blocking", async () => {
  const { isSensitiveField, metadataTokens } = await loadClassifier();
  for (const sensitive of [field({ name: "creditCardNumber" }), field({ id: "bankAccountNumber" }), field({ aria: "oneTimeCode" }), field({ placeholder: "apiKey" }), field({ name: "routingNumber2" })]) assert.equal(isSensitiveField(sensitive), true);
  const tokens = Array.from(metadataTokens(field({ name: "creditCardNumber2" })));
  for (const token of ["credit", "card", "number", "2"]) assert.ok(tokens.includes(token));
});

test("sensitive accessible helper text and title metadata block analysis", async () => {
  const { isSensitiveField } = await loadClassifier();
  assert.equal(isSensitiveField(field({ describedBy: "hint privacy", referenced: { hint: "Enter your access token", privacy: "Account credential" } })), true);
  assert.equal(isSensitiveField(field({ describedBy: "card-help", referenced: { "card-help": "Your credit card number" } })), true);
  assert.equal(isSensitiveField(field({ title: "API key" })), true);
});

test("health and identity-document metadata block extension analysis", async () => {
  const { isSensitiveField } = await loadClassifier();
  for (const sensitive of [
    field({ aria: "Medical history" }),
    field({ placeholder: "Health record" }),
    field({ name: "patientIdentifier" }),
    field({ title: "Passport number" }),
    field({ describedBy: "licence-help", referenced: { "licence-help": "Enter your driving licence number" } }),
    field({ formAria: "Medical record" }),
  ]) assert.equal(isSensitiveField(sensitive), true);

  for (const normal of [
    field({ aria: "Health article draft" }),
    field({ name: "medicalEssay" }),
    field({ placeholder: "Passport travel article" }),
    field({ title: "Driving lesson notes" }),
  ]) assert.equal(isSensitiveField(normal), false);
});

test("diagnostic, genetic, prescription, and insurance identifiers are sensitive", async () => {
  const { isSensitiveField } = await loadClassifier();
  for (const sensitive of [
    field({ aria: "Medical diagnosis" }),
    field({ name: "prescriptionNumber" }),
    field({ placeholder: "Genetic test result" }),
    field({ title: "Insurance policy number" }),
    field({ name: "insuranceMemberId" }),
    field({ describedBy: "subscriber-help", referenced: { "subscriber-help": "Enter insurance subscriber ID" } }),
  ]) assert.equal(isSensitiveField(sensitive), true);

  for (const normal of [
    field({ placeholder: "Genetic testing essay" }),
    field({ title: "Insurance policy analysis" }),
    field({ name: "prescriptionWritingGuide" }),
  ]) assert.equal(isSensitiveField(normal), false);
});

test("government identifiers and birth dates are treated as sensitive metadata", async () => {
  const { isSensitiveField } = await loadClassifier();
  for (const sensitive of [
    field({ aria: "Social Security Number" }),
    field({ name: "socialSecurityId" }),
    field({ placeholder: "National Insurance number" }),
    field({ title: "NHS number" }),
    field({ aria: "Date of birth" }),
    field({ name: "birthDate" }),
    field({ describedBy: "identity-help", referenced: { "identity-help": "Enter your date of birth" } }),
  ]) assert.equal(isSensitiveField(sensitive), true);

  for (const normal of [
    field({ aria: "Social security policy essay" }),
    field({ title: "Birth announcement draft" }),
    field({ placeholder: "NHS funding article" }),
  ]) assert.equal(isSensitiveField(normal), false);
});

test("personal autocomplete semantics block analysis even on generic text inputs", async () => {
  const { isSensitiveField } = await loadClassifier();
  for (const autocomplete of [
    "bday", "bday-day", "bday-month", "bday-year",
    "address-level1", "address-level2", "address-level3", "address-level4",
    "sex", "photo", "impp",
    "section-profile bday", "section-shipping shipping address-level2",
  ]) assert.equal(isSensitiveField(field({ name: "value", autocomplete })), true, autocomplete);

  for (const autocomplete of ["off", "on", "organization", "organization-title", "language"]) {
    assert.equal(isSensitiveField(field({ name: "articleBody", autocomplete })), false, autocomplete);
  }
});

test("sensitive form context blocks generic fields", async () => {
  const { isSensitiveField } = await loadClassifier();
  for (const sensitive of [
    field({ name: "value", formAction: "/account/login" }),
    field({ id: "entry", formAction: "https://example.test/auth/token" }),
    field({ name: "details", formAction: "/checkout/payment" }),
    field({ name: "answer", formName: "securityQuestion" }),
  ]) assert.equal(isSensitiveField(sensitive), true);

  assert.equal(isSensitiveField(field({ name: "body", formAction: "/articles/publish", formName: "editor" })), false);
});

test("semantic form and fieldset context protect generic fields on modern forms", async () => {
  const { isSensitiveField } = await loadClassifier();
  for (const sensitive of [
    field({ name: "value", roleFormAria: "Payment details" }),
    field({ id: "entry", roleFormPurpose: "accountLogin" }),
    field({ name: "answer", fieldsetLegend: "Security question" }),
    field({ name: "value", fieldsetPurpose: "bankAccount" }),
  ]) assert.equal(isSensitiveField(sensitive), true);

  for (const normal of [
    field({ name: "body", roleFormAria: "Article editor" }),
    field({ name: "notes", fieldsetLegend: "Writing details" }),
  ]) assert.equal(isSensitiveField(normal), false);
});

test("normal writing metadata remains eligible and described-by lookup is bounded", async () => {
  const { isSensitiveField } = await loadClassifier();
  for (const normal of [field({ name: "articleBody" }), field({ id: "writingNotes2" }), field({ aria: "projectSummary" }), field({ title: "Draft introduction" }), field({ describedBy: "help", referenced: { help: "Write a short project summary" } })]) assert.equal(isSensitiveField(normal), false);
  const ids = Array.from({ length: 20 }, (_, index) => `hint-${index}`).join(" ");
  const referenced = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`hint-${index}`, index === 10 ? "password" : "ordinary writing help"]));
  assert.equal(isSensitiveField(field({ describedBy: ids, referenced })), false);
});
