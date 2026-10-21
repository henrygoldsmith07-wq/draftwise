import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { shouldRegisterServiceWorker } from "../lib/service-worker.ts";

/**
 * The service worker.
 *
 * A service worker is the most dangerous thing you can add to a writing
 * tool, because it sits between the app and the network and can quietly
 * serve the wrong thing. The two failure modes that matter:
 *
 *   1. It caches something it should not. If a provider request or a
 *      response containing the writer's draft ended up in the cache, the
 *      privacy promise would be broken in a way no user could see.
 *   2. It serves something stale. A stale app shell is a broken app.
 *
 * So the invariants are asserted directly against the source, and the
 * behaviour is asserted in a real browser by e2e/pwa-offline.spec.mjs.
 */

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const worker = read("public/sw.js");

test("the worker only ever handles its own origin", () => {
  // Provider and classifier calls are another origin. Intercepting them
  // would put the writer's draft in the cache and could replay a stale AI
  // answer, which is worse than no AI answer.
  assert.match(worker, /if \(url\.origin !== self\.location\.origin\) return;/u);
});

test("the worker only ever handles GET requests", () => {
  // A POST is never a cacheable asset, and replaying one would be wrong.
  assert.match(worker, /if \(request\.method !== "GET"\) return;/u);
});

test("navigations are network-first, so a deployed update is picked up at once", () => {
  // The cached copy is the offline fallback, not the primary source.
  const navigate = worker.slice(worker.indexOf('request.mode === "navigate"'));
  const block = navigate.slice(0, navigate.indexOf("if (isHashedAsset(url))"));
  assert.match(block, /const response = await fetch\(request\);/u);
  assert.match(block, /const cached = await caches\.match\("\/"\);/u);
  // The fresh response is written back, so the offline copy keeps up.
  assert.match(block, /await cache\.put\("\/", response\.clone\(\)\);/u);
});

test("hashed build files are served from the cache first", () => {
  // Their URL changes when their content does, so a cached copy is always
  // the right one for the shell that asks for it.
  assert.match(worker, /function isHashedAsset\(url\)/u);
  assert.match(worker, /url\.pathname\.startsWith\("\/_next\/static\/"\)/u);
  const block = worker.slice(worker.indexOf("if (isHashedAsset(url))"));
  assert.match(block, /const cached = await caches\.match\(request\);[\s\S]*?if \(cached\) return cached;/u);
});

test("the worker drops its old caches so a stale shell cannot linger", () => {
  assert.match(worker, /caches\.delete\(name\)/u);
  assert.match(worker, /const names = await caches\.keys\(\);/u);
});

test("the worker does not claim the page while it is still loading", () => {
  // Claiming would put the worker in front of the page that is still
  // loading, so every remaining chunk request would detour through the
  // worker during the writer's first seconds with the app. That detour was
  // measured: it delayed the first analysis enough to change what the
  // writer sees.
  assert.doesNotMatch(worker, /clients\.claim\(\)/u);
  // The worker still takes over at the next navigation, which is the one
  // that matters.
  assert.match(worker, /await self\.skipWaiting\(\);/u);
});

test("the worker does not re-download the chunks it is precaching", () => {
  // The page has just downloaded these exact files, so the browser's HTTP
  // cache already holds them. Forcing a reload would put a burst of
  // duplicate traffic in front of the writer at the moment they are typing.
  const install = worker.slice(0, worker.indexOf('self.addEventListener("activate"'));
  assert.doesNotMatch(install, /cache: "reload"/u);
  assert.match(install, /const response = await fetch\(url\);/u);
});

test("the worker registers only in production", () => {
  // The dev server's module URLs change on every edit. A worker that cached
  // them would serve stale modules to the next person who opened the page,
  // which is a miserable afternoon for whoever is developing.
  assert.equal(shouldRegisterServiceWorker({ production: false, hasServiceWorker: true, secureContext: true }), false);
  assert.equal(shouldRegisterServiceWorker({ production: true, hasServiceWorker: false, secureContext: true }), false);
  assert.equal(shouldRegisterServiceWorker({ production: true, hasServiceWorker: true, secureContext: false }), false);
  assert.equal(shouldRegisterServiceWorker({ production: true, hasServiceWorker: true, secureContext: true }), true);
});

test("the app registers the worker and the worker is served from the site root", () => {
  const page = read("app/page.tsx");
  assert.match(page, /registerServiceWorker/u);
  assert.match(page, /shouldRegisterServiceWorker/u);
  // A worker served from a sub-path would not cover the app, and the scope
  // has to be the whole site.
  assert.match(read("lib/service-worker.ts"), /SERVICE_WORKER_URL = "\/sw\.js"/u);
  assert.match(read("lib/service-worker.ts"), /scope: "\/"/u);
});

test("the worker script is not cached by the browser", () => {
  // The worker is served from a stable URL, so a long-lived browser cache
  // would keep handing back the previous version of the file.
  const nextConfig = read("next.config.ts");
  assert.match(nextConfig, /source: "\/sw\.js"/u);
  assert.match(nextConfig, /no-cache, no-store, must-revalidate/u);
});

test("the writer is told when the network is gone, and what still works", () => {
  // Without this the only symptom of being offline is that the AI button
  // goes quiet, which reads as "Draftwise is broken" rather than "you are
  // on a train".
  const notice = read("components/draftwise/OfflineNotice.tsx");
  assert.match(notice, /offline-notice/u);
  assert.match(notice, /keeps checking your draft locally/u);
  assert.match(notice, /role="status"/u);
  assert.match(read("hooks/useOnlineStatus.ts"), /navigator\.onLine/u);
});

test("the manifest declares what an installable app needs", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  // The scope decides which pages the installed app owns.
  assert.equal(manifest.scope, "/");
  // An id keeps the installed app recognisable as the same app across
  // deploys, rather than appearing as a second, separate installation.
  assert.equal(manifest.id, "/");
  const sizes = manifest.icons.map((icon) => icon.sizes);
  assert.ok(sizes.includes("192x192"), "Chrome requires a 192x192 icon");
  assert.ok(sizes.includes("512x512"), "Chrome requires a 512x512 icon");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"), "a maskable icon is needed for Android");
});
