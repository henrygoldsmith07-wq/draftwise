# Draftwise

Draftwise is a private, local-first writing assistant for the web and the browser. It checks drafts locally as you type, explains suggestions, exposes transparent writing scores, and can optionally call an OpenAI-compatible provider with your own key.

## Product principles

- Local analysis is useful without an account, network, or API key.
- AI is opt-in and uses a single canonical toggle in the web app and extension.
- Drafts are persisted only in the browser’s local storage in this build.
- Provider output is treated as untrusted input: ranges, categories, replacements, URLs, numbers, and markup are validated before anything is shown or applied.
- Every rewrite is preview-first. Nothing changes the draft until the writer chooses Replace or Insert.

## What is included

- Web editor with highlighted ranges, accept/dismiss/dictionary actions, undo/redo, focus mode, writing goals, dark mode, keyboard shortcuts, and local persistence.
- Local checks for spelling, dialect, confused words, punctuation, capitalization, repetition, wordiness, clichés, filler words, vague language, terminology consistency, sentence structure, passive voice, and paragraph length.
- Transparent correctness, clarity, conciseness, readability, engagement, consistency, and goal-alignment scores with supporting signals.
- Incremental AI analysis: changed-range detection, context expansion, chunking for long drafts, request cancellation, bounded caching, response validation, and graceful local fallback.
- Preview-first rewrites with local fallback, protected URLs/numbers, and stale-selection checks.
- Dependency-light Manifest V3 extension. Local rules run in the page; optional AI runs in the service worker so the content script never receives the API key.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

The web editor works without environment variables. To enable AI, open Settings, enable AI, and configure an HTTPS OpenAI-compatible endpoint, model, and API key. Localhost HTTP endpoints are allowed for development only.

Useful checks:

```bash
npm run type-check
npm test
npm run test:extension
npm run lint
npm run build
npm run benchmark
```

`npm run build` also regenerates `extension/shared-analysis.js` and `extension/shared-provider.js` from the shared TypeScript packages.

## Install the extension

1. Run `npm run extension:build`.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode and choose **Load unpacked**.
4. Select the repository’s `extension/` folder.
5. Open Extension options, enable AI only if needed, and grant access only to sites where you want Draftwise to run.

The extension skips passwords, hidden fields, payment fields, one-time codes, authentication fields, disabled fields, read-only fields, and excluded sites. Its UI is isolated in a Shadow DOM and uses DOM text nodes rather than interpolated HTML.

## Repository map

```text
app/                  Web app shell, editor view, insights, settings, extension guide
components/draftwise/ Product UI components for the editor and review flows
hooks/                Persistence, bounded history, selection, analysis, and rewrites
packages/types/       Shared domain types, defaults, and workspace schema
packages/analysis/    Changed ranges, chunks, offset mapping, cache, issue merge
packages/grammar/     Pure local rules, stats, tone, and transparent scores
packages/ai/          Provider adapter, validation, chunk orchestration, rewrites
extension/            Loadable Manifest V3 browser extension and generated bundles
docs/                 Architecture, provider contract, privacy, threat model, testing
tests/                Node regression tests for rules, ranges, providers, persistence, and extension safety
```

Read [docs/architecture.md](docs/architecture.md), [docs/privacy-model.md](docs/privacy-model.md), and [docs/threat-model.md](docs/threat-model.md) before changing the provider or extension boundary.

## Privacy and limitations

Draftwise has no account or server-side draft store in this repository. Local checks never make a network call. If AI is enabled, the selected provider receives the text required for the current analysis or rewrite, plus the configured goals/style context. The provider’s own retention and training policies still apply.

This is a BYOK client, not a secret vault. Browser storage is accessible to extensions and profiles with access to the browser profile. Do not put passwords, tokens, or confidential material in a writing field. See the [privacy model](docs/privacy-model.md) and [threat model](docs/threat-model.md).

## Contributing

Run the full validation set before opening a pull request. New provider behavior must include malformed-response, range-safety, cancellation, and protected-token tests. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/testing.md](docs/testing.md).
