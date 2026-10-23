import { test, expect } from "@playwright/test";
import { freshStart } from "./helpers.mjs";

/**
 * Read aloud is the one feature whose correct behaviour depends on a browser
 * API that headless Chromium does not really implement: there are no voices, so
 * `speechSynthesis.speak` does nothing and no utterance ever completes. The
 * engine is therefore stubbed, and the stub is the test's instrument — it
 * records what would have been said, in order, and can complete an utterance on
 * demand. What is verified is the app's half of the contract: the right text is
 * queued, the highlight follows it, stop really stops, and a browser without
 * the API says so instead of pretending.
 */
async function stubSpeech(page) {
  await page.addInitScript(() => {
    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.voice = null;
        this.lang = "";
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
      }
    }
    const state = { spoken: [], cancelled: 0, pauses: 0, resumes: 0, current: null };
    window.__speech = state;
    // Throw away the "previous" utterance the way Chrome does after cancel().
    window.__speechFinish = () => {
      const current = state.current;
      state.current = null;
      if (current) current.onend?.();
    };
    // `window.speechSynthesis` is a getter on the Window prototype, so a plain
    // assignment is silently ignored and the real, voiceless engine stays in
    // charge — which looks exactly like the app hanging. Redefine it.
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true, writable: true });
    const engine = {
      speaking: false,
      paused: false,
      getVoices: () => [
        { name: "Stub British", lang: "en-GB", localService: true, default: true },
        { name: "Stub American", lang: "en-US", localService: true, default: false },
      ],
      addEventListener: () => {},
      removeEventListener: () => {},
      speak: (utterance) => {
        state.spoken.push(utterance.text);
        window.setTimeout(() => {
          state.current = utterance;
          utterance.onstart?.();
        }, 0);
      },
      cancel: () => {
        state.cancelled += 1;
        const current = state.current;
        state.current = null;
        // Chrome delivers `end` after cancel; the app must not treat it as
        // progress, which is what this stub reproduces.
        if (current) window.setTimeout(() => current.onend?.(), 0);
      },
      pause: () => { state.pauses += 1; engine.paused = true; },
      resume: () => { state.resumes += 1; engine.paused = false; },
    };
    Object.defineProperty(window, "speechSynthesis", { value: engine, configurable: true, writable: true });
  });
}

async function openWorkspace(page) {
  await freshStart(page);
  await page.getByRole("button", { name: "Write", exact: true }).click();
  await expect(page.getByLabel("Draft editor")).toBeEnabled({ timeout: 30_000 });
}

/** The draft text currently marked as being spoken, in document order. */
async function spokenPassage(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".editor-spoken, .editor-highlight.is-spoken")]
      .map((element) => element.textContent ?? "")
      .join(""));
}

test("reading aloud queues the draft in order and highlights the passage", async ({ page }) => {
  await stubSpeech(page);
  await openWorkspace(page);

  const draft = "The draft is ready for review. Send it to the team on Monday.";
  await page.getByLabel("Draft editor").fill(draft);
  await expect(page.getByLabel("Draft editor")).toHaveValue(draft);

  await page.getByRole("button", { name: "Listen to the draft" }).click();
  await expect(page.locator(".read-aloud-status")).toHaveText("Reading 1 of 2", { timeout: 10_000 });
  expect(await spokenPassage(page)).toBe("The draft is ready for review.");

  const first = await page.evaluate(() => window.__speech.spoken);
  expect(first).toEqual(["The draft is ready for review."]);

  // The utterance completes: the next passage starts and the highlight moves
  // with it, so the eye and the ear are never on different sentences.
  await page.evaluate(() => window.__speechFinish());
  await expect(page.locator(".read-aloud-status")).toHaveText("Reading 2 of 2", { timeout: 10_000 });
  expect(await spokenPassage(page)).toBe("Send it to the team on Monday.");
  expect(await page.evaluate(() => window.__speech.spoken)).toHaveLength(2);
});

test("pause, resume and stop control the engine and leave no highlight behind", async ({ page }) => {
  await stubSpeech(page);
  await openWorkspace(page);

  await page.getByLabel("Draft editor").fill("First passage here. Second passage follows it.");
  await page.getByRole("button", { name: "Listen to the draft" }).click();
  await expect(page.locator(".read-aloud-status")).toHaveText("Reading 1 of 2", { timeout: 10_000 });

  await page.getByRole("button", { name: "Pause reading" }).click();
  await expect(page.locator(".read-aloud-status")).toHaveText("Paused 1 of 2");
  expect(await page.evaluate(() => window.__speech.pauses)).toBe(1);
  await page.getByRole("button", { name: "Resume reading" }).click();
  await expect(page.locator(".read-aloud-status")).toHaveText("Reading 1 of 2");
  expect(await page.evaluate(() => window.__speech.resumes)).toBe(1);

  await page.getByRole("button", { name: "Stop reading" }).click();
  await expect(page.getByRole("button", { name: "Listen to the draft" })).toBeVisible();
  await expect(page.locator(".editor-spoken")).toHaveCount(0);
  await expect(page.locator(".editor-highlight.is-spoken")).toHaveCount(0);
  expect(await page.evaluate(() => window.__speech.cancelled)).toBeGreaterThanOrEqual(1);

  // The stray `end` Chrome fires after cancel must not restart the reading.
  await page.waitForTimeout(150);
  await expect(page.locator(".read-aloud-status")).toHaveCount(0);
});

test("editing the draft stops the reading rather than drifting", async ({ page }) => {
  await stubSpeech(page);
  await openWorkspace(page);

  const editor = page.getByLabel("Draft editor");
  await editor.fill("The opening sentence stays put. Another sentence follows.");
  await page.getByRole("button", { name: "Listen to the draft" }).click();
  await expect(page.locator(".read-aloud-status")).toHaveText("Reading 1 of 2", { timeout: 10_000 });

  await editor.fill("The opening sentence changed while it was being read.");
  await expect(page.getByRole("button", { name: "Listen to the draft" })).toBeVisible();
  await expect(page.locator(".editor-spoken")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Reading stopped because the draft changed." })).toHaveCount(1);
});

test("a browser with no speech engine gets a disabled control that explains why", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: undefined, configurable: true });
  });
  await openWorkspace(page);
  await page.getByLabel("Draft editor").fill("Some text that would otherwise be read aloud.");

  const button = page.getByRole("button", { name: "Listen to the draft" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", /no speech voices installed/u);
});

test("an empty draft cannot be read", async ({ page }) => {
  await stubSpeech(page);
  await openWorkspace(page);
  await expect(page.getByRole("button", { name: "Listen to the draft" })).toBeDisabled();

  await page.getByLabel("Draft editor").fill("Now there is something to read.");
  await expect(page.getByRole("button", { name: "Listen to the draft" })).toBeEnabled();
});
