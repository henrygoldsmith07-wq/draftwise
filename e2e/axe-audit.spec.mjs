import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

/**
 * Automated WCAG audit of the real rendered app, run through axe-core.
 *
 * This is the check that found the violations the hand-written accessibility
 * tests could not: an unlabelled nav rail at mobile width, duplicate landmark
 * roles, an aria-label that did not contain its own visible text, and two
 * accent colours below the 4.5:1 contrast threshold in light theme. All were
 * invisible to assertions that only looked for attributes I had already
 * thought to add.
 *
 * axe-core is loaded by injecting its bundle into the page rather than through
 * @axe-core/playwright, which is not a dependency of this repo; axe-core itself
 * is only present transitively (via eslint-plugin-jsx-a11y), so the bundle is
 * resolved from that install rather than adding a dependency for one helper.
 * If axe-core is ever removed the resolution error names it directly instead of
 * silently skipping the audit.
 *
 * This is NOT a conformance claim. axe-core detects a known subset of WCAG
 * automatically; it cannot judge whether a suggestion's wording is useful, and
 * it does not replace a person using a screen reader.
 */

const require = createRequire(import.meta.url);

function axeSource() {
  return readFile(require.resolve("axe-core/axe.min.js"), "utf8");
}

async function waitForAppReady(page) {
  await expect(page.locator(".saved-dot")).toHaveAttribute(
    "title",
    /Saved|Unsaved|Storage|Could not|Saving/u,
    { timeout: 30_000 },
  );
}

async function openApp(page) {
  await page.goto("/");
  await page.evaluate(() => {
    indexedDB.deleteDatabase("draftwise-documents");
    localStorage.clear();
  });
  await page.reload();
  await waitForAppReady(page);
  // Fresh installs open on the documents dashboard, so step into the editor.
  // On a resumed session this is a no-op: the app is already writing.
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(page.getByLabel("Draft editor")).toBeVisible();
}

const CONTENT_WITH_ISSUES =
  "This is repeatd wording and the numbers is wrong, so the analysis has something to show.";

async function runAxe(page, label, withinSelector = null) {
  await page.evaluate(async ({ source, selector }) => {
    const initialise = new Function(source);
    initialise();
    // A selector scopes the audit to part of the page. Auditing through an
    // open modal measures the background dimmed by the overlay, which no
    // writer ever reads as content — the dialog audit scopes to the dialog
    // itself. The selector must resolve to a rendered element: auditing a
    // hidden node would pass vacuously, so a miss throws loudly instead of
    // falling back to the whole document.
    const root = selector
      ? [...document.querySelectorAll(selector)].find((node) => node.getClientRects().length > 0)
      : document;
    if (!root) throw new Error(`axe audit scope not found: ${selector}`);
    // Colours measured mid-animation are neither the old nor the new state:
    // a dialog fading in reads grey over its overlay, and the theme toggle and
    // hover transitions blend foreground into background. Let every finite
    // animation and transition settle before auditing. A re-render can cancel
    // a transition and start another, so loop until none is left running. The
    // loop is bounded by a deadline and polls on timers: an animation whose
    // finished promise never settles must delay the audit, not hang the test.
    const running = () => (root === document ? document.getAnimations() : root.getAnimations({ subtree: true }))
      .filter((animation) => animation.playState === "running" && animation.effect?.getComputedTiming().endTime !== Infinity);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = performance.now() + 3_000;
    while (running().length && performance.now() < deadline) {
      await Promise.race([Promise.all(running().map((animation) => animation.finished.catch(() => undefined))), sleep(250)]);
      await sleep(50);
    }
    await window.axe.run(root, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
      resultTypes: ["violations"],
    }).then((results) => {
      window.__axeViolations = results.violations.map((v) => ({
        id: v.id,
        help: v.help,
        impact: v.impact,
        // axe names the offending attribute in each node's `any`/`all` checks.
        // Without it a violation like aria-valid-attr-value cannot be fixed:
        // "the value is invalid" does not say which attribute or which value.
        details: v.nodes.slice(0, 3).map((n) => ({
          target: n.target.join(" "),
          message: n.any?.[0]?.message ?? n.all?.[0]?.message ?? n.failureSummary ?? "",
        })),
        targets: v.nodes.map((n) => n.target.join(" ")),
      }));
    });
  }, { source: await axeSource(), selector: withinSelector });
  const violations = await page.evaluate(() => window.__axeViolations);
  if (violations?.length) {
    console.log(`axe violations in ${label}:\n${violations
      .map((v) => `[${v.id}] ${v.help} (${v.impact}) — ${v.targets[0]}\n    ${v.details.map((d) => d.message).join("\n    ")}`)
      .join("\n")}`);
  }
  return violations ?? [];
}

