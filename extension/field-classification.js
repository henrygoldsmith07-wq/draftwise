(() => {
  "use strict";

  const sensitiveTypes = new Set(["password", "hidden", "file", "checkbox", "radio", "submit", "button"]);
  const sensitiveAutocomplete = new Set([
    "current-password",
    "new-password",
    "one-time-code",
    "cc-number",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
    "cc-csc",
    "security-code",
  ]);

  function metadataTokens(element) {
    return [
      element?.name,
      element?.id,
      element?.type,
      element?.getAttribute?.("autocomplete"),
      element?.getAttribute?.("aria-label"),
      element?.getAttribute?.("placeholder"),
      element?.closest?.("form")?.getAttribute?.("autocomplete"),
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
    if (sensitiveAutocomplete.has(autocomplete)) return true;
    const tokens = metadataTokens(element);
    if (hasAny(tokens, ["password", "passwd", "passcode", "credential", "username", "login", "pin", "otp", "cvv", "cvc", "ssn", "secret"])) return true;
    if (tokens.includes("api") && tokens.includes("key")) return true;
    if (tokens.includes("access") && tokens.includes("token")) return true;
    if (tokens.includes("auth") && hasAny(tokens, ["token", "code", "key", "secret", "credential"])) return true;
    if (tokens.includes("authentication") && hasAny(tokens, ["token", "code", "key", "secret", "credential", "password"])) return true;
    if (tokens.includes("private") && tokens.includes("key")) return true;
    if (tokens.includes("credit") && tokens.includes("card")) return true;
    if (tokens.includes("card") && hasAny(tokens, ["number", "expiry", "expiration", "security", "cvv", "cvc"])) return true;
    if (tokens.includes("security") && hasAny(tokens, ["code", "question", "answer"])) return true;
    if (tokens.includes("one") && tokens.includes("time") && tokens.includes("code")) return true;
    return false;
  }

  globalThis.DraftwiseFieldClassifier = Object.freeze({ isSensitiveField, metadataTokens });
})();
