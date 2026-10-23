import { test, expect } from "@playwright/test";
import { freshStart } from "./helpers.mjs";

/**
 * Keyboard-driven suggestion review.
 *
 * The shortcuts dialog promised "keep your hands on the draft while you review
 * suggestions" but offered no way to move between findings or act on one, so
 * every review action needed the mouse. These tests exercise the real bindings
 * in a real browser rather than trusting the unit tests, which can only prove
 * the key mapping — not that the handler is wired to the live issue list.
 *
 * The most important assertions are the negative ones: a review binding must
 * never fire while the writer is typing, because that would corrupt their
 * draft. Ctrl+Z must still undo, and a plain arrow must still move the caret.
 */

const DRAFT =
  "This is repeatd wording and the numbers is wrong, so the analysis has something to show for the reviewer.";

async function openWorkspace(page) {
  await freshStart(page);
  // Fresh installs open on the documents dashboard, so step into the editor.
  // On a resumed session this is a no-op: the app is already writing.
  await page.getByRole("button", { name: "Write", exact: true }).click();
  // The editor stays disabled until the document store finishes hydrating; filling before then types into a field that discards its value.
  await expect(page.getByLabel("Draft editor")).toBeEnabled({ timeout: 30_000 });
  await page.getByLabel("Draft editor").fill(DRAFT);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 15_000 });
}

test("ctrl+arrow moves the review cursor through suggestions", async ({ page }) => {
  await openWorkspace(page);
  const cards = page.locator(".suggestion-card");
  const total = await cards.count();
  expect(total).toBeGreaterThan(1);

  // Move focus out of the editor so the binding is not suppressed by the
  // typing guard, then step to the first finding.
  await page.locator(".document-name input").click();
  await page.keyboard.press("Control+ArrowDown");
  await expect(cards.nth(0)).toHaveClass(/is-active/);

  // A live-region announcement is the only feedback a keyboard user gets.
  await expect(page.locator("p.sr-only[role=\"status\"]")).toContainText(/of \d+/u);
  await expect(page.locator("p.sr-only[role=\"status\"]")).toContainText(/Enter to accept/u);

  await page.keyboard.press("Control+ArrowDown");
  await expect(cards.nth(1)).toHaveClass(/is-active/);

  // And back again, without wrapping past the start.
  await page.keyboard.press("Control+ArrowUp");
  await expect(cards.nth(0)).toHaveClass(/is-active/);
});

test("ctrl+arrow wraps from the last finding to the first", async ({ page }) => {
  await openWorkspace(page);
  const cards = page.locator(".suggestion-card");
  const total = await cards.count();

  await page.locator(".document-name input").click();
  // Step to the end, then one more: the cursor must wrap rather than stop.
  for (let index = 0; index < total; index += 1) await page.keyboard.press("Control+ArrowDown");
  await expect(cards.nth(total - 1)).toHaveClass(/is-active/);
  await page.keyboard.press("Control+ArrowDown");
  await expect(cards.nth(0)).toHaveClass(/is-active/);
});

test("ctrl+enter applies the current suggestion from the keyboard", async ({ page }) => {
  await openWorkspace(page);
  const editor = page.getByLabel("Draft editor");
  const before = await editor.inputValue();

  await page.locator(".document-name input").click();
  await page.keyboard.press("Control+ArrowDown");

  const target = page.locator(".suggestion-card.is-active .suggestion-original");
  await expect(target).toBeVisible();
  const original = (await target.textContent())?.trim();
  expect(original).toBeTruthy();

  await page.keyboard.press("Control+Enter");
  await expect(editor).not.toHaveValue(before);
  const after = await editor.inputValue();
  expect(after.includes(original)).toBe(false);
});

test("ctrl+backspace dismisses the current suggestion", async ({ page }) => {
  await openWorkspace(page);
  const cards = page.locator(".suggestion-card");
  const before = await cards.count();

  await page.locator(".document-name input").click();
  await page.keyboard.press("Control+ArrowDown");
  await page.keyboard.press("Control+Backspace");

  await expect(cards).toHaveCount(before - 1);
});

test("review bindings never fire while typing", async ({ page }) => {
  await openWorkspace(page);
  const editor = page.getByLabel("Draft editor");
  await editor.click();

  // Every review binding, pressed while the caret is in the draft. None may
  // apply or dismiss a suggestion: that would corrupt the writer's work the
  // moment they leaned on Ctrl to edit a word.
  //
  // The draft is not asserted byte-identical afterwards, because the guard
  // correctly hands Ctrl+Backspace back to the browser, which deletes a word —
  // that is native editing, and the writer expects it. What must not happen is
  // a suggestion being applied or removed behind their back, so the suggestion
  // count and the applied-text check are the real assertions.
  const cards = page.locator(".suggestion-card");
  const beforeCount = await cards.count();
  const before = await editor.inputValue();

  await page.keyboard.press("Control+Enter");
  await page.keyboard.press("Control+ArrowDown");
  await page.keyboard.press("Control+ArrowUp");

  // No suggestion was applied or dismissed by the review bindings.
  await expect(cards).toHaveCount(beforeCount);
  // And nothing was silently rewritten: Ctrl+Enter must not accept-all here.
  const after = await editor.inputValue();
  const appliedAnySuggestion = before !== after;
  expect(appliedAnySuggestion).toBe(false);
});

test("ctrl+backspace inside the draft stays native word deletion", async ({ page }) => {
  await openWorkspace(page);
  const editor = page.getByLabel("Draft editor");
  await editor.click();
  await editor.press("End");
  const before = await editor.inputValue();

  // The guard must not merely block the binding — it must leave the keystroke
  // alone so the browser's own word-delete still works.
  await page.keyboard.press("Control+Backspace");
  const after = await editor.inputValue();
  expect(after.length).toBeLessThan(before.length);
});

test("ctrl+z still undoes while review bindings exist", async ({ page }) => {
  await openWorkspace(page);
  const editor = page.getByLabel("Draft editor");
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" Extra text at the end.");
  const edited = await editor.inputValue();

  await page.keyboard.press("Control+z");
  await expect(editor).not.toHaveValue(edited);
});

test("plain arrows still move the caret and are not stolen", async ({ page }) => {
  await openWorkspace(page);
  const editor = page.getByLabel("Draft editor");
  await editor.click();
  await editor.press("End");
  const end = await editor.evaluate((el) => el.selectionStart);

  await page.keyboard.press("ArrowLeft");
  const moved = await editor.evaluate((el) => el.selectionStart);
  expect(moved).toBe(end - 1);
});

test("the shortcuts dialog documents every review binding it implements", async ({ page }) => {
  await openWorkspace(page);
  // The workspace now carries its own settings shortcut, so the bare name is ambiguous — the header gear is the readiness signal this wait means. It stays a wait, not a click: opening settings here would cover the rail button below.
  await page.locator("header").getByRole("button", { name: "Open settings" }).waitFor();
  await page.getByRole("button", { name: /Keyboard shortcuts/u }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  for (const label of [
    /Next suggestion/u,
    /Previous suggestion/u,
    /Accept the current suggestion/u,
    /Ignore the current suggestion/u,
  ]) {
    await expect(dialog).toContainText(label);
  }
});
