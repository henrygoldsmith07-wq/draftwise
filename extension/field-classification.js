(() => {
  "use strict";

  const sensitiveTypes = new Set(["password", "hidden", "file", "checkbox", "radio", "submit", "button", "email", "tel", "number", "date", "datetime-local", "month", "week", "time", "url", "range", "color"]);
  const sensitiveAutocomplete = new Set([
    "current-password",
    "new-password",
    "one-time-code",
    "webauthn",
    "cc-number",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
    "cc-csc",
    "security-code",
    "email",
    "tel",
    "name",
    "given-name",
    "additional-name",
    "family-name",
    "street-address",
    "address-line1",
    "address-line2",
    "address-line3",
    "postal-code",
    "country",
    "country-name",
    "cc-name",
    "cc-given-name",
    "cc-additional-name",
    "cc-family-name",
    "cc-type",
    "transaction-currency",
    "transaction-amount",
  ]);

  function associatedLabelText(element) {
    const explicitLabels = Array.from(element?.labels || []).map((label) => label?.textContent || "");
    const wrappingLabel = element?.closest?.("label")?.textContent || "";
    const labelledBy = String(element?.getAttribute?.("aria-labelledby") || "")
      .split(/\s+/u)
      .filter(Boolean)
      .map((id) => element?.ownerDocument?.getElementById?.(id)?.textContent || "");
    return [...explicitLabels, wrappingLabel, ...labelledBy].filter(Boolean).join(" ");
  }

  function metadataTokens(element) {
    const form = element?.closest?.("form");
    return [
      element?.name,
      element?.id,
      element?.type,
      element?.getAttribute?.("autocomplete"),
      element?.getAttribute?.("aria-label"),
      element?.getAttribute?.("placeholder"),
      associatedLabelText(element),
      form?.name,
      form?.id,
      form?.getAttribute?.("aria-label"),
      form?.getAttribute?.("autocomplete"),
    ].filter(Boolean).join(" ").toLocaleLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
  }

  function hasAny(tokens, values) {
    return values.some((value) => tokens.includes(value));
  }

  function isSensitiveField(element) {
    if (!element || element.disabled || element.readOnly || element.hidden || element.getAttribute?.("aria-hidden") === "true") return true;
    const type = String(element.type || "").toLocaleLowerCase();
    if (sensitiveTypes.has(type)) return true;
    const autocomplete = String(element.getAttribute?.("autocomplete") || "").toLocaleLowerCase();
    const autocompleteTokens = autocomplete.split(/\s+/u).filter(Boolean);
    if (autocompleteTokens.some((token) => sensitiveAutocomplete.has(token))) return true;
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
