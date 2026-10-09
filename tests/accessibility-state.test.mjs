import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorUrl = new URL("../components/draftwise/EditorWorkspace.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

test("toolbar and status controls expose their state to assistive technology", async () => {
  const editor = await readFile(editorUrl, "utf8");

  // Focus mode is a toggle. Without aria-pressed a screen reader announces the
  // button's label but not whether it is on, and the label flips between
  // "Check as I write" and "Exit focus" without the state ever being stated.
  assert.match(editor, /onToggleFocusMode[^>]*aria-pressed=\{props\.focusMode\}/u);

  // The panel collapse is a disclosure. It used to be labelled "Collapse
  // suggestions" even while collapsed, so there was no way to reopen it by name.
  // Asserted order-independently: the point is that both attributes are present
  // on the same element, not which one JSX happens to list first.
  const collapse = editor.match(/<Button[^>]*onToggleSuggestions[^>]*>/u);
  assert.ok(collapse, "panel toggle should exist");
  assert.match(collapse[0], /aria-label=\{props\.suggestionsOpen \? "Collapse suggestions" : "Show suggestions"\}/u);
  assert.match(collapse[0], /aria-expanded=\{props\.suggestionsOpen\}/u);

  // Decorative icons must not be announced. A bare <Check size={11} /> has no
  // accessible name but is still in the tree, so a reader heard a stray node
  // before the actual status text.
  assert.match(editor, /<span className="status-check" aria-hidden="true">/u);
  assert.match(editor, /<span className="status-spinner" aria-hidden="true" \/>/u);
});

test("mobile layout hides labels visually without removing them from the a11y tree", async () => {
  const css = await readFile(cssUrl, "utf8");

  // font-size: 0 is not a hiding technique: most screen readers drop text set to
  // zero size, so the analysis status and the focus-mode label became completely
  // silent on mobile — not just invisible. A real visually-hidden utility keeps
  // them in the tree while clipping them out of view.
  const mobileBlock = css.slice(css.indexOf("@media (max-width: 640px)"));
  assert.doesNotMatch(mobileBlock, /\.toolbar-text \{ font-size: 0; \}$/u,
    "a bare font-size:0 hide drops the label from assistive technology");

  assert.match(css, /\.sr-only \{/u);
  assert.match(css, /clip-path: inset\(50%\)/u);
  // Inside a zero-sized container the absolute utility collapses, so it is
  // reverted to static there and clipped by the container instead.
  assert.match(css, /\.toolbar-text \.sr-only, \.analysis-status \.sr-only \{ position: static; \}/u);
});

test("motion respects prefers-reduced-motion", async () => {
  const css = await readFile(cssUrl, "utf8");

  // The status spinner and rewrite pulse run an infinite animation. There was no
  // reduced-motion guard anywhere in the stylesheet, so a user who has asked
  // their OS to reduce motion still got continuous animation.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /\.loading-pulse, \.status-spinner \{ animation: none;/u);
});
