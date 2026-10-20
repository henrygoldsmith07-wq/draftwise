import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

/**
 * Backup & restore, driven through the real Settings dialog.
 *
 * Replace and merge are the highest-stakes flows in Draftwise: one reloads
 * the app after swapping the whole library, the other mutates the live
 * library without reloading. Unit tests pin the lifecycle semantics, but
 * nothing pinned the wiring — the export download, the file-picker parse,
 * the two-step confirmation, the reload, and the messages the writer sees.
 * These tests do, deterministically and offline (AI is never enabled).
 */

const editor = (page) => page.getByLabel("Draft editor");
const titleInput = (page) => page.getByLabel("Document title");

async function waitForAppReady(page) {
  await expect(page.locator(".saved-dot")).toHaveAttribute(
    "title",
    /Saved|Unsaved|Storage|Could not|Saving/u,
    { timeout: 30_000 },
  );
}

async function freshStart(page) {
  await page.goto("/");
  await page.evaluate(() => {
    indexedDB.deleteDatabase("draftwise-documents");
    localStorage.clear();
  });
  await page.reload();
  await waitForAppReady(page);
}

async function openEditor(page) {
  // Fresh installs open on the documents dashboard, so step into the editor.
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(editor(page)).toBeVisible({ timeout: 30_000 });
}

async function createDocument(page, title, text) {
  // A plain click, not forced: it retries across the re-renders analysis
  // causes, where a forced single-shot click can land on a detached node
  // and silently navigate nowhere.
  await page.getByRole("button", { name: "Documents" }).click();
  await waitForAppReady(page);
  await page.getByRole("button", { name: "New document" }).click();
  await expect(editor(page)).toBeVisible({ timeout: 30_000 });
  await titleInput(page).fill(title);
  await editor(page).fill(text);
  // The export reads live state but the replace flow reloads from storage,
  // so every document asserted after a reload must be confirmed persisted.
  await expect(page.locator(".saved-dot")).toHaveAttribute("title", /Saved/u, { timeout: 30_000 });
}

async function openSettings(page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function closeSettings(page) {
  await page.getByRole("button", { name: "Save & close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function exportBackup(page, outputPath) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).click();
  const download = await downloadPromise;
  await download.saveAs(outputPath);
  await expect(page.getByText(/Backup exported:/u)).toBeVisible();
}

async function restoreBackupFile(page, filePath) {
  await page
    .locator(".writing-profile-import", { hasText: "Restore backup" })
    .locator("input[type=file]")
    .setInputFiles(filePath);
}

test("merge adds the backup's documents alongside the current ones", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (event) => errors.push(event.message));

  await freshStart(page);
  await openEditor(page);
  await createDocument(page, "Keep me", "The merge source stays.");
  await openSettings(page);
  const backupPath = testInfo.outputPath("library-backup.json");
  await exportBackup(page, backupPath);
  await closeSettings(page);

  // New work since the export: the merge must keep it. And "Keep me" is
  // deleted, so the merge has both paths to exercise: one document to add
  // back, one (the fresh-install seed) to recognise as already here.
  await createDocument(page, "Second draft", "A newer thought.");
  // A plain click, not forced: it retries across the re-renders analysis
  // causes, where a forced single-shot click can land on a detached node
  // and silently navigate nowhere.
  await page.getByRole("button", { name: "Documents" }).click();
  await waitForAppReady(page);
  await page.getByRole("button", { name: "Delete Keep me" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.locator(".document-card-main", { hasText: "Keep me" })).toHaveCount(0);

  await openSettings(page);
  await restoreBackupFile(page, backupPath);
  // Parsing alone must change nothing: the confirmation names the payload.
  // Two documents because a fresh install seeds one empty draft next to "Keep me".
  await expect(page.getByText(/Restore 2 documents from/u)).toBeVisible();
  await page.getByRole("button", { name: "Merge into library" }).click();
  await expect(page.getByText(/Merged into your library: 1 added, 1 already here/u)).toBeVisible();
  await closeSettings(page);

  // A plain click, not forced: it retries across the re-renders analysis
  // causes, where a forced single-shot click can land on a detached node
  // and silently navigate nowhere.
  await page.getByRole("button", { name: "Documents" }).click();
  await expect(page.locator(".document-card-main", { hasText: "Keep me" })).toHaveCount(1);
  await expect(page.locator(".document-card-main", { hasText: "Second draft" })).toHaveCount(1);

  expect(errors).toEqual([]);
});

test("replace swaps the whole library and reloads onto the restored documents", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (event) => errors.push(event.message));

  await freshStart(page);
  await openEditor(page);
  await createDocument(page, "Original", "The text worth restoring.");
  await openSettings(page);
  const backupPath = testInfo.outputPath("library-backup.json");
  await exportBackup(page, backupPath);
  await closeSettings(page);

  await createDocument(page, "Doomed", "This draft must not survive the replace.");

  await openSettings(page);
  await restoreBackupFile(page, backupPath);
  // Two documents: the fresh-install seed plus "Original".
  await expect(page.getByText(/Restore 2 documents from/u)).toBeVisible();
  // Replace reloads the app, so the click and the navigation are awaited
  // together. This must be waitForNavigation, not waitForLoadState: the
  // latter resolves immediately on the already-loaded pre-replace page and
  // every step after it can then act on stale DOM — including a click into
  // the editor that hydration later discards.
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole("button", { name: "Replace everything" }).click(),
  ]);
  await waitForAppReady(page);

  // A library with real words resumes in the editor, not on the dashboard:
  // the restored active document is open with its text intact.
  await expect(editor(page)).toHaveValue(/The text worth restoring/u);
  // And the dashboard shows the restored library without the post-export draft.
  // A plain click, not forced: it retries across the re-renders analysis
  // causes, where a forced single-shot click can land on a detached node
  // and silently navigate nowhere.
  await page.getByRole("button", { name: "Documents" }).click();
  // Gate on the dashboard itself before asserting its cards: this tells a
  // lost navigation (grid never renders) apart from a data problem (grid
  // renders without the restored document).
  await expect(page.locator(".document-grid")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".document-card-main", { hasText: "Original" })).toHaveCount(1);
  await expect(page.locator(".document-card-main", { hasText: "Doomed" })).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("a corrupt backup is refused without touching the library", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", (event) => errors.push(event.message));

  await freshStart(page);
  await openEditor(page);
  await createDocument(page, "Keep me", "Nothing about this may change.");
  await openSettings(page);

  const garbagePath = testInfo.outputPath("garbage.json");
  await writeFile(garbagePath, "{ this is not a backup");
  await restoreBackupFile(page, garbagePath);

  await expect(page.getByText("That file is not a Draftwise backup.")).toBeVisible();
  // No confirmation step may appear for an unreadable file.
  await expect(page.getByRole("button", { name: "Replace everything" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Merge into library" })).toHaveCount(0);
  await closeSettings(page);

  // A plain click, not forced: it retries across the re-renders analysis
  // causes, where a forced single-shot click can land on a detached node
  // and silently navigate nowhere.
  await page.getByRole("button", { name: "Documents" }).click();
  await expect(page.locator(".document-card-main", { hasText: "Keep me" })).toHaveCount(1);
  await page.locator(".document-card-main", { hasText: "Keep me" }).first().click();
  await expect(editor(page)).toHaveValue(/Nothing about this may change/u);

  expect(errors).toEqual([]);
});
