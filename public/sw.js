/**
 * The Draftwise service worker.
 *
 * Every check this product makes — the rules, the scores, the document
 * outline, goal alignment, even the local rewrite previews — already runs in
 * the browser. The network was only ever needed for the page itself, which
 * meant the deployed app was a blank screen the moment the connection
 * dropped. For a product whose entire claim is that it is local-first, that
 * was the wrong failure, and it is the one thing the cloud competitors in
 * this category can never offer: their analysis lives on their servers.
 *
 * The strategy is deliberately conservative, because a service worker that
 * serves the wrong thing is worse than no service worker at all:
 *
 *   navigations        network-first, cached copy only as the offline fallback
 *   hashed build files cache-first (their URL changes when their content does)
 *   other same-origin  stale-while-revalidate
 *   everything else    untouched
 *
 * "Everything else" is the important part. Provider calls, classifier calls
 * and any other cross-origin request are never intercepted, never cached and
 * never replayed. A stale AI answer would be worse than no AI answer, and a
 * cached provider response would put the writer's draft in the cache for no
 * reason. Only the app's own shell is stored.
 */

/* The cache name carries a version. Bump it when the caching rules change;
   the old cache is dropped on activation. */
const CACHE_NAME = "draftwise-shell-v1";

/**
 * The shell is the document plus the hashed build files it loads.
 *
 * These are precached on install so the very first offline visit works, not
 * just the second one. The build files are content-hashed by the framework,
 * so a cached one is always the right one for the shell that references it.
 *
 * Only the files the app itself does not request are listed here. The
 * browser fetches the manifest on its own, and the launcher caches the
 * install icons when the app is installed, so asking for them again during
 * the install would be three requests for nothing.
 */
const PRECACHE_URLS = ["/manifest.webmanifest", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // The small static files the page itself may never request. The icons
    // are what an installed app shows on the home screen, so they are worth
    // having offline even though the editor never asks for them.
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response.clone());
      } catch {
        // A missing icon must not fail the install.
      }
    }));

    // The shell is fetched once and used twice: stored as the offline
    // fallback, and read to find the hashed build files to precache.
    let shell = null;
    try {
      // "no-cache" revalidates rather than blindly reusing, because the
      // document changes on every deploy. The browser answers from its own
      // cache when the server says nothing has changed, so this is one cheap
      // round trip and not a fresh download.
      const response = await fetch("/", { cache: "no-cache" });
      if (response.ok) {
        await cache.put("/", response.clone());
        shell = await response.text();
      }
    } catch {
      // Offline at install time. The runtime handler will fill the gap.
    }

    // The hashed build files are named in the shell document. Precaching them
    // is what makes an offline load complete rather than half-rendered.
    //
    // They are fetched with the default cache mode, not "reload". The page
    // has just downloaded these exact files, so the browser's HTTP cache
    // already holds them and this reads from disk. Re-downloading every
    // chunk to seed the cache would put a burst of duplicate traffic in
    // front of the writer at the moment they are trying to type, and it
    // measurably delayed the first analysis.
    if (shell) {
      const assets = new Set();
      const pattern = /["'(](\/_next\/static\/[^"')\s]+)["')]/g;
      let match = pattern.exec(shell);
      while (match) {
        assets.add(match[1]);
        match = pattern.exec(shell);
      }
      const queue = [...assets];
      // A small number of concurrent reads keeps the disk cache warm
      // without monopolising the connection.
      const readers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) {
          const url = queue.shift();
          try {
            const response = await fetch(url);
            if (response.ok) await cache.put(url, response.clone());
          } catch {
            // Same as above: a missing asset must not fail the install.
          }
        }
      });
      await Promise.all(readers);
    }

    // Take over as soon as the new worker is ready.
    //
    // Deliberately no client claiming here. Claiming would put the worker
    // in front of the page that is still loading, so every remaining chunk
    // request would take a detour through the worker during the writer's
    // first seconds with the app. Without it the worker takes over at the
    // next navigation, which is when it is actually needed — and that
    // navigation is the offline one the whole feature exists for.
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => (name === CACHE_NAME ? null : caches.delete(name))));
  })());
});

/** Hashed build files never change content at the same URL. */
function isHashedAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only this origin. Provider and classifier traffic is another origin, and
  // it must reach the network untouched and unstored.
  if (url.origin !== self.location.origin) return;

  // Navigations: the page. Network first so a deployed update is picked up
  // immediately; the cached copy is the offline fallback.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/", response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match("/");
        if (cached) return cached;
        return new Response(
          "<!doctype html><meta charset=\"utf-8\"><title>Draftwise is offline</title>"
          + "<body style=\"font-family:system-ui;padding:2rem\"><h1>Draftwise is offline</h1>"
          + "<p>Open Draftwise once while connected and it will be ready to work offline from then on.</p>",
          { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
    })());
    return;
  }

  // Hashed build files: cache first. The URL changes when the content does,
  // so a cached copy is always correct for the shell that asks for it.
  if (isHashedAsset(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  // Other same-origin files (icons, the manifest): serve the cached copy if
  // there is one, and refresh it in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const network = fetch(request).then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }).catch(() => null);
    if (cached) {
      // Do not await the refresh: the writer should not wait for it.
      void network;
      return cached;
    }
    const response = await network;
    if (response) return response;
    return new Response("", { status: 504, statusText: "Offline" });
  })());
});
