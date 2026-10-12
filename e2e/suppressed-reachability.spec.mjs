import { test, expect } from "@playwright/test";

const MISSES = [
  "seperate", "occured", "definately", "accomodate", "untill", "wich",
  "teh", "adress", "arguement", "becuase", "calender", "embarass", "foriegn",
  "goverment", "independant", "occassion", "priviledge", "publically",
  "refered", "tommorow",
];

async function openWorkspace(page) {
  await page.goto("/");
  await page.evaluate(() => { indexedDB.deleteDatabase("draftwise-documents"); localStorage.clear(); });
  await page.reload();
  await page.locator(".saved-dot").waitFor({ timeout: 30_000 });
  await expect(page.getByLabel("Draft editor")).toBeEnabled({ timeout: 30_000 });
}

test("a held-back finding can be opened from the disclosure", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openWorkspace(page);

  const draft = MISSES.map((w, i) => `Section ${i + 1} of the plan. The manager ${w} the update on Thursday.\n\n`).join("");
  await page.getByLabel("Draft editor").fill(draft);
  await expect(page.getByLabel("Draft editor")).toHaveValue(/Section 20 of the plan/);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  const toggle = page.locator(".suppressed-toggle");
  await expect(toggle).toBeVisible();
  const heldBefore = Number((await toggle.textContent()).match(/(\d+)/)[1]);
  console.log("E2E held back:", heldBefore);
  expect(heldBefore).toBeGreaterThan(0);

  const cardsBefore = await page.locator(".suggestion-card").count();
  await toggle.click();

  // The disclosure must list real, reachable findings, not just counts.
  const rows = page.locator(".suppressed-list button");
  await expect(rows.first()).toBeVisible();
  const rowCount = await rows.count();
  console.log("E2E rows listed:", rowCount, "cards before:", cardsBefore);
  expect(rowCount).toBeGreaterThan(0);

  // Opening one puts it into the review list and decrements the held-back count.
  await rows.first().click();
  const cardsAfter = await page.locator(".suggestion-card").count();
  console.log("E2E cards after opening one:", cardsAfter);
  expect(cardsAfter).toBeGreaterThan(cardsBefore);

  const heldAfter = Number((await toggle.textContent()).match(/(\d+)/)[1]);
  console.log("E2E held after:", heldAfter);
  expect(heldAfter).toBe(heldBefore - 1);

  expect(errors).toEqual([]);
});
