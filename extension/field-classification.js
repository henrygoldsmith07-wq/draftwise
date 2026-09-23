(() => {
  "use strict";

  const sensitiveTypes = new Set(["password", "hidden", "file", "checkbox", "radio", "submit", "button", "email", "tel", "number", "date", "datetime-local", "month", "week", "time", "url", "range", "color"]);
  const sensitiveAutocomplete = new Set([
    "current-password", "new-password", "one-time-code", "webauthn", "cc-number", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-csc", "security-code", "email", "tel", "name", "given-name", "additional-name", "family-name", "street-address", "address-line1", "address-line2", "address-line3", "address-level1", "address-level2", "address-level3", "address-level4", "postal-code", "country", "country-name", "cc-name", "cc-given-name", "cc-additional-name", "cc-family-name", "cc-type", "transaction-currency", "transaction-amount", "bday", "bday-day", "bday-month", "bday-year", "sex", "photo", "impp",
  ]);

  const MAX_METADATA_PART_CHARS = 512;
  const MAX_ASSOCIATED_LABELS = 8;
  const FRAMEWORK_METADATA_ATTRIBUTES = ["data-testid", "data-test", "data-field", "data-name", "data-purpose"];

  function metadataPart(value) { return String(value || "").slice(0, MAX_METADATA_PART_CHARS); }
  function normaliseMetadataPart(value) {
    return metadataPart(value).replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/([A-Za-z])([0-9])/gu, "$1 $2").replace(/([0-9])([A-Za-z])/gu, "$1 $2");
  }
  function referencedText(element, attribute) {
    return metadataPart(element?.getAttribute?.(attribute)).split(/\s+/u).filter(Boolean).slice(0, MAX_ASSOCIATED_LABELS).map((id) => metadataPart(element?.ownerDocument?.getElementById?.(id)?.textContent));
  }
  function associatedLabelText(element) {
    const explicitLabels = Array.from(element?.labels || []).slice(0, MAX_ASSOCIATED_LABELS).map((label) => metadataPart(label?.textContent));
    const wrappingLabel = metadataPart(element?.closest?.("label")?.textContent);
    return [...explicitLabels, wrappingLabel, ...referencedText(element, "aria-labelledby"), ...referencedText(element, "aria-describedby")].filter(Boolean).join(" ");
  }
  function frameworkMetadata(element) {
    return FRAMEWORK_METADATA_ATTRIBUTES.map((attribute) => element?.getAttribute?.(attribute));
  }
  function containerMetadata(container) {
    if (!container) return [];
    return [container?.name, container?.id, container?.getAttribute?.("aria-label"), container?.getAttribute?.("autocomplete"), container?.getAttribute?.("action"), ...frameworkMetadata(container)];
  }
  function metadataParts(element) {
    const form = element?.closest?.("form");
    const roleForm = form ? null : element?.closest?.('[role="form"]');
    const fieldset = element?.closest?.("fieldset");
    const legend = metadataPart(fieldset?.querySelector?.(":scope > legend")?.textContent);
    return [element?.name, element?.id, element?.type, element?.getAttribute?.("autocomplete"), element?.getAttribute?.("aria-label"), element?.getAttribute?.("placeholder"), element?.getAttribute?.("title"), associatedLabelText(element), ...frameworkMetadata(element), ...containerMetadata(form || roleForm), legend, ...frameworkMetadata(fieldset)].map(normaliseMetadataPart).filter(Boolean);
  }
  function metadataTokens(element) { return metadataParts(element).join(" ").toLocaleLowerCase().split(/[^a-z0-9]+/u).filter(Boolean); }
  function hasAny(tokens, values) { return values.some((value) => tokens.includes(value)); }
  function hasSensitivePhrase(element) {
    return metadataParts(element).some((part) => /(?:api\s*key|access\s*token|private\s*key|credit\s*card|bank\s*account|routing\s*number|sort\s*code|one\s*time\s*code|medical\s*(?:history|record|diagnosis)|health\s*record|patient\s*(?:id|identifier|number)|prescription\s*(?:id|number)|genetic\s*(?:test|result|record)|insurance\s*(?:policy|member|membership|subscriber)\s*(?:id|number)|passport\s*(?:id|number)|driv(?:er|ing)\s*licen[cs]e(?:\s*(?:id|number))?|social\s*security\s*(?:id|number)|national\s*insurance\s*(?:id|number)|nhs\s*(?:id|number)|date\s*of\s*birth|birth\s*date)/u.test(part.toLocaleLowerCase()));
  }
  function isSensitiveField(element) {
    if (!element || element.disabled || element.readOnly || element.hidden || element.getAttribute?.("aria-hidden") === "true") return true;
    const type = String(element.type || "").toLocaleLowerCase();
    if (sensitiveTypes.has(type)) return true;
    const autocomplete = String(element.getAttribute?.("autocomplete") || "").toLocaleLowerCase();
    const autocompleteTokens = autocomplete.split(/\s+/u).filter(Boolean);
    if (autocompleteTokens.some((token) => sensitiveAutocomplete.has(token))) return true;
    if (hasSensitivePhrase(element)) return true;
    const tokens = metadataTokens(element);
    if (hasAny(tokens, ["password", "passwd", "passcode", "credential", "username", "login", "signin", "payment", "checkout", "banking", "cardholder", "iban", "swift", "pin", "otp", "cvv", "cvc", "ssn", "secret"])) return true;
    if ((tokens.includes("sign") || tokens.includes("log")) && tokens.includes("in")) return true;
    if (hasAny(tokens, ["email", "phone", "telephone", "mobile", "postcode", "zipcode"])) return true;
    if (tokens.includes("postal") && hasAny(tokens, ["code", "address"])) return true;
    if (tokens.includes("street") && tokens.includes("address")) return true;
    if (tokens.includes("api") && tokens.includes("key")) return true;
    if (tokens.includes("access") && tokens.includes("token")) return true;
    if (tokens.includes("auth") && hasAny(tokens, ["token", "code", "key", "secret", "credential"])) return true;
    if (tokens.includes("authentication") && hasAny(tokens, ["token", "code", "key", "secret", "credential", "password"])) return true;
    if (tokens.includes("private") && tokens.includes("key")) return true;
    if (tokens.includes("credit") && tokens.includes("card")) return true;
    if (tokens.includes("card") && hasAny(tokens, ["number", "expiry", "expiration", "security", "cvv", "cvc"])) return true;
    if (tokens.includes("bank") && hasAny(tokens, ["account", "routing", "sort"])) return true;
    if (tokens.includes("account") && tokens.includes("number")) return true;
    if (tokens.includes("routing") && tokens.includes("number")) return true;
    if (tokens.includes("sort") && tokens.includes("code")) return true;
    if (tokens.includes("national") && tokens.includes("insurance")) return true;
    if (tokens.includes("tax") && hasAny(tokens, ["id", "number", "identifier"])) return true;
    if (tokens.includes("security") && hasAny(tokens, ["code", "question", "answer"])) return true;
    if (tokens.includes("one") && tokens.includes("time") && tokens.includes("code")) return true;
    return false;
  }
  globalThis.DraftwiseFieldClassifier = Object.freeze({ isSensitiveField, metadataTokens });
})();
