/**
 * Registering the service worker.
 *
 * The worker itself lives in `public/sw.js` and is plain JavaScript on
 * purpose: it has to be served from the site root so its scope covers the
 * whole app, and it must not depend on the framework's bundling.
 *
 * Registration is deliberately quiet. A browser that refuses the worker
 * (private windows, an enterprise policy, a storage quota error) must not
 * produce a console error a writer has to read, and it must certainly not
 * stop the editor from loading — the app works perfectly well without a
 * service worker, it just needs the network.
 */

export const SERVICE_WORKER_URL = "/sw.js";

/**
 * Whether the worker should be registered at all.
 *
 * Only in production. In development the bundler serves module URLs that
 * change on every edit, and a worker that cached them would serve stale
 * modules to the next person who opened the page — which is a miserable way
 * to spend an afternoon. The dev server is left alone.
 */
export function shouldRegisterServiceWorker(options: {
  production: boolean;
  hasServiceWorker: boolean;
  secureContext: boolean;
}): boolean {
  if (!options.production) return false;
  if (!options.hasServiceWorker) return false;
  // A service worker needs a secure context. `localhost` counts as one, but
  // a plain-http LAN address does not, and registering there throws.
  return options.secureContext;
}

/**
 * Register the worker.
 *
 * Returns a promise that resolves once the registration has been attempted.
 * It never rejects: a failure to register is not a failure of the app.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    return registration;
  } catch {
    return null;
  }
}
