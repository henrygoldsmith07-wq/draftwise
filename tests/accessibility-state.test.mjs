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

  // The collapsed rail renders a *separate* button with the same job, and it
  // shipped with neither an accessible label nor a state. Playwright caught this
  // in the browser: the control resolved by role but reported aria-expanded as
  // null, so a screen reader had nothing to announce when reopening the panel.
  const collapsedRail = editor.match(/<aside className="suggestions-collapsed">[\s\S]*?<\/aside>/u);
  assert.ok(collapsedRail, "collapsed rail should exist");
  assert.match(collapsedRail[0], /aria-label="Show suggestions"/u);
  assert.match(collapsedRail[0], /aria-expanded=\{false\}/u);
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
  // The old font-size:0 hide used a .sr-only revert rule that matched nothing
  // (the labels are plain text nodes). Keeping the analysis status readable
  // at a small size restores the actual "Analysing / ready" feedback.
  assert.doesNotMatch(css, /\.toolbar-text \.sr-only, \.analysis-status \.sr-only/u);
  assert.match(mobileBlock, /\.analysis-status \{ font-size: 10px; \}/u);
});

test("motion respects prefers-reduced-motion", async () => {
  const css = await readFile(cssUrl, "utf8");

  // The status spinner and rewrite pulse run an infinite animation. There was no
  // reduced-motion guard anywhere in the stylesheet, so a user who has asked
  // their OS to reduce motion still got continuous animation.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /\.loading-pulse, \.status-spinner \{ animation: none;/u);
});

test("offline status, backup reminder and backup stamping reach the UI", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  // These were computed but never rendered, so the offline explanation and
  // the only nudge protecting local-only drafts never reached any writer.
  assert.match(page, /<OfflineNotice online=\{online\} \/>/u);
  assert.match(page, /<div className="backup-banner">[\s\S]{0,80}<span role="status">/u);
  assert.match(page, /onClick=\{exportBackupFromReminder\}/u);
  assert.match(page, /onClick=\{snoozeBackupReminder\}/u);
  assert.match(page, /onBackupExported=\{markBackupExported\}/u);
});

