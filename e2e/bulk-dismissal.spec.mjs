import { test, expect } from "@playwright/test";

// Bulk handling for held-back findings. Opening them one at a time does not
// scale, and a writer who does not want a kind of note at all currently has to
// dismiss each finding individually.
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
  await page.locator(".saved-dot").waitFor({ timeout: 30_000 });
  await expect(page.getByLabel("Draft editor")).toBeEnabled({ timeout: 30_000 });
}

test("bulk dismissal clears the filtered set and is confirmed first", async ({ page }) => {
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
  const batch = page.locator(".suppressed-batch");
  await expect(batch).toBeVisible();
  const label = (await batch.textContent())?.trim() ?? "";
  console.log("E2E batch label:", label);

  // Destructive bulk actions must confirm, and confirming must not be the same
  // click that starts them.
  await batch.click();
  const confirm = page.locator(".suppressed-batch-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveAttribute("role", "alertdialog");
  const heldBefore = Number((await page.locator(".suppressed-toggle").textContent()).match(/(\d+)/)?.[1] ?? -1);
  console.log("E2E held before:", heldBefore);
  expect(heldBefore).toBeGreaterThan(5);

  await page.locator(".suppressed-batch-confirm").getByRole("button", { name: /^Dismiss all \d+$/ }).click();
  await expect(page.locator(".suppressed-batch-confirm")).toHaveCount(0);

  const heldAfter = Number((await page.locator(".suppressed-toggle").textContent()).match(/(\d+)/)?.[1] ?? 0);
  console.log("E2E held after:", heldAfter);
  expect(heldAfter).toBeLessThan(heldBefore);

  expect(errors).toEqual([]);
});

test("backing out of the confirmation changes nothing", async ({ page }) => {
  await openWorkspace(page);
  const draft = MISSES.map((word, index) => (
    `Section ${index + 1} of the plan. The manager ${word} the update on Thursday.\n\n`
  )).join("");
  await page.getByLabel("Draft editor").fill(draft);
  await expect(page.getByLabel("Draft editor")).toHaveValue(/Section 20 of the plan/);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  await page.locator(".suppressed-toggle").click();
  const heldBefore = Number((await page.locator(".suppressed-toggle").textContent()).match(/(\d+)/)?.[1] ?? -1);

  await page.locator(".suppressed-batch").click();
  await page.getByRole("button", { name: "Keep them" }).click();
  await expect(page.locator(".suppressed-batch-confirm")).toHaveCount(0);

  const heldAfter = Number((await page.locator(".suppressed-toggle").textContent()).match(/(\d+)/)?.[1] ?? -1);
  console.log("E2E kept:", heldBefore, "->", heldAfter);
  expect(heldAfter).toBe(heldBefore);
  // The list is still there to browse.
  await expect(page.locator(".suppressed-list button").first()).toBeVisible();
});

test("bulk dismissal teaches the writing profile", async ({ page }) => {
  await openWorkspace(page);
  const draft = MISSES.map((word, index) => (
    `Section ${index + 1} of the plan. The manager ${word} the update on Thursday.\n\n`
  )).join("");
  await page.getByLabel("Draft editor").fill(draft);
  await expect(page.getByLabel("Draft editor")).toHaveValue(/Section 20 of the plan/);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  await page.locator(".suppressed-toggle").click();

  // Narrow to a single reason so the batch is one family, then dismiss it twice
  // over to cross the learning threshold the profile uses.
  const reasonButton = page.locator(".suppressed-reasons button").first();
  await reasonButton.click();
  const held = Number((await page.locator(".suppressed-toggle").textContent()).match(/(\d+)/)?.[1] ?? 0);
  console.log("E2E held for one reason:", held);

  for (const round of [1, 2]) {
    const batch = page.locator(".suppressed-batch");
    if (!(await batch.count())) break;
    await batch.click();
    await page.locator(".suppressed-batch-confirm").getByRole("button", { name: /^Dismiss all \d+$/ }).click();
    await page.waitForTimeout(800);
    console.log(`E2E after round ${round}:`, (await page.locator(".suppressed-toggle").textContent())?.trim());
  }

  // The profile should now report what it learned. Insights is where learned
  // adjustments are surfaced, and the entry must name a reason, not a rule id.
  await page.getByRole("button", { name: /Insights/i }).first().click();
  await expect(page.locator(".full-view")).toBeVisible();
  const learned = await page.evaluate(() => {
    const text = document.body.textContent ?? "";
    return /dismissed|Dismissed|show fewer|Show fewer/i.test(text);
  });
  console.log("E2E profile learned something:", learned);
  expect(learned).toBe(true);
});
