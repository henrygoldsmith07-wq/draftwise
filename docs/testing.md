# Testing guide

## Required checks

```bash
npm run type-check
npm test
npm run test:extension
npm run lint
npm run build
```

`npm run benchmark` measures local analysis on representative document sizes and is useful when changing tokenization or rule loops.

## Regression coverage

Tests should cover:

- Unicode and absolute character offsets.
- Insertions, deletions, long-document chunk mapping, and overlapping local/AI issues.
- Malformed provider JSON, unknown categories, invalid ranges, status errors, cancellation, and partial chunk failure.
- HTTPS validation and blocked custom headers.
- Rewrite protection for URLs, numbers, HTML, stale selections, and empty output.
- Persistence hydration/migration without overwriting saved content.
- Extension manifest permissions, generated bundle syntax, and the content-script/service-worker key boundary.

For manual release verification, load the extension in Chrome/Edge, grant one test site, check a normal textarea, check a contenteditable editor, verify password/payment/OTP fields stay untouched, test exclusions, and revoke the optional permission.
