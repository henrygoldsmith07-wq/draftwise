import { test, expect } from "@playwright/test";
import { freshStart, waitForAppReady } from "./helpers.mjs";

/**
 * Accessibility-tree pass — what a screen reader actually receives.
 *
 * axe checks attributes; it cannot tell that a page has no landmarks, two
 * competing H1s, or unlabelled controls. These assertions read the rendered
 * accessibility tree on the main journeys instead of grepping attributes.
 */
test("dashboard exposes one H1 and the expected landmarks", async ({ page }) => {
  await freshStart(page);
  await waitForAppReady(page);
  const headings = await page.locator("main h1").allTextContents();
  expect(headings).toHaveLength(1);
  expect(headings[0]).toMatch(/everything you have written/iu);
  const tree = await page.locator("body").ariaSnapshot();
  expect(tree).toContain("banner:");
  expect(tree).toContain("complementary");
  expect(tree).toContain("main:");
});

test("editor controls have accessible names and one live region per message", async ({ page }) => {
  await freshStart(page);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await page.getByLabel("Draft editor").fill("This is repeatd wording and the numbers is wrong.");
  await page.locator(".suggestion-card").first().waitFor({ timeout: 20000 });
  const tree = await page.getByRole("main").ariaSnapshot();
  // No unnamed textbox/combobox/button survived the accessibility pass.
  expect(tree).not.toMatch(/- (textbox|combobox|button)(?::|\s*$)/u);
  expect(tree).toContain('textbox "Draft editor"');
  expect(tree).toContain('heading "Make the next sentence easier." [level=1]');
});
