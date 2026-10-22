import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

/**
 * The deployed site's security headers, verified in a browser.
 *
 * `vercel.json` sets the headers for the Vercel deployment. Nothing applies
 * them locally — the dev server and `next start` both ignore that file — so
 * before this test the policy was never executed anywhere. It was written,
 * read, and shipped without once being applied to a page.
 *
 * That is the worst possible arrangement for a Content-Security-Policy. A
 * policy with a typo, or one that forgets a directive the app needs, does not
 * degrade gracefully: it blocks the script that hydrates the app, and every
 * visitor gets a blank page. The unit tests assert the policy is well-formed;
 * only a browser can say whether it still lets the app work.
 *
 * So the real policy is taken from `vercel.json`, attached to the responses,
 * and the app is driven through it. Any refusal the browser reports fails the
 * test.
 */

const vercelConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

function headerValue(key) {
  for (const rule of vercelConfig.headers ?? []) {
    for (const header of rule.headers ?? []) {
      if (header.key.toLowerCase() === key.toLowerCase()) return header.value;
    }
  }
  return null;
}

const CSP = headerValue("Content-Security-Policy");

/**
 * Apply the deployed policy to every response.
 *
 * The document is fetched and re-served with the header attached, so the
 * browser enforces exactly the policy the deployment will send — not a
 * paraphrase of it, and not a hand-copied subset.
 */
async function applyDeployedHeaders(page) {
  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    headers["content-security-policy"] = CSP;
    await route.fulfill({ response, headers });
  });
}

/**
 * The browser reports a policy refusal on the console. Collect them all so a
 * test can assert there were none.
 */
function collectPolicyViolations(page) {
  const violations = [];
  page.on("console", (message) => {
    const text = message.text();
    if (!/Content Security Policy|Refused to|violates the following directive/iu.test(text)) return;
    // The dev server's hot-reload socket is not part of the deployed site.
    //
    // The policy governs `connect-src`, and a WebSocket URL is not covered by
    // `'self'` (that matches the document's http(s) origin) nor by the
    // `http://localhost:*` exceptions (those are http, not ws). The live
    // reload channel is therefore refused — correctly, as far as the
    // deployment is concerned, since the deployed site has no hot reload and
    // never opens a WebSocket. The app itself opens none: there is no
    // WebSocket or EventSource anywhere in the source.
    //
    // This is filtered rather than allowed in the policy because allowing
    // `ws://` to reach the user's own machine is a real loosening, and the
    // deployment gains nothing from it.
    if (/\bws:\/\//u.test(text)) return;
    violations.push(text);
  });
  page.on("pageerror", (error) => {
    violations.push(`pageerror: ${error.message}`);
  });
  return violations;
}

test.beforeEach(async ({ page }) => {
  await applyDeployedHeaders(page);
});

test("the deployed Content-Security-Policy is a real policy", async () => {
  expect(CSP).toBeTruthy();
  // A policy without a default-src does not restrict anything it does not
  // name. The old policy named base-uri, object-src and connect-src and left
  // script-src unset, so scripts were never actually constrained.
  expect(CSP).toContain("default-src 'self'");
  expect(CSP).toContain("script-src");
  expect(CSP).toContain("object-src 'none'");
  expect(CSP).toContain("frame-ancestors 'none'");
});

test("the deployed policy does not block the app from working", async ({ page }) => {
  const violations = collectPolicyViolations(page);

  await page.goto("/");
  await page.evaluate(() => {
    indexedDB.deleteDatabase("draftwise-documents");
    localStorage.clear();
  });
  await page.reload();

  // The app must actually hydrate: the brand lockup is rendered by the
  // server, so a blocked script bundle shows up as a page that never becomes
  // interactive.
  await expect(page.locator(".brand-lockup")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".saved-dot")).toHaveAttribute(
    "title",
    /Saved|Unsaved|Storage|Could not|Saving/u,
    { timeout: 30_000 },
  );

  // Exercise the parts most likely to trip a policy: inline styles (the
  // suggestion colours are set through a style attribute), the settings
  // dialog, and the theme toggle, which writes a stylesheet-affecting
  // attribute onto the shell.
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(page.getByLabel("Draft editor")).toBeVisible();
  // "seperate" is a misspelling the local analyser detects without any AI, so
  // a finding proves the whole analysis path ran under the policy. Plain
  // correct prose produces no findings at all, and a missing card would say
  // nothing about the policy.
  await page.getByLabel("Draft editor").fill("The committee will seperate the proposal into two groups.");
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 30_000 });

  // The workspace carries its own settings shortcut, so the bare name is
  // ambiguous — the header gear is the one that opens the dialog.
  await page.locator("header").getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  expect(violations, `policy refusals:\n${violations.join("\n")}`).toEqual([]);
});

test("the deployment sends HSTS and the standard security headers", async () => {
  // The headers are what the deployment sends, so read them from the config
  // the deployment is built from.
  expect(headerValue("Strict-Transport-Security")).toMatch(/max-age=\d+/u);
  expect(headerValue("X-Content-Type-Options")).toBe("nosniff");
  expect(headerValue("X-Frame-Options")).toBe("DENY");
  expect(headerValue("Referrer-Policy")).toBe("no-referrer");
  expect(headerValue("Permissions-Policy")).toContain("camera=()");
});

test("the policy still allows the local provider endpoints the app supports", async () => {
  // The app deliberately accepts `http://localhost` provider URLs so a
  // writer can point it at a model running on their own machine
  // (see isSafeUrl in lib/workspace-storage.ts). A policy that upgrades
  // insecure requests, or that drops the localhost exceptions from
  // connect-src, breaks that setup for exactly the people the product is
  // built for — and it breaks it silently, at request time, with no error
  // anywhere near the cause.
  expect(CSP).toContain("http://localhost:*");
  expect(CSP).toContain("http://127.0.0.1:*");
  // The dev server's hot-reload channel is a WebSocket on localhost.
  expect(CSP).toContain("ws://localhost:*");
  expect(CSP).not.toContain("upgrade-insecure-requests");
});
