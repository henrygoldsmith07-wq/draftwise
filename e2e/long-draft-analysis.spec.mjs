import { test, expect } from "@playwright/test";
import { freshStart } from "./helpers.mjs";

// The analysis pipeline chunks large documents and merges the results, so the
// completeness and ordering of findings in a long draft depends on that merge.
const MISSES = [
  "seperate", "occured", "definately", "accomodate", "untill", "wich",
  "teh", "adress", "arguement", "becuase", "calender", "embarass", "foriegn",
  "goverment", "independant", "occassion", "priviledge", "publically",
  "refered", "tommorow",
];

// Every sentence carries a DISTINCT misspelling, so no two findings collapse
// into the same group and the card count is a true completeness measure. An
// earlier version of this test repeated one misspelling per block, which the
// engine correctly grouped into a single finding — the count was never going to
// match the number of blocks.
function buildLongDraft(blocks) {
  let text = "";
  for (let i = 0; i < blocks; i += 1) {
    const word = MISSES[i % MISSES.length];
    text += `Section ${i + 1} of the plan. The manager ${word} the update on Thursday.`;
    if (i % 2 === 0) text += " We reviewed the figures twice. ";
    text += "\n\n";
  }
  return text;
}

async function openWorkspace(page) {
  await freshStart(page);
  // Fresh installs open on the documents dashboard, so step into the editor.
  // On a resumed session this is a no-op: the app is already writing.
  await page.getByRole("button", { name: "Write", exact: true }).click();
  // The save dot appears while the document store is still hydrating, and the
  // editor is deliberately disabled until it finishes. Filling before then
  // types into a field that discards its value — which is exactly the bug the
  // loading guard fixes.
  await expect(page.getByLabel("Draft editor")).toBeEnabled({ timeout: 30_000 });
}

test("a long draft is analysed across the whole document, not just near the edit", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (event) => errors.push(event.message));

  await openWorkspace(page);
  const draft = buildLongDraft(30);
  await page.getByLabel("Draft editor").fill(draft);

  // Assert the text actually landed before waiting on analysis. An earlier run
  // of this test read the sample document instead, because the save dot had
  // already resolved and the fill had not been applied yet.
  await expect(page.getByLabel("Draft editor")).toHaveValue(/Section 30 of the plan/);
  await expect(page.getByLabel("Draft editor")).not.toHaveValue("");

  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });

  // Wait for the card count to stop changing before counting or stepping.
  //
  // The first card appears while the sweep is still running, and the list
  // keeps moving as later chunks land: findings that repeat across sections
  // get grouped into one card, so the displayed count can go DOWN as well as
  // up. A fixed wait for the sweep to finish is a guess. The status label
  // always reads "Local analysis only" with AI off, so it says nothing about
  // whether the sweep finished either. Waiting for the count itself to settle
  // is the only signal that does.
  //
  // This matters because the review cursor deliberately wraps: on the last
  // finding, "next" returns to the first, so the writer is never stranded at
  // the end of a draft (keyboard-review.spec.mjs asserts that wrap). Walking
  // a list that is still shrinking overshoots the end and lands back on the
  // first finding, which is correct product behaviour and a wrong test
  // assumption.
  await expect(async () => {
    const first = await page.locator(".suggestion-card").count();
    await page.waitForTimeout(700);
    const second = await page.locator(".suggestion-card").count();
    expect(second).toBe(first);
  }).toPass({ timeout: 45_000 });

  // The sidebar deliberately caps displayed findings per tier
  // (SUGGESTION_DENSITY_CAPS) so a long draft cannot flood the writer, so this
  // does NOT assert all 30 findings appear. What it asserts is that the
  // findings shown come from the whole document and the review cursor starts at
  // the first defect, not at whatever a chunk happened to finish with.
  const cards = await page.locator(".suggestion-card").count();
  expect(cards).toBeGreaterThanOrEqual(12);

  // The review cursor is only marked once the writer selects a finding, so
  // step to it. The first finding must be the first defect in the DOCUMENT,
  // not whatever a chunk happened to finish with.
  await page.evaluate(() => {
    const editor = document.querySelector("textarea.editor-input");
    if (editor) editor.blur();
  });
  await page.keyboard.press("Control+ArrowDown");
  const firstActive = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".suggestion-card")];
    const active = cards.find((card) => card.className.includes("is-active"));
    return active ? active.textContent?.slice(0, 80) : null;
  });
  expect(firstActive).toContain("Section 1");

  // Stepping forward must move the caret through the document, so the findings
  // displayed are not all clustered around the edit that triggered analysis.
  const caretAt = () => page.evaluate(() => document.querySelector("textarea.editor-input")?.selectionStart ?? -1);
  await page.keyboard.press("Control+ArrowDown");
  const firstCaret = await caretAt();

  // Walk forward by however many findings remain, and no further.
  //
  // The review cursor deliberately wraps: on the last finding, "next" returns
  // to the first, so the writer is never stranded at the end of a draft
  // (keyboard-review.spec.mjs asserts that wrap). A fixed number of presses
  // therefore does NOT always move forward — pressing 12 times with 13
  // findings displayed lands back on the first one, and the caret jumps
  // backwards. That is correct product behaviour and a wrong test assumption.
  // Stepping exactly to the last finding proves the same thing — the cursor
  // walks through the document rather than clustering near the edit —
  // without depending on where the wrap lands.
  const stepsToLast = Math.max(1, cards - 2);
  let furthestCaret = firstCaret;
  for (let i = 0; i < stepsToLast; i += 1) {
    await page.keyboard.press("Control+ArrowDown");
    furthestCaret = Math.max(furthestCaret, await caretAt());
  }
  const laterCaret = await caretAt();
  console.log("LONG carets:", firstCaret, "->", laterCaret, `(${cards} shown, ${stepsToLast} steps)`);

  // The review loop must be walkable end to end. The strongest statement is
  // that the cursor ended on the LAST displayed finding: it proves the whole
  // list was walked, and unlike a caret comparison it does not depend on
  // where in the document each finding happens to sit.
  const activeIndex = await page.evaluate(() => {
    const all = [...document.querySelectorAll(".suggestion-card")];
    return all.findIndex((card) => card.className.includes("is-active"));
  });
  expect(activeIndex).toBe(cards - 1);

  // And the caret must have moved forward into the document at some point
  // along the way, so the findings are not all clustered near the edit that
  // triggered the analysis.
  expect(firstCaret).toBeGreaterThan(0);
  expect(furthestCaret).toBeGreaterThan(firstCaret);

  // Suppressed findings are still accounted for, so the writer is told the
  // difference between "clean" and "more than we are showing you".
  const summary = await page.evaluate(() => {
    const el = document.querySelector(".fix-first-banner");
    return el ? el.textContent?.slice(0, 140) : null;
  });
  console.log("LONG summary text:", summary);
  expect(summary).not.toBeNull();

  expect(errors).toEqual([]);
});

