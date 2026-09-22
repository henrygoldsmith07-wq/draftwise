import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configUrl = new URL("../next.config.ts", import.meta.url);

test("web app config applies conservative security headers to every route", async () => {
  const config = await readFile(configUrl, "utf8");
  assert.match(config, /source:\s*"\/:path\*"/u);
  assert.match(config, /Content-Security-Policy/u);
  assert.match(config, /frame-ancestors 'none'/u);
  assert.match(config, /base-uri 'self'/u);
  assert.match(config, /object-src 'none'/u);
  assert.match(config, /Referrer-Policy[^\n]*no-referrer/u);
  assert.match(config, /X-Content-Type-Options[^\n]*nosniff/u);
  assert.match(config, /X-Frame-Options[^\n]*DENY/u);
  assert.match(config, /Permissions-Policy/u);
  assert.match(config, /camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\)/u);
});

test("security policy does not restrict BYOK provider connections", async () => {
  const config = await readFile(configUrl, "utf8");
  assert.doesNotMatch(config, /connect-src/u);
  assert.doesNotMatch(config, /default-src/u);
});
