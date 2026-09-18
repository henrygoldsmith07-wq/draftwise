# Draftwise architecture

Draftwise has one shared analysis model and two clients. The web app owns the writing workspace; the extension owns page integration. Both clients use the same local rules and provider contracts.

## Shared pipeline

```text
draft
  └─ local analysis (always, synchronous after debounce)
       ├─ issues + stats + tone + transparent scores
       └─ changed range → context expansion → bounded chunks
                                  └─ optional provider requests
                                       └─ validate → map offsets → merge
```

`packages/types` is the contract. `packages/grammar` is pure and has no browser or network dependency. `packages/analysis` owns changed-range detection, chunk boundaries, offset mapping, bounded caching, and overlap resolution. `packages/ai` adapts an OpenAI-compatible endpoint and never applies a rewrite directly.

## Web flow

1. `useDraftPersistence` renders the stable initial workspace, hydrates from versioned storage, then writes only after hydration. This prevents an initial empty state from overwriting a saved draft.
2. `useAnalysis` runs the local pipeline immediately, debounces remote work, cancels stale requests, and keeps a bounded LRU cache keyed by text, settings, goals, style, and changed range.
3. Local issues are full-document and therefore keep highlights visible in long drafts. AI requests are full-document chunks on the first run and changed/context chunks after edits; the client maps chunk-relative ranges back to absolute offsets.
4. Provider responses are accepted only when the range is valid and the returned `original` exactly matches the submitted text. Unknown categories, invalid severities, malformed JSON, and unsafe rewrite output are discarded or surfaced as a local fallback.
5. Accepting a suggestion is a targeted replacement guarded by an exact original-text check. Rewrite actions capture the selection, show a preview, and refuse to apply if the draft changed underneath them.

## Extension flow

The Manifest V3 content script is intentionally small and dependency-free:

- `shared-analysis.js` exposes the compiled local rules.
- `content.js` finds editable fields, skips sensitive/disabled/read-only fields, debounces local checks, and renders a closed Shadow DOM assistant using DOM text nodes.
- AI messages contain text, goals, style, and a request ID only. The content script never receives provider settings or an API key.
- `background.js` is the service-worker boundary. It reads the key from `chrome.storage.local`, validates provider requests through the shared AI bundle, aborts stale per-tab/per-frame requests, and returns only validated issues.
- `options.html` and `options.js` manage opt-in AI, style preferences, exclusions, optional site permissions, and local deletion.

The manifest uses `activeTab` plus optional HTTP(S) host permissions rather than permanent `<all_urls>` access. Users can grant access only to sites where they want the assistant.

## Persistence

The web app stores one versioned workspace at `draftwise:workspace:v2`. The hook also migrates the previous split keys (`draftwise:draft`, `draftwise:goals`, `draftwise:provider`, `draftwise:theme`, and `draftwise:ai-enabled`) without crashing on malformed values. A clear-data action removes both the versioned and legacy keys.

## Build boundary

The site build uses the repository’s framework runner. `scripts/build-extension.mjs` transpiles the pure shared packages with TypeScript and wraps them as browser globals, so the extension does not need runtime imports or a bundler. `npm run build` runs both steps and keeps the generated bundles in source control for “Load unpacked” users.
