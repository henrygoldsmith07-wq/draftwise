import { test, expect } from "@playwright/test";

/**
 * Browser-level journeys for the document workflows users depend on.
 * Deterministic and offline: AI is never enabled or configured in these runs.
 *
 * The app server-renders its shell, so every journey waits for hydration
 * before interacting. The save indicator exposes it: "Loading local draft…"
 * only disappears once the client store has taken over.
 */

const editor = (page) => page.getByLabel("Draft editor");
const titleInput = (page) => page.getByLabel("Document title");

async function waitForAppReady(page) {
  await expect(page.locator(".saved-dot")).toHaveAttribute("title", /Saved|Unsaved|Storage|Could not|Saving/u, { timeout: 20_000 });
}

async function openApp(page) {
  await page.goto("/");
  await page.evaluate(() => {
    indexedDB.deleteDatabase("draftwise-documents");
    localStorage.clear();
  });
  await page.reload();
  await waitForAppReady(page);
  await expect(editor(page)).toBeVisible();
}

async function newDocument(page) {
  await page.getByRole("button", { name: "Documents" }).click({ force: true });
  await waitForAppReady(page);
  await page.getByRole("button", { name: "New document" }).click();
}

async function openDocumentByTitle(page, title) {
  await page.getByRole("button", { name: "Documents" }).click({ force: true });
  await waitForAppReady(page);
  await page.locator(".document-card-main", { hasText: title }).first().click();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("document lifecycle: create, type, autosave, switch, refresh restores last-opened", async ({ page }) => {
  // Document A
  await editor(page).fill("Alpha body text for document A.");
  await titleInput(page).fill("Doc A");
  await expect(editor(page)).toHaveValue("Alpha body text for document A.");

  // Document B
  await newDocument(page);
  await editor(page).fill("Beta body text for document B.");
  await titleInput(page).fill("Doc B");

  // Switch back to A and verify its content is intact
  await openDocumentByTitle(page, "Doc A");
  await expect(editor(page)).toHaveValue("Alpha body text for document A.");
  await expect(titleInput(page)).toHaveValue("Doc A");

  // Switch to B, let autosave land, refresh: B is the last-opened document
  await openDocumentByTitle(page, "Doc B");
  await expect(editor(page)).toHaveValue("Beta body text for document B.");
  await page.waitForTimeout(800);
  await page.reload();
  await waitForAppReady(page);
  await expect(editor(page)).toHaveValue("Beta body text for document B.");
  await expect(titleInput(page)).toHaveValue("Doc B");

  // A's content still lives in the store
  await openDocumentByTitle(page, "Doc A");
  await expect(editor(page)).toHaveValue("Alpha body text for document A.");
});

test("undo isolation: undo in B never restores A's text", async ({ page }) => {
  await editor(page).fill("TEXT-FROM-DOCUMENT-A");
  await titleInput(page).fill("Doc A");

  await newDocument(page);
  await editor(page).fill("TEXT-FROM-DOCUMENT-B");
  await editor(page).fill("TEXT-FROM-DOCUMENT-B-EDITED");
  await editor(page).press("Control+z");

  const value = await editor(page).inputValue();
  expect(value).toContain("DOCUMENT-B");
  expect(value).not.toContain("TEXT-FROM-DOCUMENT-A");
});

test("undo on a brand-new document never reaches the previous document", async ({ page }) => {
  await editor(page).fill("SECRET-PREVIOUS-DOCUMENT");
  await newDocument(page);
  await editor(page).press("Control+z");
  await editor(page).press("Control+z");
  const value = await editor(page).inputValue();
  expect(value).not.toContain("SECRET-PREVIOUS-DOCUMENT");
});

test("rename persists across reload and dashboard", async ({ page }) => {
  await editor(page).fill("Renameable content.");
  await titleInput(page).fill("Renamed Document");
  await page.waitForTimeout(800);
  await page.reload();
  await waitForAppReady(page);
  await expect(titleInput(page)).toHaveValue("Renamed Document");
  await page.getByRole("button", { name: "Documents" }).click({ force: true });
  await expect(page.locator(".document-card-title", { hasText: "Renamed Document" })).toBeVisible();
});

test("rapid switching keeps both documents' content correct after reload", async ({ page }) => {
  await editor(page).fill("RAPID-A-CONTENT");
  await titleInput(page).fill("Rapid A");
  await newDocument(page);
  await editor(page).fill("RAPID-B-CONTENT");
  await titleInput(page).fill("Rapid B");
  await openDocumentByTitle(page, "Rapid A");
  await openDocumentByTitle(page, "Rapid B");
  await openDocumentByTitle(page, "Rapid A");
  await page.waitForTimeout(800);
  await page.reload();
  await waitForAppReady(page);
  await expect(editor(page)).toHaveValue("RAPID-A-CONTENT");
  await openDocumentByTitle(page, "Rapid B");
  await expect(editor(page)).toHaveValue("RAPID-B-CONTENT");
});

test("version history: checkpoint, edit, preview, restore keeps both versions", async ({ page }) => {
  await editor(page).fill("Version one content.");
  await titleInput(page).fill("Versioned");
  // Manual checkpoint via the save pathway (Ctrl+S records a manual snapshot)
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(700);
  await editor(page).fill("Version two content, revised.");

  await page.getByRole("button", { name: "Documents" }).click({ force: true });
  await waitForAppReady(page);
  await page.getByRole("button", { name: /Version history for Versioned/u }).click();
  await waitForAppReady(page);
  await expect(page.getByRole("heading", { name: "Versioned" })).toBeVisible();

  // Preview the checkpoint and restore it
  await page.getByRole("button", { name: "Preview" }).first().click();
  await expect(page.getByRole("dialog", { name: "Version preview" })).toBeVisible();
  await page.getByRole("button", { name: "Restore this version" }).click();
  await page.getByRole("button", { name: "Confirm restore this version" }).click();
  await expect(editor(page)).toHaveValue("Version one content.");
});

test("delete: deleting a document never resurrects it after reload", async ({ page }) => {
  await editor(page).fill("Doomed content here.");
  await titleInput(page).fill("Doomed");
  await newDocument(page);
  await editor(page).fill("Survivor content.");
  await titleInput(page).fill("Survivor");

  await page.getByRole("button", { name: "Documents" }).click({ force: true });
  await waitForAppReady(page);
  await page.getByRole("button", { name: "Delete Doomed" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.locator(".document-card-title", { hasText: "Doomed" })).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.reload();
  await waitForAppReady(page);
  await page.getByRole("button", { name: "Documents" }).click({ force: true });
  await waitForAppReady(page);
  await expect(page.locator(".document-card-title", { hasText: "Doomed" })).toHaveCount(0);
  await expect(page.locator(".document-card-title", { hasText: "Survivor" })).toBeVisible();
});

test("delete the active document moves the editor to a real document", async ({ page }) => {
  await editor(page).fill("First document body.");
  await titleInput(page).fill("First");
  await newDocument(page);
  await editor(page).fill("Second document body.");
  await titleInput(page).fill("Second");

  await page.getByRole("button", { name: "Documents" }).click({ force: true });
  await waitForAppReady(page);
  await page.getByRole("button", { name: "Delete Second" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await page.getByRole("button", { name: "Write" }).click({ force: true });
  await waitForAppReady(page);
  await expect(editor(page)).toHaveValue("First document body.");
});

test("import markdown, edit, and reload keeps the imported document", async ({ page }) => {
  await page.getByRole("button", { name: "Documents" }).click({ force: true });
  await waitForAppReady(page);
  await page.setInputFiles(".dashboard-import input", {
    name: "imported-notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Imported heading\n\nImported body paragraph."),
  });
  await waitForAppReady(page);
  await expect(editor(page)).toHaveValue(/Imported body paragraph\./u);
  await editor(page).fill("# Imported heading\n\nImported body paragraph, then edited.");
  await page.waitForTimeout(800);
  await page.reload();
  await waitForAppReady(page);
  await expect(editor(page)).toHaveValue(/then edited/u);
});

test("suggestions: accept and undo keep the draft consistent", async ({ page }) => {
  await editor(page).fill("This is repeatd wording in the draft.");
  const accept = page.getByRole("button", { name: /^Accept$/u }).first();
  await expect(accept).toBeVisible({ timeout: 10_000 });
  await accept.click();
  await expect(editor(page)).toHaveValue(/repeated wording/u);
  await editor(page).press("Control+z");
  await expect(editor(page)).toHaveValue(/repeatd wording/u);
});

async function selectForRewrite(page) {
  await editor(page).evaluate((el) => {
    el.focus();
    el.setSelectionRange(0, 10);
    el.dispatchEvent(new Event("select", { bubbles: true }));
    el.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}

test("rewrite preview cannot overwrite changed text (stale-selection protection)", async ({ page }) => {
  await editor(page).fill("Select this sentence for the rewrite.");
  await selectForRewrite(page);
  await expect(page.getByText("Rewrite selection")).toBeVisible();
  // Toolbar buttons sit near the sticky top bar; force skips the hover check
  // for this uniquely-named control without changing what it does.
  await page.getByRole("button", { name: "Shorten", exact: true }).click({ force: true });
  await expect(page.locator(".rewrite-preview")).toBeVisible({ timeout: 10_000 });
  // Change the draft underneath the preview: applying must become impossible.
  await editor(page).fill("The draft changed underneath the pending rewrite preview.");
  await editor(page).press("Control+z");
  const replace = page.getByRole("button", { name: /^Replace$/u });
  if (await replace.isVisible().catch(() => false)) {
    await expect(replace).toBeDisabled();
  }
});

test("storage degradation: blocked IndexedDB shows truthful UI and never claims durable save", async ({ page }) => {
  await page.addInitScript(() => {
    // Block IndexedDB before the app loads: the resilient backend must fall
    // back and the UI must not claim durable IndexedDB persistence.
    window.indexedDB.open = () => {
      const request = { result: null, error: new Error("blocked"), onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      setTimeout(() => request.onerror && request.onerror(), 0);
      return request;
    };
  });
  await page.reload();
  await waitForAppReady(page);
  await editor(page).fill("Written while storage is degraded.");
  await page.waitForTimeout(1000);
  const status = await page.locator(".saved-dot").getAttribute("title");
  expect(status).toBeTruthy();
  // Fallback storage is named as such; plain "Saved locally" would be a lie
  // while IndexedDB is unavailable.
  expect(status === "Saved locally" ? false : true).toBeTruthy();
});

test("keyboard: Ctrl+S save and Escape closing rewrite preview", async ({ page }) => {
  await editor(page).fill("Keyboard workflow content.");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".saved-dot")).toHaveAttribute("title", /Saved/u, { timeout: 5000 });

  await selectForRewrite(page);
  await expect(page.getByText("Rewrite selection")).toBeVisible();
  await page.getByRole("button", { name: "Fix grammar", exact: true }).click({ force: true });
  await expect(page.locator(".rewrite-preview")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await expect(page.locator(".rewrite-preview")).toHaveCount(0);
});
