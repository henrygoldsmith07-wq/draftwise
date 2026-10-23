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
  // This used to assert that no connect-src existed at all, because a policy
  // that named only 'self' would silently break every BYOK provider — and an
  // app whose AI silently stopped working is worse than one without the header.
  //
  // connect-src is now set, so the intent behind that test is asserted directly:
  // it must still admit the providers validateProviderUrl accepts (HTTPS
  // anywhere, HTTP on localhost) and must not force a specific host.
  const policy = /Content-Security-Policy[^\n]*value:\s*"([^"]+)"/u.exec(config);
  assert.ok(policy, "Content-Security-Policy must be declared in next.config.ts");
  const [, directives] = policy;
  const connectSrc = /connect-src ([^;]+)/u.exec(directives);
  assert.ok(connectSrc, "connect-src must be declared explicitly");
  assert.match(connectSrc[1], /https:/u, "BYOK providers may live on any HTTPS host");
  assert.match(connectSrc[1], /http:\/\/localhost:\*/u, "localhost providers for local models must work");
  assert.doesNotMatch(connectSrc[1], /api\.(openai|anthropic|google)\.com/u, "no vendor host may be pinned into the policy");
});

test("the policy constrains scripts instead of leaving them unconstrained", async () => {
  const config = await readFile(configUrl, "utf8");
  // This assertion used to forbid default-src outright, on the grounds that
  // it "would need a full review before being introduced" — a fair position,
  // because the previous policy named no script-src either, and with no
  // default-src that left scripts loadable from ANY origin.
  //
  // The review is done and is enforced by a browser test: the policy is taken
  // out of this file, attached to a real page, and the app is driven through
  // it. e2e/deployment-headers.spec.mjs fails on any refusal the browser
  // reports, which is the failure mode a unit test could not catch.
  //
  // What protects the app from a wrong guess is now the browser test, so the
  // directive that makes the policy real can be introduced.
  const policy = /Content-Security-Policy[^\n]*value:\s*"([^"]+)"/u.exec(config);
  assert.ok(policy, "Content-Security-Policy must be declared in next.config.ts");
  const [, directives] = policy;
  assert.match(directives, /default-src 'self'/u, "the policy must constrain everything it does not name");
  assert.match(directives, /script-src 'self'/u, "scripts must be same-origin");
  assert.match(directives, /style-src 'self'/u, "styles must be same-origin");
  // The app sets suggestion colours and issue highlights through style
  // attributes, and Next emits inline bootstrap scripts, so both need the
  // inline allowance — a policy without it breaks the app rather than
  // tightening it.
  assert.match(directives, /script-src 'self' 'unsafe-inline'/u);
  assert.match(directives, /style-src 'self' 'unsafe-inline'/u);
  // The dev server's hot-reload channel is a WebSocket on localhost. It is
  // the same trust boundary as the http://localhost exceptions the app
  // already needs for local models; the deployed app opens no WebSocket.
  assert.match(directives, /ws:\/\/localhost:\*/u, "the dev server's hot-reload channel must work");
  // Upgrading insecure requests would rewrite the localhost provider calls
  // to https and break local models, silently and at request time.
  assert.doesNotMatch(directives, /upgrade-insecure-requests/u);
});

test("the deployed header policy matches the Next.js one", async () => {
  // vercel.json repeats these headers so they hold even if the Next headers
  // path is bypassed. Two copies of a security policy drift silently unless
  // something compares them.
  const config = await readFile(configUrl, "utf8");
  const vercel = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
  const fromNext = /Content-Security-Policy[^\n]*value:\s*"([^"]+)"/u.exec(config)?.[1];
  const fromVercel = /Content-Security-Policy[\s\S]*?"value":\s*"([^"]+)"/u.exec(vercel)?.[1];
  assert.ok(fromNext && fromVercel, "both files must declare a Content-Security-Policy");
  assert.equal(fromVercel, fromNext, "vercel.json and next.config.ts must send the same policy");
});
