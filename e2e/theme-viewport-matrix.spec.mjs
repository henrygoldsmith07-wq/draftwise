import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { freshStart, waitForAppReady } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const axeSource = () => readFile(require.resolve("axe-core/axe.min.js"), "utf8");

async function audit(page, label) {
  // Rail buttons and dialogs animate colour/opacity for 140-200ms; axe run
  // immediately after a click samples mid-transition blends, not settled UI.
  await page.waitForTimeout(350);
  await page.addScriptTag({ content: await axeSource() });
  const r = await page.evaluate(async () => {
    const [res, geometry] = await Promise.all([
      window.axe.run(document.body, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
        resultTypes: ["violations"],
      }),
      Promise.resolve({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }),
    ]);
    return {
      violations: res.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 2).map(n => n.target.join(" ") + " :: " + (n.any?.[0]?.message ?? "")) })),
      geometry,
    };
  });
  const bad = r.violations.filter(v => v.impact === "serious" || v.impact === "critical");
  console.log("MATRIX", label, "scroll", r.geometry.s, "/", r.geometry.c, "violations", JSON.stringify(r.violations));
  expect(r.geometry.s, `${label} horizontal overflow`).toBe(r.geometry.c);
  expect(bad, `${label} serious axe violations`).toEqual([]);
}

for (const theme of ["light", "dark"]) {
  for (const width of [390, 768, 1280]) {
    test(`${theme} @ ${width}px: all views`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await freshStart(page);
      await waitForAppReady(page);
      if (theme === "dark") {
        await page.getByRole("button", { name: /Use dark theme/u }).click();
      }
      await page.getByRole("button", { name: "Write", exact: true }).click();
      await expect(page.getByLabel("Draft editor")).toBeVisible();
      await page.getByLabel("Draft editor").fill("This is repeatd wording and the numbers is wrong. The data are conclusive.");
      await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 20000 });
      for (const [name, open] of [
        ["write", () => page.getByRole("button", { name: "Write", exact: true }).click()],
        ["home", () => page.getByRole("button", { name: "Documents" }).click()],
        ["insights", () => page.locator(".left-rail button[aria-label^='Insights']").click()],
        ["extension", () => page.locator(".left-rail button[aria-label^='Extension']").click()],
      ]) {
        await open();
        await audit(page, `${theme}/${width}/${name}`);
      }
    });
  }
}

test("all dialogs at 390px light and dark", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  for (const theme of ["light", "dark"]) {
    await freshStart(page);
    if (theme === "dark") await page.getByRole("button", { name: /Use dark theme/u }).click();
    await page.getByRole("button", { name: /Keyboard shortcuts/u }).click();
    await audit(page, `${theme}/shortcuts`);
    await page.keyboard.press("Escape");
    await page.locator("header").getByRole("button", { name: "Open settings" }).click();
    await audit(page, `${theme}/settings`);
    await page.keyboard.press("Escape");
  }
});

