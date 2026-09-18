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

## Regression coverage

Tests should cover:

- Unicode and absolute character offsets.
- Insertions, deletions, incremental issue retention, long-document chunk mapping, partial chunk failures, and overlapping local/AI issues.
- Malformed provider JSON, unknown categories, invalid ranges, status errors, cancellation, and partial chunk failure.
- HTTPS validation and blocked custom headers.
- Rewrite protection for URLs, email addresses, dates, currencies, identifiers, filenames, quoted text, HTML, stale selections, alternatives, and empty output.
- Persistence hydration/migration without overwriting saved content.
- Extension manifest permissions, deterministic generated bundles, dynamic site/provider permission handling, field-classification positives/negatives, and the content-script/service-worker key boundary.

`npm run evaluate` runs the compact `evaluation/corpus.json` across correct, academic, professional, casual, and technical prose and reports true positives, false positives, missed issues, categories, rule IDs, and confidence. Use `npm run evaluate -- --strict` as a release gate when expanding the corpus.

For manual release verification, load the extension in Chrome/Edge, grant one test site, check a normal textarea, check a contenteditable editor, verify password/payment/OTP fields stay untouched, test exclusions, and revoke the optional permission.
