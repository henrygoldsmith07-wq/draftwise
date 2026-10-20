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
