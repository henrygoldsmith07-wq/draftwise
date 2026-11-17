import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Shared-origin isolation for the Draftwise service worker.
 *
 * On a shared origin a service worker can accidentally store another app's
 * responses, replay them stale, or delete that app's caches. These tests read
 * the worker and registration source directly and assert the four boundaries
 * that keep Draftwise inside its own lane. They are static on purpose: the
 * behaviour they guard is "never intercept this", which a source-level check
 * can pin down more precisely than a browser round trip.
 */

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const worker = read("public/sw.js");
const registration = read("lib/service-worker.ts");
const manifest = JSON.parse(read("public/manifest.webmanifest"));

test("the stale-while-revalidate branch is an explicit allowlist, not all same-origin GETs", () => {
  // The set is the complete list of non-hashed, same-origin files the worker
  // is allowed to store. It must exist and be consulted by the final branch.
  assert.match(worker, /const ALLOWED_STATIC_ASSETS = new Set\(\[/u);
  assert.match(worker, /function isAppOwnedStaticAsset\(url\)[\s\S]*?ALLOWED_STATIC_ASSETS\.has\(url\.pathname\)/u);
  assert.match(worker, /if \(!isAppOwnedStaticAsset\(url\)\) return;/u);

  // Every file the app actually declares is in the allowlist: the manifest
  // and icons it advertises, plus the favicon it precaches.
  const start = worker.indexOf("const ALLOWED_STATIC_ASSETS = new Set([");
  const end = worker.indexOf("]);", start);
  assert.ok(start >= 0 && end > start, "the allowlist must be a literal set");
  const allowlist = worker.slice(start, end);
  assert.ok(allowlist.includes('"/manifest.webmanifest"'));
  assert.ok(allowlist.includes('"/favicon.svg"'));
  for (const icon of manifest.icons) {
    assert.ok(
      allowlist.includes(`"${icon.src}"`),
      `the allowlist must include the declared icon ${icon.src}`,
    );
  }
});

test("no unconditional same-origin catch-all caching remains after the origin check", () => {
  // Before the allowlist guard there must be exactly two caching strategies:
  // network-first navigations and cache-first hashed assets. The third and
  // final respondWith is the allowlisted stale-while-revalidate branch.
  const fetchAt = worker.indexOf('self.addEventListener("fetch"');
  const guardAt = worker.indexOf("if (!isAppOwnedStaticAsset(url)) return;", fetchAt);
  assert.ok(fetchAt >= 0 && guardAt > fetchAt, "the allowlist guard must be inside the fetch handler");
  const beforeGuard = worker.slice(fetchAt, guardAt);
  const respondWithCount = (beforeGuard.match(/event\.respondWith/gu) ?? []).length;
  assert.equal(
    respondWithCount,
    2,
    "only the navigation and hashed-asset strategies may cache before the allowlist guard",
  );
  // The guarded branch itself still does the stale-while-revalidate work.
  const afterGuard = worker.slice(guardAt);
  assert.match(afterGuard, /event\.respondWith/u);
  assert.match(afterGuard, /if \(cached\) \{[\s\S]*?return cached;/u);
  assert.match(afterGuard, /cache\.put\(request, response\.clone\(\)\)/u);
});

test("cross-origin requests are still untouched", () => {
  // Provider and classifier traffic must reach the network without being
  // intercepted, cached or replayed. The origin check is the first gate in
  // the fetch handler, ahead of every respondWith.
  const fetchHandler = worker.slice(worker.indexOf('self.addEventListener("fetch"'));
  const originCheckAt = fetchHandler.indexOf("if (url.origin !== self.location.origin) return;");
  assert.ok(originCheckAt >= 0, "the cross-origin early return must be present");
  const firstRespondWith = fetchHandler.indexOf("event.respondWith");
  assert.ok(firstRespondWith > originCheckAt, "no caching path may run before the origin check");
  assert.match(worker, /if \(request\.method !== "GET"\) return;/u);
});

test("activation deletes only caches managed by this app", () => {
  assert.ok(worker.includes('const CACHE_PREFIX = "draftwise-";'));
  const activateAt = worker.indexOf('self.addEventListener("activate"');
  const hashedAt = worker.indexOf("/** Hashed build files never change content");
  assert.ok(activateAt >= 0 && hashedAt > activateAt);
  const activate = worker.slice(activateAt, hashedAt);

  // A cache is deleted only when it is one of ours and not the live one.
  assert.match(activate, /name\.startsWith\(CACHE_PREFIX\)/u);
  assert.match(activate, /name !== CACHE_NAME/u);
  assert.match(activate, /caches\.delete\(name\)/u);
  // The old "delete everything that is not our current cache" rule is gone.
  assert.doesNotMatch(activate, /name === CACHE_NAME \? null : caches\.delete\(name\)/u);
});

test("the registration scope derives from the base path, not a hard-coded root", () => {
  assert.match(registration, /function normalizedBasePath\(raw/u);
  assert.match(registration, /process\.env\.NEXT_PUBLIC_BASE_PATH/u);
  assert.ok(
    registration.includes('const serviceWorkerScope = configuredBasePath ? `${configuredBasePath}/` : "/";'),
    "the scope must be computed from the configured base path",
  );
  assert.match(
    registration,
    /navigator\.serviceWorker\.register\(serviceWorkerPath,\s*\{\s*scope: serviceWorkerScope,\s*\}\)/u,
  );
  // No literal hard-coded "/" scope survives anywhere in the registration
  // module. A configured base path moves both the script URL and its scope.
  assert.doesNotMatch(registration, /scope:\s*["']\/["']/u);
  assert.ok(registration.includes("const serviceWorkerPath = configuredBasePath"));

  // Registration stays best-effort and quiet on failure: no rejection reaches
  // the page, and the app reports the worker as unavailable instead.
  assert.match(registration, /\} catch \{[\s\S]*?setState\("unavailable"\)[\s\S]*?return null;/u);
  // The public export keeps its original root-relative contract, so the page
  // call site needs no change.
  assert.ok(registration.includes('export const SERVICE_WORKER_URL = "/sw.js";'));
});

test("offline behaviour for Draftwise's own shell is preserved", () => {
  assert.match(worker, /request\.mode === "navigate"/u);
  assert.match(worker, /function isHashedAsset\(url\)/u);
  assert.match(worker, /url\.pathname\.startsWith\("\/_next\/static\/"\)/u);
  assert.ok(worker.includes('const PRECACHE_URLS = ["/manifest.webmanifest", "/favicon.svg"];'));
  assert.match(worker, /await self\.skipWaiting\(\);/u);
  assert.doesNotMatch(worker, /clients\.claim\(\)/u);
});
