import { test, expect } from "@playwright/test";

/**
 * The deployed app is a real, installable, offline-capable PWA.
 *
 * The manifest already claimed `display: standalone` and shipped every icon
 * Chrome asks for, and the README called the app installable. But Chrome has
 * three installability criteria, and the third one is a service worker with a
 * fetch handler. There was none, so the install prompt never appeared on
 * Chrome or Android, and the deployed app was a blank page whenever the
 * network was not there.
 *
 * That is the wrong failure for this product. Every check Draftwise makes —
 * the rules, the scores, the outline, the goal alignment, the local rewrites
 * — already runs in the browser. The only thing the network was needed for
 * was the page itself. A local-first writing assistant that stops working
 * when the wifi drops is not local-first in any sense a writer would feel,
 * and the competitors in this category cannot offer offline at all, because
 * their analysis lives on their servers.
 */

// These tests only mean anything against a production build.
//
// The service worker is deliberately not registered in development: the dev
// server's module URLs change on every edit, and a worker that cached them
// would serve stale modules to the next person who opened the page. A
// production build is the only thing that has a worker to test, so the
// dev-server project skips this file rather than failing it.
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-production",
    "the service worker only exists in a production build",
  );
});

test("the app registers a service worker", async ({ page }) => {
  await page.goto("/");
  // The worker is registered after load, so give it a moment to appear.
  await expect
    .poll(async () => page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.length;
    }), { timeout: 30_000 })
    .toBeGreaterThan(0);
});

test("the app still loads with the network switched off", async ({ page, context }) => {
  await page.goto("/");
  // Wait for the worker to be installed and controlling the page, otherwise
  // the offline reload has nothing to serve from.
  await expect
    .poll(async () => page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.some((registration) => registration.active);
    }), { timeout: 30_000 })
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.reload();
    // The app shell must come back, and it must be the real app — not a
    // browser error page.
    await expect(page.locator(".brand-lockup")).toBeVisible({ timeout: 30_000 });
    // A fresh install opens on the documents view, so step into the editor.
    // Clicking only works if the page hydrated, which means the JavaScript
    // bundles were served from the cache — so this line is the real
    // assertion that the offline load is complete, not just a cached
    // picture of the app.
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await expect(page.getByLabel("Draft editor")).toBeVisible({ timeout: 30_000 });
  } finally {
    await context.setOffline(false);
  }
});

test("local analysis still runs with the network switched off", async ({ page, context }) => {
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.some((registration) => registration.active);
    }), { timeout: 30_000 })
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator(".brand-lockup")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Write", exact: true }).click();
    await expect(page.getByLabel("Draft editor")).toBeVisible({ timeout: 30_000 });
    // This is the point of the whole exercise: the local engine does not need
    // a network, so the writer keeps their checks on a train, a plane, or a
    // bad connection.
    await page.getByLabel("Draft editor").fill("The committee will seperate the proposal.");
    await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await context.setOffline(false);
  }
});