test("a new draft uses the title typed in the dialog", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const dialog = await readFile(
    new URL("../components/draftwise/dialogs/NewDraftDialog.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /function NewDraftDialog\(/u, "the duplicate local dialog is dead code");
  assert.match(page, /createNew\(requestedTitle \|\| "Untitled draft"/u);
  assert.match(page, /typeof title === "string" \? title\.trim\(\) : ""/u);
  assert.match(dialog, /onConfirm: \(title\?: string\) => void/u);
  assert.match(dialog, /onConfirm\(title\);/u);
  assert.match(dialog, /<label htmlFor="draft-title"/u);
});

test("the toast live region exists before it receives a message", async () => {
  const toast = await readFile(
    new URL("../components/draftwise/utilities/Toast.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(toast, /if \(toasts\.length === 0\) return null/u,
    "mounting the region with its first message makes announcements missable");
  assert.match(toast, /aria-live="polite" aria-label="Notifications"/u);
});

test("the shortcut help lists only keys the app implements", async () => {
  const overlay = await readFile(
    new URL("../components/draftwise/dialogs/KeyboardShortcutsOverlay.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  for (const unimplemented of ["Ctrl + N", "Ctrl + O", "Ctrl + D", '["Documents view"', '["Toggle suggestions"']) {
    assert.doesNotMatch(overlay, new RegExp(unimplemented.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      `${unimplemented} has no handler`);
  }
  assert.match(overlay, /Dismiss suggestion", "⌘ \+ Backspace/u);
  assert.doesNotMatch(page, /function ShortcutDialog/u, "the duplicate shortcut list is dead code");
});

test("changing views moves focus and announces the destination", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  // The effect is the single place every setView flows through, so all
  // navigation paths get focus management without editing each call site.
  assert.match(page, /useEffect\(\(\) => \{[\s\S]{0,700}document\.getElementById\("main-content"\)\?\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(page, /viewStatusRef\.current\.textContent = `\$\{label\} view\.`/u);
  assert.match(page, /<div ref=\{viewStatusRef\} className="sr-only" role="status" aria-live="polite" \/>/u);
});

test("each status message has exactly one live region", async () => {
  const editor = await readFile(
    new URL("../components/draftwise/EditorWorkspace.tsx", import.meta.url), "utf8");
  const topBar = await readFile(
    new URL("../components/draftwise/topbar/TopBar.tsx", import.meta.url), "utf8");

  // Duplicated polite regions made every review step and analysis update be
  // announced twice by screen readers.
  assert.doesNotMatch(editor, /reviewAnnouncement: string;/u);
  assert.doesNotMatch(editor, /<p className="sr-only" role="status"/u);
  const liveRegions = editor.match(/role="status" aria-live="polite"/gu) ?? [];
  assert.equal(liveRegions.length, 1, "the editor should own exactly one polite live region");
  assert.match(editor, /<span aria-hidden="true"><Zap size=\{14\} \/> \{props\.analysisStatusLabel\}<\/span>/u);
  assert.match(topBar, /className="sr-only" role="status" aria-live="polite">\{saveError \?\? ""\}/u);

  // Analysis and import errors were inserted into the DOM already carrying
  // their message, which screen readers commonly miss. Their live regions
  // must be mounted from the start and contain text only — no recovery button.
  assert.match(editor, /<p className="sr-only" role="alert">\{props\.analysisError \?/u);
  assert.doesNotMatch(editor, /className="analysis-error"[^>]*role=/u);
  const dashboard = await readFile(
    new URL("../components/draftwise/DocumentDashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /<p className="sr-only" role="alert">\{importError \?\? ""\}<\/p>/u);
  assert.doesNotMatch(dashboard, /className="import-error"[^>]*role=/u);
});

test("skip link is hidden until focused and all motion respects the OS setting", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /\.skip-link \{ position: absolute; left: -9999px;/u);
  assert.match(css, /\.skip-link:focus \{ left: 8px;/u);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.toast, \[class\*="animate-"\], button, \.app-shell/u);
  assert.match(reduced, /button:hover \{ transform: none; \}/u);
});

test("decorative and named graphics use valid semantics", async () => {
  const primitives = await readFile(
    new URL("../components/draftwise/EditorPrimitives.tsx", import.meta.url), "utf8");
  const editor = await readFile(
    new URL("../components/draftwise/EditorWorkspace.tsx", import.meta.url), "utf8");
  const topBar = await readFile(
    new URL("../components/draftwise/topbar/TopBar.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(primitives, /className="score-ring" role="img" aria-label=/u);
  assert.match(editor, /editor-jump[\s\S]{0,120}<span aria-hidden="true">↓<\/span>/u);
  assert.match(topBar, /<FileText size=\{15\} aria-hidden="true" \/>/u);
  assert.match(page, /event\.target instanceof HTMLSelectElement/u);
});

test("rail 'new' badges clear once their views have been visited", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const rail = await readFile(
    new URL("../components/draftwise/navigation/RailNavigation.tsx", import.meta.url), "utf8");

  // These flags were computed but never passed, so the badge and its
  // accessible name stayed "new" forever, including on later visits.
  assert.match(page, /showInsightsNew=\{showInsightsNew\}/u);
  assert.match(page, /showExtensionNew=\{showExtensionNew\}/u);
  assert.match(page, /if \(next === "insights"\) openInsights\(\)/u);
  assert.match(rail, /aria-label=\{showInsightsNew \? "Insights new" : "Insights"\}/u);
  assert.match(rail, /aria-label=\{showExtensionNew \? "Extension new" : "Extension"\}/u);
});

test("the theme has a reachable control and reaches portaled dialogs", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const topBar = await readFile(
    new URL("../components/draftwise/topbar/TopBar.tsx", import.meta.url), "utf8");
  const layout = await readFile(
    new URL("../components/draftwise/PageLayout.tsx", import.meta.url), "utf8");
  const css = await readFile(cssUrl, "utf8");

  assert.match(topBar, /<ThemeToggle darkMode=\{darkMode\} onThemeChange=\{onThemeChange\} \/>/u);
  assert.match(page, /darkMode=\{darkMode\}/u);
  assert.match(page, /onThemeChange=\{\(dark\) => updateWorkspace\(\{ theme: dark \? "dark" : "light" \}\)\}/u);
  assert.match(layout, /document\.documentElement\.dataset\.theme = theme/u);
  assert.match(css, /html\[data-theme="dark"\] \[data-slot="dialog-content"\]/u);
});

test("the export menu opens by keyboard, not only by hover", async () => {
  const dashboard = await readFile(
    new URL("../components/draftwise/DocumentDashboard.tsx", import.meta.url), "utf8");
  const css = await readFile(cssUrl, "utf8");

  // The menu was display:none until :hover, and its trigger had no click or key
  // handler. A keyboard user could focus the button but could never reach the
  // three export formats, so a core journey was mouse-only.
  const trigger = dashboard.match(
    /<Button[\s\S]*?aria-label=\{`Export \$\{document\.title\}`\}[\s\S]*?<\/Button>/u);
  assert.ok(trigger, "export trigger should exist");
  assert.match(trigger[0], /aria-haspopup="menu"/u);
  assert.match(trigger[0], /aria-expanded=\{openExportId === document\.id\}/u);
  assert.match(trigger[0], /onClick=\{\(\) => setOpenExportId/u);
  assert.match(trigger[0], /event\.key === "ArrowDown"/u);

  const container = dashboard.match(/<div\s+className=\{`export-dropdown[\s\S]*?event\.key === "Escape"/u);
  assert.ok(container, "the dropdown should close on Escape");
  assert.match(css, /\.export-dropdown\.open \.dropdown-menu/u,
    "the click/keyboard-opened menu must be visible, not just the hovered one");
});
