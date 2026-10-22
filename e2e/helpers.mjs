import { expect } from "@playwright/test";

/**
 * Shared browser-suite setup. Every spec used to carry its own copy of this
 * teardown, and the copies drifted — including one that cleared storage
 * while the app was still loaded, letting the editor's pagehide flush
 * resurrect exactly what was cleared on the next load. One canonical helper
 * keeps the race fixed everywhere instead of in one file.
 */

export async function waitForAppReady(page) {
  // The dot ships in the server-rendered shell, so its presence proves
  // nothing. Its status text appears only once the client store hydrates —
  // clicking Write before that hits a dead button and strands the run on
  // the dashboard.
  await expect(page.locator(".saved-dot")).toHaveAttribute(
    "title",
    /Saved|Unsaved|Storage|Could not|Saving/u,
    { timeout: 30_000 },
  );
}

export async function freshStart(page) {
  // Unload the app BEFORE clearing: the editor flushes unsaved workspace
  // state on pagehide, so clearing first lets that flush resurrect exactly
  // what was cleared on the next load. The _not-found route renders no
  // Draftwise state, and unloading also closes the document store's
  // IndexedDB connections, which otherwise block the delete and race the
  // reload. The delete is awaited so the fresh boot below cannot open the
  // database before the old one is gone.
  await page.goto("/_not-found");
  await page.evaluate(() => {
    const request = indexedDB.deleteDatabase("draftwise-documents");
    const done = new Promise((resolve) => {
      request.onsuccess = () => resolve(0);
      request.onerror = () => resolve(0);
      request.onblocked = () => resolve(0);
    });
    localStorage.clear();
    return done;
  });
  await page.goto("/");
  await waitForAppReady(page);
}
