# Draftwise

Draftwise is a private, local-first writing workspace with optional BYOK AI assistance. It is an original writing product, not a clone of any existing brand. The repository includes the Next.js web editor and a dependency-free Chrome / Edge Manifest V3 extension.

## What works now

- Large textarea editor with issue highlights that preserve cursor and selection behavior.
- Local spelling, punctuation, repetition, capitalization, filler-word, and passive-voice checks.
- Overall, grammar, clarity, conciseness, engagement, readability, and document statistics.
- Accept, dismiss, and accept-all suggestion actions.
- Selection rewrite toolbar with Improve, Fix grammar, Shorten, Confident, Formal, and custom instruction actions.
- Preview-first Replace, Insert, Copy, Retry, and Cancel flow for rewrites.
- Any OpenAI-compatible provider with custom base URL, model, key, temperature, max tokens, and optional JSON headers.
- Debounced analysis, changed-text caching, request cancellation, token estimates, chunk limits, and strict Zod response validation.
- Local persistence, dark mode, undo/redo controls, writing goals, privacy controls, and graceful offline behavior.
- Extension field detection, isolated floating UI, site exclusions, password-field protection, local checks, and optional changed-neighborhood AI checks.

## Run it

```bash
npm install
npm run dev
```

Open the local URL printed by the dev server. The editor works without any environment variables or API key. To use a model, open Settings, enable AI, and enter your own provider details. Keys are stored locally in the browser and are never committed.

Useful checks:

```bash
npm run type-check
npm test
npm run build
```

## Install the extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked**.
4. Select the repository’s `extension/` folder.
5. Open the extension options to configure optional AI, exclusions, and local storage settings.

The extension skips password, hidden, disabled, and read-only fields. Its interface is isolated in a closed Shadow DOM so it does not alter a host page’s styling.

## Repository map

```text
app/                  Next.js editor, insights, extension guide, settings dialog
packages/types/       Shared domain types and defaults
packages/grammar/     Pure local analysis and writing scores
packages/ai/          Provider abstraction, parsing, caching helpers, rewrites
extension/            Loadable Manifest V3 browser extension
docs/                 Architecture and provider contract
tests/                Node tests for local analysis and range safety
```

See [docs/architecture.md](docs/architecture.md) and [docs/provider-contract.md](docs/provider-contract.md) for the implementation boundaries.

## Privacy

Draftwise has no account requirement, no analytics by default, and no server-side draft store in this build. Local checks never leave the device. AI is opt-in; when enabled, the UI makes the provider boundary visible and sends only the changed or bounded text necessary for the current action. Never paste passwords or secrets into a writing field.
