# Draftwise architecture

Draftwise has one shared analysis model and two clients. The web app owns the writing workspace; the extension owns page integration. Both clients use the same local rules and provider contracts.

## Shared pipeline

```text
edit
  └─ changed range → safe sentence/paragraph context
       ├─ discard affected issues → local rules on the changed region → remap/merge
       ├─ recalculate document statistics and scores
       └─ changed range → context expansion → bounded chunks
                                   ├─ heuristic selects unresolved/ambiguous chunks
                                   ├─ classifier.dev (ordered redacted excerpts + labels, decision only)
                                   └─ expensive provider for ai-needed chunks or classifier failures
                                       └─ validate → map offsets → merge
```

`packages/types` is the contract. `packages/grammar` is pure and has no browser or network dependency. It builds a reusable `ParsedDocument`, uses a compact ranked local lexicon with edit-distance candidates, and exposes incremental local analysis. `packages/analysis` owns changed-range detection, safe chunk boundaries, offset mapping, bounded caching, unaffected-issue retention, and sorted overlap resolution. `packages/ai` adapts an OpenAI-compatible endpoint, gates expensive calls behind `classifier.dev` triage (see `docs/classifier-triage.md`), and never applies a rewrite directly. The classifier returns decisions only and never rewrites user text.

## Web flow

1. `useDraftPersistence` renders the stable initial workspace, hydrates from versioned storage, then writes only after hydration. This prevents an initial empty state from overwriting a saved draft.
2. `useAnalysis` retains the previous result, expands the edit to safe context boundaries, recalculates only that region locally, shifts unaffected issue offsets, and recomputes document-level stats/scores. Remote work is debounced (650ms, no classifier request on every keystroke), batched, cancellable, and cached in a bounded LRU. Local-first triage sends only redacted excerpts for unresolved chunks to `classifier.dev`; uncertain results default to the provider, and classifier failures become explicit provider-required fallbacks.
3. AI requests are full-document chunks on the first run and changed/context chunks after edits; each settled provider response remains paired with its originating chunk before relative ranges are mapped back to absolute offsets. Partial failures keep successful suggestions; all-failure cases remain explicit.
4. Provider responses are accepted only when the range is valid and the returned `original` exactly matches the submitted text. Unknown categories, invalid severities, malformed JSON, and unsafe rewrite output are discarded or surfaced as a local fallback.
5. Accepting a suggestion is a targeted replacement guarded by an exact original-text check. Rewrite actions capture the selection, show a preview, and refuse to apply if the draft changed underneath them.

## Extension flow

The Manifest V3 content script is intentionally small and dependency-free:

- `shared-analysis.js` exposes the compiled local rules.
- `content.js` finds editable fields, skips sensitive/disabled/read-only fields, debounces local checks, and renders a closed Shadow DOM assistant using DOM text nodes.
- AI messages contain text, goals, style, and a request ID only. The content script never receives provider or classifier settings or API keys.
- `background.js` is the service-worker boundary. It dynamically registers content scripts only for granted site patterns, reads provider and classifier keys from `chrome.storage.local`, requires separate provider-origin and classifier-origin permissions, runs local-first triage with bounded caching, aborts stale per-tab/per-frame requests, and returns only validated issues.
- `field-classification.js` tokenises metadata and blocks explicit credential/payment/OTP patterns without treating substrings such as `auth` inside `author` as sensitive.
- `options.html` and `options.js` manage opt-in AI, style preferences, exclusions, site grant/revoke/disable actions, independent provider-origin access, and local deletion.

The manifest uses `activeTab`/`scripting` plus optional HTTP(S) host permissions rather than permanent `<all_urls>` access. There is no static global content script. Users can grant access only to sites where they want the assistant, and provider origins are never inferred from a site grant.

## Persistence

The web app stores one versioned workspace at `draftwise:workspace:v2`. The hook also migrates the previous split keys (`draftwise:draft`, `draftwise:goals`, `draftwise:provider`, `draftwise:theme`, and `draftwise:ai-enabled`) without crashing on malformed values. A clear-data action removes both the versioned and legacy keys.

## Build boundary

The site build uses the repository’s framework runner. `scripts/build-extension.mjs` transpiles the pure shared packages with TypeScript and wraps them as browser globals, so the extension does not need runtime imports or a bundler. `npm run build` runs both steps and keeps the generated bundles in source control for “Load unpacked” users. CI regenerates them and fails if the checked-in output changes.
