import { test, expect } from "@playwright/test";

// Dismissals are decisions the writer made, not session state. These tests pin
// that they survive a reload — including the bulk case, where losing forty
// dismissals on a refresh is the difference between a feature and a trap.
const MISSES = [
  "seperate", "occured", "definately", "accomodate", "untill", "wich",
  "teh", "adress", "arguement", "becuase", "calender", "embarass", "foriegn",
  "goverment", "independant", "occassion", "priviledge", "publically",
  "refered", "tommorow",
];

const WORKSPACE_KEY = "draftwise:workspace:v2";

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

const storedDismissalCount = (page) => page.evaluate(
  (key) => (JSON.parse(localStorage.getItem(key) ?? "{}").dismissedIssueKeys ?? []).length,
  WORKSPACE_KEY,
);

const heldCount = async (page) => {
  const toggle = page.locator(".suppressed-toggle");
  if (!(await toggle.count())) return 0;
  return Number((await toggle.textContent()).match(/(\d+)/)?.[1] ?? -1);
};

test("a bulk dismissal survives a reload", async ({ page }) => {
  await openWorkspace(page);
  const draft = MISSES.map((word, index) => (
    `Section ${index + 1} of the plan. The manager ${word} the update on Thursday. We reviewed the figures twice.\n\n`
  )).join("");
  await page.getByLabel("Draft editor").fill(draft);
  await expect(page.getByLabel("Draft editor")).toHaveValue(/Section 20 of the plan/);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  await page.locator(".suppressed-toggle").click();
  const before = await heldCount(page);
  expect(before).toBeGreaterThan(5);

  // Narrow to one reason so the batch is unambiguous, then dismiss it.
  await page.locator(".suppressed-reasons button").first().click();
  await page.locator(".suppressed-batch").click();
  await page.locator(".suppressed-batch-confirm").getByRole("button", { name: /^Dismiss all \d+$/ }).click();
  await page.waitForTimeout(1500);

  const afterDismiss = await heldCount(page);
  const stored = await storedDismissalCount(page);
  console.log("E2E held:", before, "->", afterDismiss, "stored:", stored);
  expect(afterDismiss).toBeLessThan(before);
  expect(stored).toBeGreaterThan(0);

  await page.reload();
  await page.locator(".saved-dot").waitFor({ timeout: 30_000 });
  await expect(page.getByLabel("Draft editor")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  const afterReload = await heldCount(page);
  const stillStored = await storedDismissalCount(page);
  console.log("E2E after reload: held", afterReload, "stored", stillStored);
  expect(stillStored).toBe(stored);
  expect(afterReload).toBe(afterDismiss);
});

test("a single dismissal survives a reload", async ({ page }) => {
  await openWorkspace(page);
  const draft = MISSES.map((word, index) => (
    `Section ${index + 1} of the plan. The manager ${word} the update on Thursday.\n\n`
  )).join("");
  await page.getByLabel("Draft editor").fill(draft);
  await expect(page.getByLabel("Draft editor")).toHaveValue(/Section 20 of the plan/);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });
  // Wait for analysis to settle: the first card appears mid-sweep, and a
  // dismissal measured against a partial list sees the count rise as more
  // findings arrive.
  await expect(async () => {
    const first = await page.locator(".suggestion-card").count();
    await page.waitForTimeout(700);
    expect(await page.locator(".suggestion-card").count()).toBe(first);
  }).toPass({ timeout: 45_000 });

  const cardsBefore = await page.locator(".suggestion-card").count();
  const firstTitle = await page.locator(".suggestion-card").first().locator("span").first().textContent();
  await page.locator(".suggestion-card").first().getByRole("button", { name: /ignore this/i }).first().click();
  await page.waitForTimeout(1500);
  const stored = await storedDismissalCount(page);
  console.log("E2E cards:", cardsBefore, "stored:", stored, "ignored:", firstTitle?.trim());
  // The dismissal is recorded. Whether the card count drops depends on the
  // tier's density cap: dismissing one can promote a held-back finding into the
  // freed slot, so the count is not the assertion — the persisted key is.
  expect(stored).toBe(1);

  await page.reload();
  await page.locator(".saved-dot").waitFor({ timeout: 30_000 });
  await expect(page.getByLabel("Draft editor")).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  const cardsAfterReload = await page.locator(".suggestion-card").count();
  console.log("E2E cards after reload:", cardsAfterReload);
  expect(await storedDismissalCount(page)).toBe(stored);
  // The ignored finding must not be back in the list.
  const titles = await page.locator(".suggestion-card").locator("span").first().allTextContents();
  expect(titles.some((text) => text.trim() === firstTitle?.trim())).toBe(false);
});

test("corrupt stored dismissals are ignored rather than hiding suggestions", async ({ page }) => {
  await openWorkspace(page);
  // Write a workspace record whose dismissal list is the wrong type entirely.
  await page.evaluate(() => {
    const key = "draftwise:workspace:v2";
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}");
    parsed.dismissedIssueKeys = "not-an-array";
    localStorage.setItem(key, JSON.stringify(parsed));
  });
  await page.reload();
  await page.locator(".saved-dot").waitFor({ timeout: 30_000 });
  await expect(page.getByLabel("Draft editor")).toBeEnabled({ timeout: 30_000 });

  const draft = MISSES.map((word, index) => (
    `Section ${index + 1} of the plan. The manager ${word} the update on Thursday.\n\n`
  )).join("");
  await page.getByLabel("Draft editor").fill(draft);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  // A malformed list must not be trusted as a dismissal set, or every suggestion
  // would be filtered out and the writer would see an empty review list.
  const cards = await page.locator(".suggestion-card").count();
  console.log("E2E cards with corrupt dismissals:", cards);
  expect(cards).toBeGreaterThan(0);
});
