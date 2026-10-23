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
 * What the app knows about its own offline readiness.
 *
 * "unsupported"  the browser has no service worker at all
 * "unavailable"  this build will not register one (development, or no
 *                secure context), so the app needs the network
 * "registering"  registration is in flight
 * "ready"        a worker is active, so the app shell is stored locally and
 *                the app opens with no network
 */
export type ServiceWorkerState = "unsupported" | "unavailable" | "registering" | "ready";

/**
 * The current state, readable from any component.
 *
 * This is an external store rather than React state on purpose. The
 * registration completes long after the first render and may never complete
 * at all, and reading it through useSyncExternalStore means no component has
 * to set state in an effect to find out — the same pattern the document and
 * activity stores use.
 */
let state: ServiceWorkerState = "unsupported";
const listeners = new Set<() => void>();

function setState(next: ServiceWorkerState) {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeServiceWorker(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getServiceWorkerState(): ServiceWorkerState {
  return state;
}

/** The value the server renders with. The state is only ever known on the client. */
export function getServiceWorkerServerState(): ServiceWorkerState {
  return "unsupported";
}

/**
 * Record that this browser or this build will not use a worker.
 *
 * The app still works — it just needs the network — and saying so is more
 * useful than leaving the writer to work it out from a failed request.
 */
export function noteServiceWorkerUnavailable(): void {
  setState("unavailable");
}

/**
 * What to tell the writer about the app's own offline readiness.
 *
 * The failure mode this avoids is promising offline use that does not work.
 * A writer who was told "ready to work offline" and then met a blank page
 * would trust the app less than one that was never told anything at all.
 * So every state has its own honest sentence, including the ones that say
 * no.
 */
export interface OfflineReadiness {
  tone: "ready" | "pending" | "unavailable";
  label: string;
  detail: string;
}

export function describeOfflineReadiness(state: ServiceWorkerState, installed: boolean): OfflineReadiness {
  if (installed) {
    return {
      tone: "ready",
      label: "Installed and ready to work offline",
      detail: "Draftwise is installed on this device. It opens without a browser and keeps checking your draft with no network — only AI suggestions need a connection.",
    };
  }
  if (state === "ready") {
    return {
      tone: "ready",
      label: "Ready to work offline",
      detail: "The app is stored on this device, so Draftwise opens and keeps checking your draft with no network. Only AI suggestions need a connection.",
    };
  }
  if (state === "registering") {
    return {
      tone: "pending",
      label: "Preparing offline use…",
      detail: "Draftwise is storing the app on this device so it can open without a network. This takes a moment.",
    };
  }
  return {
    tone: "unavailable",
    label: "Offline use is not available here",
    detail: "This browser will not store the app on your device, so Draftwise needs a connection to open. Your drafts are still saved in this browser, and every check still runs on it.",
  };
}

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
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    setState("unsupported");
    return null;
  }
  setState("registering");
  try {
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
    // The worker is only useful once it is active: an installing worker
    // cannot yet serve the app shell, and reporting "ready" before then
    // would be a promise the app cannot keep.
    if (registration.active) {
      setState("ready");
    } else {
      const settled = await waitForActivation(registration);
      setState(settled ? "ready" : "unavailable");
    }
    return registration;
  } catch {
    setState("unavailable");
    return null;
  }
}

/**
 * Wait for a worker to become active.
 *
 * A worker that never activates — a browser that installed it but never ran
 * it — is treated as "not ready" rather than left pending forever, so the
 * app can say so honestly instead of promising offline use it does not have.
 */
function waitForActivation(registration: ServiceWorkerRegistration): Promise<boolean> {
  if (registration.active) return Promise.resolve(true);
  return new Promise((resolve) => {
    const worker = registration.installing ?? registration.waiting;
    if (!worker) {
      resolve(false);
      return;
    }
    const settle = (active: boolean) => {
      worker.removeEventListener("statechange", onStateChange);
      resolve(active);
    };
    const onStateChange = () => {
      if (worker.state === "activated") settle(true);
      else if (worker.state === "redundant") settle(false);
    };
    worker.addEventListener("statechange", onStateChange);
  });
}
