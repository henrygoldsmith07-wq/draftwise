# Testing guide

## Required checks

```bash
npm run type-check
npm test
npm run test:extension
npm run lint
npm run extension:build
git diff --exit-code -- extension/shared-analysis.js extension/shared-provider.js
npm run build
npm run evaluate
```

`npm run benchmark` measures local analysis on representative document sizes and is useful when changing tokenization or rule loops.

## Browser suite

`npm run test:e2e` runs `e2e/*.spec.mjs` against the vinext dev server; `npm run test:e2e:production` rebuilds and runs the same suite against the production build a deployment serves. Every spec starts from `freshStart(page)` in `e2e/helpers.mjs` — do not clear storage inline. Clearing while the app is loaded lets the editor's pagehide flush resurrect exactly what was cleared on the next load, and open IndexedDB connections block the delete; the helper unloads via `/_not-found` first and awaits the delete so the fresh boot cannot race it.

## Regression coverage

Tests should cover:

- Unicode and absolute character offsets.
- Insertions, deletions, incremental issue retention, long-document chunk mapping, partial chunk failures, and overlapping local/AI issues.
- Malformed provider JSON, unknown categories, invalid ranges, status errors, cancellation, and partial chunk failure.
- HTTPS validation and blocked custom headers.
- Rewrite protection for URLs, email addresses, dates, currencies, identifiers, filenames, quoted text, HTML, stale selections, alternatives, and empty output.
- Persistence hydration/migration without overwriting saved content.
- Extension manifest permissions, deterministic generated bundles, dynamic site/provider permission handling, field-classification positives/negatives, and the content-script/service-worker key boundary.
- Version comparison: word-diff parts that rebuild both inputs, punctuation and whitespace handling, separate edits counted separately, the paragraph fallback for long drafts, and — in `e2e/document-lifecycle.spec.mjs` — the diff summary and marked passages in the real preview dialog.
- Library search: matching a phrase in the middle of a draft, the matched-passage excerpt, case-insensitive and whitespace-only queries, and the browser journey that finds a mid-draft phrase and highlights it.
- Read aloud: segment offsets against the draft, markdown and code handling, the long-sentence cap that stops Chrome truncating an utterance, dialect voice selection, and — in `e2e/read-aloud.spec.mjs` — a stubbed speech engine proving the queued text, the highlight, pause/resume/stop, the stop-on-edit rule, and the disabled state when the browser has no voices.

`npm run evaluate` runs the compact `evaluation/corpus.json` across correct, academic, professional, casual, and technical prose and reports true positives, false positives, missed issues, categories, rule IDs, and confidence. Use `npm run evaluate -- --strict` as a release gate when expanding the corpus.

`npm run evaluate:blind` reports against `evaluation/blind-corpus.json`, which is held out from tuning on purpose. Read it to find out whether a rule change generalises; do not calibrate thresholds against it, or the only independent measurement of false positives is lost. The corpus that thresholds and word lists *are* calibrated against is `evaluation/corpus.json` plus `evaluation/clean-prose.json`, and a rule change should add cases to one of those two.

Rules that read the writer's register (deliberate lower case, casual voice, narrative intent) need cases on both sides: the draft where the rule should stay quiet, and the one where the same signal must not silence a real error. `tests/false-positive-regressions.test.mjs` holds both halves for each such rule.

For manual release verification, load the extension in Chrome/Edge, grant one test site, check a normal textarea, check a contenteditable editor, verify password/payment/OTP fields stay untouched, test exclusions, and revoke the optional permission.