test("editing the middle of a long draft keeps findings from before the edit", async ({ page }) => {
  await openWorkspace(page);
  await page.getByLabel("Draft editor").fill(buildLongDraft(6));
  await expect(page.getByLabel("Draft editor")).toHaveValue(/Section 6 of the plan/);
  await expect(page.locator(".suggestion-card").first()).toBeVisible({ timeout: 45_000 });
  // The first card appears while analysis is still running, so counting there
  // reads a partial list — 2 cards in a full run where the settled count is 8.
  // The status label always reads "Local analysis only" with AI off, so it says
  // nothing about whether the sweep finished. Wait for the card count itself to
  // stop changing instead.
  await expect(async () => {
    const first = await page.locator(".suggestion-card").count();
    await page.waitForTimeout(700);
    const second = await page.locator(".suggestion-card").count();
    expect(second).toBe(first);
    expect(first).toBeGreaterThanOrEqual(6);
  }).toPass({ timeout: 45_000 });

  const before = await page.locator(".suggestion-card").count();
  expect(before).toBeGreaterThanOrEqual(6);

  // Insert text deep in the middle. Incremental analysis must not discard the
  // findings that precede the edit — this is the wholesale-replacement guard in
  // analyzeLocallyIncremental: a large changed span must re-analyse the whole
  // document rather than retain a window-sized slice of the old findings.
  await page.evaluate(() => {
    const editor = document.querySelector("textarea.editor-input");
    if (!editor) return;
    const at = Math.floor(editor.value.length / 2);
    editor.focus();
    editor.setSelectionRange(at, at);
  });
  await page.keyboard.type("INSERTEDWORD ");
  await page.waitForTimeout(4000);

  const after = await page.locator(".suggestion-card").count();
  expect(after).toBeGreaterThanOrEqual(6);
});
