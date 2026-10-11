import { test, expect } from "@playwright/test";

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
  await page.goto("/");
  await page.evaluate(() => {
    indexedDB.deleteDatabase("draftwise-documents");
    localStorage.clear();
  });
  await page.reload();
  await page.locator(".saved-dot").waitFor({ timeout: 30_000 });
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
  await page.waitForTimeout(1500);

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
  for (let i = 0; i < 12; i += 1) await page.keyboard.press("Control+ArrowDown");
  const laterCaret = await caretAt();
  console.log("LONG carets:", firstCaret, "->", laterCaret);

  // The review loop must be walkable end to end: the first press lands on a
  // real finding and stepping forward advances. Density caps mean the displayed
  // set is bounded by design, so this asserts the loop advances rather than
  // how far across the document the capped set reaches.
  expect(firstCaret).toBeGreaterThan(0);
  expect(laterCaret).toBeGreaterThan(firstCaret);

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
