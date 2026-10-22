import { test, expect } from "@playwright/test";
import { freshStart } from "./helpers.mjs";

/**
 * Where the app puts you, and whether it keeps you there.
 *
 * Two separate things go wrong here, and both were found by a test that
 * could not get to the library it was looking for.
 *
 * The first is layout. The header is sticky, so a rail that simply scrolled
 * away slid its first button underneath it: "Documents" became invisible and
 * unclickable as soon as the page moved, and a writer reaching for their
 * library got nothing at all.
 *
 * The second is timing. The app resumes a returning writer into the editor,
 * because the drafts they left behind are what they came back for. That
 * decision is made when the document store finishes reading, and the store
 * can finish reading after the writer has already made up their mind about
 * where they want to be. When it did, the resume pulled them back into the
 * editor and threw away the view they had chosen.
 */

const editor = (page) => page.getByLabel("Draft editor");
const titleInput = (page) => page.getByLabel("Document title");

/**
 * Hold the document store's wake-up back.
 *
 * The store reads its drafts from IndexedDB, and that read is what tells the
 * app whether to resume a returning writer into the editor. Slowing it is
 * the only way to reproduce the race on demand: the writer picks a view in
 * the gap between the app appearing and the store answering.
 *
 * Only the success event is held back. The upgrade event must not be — it
 * fires inside the version-change transaction, and a handler that arrived
 * late would let the transaction close before the object store existed.
 */
function slowDocumentStore(delayMs) {
  const originalOpen = indexedDB.open.bind(indexedDB);
  indexedDB.open = (...args) => {
    const request = originalOpen(...args);
    let handler = null;
    Object.defineProperty(request, "onsuccess", {
      configurable: true,
      // The native handler attribute fires the app's callback the moment the
      // event is dispatched, which is exactly what this is here to prevent.
      // Swallow it, and do the work from the listener below instead.
      get: () => () => {},
      set: (fn) => {
        handler = fn;
        if (typeof fn !== "function") return;
        request.addEventListener("success", (event) => {
          window.setTimeout(() => handler.call(request, event), delayMs);
        }, { once: true });
      },
    });
    return request;
  };
}

test("the navigation stays reachable after the page scrolls", async ({ page }) => {
  await freshStart(page);
  // A window short enough that the app has to scroll, as it does on any
  // laptop once the draft and the suggestions stack up.
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.evaluate(() => window.scrollTo(0, 200));

  // The rail is sticky: the navigation is still on screen, and the top
  // button is not hiding underneath the sticky header.
  const documents = page.getByRole("button", { name: "Documents" });
  await expect(documents).toBeInViewport();

  // And clicking it does what it says.
  await documents.click({ force: true });
  await expect(page.getByLabel("Search documents")).toBeVisible();
});

test("a writer who picks a view while the app is waking up keeps it", async ({ page }) => {
  await freshStart(page);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(editor(page)).toBeVisible();
  // Give the library something worth coming back for, and let the autosave
  // land before the page is reloaded.
  await editor(page).fill("Words a returning writer would come back for.");
  await titleInput(page).fill("Kept draft");
  await page.waitForTimeout(800);

  // The store now takes its time, so the writer says where they want to be
  // before it answers.
  await page.addInitScript(slowDocumentStore, 4000);
  await page.reload();

  // The store is still reading: the dashboard is showing its skeleton.
  await expect(page.locator(".skeleton-card")).toHaveCount(3);

  // Wait until the app answers a click. Until React has hydrated, the rail
  // is inert, and the click that follows it would be lost the same way.
  await expect(async () => {
    await page.getByRole("button", { name: "Write", exact: true }).click({ force: true });
    await expect(editor(page)).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });

  await page.getByRole("button", { name: "Documents" }).click({ force: true });
  const search = page.getByLabel("Search documents");
  await expect(search).toBeVisible();

  // The store finishes reading. This is the moment the resume used to fire.
  await expect(page.locator(".skeleton-card")).toHaveCount(0);

  // The writer asked for their library. They are still in it.
  await expect(search).toBeVisible();
});

test("a returning writer with real words still lands in the editor", async ({ page }) => {
  await freshStart(page);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(editor(page)).toBeVisible();
  await editor(page).fill("Words a returning writer would come back for.");
  await titleInput(page).fill("Kept draft");
  await page.waitForTimeout(800);

  // The other half of the promise: when nobody has asked for a view of their
  // own, the app still resumes the writer where they left off.
  await page.reload();
  await expect(editor(page)).toBeVisible({ timeout: 15_000 });
  await expect(titleInput(page)).toHaveValue("Kept draft");
});
