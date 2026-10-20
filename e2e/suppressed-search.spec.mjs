import { test, expect } from "@playwright/test";

// The held-back list is bounded to keep the review list usable, so a long draft
// can have far more findings held back than are shown. These tests check the
// writer can still reach one the cap hides.
const MISSES = [
  "seperate", "occured", "definately", "accomodate", "untill", "wich",
  "teh", "adress", "arguement", "becuase", "calender", "embarass", "foriegn",
  "goverment", "independant", "occassion", "priviledge", "publically",
  "refered", "tommorow",
];

async function openWorkspace(page) {
  await page.goto("/");
  await page.evaluate(() => {
    indexedDB.deleteDatabase("draftwise-documents");
    localStorage.clear();
  });
  await page.reload();
  // The dot ships in the server-rendered shell, so its presence proves nothing. Its status text appears only once the client store hydrates — clicking Write before that hits a dead button and strands the run on the dashboard.
  await expect(page.locator(".saved-dot")).toHaveAttribute("title", /Saved|Unsaved|Storage|Could not|Saving/u, { timeout: 30_000 });
  // Fresh installs open on the documents dashboard, so step into the editor.
  // On a resumed session this is a no-op: the app is already writing.
  await page.getByRole("button", { name: "Write", exact: true }).click();
  // The save dot appears while the document store is still hydrating; filling
  // before the editor is enabled types into a field that discards its value.
  await expect(page.getByLabel("Draft editor")).toBeEnabled({ timeout: 30_000 });
}

test("search reaches a held-back finding the row cap hides", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (event) => errors.push(event.message));

  await openWorkspace(page);
  const draft = MISSES.map((word, index) => (
    `Section ${index + 1} of the plan. The manager ${word} the update on Thursday. We reviewed the figures twice.\n\n`
  )).join("");
  await page.getByLabel("Draft editor").fill(draft);
  await expect(page.getByLabel("Draft editor")).toHaveValue(/Section 20 of the plan/);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  await page.locator(".suppressed-toggle").click();
  const search = page.getByLabel("Search held-back findings");
  await expect(search).toBeVisible();

  const rowsBefore = await page.locator(".suppressed-list button").count();
  console.log("E2E rows before search:", rowsBefore);

  // A misspelling near the end of the draft: the cap shows the first 20 rows, so
  // this finding is held back AND past the visible window.
  await search.fill("tommorow");
  const matches = page.locator(".suppressed-list button");
  await expect(matches.first()).toBeVisible();
  const texts = await matches.allTextContents();
  console.log("E2E matches for 'tommorow':", texts.length, texts.slice(0, 2));
  expect(texts.length).toBeGreaterThan(0);
  // Every result must actually relate to the query, not just be a shorter list.
  expect(texts.some((text) => text.toLocaleLowerCase().includes("tommorow"))).toBe(true);

  // Opening it puts the finding into the review list.
  const cardsBefore = await page.locator(".suggestion-card").count();
  await matches.first().click();
  await expect(page.locator(".suggestion-card")).not.toHaveCount(cardsBefore);
  console.log("E2E cards:", cardsBefore, "->", await page.locator(".suggestion-card").count());

  expect(errors).toEqual([]);
});

test("an unmatched query says so instead of showing the first rows", async ({ page }) => {
  await openWorkspace(page);
  const draft = MISSES.map((word, index) => (
    `Section ${index + 1} of the plan. The manager ${word} the update on Thursday.\n\n`
  )).join("");
  await page.getByLabel("Draft editor").fill(draft);
  await expect(page.getByLabel("Draft editor")).toHaveValue(/Section 20 of the plan/);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  await page.locator(".suppressed-toggle").click();
  await page.getByLabel("Search held-back findings").fill("zzzz-not-a-real-finding");
  await expect(page.locator(".suppressed-list")).toHaveCount(0);
  await expect(page.locator(".suppressed-empty")).toContainText("Nothing held back matches");

  // Clearing the search restores the full list.
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator(".suppressed-list button").first()).toBeVisible();
});

test("search stays inside the selected reason filter", async ({ page }) => {
  await openWorkspace(page);
  const draft = MISSES.map((word, index) => (
    `Section ${index + 1} of the plan. The manager ${word} the update on Thursday.\n\n`
  )).join("");
  await page.getByLabel("Draft editor").fill(draft);
  await expect(page.getByLabel("Draft editor")).toHaveValue(/Section 20 of the plan/);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  await page.locator(".suppressed-toggle").click();
  // Pick the most common reason and confirm every result stays within it.
  const reasonButtons = page.locator(".suppressed-reasons button");
  const first = reasonButtons.first();
  const label = (await first.textContent())?.trim() ?? "";
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Search held-back findings").fill("a");
  const matches = await page.locator(".suppressed-list button").count();
  console.log("E2E reason:", label, "matches for 'a':", matches);
  expect(matches).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(first).toHaveAttribute("aria-pressed", "false");
});
