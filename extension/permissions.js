(() => {
  "use strict";

  function normaliseHostname(value) {
    const raw = String(value || "").trim().toLocaleLowerCase();
    if (!raw) throw new Error("Enter a hostname such as example.com.");
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (!parsed.hostname || parsed.username || parsed.password || parsed.pathname !== "/" && parsed.pathname !== "") throw new Error("Enter a hostname without a path.");
    const hostname = parsed.hostname.replace(/^www\./u, "");
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return hostname;
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(hostname)) throw new Error("Enter a valid hostname such as example.com.");
    return hostname;
  }

  function sitePatterns(value) {
    const hostname = normaliseHostname(value);
    return [`https://${hostname}/*`, `http://${hostname}/*`];
  }

  function providerPattern(baseUrl) {
    const parsed = new URL(String(baseUrl || "").trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) throw new Error("Provider access requires HTTPS, except for localhost.");
    if (parsed.username || parsed.password || parsed.hash) throw new Error("Provider URLs cannot contain credentials or fragments.");
    return `${parsed.origin}/*`;
  }

  function siteScriptId(value) {
    const hostname = normaliseHostname(value);
    let hash = 2_166_136_261;
    for (let index = 0; index < hostname.length; index += 1) {
      hash ^= hostname.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    const readable = hostname.replace(/[^a-z0-9]+/gu, "-").slice(0, 48);
    return `draftwise-site-${readable}-${(hash >>> 0).toString(36)}`.slice(0, 80);
  }

  globalThis.DraftwisePermissions = Object.freeze({ normaliseHostname, sitePatterns, providerPattern, siteScriptId });
})();
