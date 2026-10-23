import { test, expect } from "@playwright/test";

// The web app is installable: manifest linked, install icons served,
// maskable purpose present, Apple touch icon and theme-color wired.
test("pwa manifest and install icons are served", async ({ page }) => {
  await page.goto("/");

  const manifestHref = await page.getAttribute('link[rel="manifest"]', "href");
  expect(manifestHref).toBe("/manifest.webmanifest");

  const manifestResponse = await page.request.get(manifestHref);
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.name).toContain("Draftwise");
  expect(manifest.start_url).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(Array.isArray(manifest.icons)).toBe(true);
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

  for (const icon of manifest.icons) {
    expect(icon.sizes).toMatch(/^\d+x\d+$/);
    const iconResponse = await page.request.get(icon.src);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
  }
  const purposes = manifest.icons.map((icon) => icon.purpose ?? "any").join(" ");
  expect(purposes).toContain("maskable");

  const appleHref = await page.getAttribute('link[rel="apple-touch-icon"]', "href");
  expect(appleHref).toBeTruthy();
  const appleResponse = await page.request.get(appleHref);
  expect(appleResponse.ok()).toBe(true);
  expect(appleResponse.headers()["content-type"]).toContain("image/png");

  const themeColors = await page.$$eval('meta[name="theme-color"]', (elements) =>
    elements.map((element) => element.getAttribute("content")),
  );
  expect(themeColors.length).toBeGreaterThan(0);
  for (const color of themeColors) {
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  }
});

// theme-color metadata defaults to the OS preference; an explicit in-app
// theme must recolour the browser chrome too.
test("theme-color follows the in-app theme toggle", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  // Wait for hydration: the save indicator only gains a title once the app is live.
  await expect(page.locator(".saved-dot")).toHaveAttribute("title", /Saved|Unsaved|Storage|Could not|Saving/u, { timeout: 30_000 });
  const themeColors = () => page.$$eval('meta[name="theme-color"]', (elements) =>
    [...new Set(elements.map((element) => element.getAttribute("content")))],
  );

  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
  await expect.poll(themeColors).toEqual(["#10221f"]);

  await page.getByRole("button", { name: "Use light theme" }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "light");
  await expect.poll(themeColors).toEqual(["#f5f8f6"]);
});
