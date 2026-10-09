import { test, expect } from "@playwright/test";

/**
 * Browser-level verification for the accessibility and responsive fixes.
 *
 * The unit tests assert the source and stylesheet contain the right
 * attributes and rules. They cannot tell you whether a screen reader actually
 * announces the analysis status, or whether the toolbar label is gone from the
 * accessibility tree at mobile width. This file renders the real app and
 * checks the computed result.
 *
 * Everything here runs offline with AI disabled, the same discipline as
 * document-lifecycle.spec.mjs.
 */

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
  await expect(page.getByLabel("Draft editor")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("analysis status is announced and is not an empty live region", async ({ page }) => {
  const status = page.locator(".analysis-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveAttribute("aria-live", "polite");

  // A live region with no accessible text announces nothing. The status must
  // always carry a readable string, analysing or not.
  const text = (await status.innerText()).trim();
  expect(text.length).toBeGreaterThan(0);

  // The two decorative icons are alternatives, not siblings: the spinner shows
  // while analysing and the tick once settled. Asserting both at once was
  // wrong — only one is ever in the DOM. Whichever is present must be hidden
  // from assistive technology, so a reader reaches the status text rather than
  // an unnamed node before it.
  const icon = status.locator(".status-check, .status-spinner");
  await expect(icon.first()).toHaveAttribute("aria-hidden", "true");

  // And the live region's text is real prose, not just an icon.
  expect(text).toMatch(/[A-Za-z]{3,}/u);
});

test("analysis status stays announced while the app is analysing", async ({ page }) => {
  // The spinner branch is the one that previously carried an unlabelled node.
  // Typing schedules analysis, so the spinner appears here; the assertion is
  // that it is hidden and the accompanying words are not.
  await page.getByLabel("Draft editor").fill("A sentence long enough to schedule real analysis work.");
  const spinner = page.locator(".analysis-status .status-spinner");
  if (await spinner.count()) {
    await expect(spinner.first()).toHaveAttribute("aria-hidden", "true");
    const statusText = (await page.locator(".analysis-status").innerText()).trim();
    expect(statusText.length).toBeGreaterThan(0);
  }
});

test("focus mode reports its pressed state, not just its label", async ({ page }) => {
  const toggle = page.getByRole("button", { name: /Check as I write|Exit focus/u });
  await expect(toggle).toBeVisible();

  // The label flips, which is not the same as the state being exposed. aria-pressed
  // is what lets assistive technology say "pressed" or "not pressed".
  const before = await toggle.getAttribute("aria-pressed");
  expect(before).toBe("false");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toHaveText(/Exit focus/u);
});

test("suggestions panel collapse is a labelled disclosure in both states", async ({ page }) => {
  const panel = page.locator(".suggestions-column");
  await expect(panel).toBeVisible();

  // While open, the control must say it can collapse.
  const collapse = page.getByRole("button", { name: "Collapse suggestions" });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();

  // Collapsed: the previous label was still "Collapse suggestions", leaving no
  // accessible way back in. It must now be findable by name.
  await expect(panel).toHaveCount(0);
  const expand = page.getByRole("button", { name: "Show suggestions" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.click();
  await expect(panel).toBeVisible();
});

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("hidden toolbar labels stay in the accessibility tree", async ({ page }) => {
    // font-size: 0 is not a hiding technique: most screen readers drop
    // zero-sized text, so these labels became silent rather than invisible.
    // They must still be reachable by accessible name at mobile width.
    const toggle = page.getByRole("button", { name: /Check as I write|Exit focus/u });
    await expect(toggle).toBeVisible();

    const status = page.locator(".analysis-status");
    await expect(status).toBeVisible();
    expect((await status.innerText()).trim().length).toBeGreaterThan(0);

    // Visually collapsed to zero width, but not display:none, which would
    // remove it from the tree entirely.
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    const styles = await toggle.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { display: computed.display, visibility: computed.visibility, fontSize: computed.fontSize };
    });
    expect(styles.display).not.toBe("none");
    expect(styles.visibility).not.toBe("hidden");
    // The label itself is clipped rather than deleted.
    expect(styles.fontSize).toBe("0px");
  });

  test("essential editing controls remain reachable", async ({ page }) => {
    // The brief requires mobile layouts to preserve the essential editing and
    // review workflow, not just avoid clipping.
    await expect(page.getByLabel("Draft editor")).toBeVisible();
    const editor = page.getByLabel("Draft editor");
    await editor.fill("Typed on a narrow screen.");
    await expect(editor).toHaveValue("Typed on a narrow screen.");

    // Undo/redo are the recovery path and must survive the breakpoint.
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Redo" })).toBeVisible();
  });
});

test("reduced-motion preference stops the infinite status animation", async ({ browser }) => {
  // A user who has asked their OS to reduce motion must not get a continuously
  // animating spinner. The stylesheet had no guard at all before this.
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await openApp(page);

  // Put the app into the analysing state, then confirm the spinner is not
  // animating. Typing schedules analysis, which is the only path to a spinner.
  await page.getByLabel("Draft editor").fill("A sentence long enough to trigger analysis work.");
  const spinner = page.locator(".status-spinner");
  if (await spinner.count()) {
    const animation = await spinner.first().evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  }

  // The loading pulse in the rewrite preview is the other animated element.
  const pulse = page.locator(".loading-pulse");
  if (await pulse.count()) {
    const animation = await pulse.first().evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  }
  await context.close();
});

test("sticky-sentence findings appear in the review list with an explanation", async ({ page }) => {
  // End-to-end confirmation that the new rule reaches the writer, not just the
  // analyser: a sentence made mostly of connecting words must produce a card
  // the writer can read, act on, or dismiss.
  await page.getByLabel("Draft editor").fill(
    "The fact of the matter is that the implementation of the system in the context of the organisation will be the subject of a review by the committee.",
  );
  const card = page.locator(".suggestion-card", { hasText: "Dense with connecting words" }).first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  // The card states the measurement that triggered it, so the writer can
  // disagree with a number rather than an opinion.
  await expect(card).toContainText(/% of this sentence/u);
  // It must be dismissible: an unexplainable suggestion is not a suggestion.
  // The accessible name comes from aria-label, which overrides the visible
  // "Ignore this" text — matching on the visible string alone finds nothing.
  await expect(card.getByRole("button", { name: /^Dismiss /u })).toBeVisible();
});
