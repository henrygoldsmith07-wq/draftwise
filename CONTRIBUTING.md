# Contributing to Draftwise

Keep the local-first and privacy boundaries intact. Prefer pure functions in `packages/grammar` and `packages/analysis`; keep browser APIs in hooks or client adapters.

Before opening a pull request:

```bash
npm run type-check
npm test
npm run test:extension
npm run lint
npm run build
```

Changes to the shared packages must regenerate the extension bundles with `npm run extension:build`. New provider behavior needs tests for malformed output, exact ranges, cancellation, and protected URLs/numbers. Do not add analytics, server-side draft persistence, permanent broad host permissions, or logging that could include draft text or API keys without an explicit privacy review.
