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
2. `useAnalysis` keeps local and AI issue histories separate, expands the edit to safe context boundaries, recalculates only that region locally, shifts unaffected local issue offsets, and recomputes document-level stats/scores. Remote work is debounced (650ms, no classifier request on every keystroke), batched, cancellable, and cached in a bounded LRU. Local-first triage sends only redacted excerpts for unresolved chunks to `classifier.dev`; uncertain results default to the provider, and classifier failures become explicit provider-required fallbacks.
3. AI requests are full-document chunks on the first run and changed/context chunks after edits; provider work uses a bounded concurrency pool and per-analysis chunk/character limits, with requested, successful, failed, and skipped coverage reported. Each settled provider response remains paired with its originating chunk before relative ranges are mapped back to absolute offsets. Partial failures keep successful suggestions; all-failure cases remain explicit.
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

A backup (`lib/backup.ts`) serialises every document plus the workspace and activity log as one versioned file. Restore validates the whole file, then offers two paths: replace swaps the library through `DocumentLifecycle.replaceAll`, swaps the workspace and activity, flushes every surface, and reloads so no in-memory store lingers with pre-restore values; merge adds the backup's documents alongside the current ones through `DocumentLifecycle.mergeAll`, touches nothing else, and needs no reload. Merge dedupes transparently — identical title and text is skipped, a shared id with different content is kept as a titled copy under a fresh id — and reports added/skipped/renamed counts.

The web app stores one versioned workspace at `draftwise:workspace:v2`. Writing goals live on each document (`StoredDocument.goals`) — including required/forbidden terminology, edited in the goal bar (`lib/terminology.ts` parsing rule) — as does the spelling dialect (`StoredDocument.dialect`); the workspace copies are the sticky defaults new documents inherit and the fallbacks for older documents. The learned profile (dictionary, dismissal history) stays global — it describes the writer, not the draft. The hook also migrates the previous split keys (`draftwise:draft`, `draftwise:goals`, `draftwise:provider`, `draftwise:theme`, and `draftwise:ai-enabled`) without crashing on malformed values. A clear-data action removes both the versioned and legacy keys.

## Build boundary

The site build uses the repository’s framework runner. `scripts/build-extension.mjs` transpiles the pure shared packages with TypeScript and wraps them as browser globals, so the extension does not need runtime imports or a bundler. `npm run build` runs both steps and keeps the generated bundles in source control for “Load unpacked” users. CI regenerates them and fails if the checked-in output changes.

## Deployment

Two builds, two targets. `npm run build` produces the Cloudflare Workers artifact; `npm run build:vercel` produces the Next.js production build that Vercel serves. The browser suite runs against both: the `e2e` job uses the dev server, and the `e2e-production` job builds and serves the production artifact. The second one exists because a Content-Security-Policy, the service worker and the Open Graph routes are production-only behaviour that a dev-server run cannot exercise.

The service worker (`public/sw.js`) caches the app shell so the deployed app opens and keeps checking a draft with the network switched off. It only ever handles its own origin and only `GET` requests: provider and classifier calls are never intercepted, never cached and never replayed.

**The Vercel project currently has Deployment Protection enabled**, so both the production alias and the preview deployments answer `401 Protected deployment` to anyone who is not signed in to Vercel. Verified against `draftwise-henry-107b.vercel.app` on 2026-10-21.

That matters more than it looks, because it is the opposite of this product’s promise. Draftwise is sold on “no account, no server, no sign-up” — a visitor currently needs a Vercel account to open the page at all. It also makes the rest of the deployment work unreachable: `/robots.txt`, `/sitemap.xml` and the Open Graph image are all behind the same gate, so no crawler or social card can see them, and the installable PWA can be neither installed nor used by anyone else. Turning off Deployment Protection (Vercel → Settings → Deployment Protection) is what makes the public surface real; until then, the metadata, the manifest and the service worker describe an app nobody outside the team can reach.

