import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MemoryDocumentBackend } from "../lib/documents.ts";
import { DocumentLifecycle } from "../lib/document-lifecycle.ts";

/**
 * First-run honesty, and the mobile viewport contract.
 *
 * A fresh install used to open the editor cursor-deep in sample prose that was
 * presented as the writer's own draft. The prose was not theirs, they had not
 * asked for it, and the first thing the product did was imply they had written
 * it. The fixes are in place — an empty seed, a home-first default, a welcome
 * panel — but they were only ever protected by comments, so any future change
 * to the seed or the default view could quietly reintroduce the lie.
 *
 * These tests pin the invariants so that a regression is a failing test rather
 * than a bad first impression.
 */

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const dashboardUrl = new URL("../components/draftwise/DocumentDashboard.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

const EMPTY_SEED = { title: "Untitled draft", draft: "" };

/**
 * The body of the small-screen block that actually declares `selector`.
 *
 * The stylesheet contains more than one `@media (max-width: 640px)` block, and
 * they are not interchangeable: a one-line block for the terminology fields
 * precedes the main responsive block. Taking the *first* match therefore
 * silently reads the wrong rules, and the assertions below would be checking
 * something that is not the mobile layout at all. The right block is the one
 * that declares the selector being asserted.
 */
function smallScreenRule(css, selector) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf("@media (max-width: 640px)", from);
    if (start === -1) break;
    // The block runs to the end of the enclosing braces.
    let depth = 0;
    let end = start;
    for (let index = css.indexOf("{", start); index < css.length; index += 1) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) { end = index; break; }
      }
    }
    blocks.push(css.slice(start, end));
    from = end + 1;
  }
  for (const block of blocks) {
    const rule = block.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")} \\{([^}]*)\\}`, "u"));
    if (rule) return rule[1];
  }
  return null;
}

test("a fresh install seeds an empty draft, never sample prose", async () => {
  // Behavioural, not a source grep: this is the actual promise the product
  // makes to someone opening it for the first time.
  const lifecycle = new DocumentLifecycle(new MemoryDocumentBackend(), EMPTY_SEED);
  await lifecycle.load();

  const active = lifecycle.getActive();
  assert.ok(active, "a fresh install still gets a real document to write into");
  assert.equal(active.draft, "", "the seeded draft is empty: the writer owns no words yet");
  assert.equal(active.title, "Untitled draft");
});

test("the seed passed to the document store is empty, not the sample", async () => {
  const page = await readFile(pageUrl, "utf8");

  // The sample prose must never be the seed. It is only ever loaded by an
  // explicit action from the welcome panel, into its own titled document.
  const seedCall = page.match(/useDocuments\(\{ title: "[^"]*", draft: "([^"]*)" \}/u);
  assert.ok(seedCall, "the document store should be seeded explicitly");
  assert.equal(seedCall[1], "", "the seed draft must be empty");

  // And the sample constant must not be referenced as a seed anywhere.
  const seededWithSample = /draft:\s*SAMPLE_DOCUMENT/u.test(page);
  assert.equal(seededWithSample, false, "sample prose must never be seeded into a document");
});

test("a fresh install opens on the documents view, not inside the editor", async () => {
  const page = await readFile(pageUrl, "utf8");

  // The default view is the dashboard. A returning writer is moved into the
  // editor by the resume rule below, but only once real words exist.
  assert.match(page, /useState<WorkspaceView>\("home"\)/u,
    "the first view should be the documents dashboard");

  // The resume rule is what makes a returning writer land in their draft. It
  // must be gated on there being actual words: a fresh install owns none, so it
  // stays on the dashboard.
  const resume = page.match(/if \(hydrated && documents\.hydrated && !resumed\) \{([\s\S]*?)\n  \}/u);
  assert.ok(resume, "a resume rule should exist for returning writers");
  assert.match(resume[1], /documents\.documents\.some\(\(document\) => document\.draft\.trim\(\) !== ""\)/u,
    "the editor is only entered when a document actually has words in it");
});

test("the first-run welcome panel offers a blank page and an explicit sample", async () => {
  const dashboard = await readFile(dashboardUrl, "utf8");

  // The empty state is a decision, not an absence: blank page or sample.
  assert.match(dashboard, /welcome-panel/u, "a fresh install should offer a way to start");
  assert.match(dashboard, /onSample/u, "the sample is reachable, but only by asking for it");
  assert.match(dashboard, /Try the sample text/u);

  // The panel appears only when nothing has been written, and never while the
  // store is still hydrating — an empty list before storage answers reads as
  // "you have nothing", which is a different and wrong claim.
  assert.match(dashboard, /const isFresh = !loading && summaries\.every\(\(document\) => document\.wordCount === 0\)/u);
  assert.match(dashboard, /!loading && isFresh/u);
});

test("the mobile editor never grows taller than the viewport", async () => {
  const css = await readFile(cssUrl, "utf8");

  const editorRule = smallScreenRule(css, ".editor-card");
  assert.ok(editorRule, "the editor card should be restyled on small screens");
  assert.doesNotMatch(editorRule, /min-height:\s*450px/u,
    "a fixed 450px minimum overflows short phone viewports");
  assert.match(editorRule, /min-height:\s*min\(450px, calc\(100svh - 300px\)\)/u,
    "the editor minimum should be capped by the viewport height");

  // `svh` (small viewport height) rather than `vh`: `vh` ignores the browser
  // chrome, so the card could still overflow once the address bar is showing.
  assert.match(editorRule, /100svh/u);

  // The same cap on the card's height, so the whole editor is usable.
  assert.match(editorRule, /height:\s*62svh/u);
});

test("the settings footer stays reachable while scrolling on mobile", async () => {
  const css = await readFile(cssUrl, "utf8");

  // The footer holds the destructive "clear local data" control. If it scrolls
  // away, the setting is only findable by scrolling back to the bottom.
  assert.match(css, /\.settings-footer \{[^}]*position: sticky;[^}]*bottom: 0/u,
    "the settings footer should stick to the bottom of the viewport");
});

test("the small-screen layout reserves room for the bottom navigation rail", async () => {
  const css = await readFile(cssUrl, "utf8");

  // On small screens the rail becomes a fixed bar across the bottom. Content
  // that runs underneath it is content the writer cannot tap.
  const railRule = smallScreenRule(css, ".left-rail");
  assert.ok(railRule, "the rail should be restyled on small screens");
  assert.match(railRule, /position: fixed/u);
  assert.match(railRule, /bottom: 0/u);

  const gridRule = smallScreenRule(css, ".workspace-grid");
  assert.ok(gridRule, "the workspace grid should be restyled on small screens");
  assert.match(gridRule, /padding:\s*26px 14px 82px/u,
    "the bottom padding must clear the fixed navigation rail");
});