test.describe("axe-core audit", () => {
  test("editor view passes axe in light theme at desktop width", async ({ page }) => {
    await openApp(page);
    await page.getByLabel("Draft editor").fill(CONTENT_WITH_ISSUES);
    await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 15_000 });
    expect(await runAxe(page, "editor / light / desktop")).toEqual([]);
  });

  test("editor view passes axe in dark theme", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /Use dark theme/u }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
    await page.getByLabel("Draft editor").fill(CONTENT_WITH_ISSUES);
    await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 15_000 });
    expect(await runAxe(page, "editor / dark / desktop")).toEqual([]);
  });

  test("insights view passes axe", async ({ page }) => {
    await openApp(page);
    await page.getByLabel("Draft editor").fill(
      "A draft with enough content for the insights view to have something to describe and score.",
    );
    await page.getByRole("button", { name: "Insights" }).click({ force: true });
    await expect(page.getByRole("progressbar").first()).toBeVisible({ timeout: 15_000 });
    expect(await runAxe(page, "insights")).toEqual([]);
  });

  test("document dashboard passes axe", async ({ page }) => {
    await openApp(page);
    await page.getByLabel("Draft editor").fill("Dashboard content.");
    await page.getByLabel("Document title").fill("Audited document");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Documents" }).click({ force: true });
    await waitForAppReady(page);
    await expect(page.locator(".document-card-main").first()).toBeVisible();
    expect(await runAxe(page, "dashboard")).toEqual([]);
  });

  test("settings dialog passes axe", async ({ page }) => {
    await openApp(page);
    // The workspace carries its own settings shortcut, so the bare name is ambiguous — the header gear opens the dialog this audit means.
    await page.locator("header").getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // Scoped to the dialog: the goal bar behind the modal is covered by the
    // editor-view audits at full opacity, and measuring it through the
    // overlay's dimming would flag colours no one can see.
    expect(await runAxe(page, "settings dialog", "[role=\"dialog\"]")).toEqual([]);
  });

  test("dialogs pass axe in dark theme", async ({ page }) => {
    // Dialogs portal to document.body, outside .app-shell, so they carry the
    // theme themselves. Text that inherited body's light-theme colour once
    // rendered near-black on the dark dialog surface.
    await openApp(page);
    await page.getByRole("button", { name: /Use dark theme/u }).click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByRole("dialog")).toHaveAttribute("data-theme", "dark");
    expect(await runAxe(page, "shortcuts dialog / dark", "[role=\"dialog\"]")).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.locator("header").getByRole("button", { name: "Open settings" }).click();
    await expect(page.getByRole("dialog")).toHaveAttribute("data-theme", "dark");
    expect(await runAxe(page, "settings dialog / dark", "[role=\"dialog\"]")).toEqual([]);
  });

  test("editor passes axe at mobile width", async ({ page }) => {
    // The nav rail collapses to icons here, which is exactly where the
    // button-name violations were: every rail button lost its accessible text.
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await page.getByLabel("Draft editor").fill(
      "Mobile content with a repeatd word so analysis has something to report.",
    );
    await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 15_000 });
    expect(await runAxe(page, "editor / mobile")).toEqual([]);
  });
});
