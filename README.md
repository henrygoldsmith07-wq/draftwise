# Draftwise

Draftwise is a private, local-first writing assistant for the web and the browser. It checks drafts locally as you type, explains suggestions, exposes transparent writing scores, and can optionally call an OpenAI-compatible provider with your own key.

## Product principles

- Local analysis is useful without an account, network, or API key.
- AI is opt-in and uses a single canonical toggle in the web app and extension.
- Drafts are persisted only in the browser, in IndexedDB; settings and the learned profile stay in local storage. Nothing is sent anywhere unless AI is enabled and the writer asks for it.
- Provider output is treated as untrusted input: ranges, categories, replacements, URLs, numbers, and markup are validated before anything is shown or applied.
- Every rewrite is preview-first. Nothing changes the draft until the writer chooses Replace or Insert.

## What is included

- Web editor with highlighted ranges, accept/dismiss/dictionary actions, undo/redo, focus mode, per-document writing goals with a live length-goal progress meter, a document library whose search covers the whole draft (not just the opening excerpt, and it highlights the matched passage), dark mode, keyboard shortcuts, debounced local persistence, immediate Ctrl/Cmd+S saves, and page-exit flushing.
- A real installable PWA. The service worker caches the app shell, so the deployed site opens and keeps checking a draft with the network switched off — which is the one thing the cloud competitors in this category cannot offer, because their analysis lives on their servers. The writer is told when they are offline and what still works, and Settings offers the install and reports whether the app is genuinely ready to open with no network.
- Version history with a word-level comparison: opening a checkpoint shows what changed between it and the current draft, with added and removed passages marked, a plain summary ("2 changes · +12 words · −6 words"), and side-by-side still one click away. Very long drafts fall back to a paragraph comparison and say so.
- Read aloud through the browser's own speech engine, with the passage being spoken marked in the editor and a voice chosen to match the draft's British or American dialect. It never touches the network or the configured provider, and the control disables itself when the browser has no voices installed, with an explanation. Editing the draft stops the reading rather than leaving the highlight behind.
- Local checks for ranked spelling candidates (British/US English, dictionaries, names, acronyms, contractions, hyphenated and technical terms), dialect, confused words, punctuation, capitalization, repetition, wordiness, clichés, filler words, vague language, terminology consistency, sentence structure, passive voice, and paragraph length.
- Register awareness: a draft written entirely in lower case (a chat message, a quick note) is treated as a deliberate voice rather than as a page of capitalisation errors, and sentence-case advice returns the moment any capital letter appears. The same signal silences terminal-punctuation advice on those messages. A short all-lower-case fragment is still reported, because there is not enough text to establish a register.
- Transparent correctness, clarity, conciseness, readability, engagement, consistency, and goal-alignment scores with supporting signals.
- Incremental local and AI analysis: safe context boundaries, unaffected-issue retention/remapping, chunking for long drafts, request cancellation, bounded caching, response validation, and graceful local fallback.
- Preview-first rewrites with local fallback, protected URLs, emails, dates, currencies, identifiers, filenames, quoted text, and stale-selection checks. AI alternatives remain previews until chosen.
- Full backup and restore: every document with its goals and history, settings, and writing activity as one versioned JSON file from Settings. A backup includes API keys so a restore brings back a working app — keep the file private. Once the library holds real work, a dismissible reminder nudges writers with no recent backup to export one.
- Dependency-light Manifest V3 extension. Dynamic content-script registration runs only on explicitly granted sites; provider-origin access is separately granted to the service worker, and the content script never receives the API key.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

The web editor works without environment variables. To enable AI, open Settings, enable AI, and configure an HTTPS OpenAI-compatible endpoint, model, and API key. Localhost HTTP endpoints are allowed for development only. Use Test connection to verify the URL and key against the provider's model list before depending on it — the check sends the key in the header and no draft text.

Useful checks:

```bash
npm run type-check
npm test
npm run test:extension
npm run lint
npm run extension:build
git diff --exit-code -- extension/shared-analysis.js extension/shared-provider.js
npm run build
npm run build:vercel
npm run test:e2e:production
npm run benchmark
npm run evaluate
```

`npm run build` also regenerates `extension/shared-analysis.js` and `extension/shared-provider.js` from the shared TypeScript packages.

## Deploy to Vercel

The app is a standard Next.js app, so it deploys to Vercel as one:

```bash
npx vercel          # preview
npx vercel --prod   # production
```

`vercel.json` sets `framework: nextjs` and points the build at `npm run build:vercel`, which regenerates the extension bundles and then runs `next build`. There is nothing else to configure: no environment variables, no database, no server code. Analysis runs in the browser and drafts are stored locally, so the deployment serves the interface and nothing else.

Analysis runs in the browser and drafts are stored locally, so the server only serves the interface. The Cloudflare Workers build (`npm run build` via vinext) is unaffected and remains the default for `npm start` local preview.

To check a deployment before trusting it, run the browser suite against the same production build a deployment serves:

```bash
npm run test:e2e:production
```

`npm run test:e2e` runs the same browser suite against the vinext dev server. The production config exists because passing against the dev server does not tell you the deployed artifact works; this one does.

## Install the extension

1. Run `npm run extension:build`.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode and choose **Load unpacked**.
4. Select the repository’s `extension/` folder.
5. Open Extension options, enable AI only if needed, and grant access only to sites where you want Draftwise to run.

The extension skips passwords, hidden fields, payment fields, one-time codes, explicit credential fields, disabled fields, read-only fields, and excluded sites. Its UI is isolated in a Shadow DOM and uses DOM text nodes rather than interpolated HTML. Settings separates site grants from provider-origin grants and supports disable/re-enable/revoke actions.

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
evaluation/           Small rule-quality corpus and precision/recall report
```

Read [docs/architecture.md](docs/architecture.md), [docs/privacy-model.md](docs/privacy-model.md), and [docs/threat-model.md](docs/threat-model.md) before changing the provider or extension boundary.

## Repository hygiene

A number of files in `lib/` (for example `export-multi-format.ts`, `plugin-system.ts`, `realtime-sync.ts`, `emotion-analysis.ts`, `handwriting-recognition.ts`, `word-cloud.ts`) are currently unreferenced: no component, hook, script, or test imports them. They are kept out of the browser bundle by tree-shaking, but `tsc --noEmit` still type-checks them. When touching them, do not assume their exports are wired into the UI — check for importers first (`grep -r "<module-name>" --include=*.ts --include=*.tsx app components hooks lib tests`).

## Privacy and limitations

Draftwise has no account or server-side draft store in this repository. Local checks never make a network call. If AI is enabled, the selected provider receives the text required for the current analysis or rewrite, plus the configured goals/style context. The provider’s own retention and training policies still apply.

This is a BYOK client, not a secret vault. Browser storage is accessible to extensions and profiles with access to the browser profile. Do not put passwords, tokens, or confidential material in a writing field. See the [privacy model](docs/privacy-model.md) and [threat model](docs/threat-model.md).

## Contributing

Run the full validation set before opening a pull request. New provider behavior must include malformed-response, range-safety, cancellation, and protected-token tests. See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/testing.md](docs/testing.md).
