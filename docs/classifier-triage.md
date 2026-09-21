# Classifier triage (classifier.dev)

Draftwise reduces expensive model calls with a cheap triage gate. Local rules always
run first. Only unresolved or ambiguous chunks are sent to `classifier.dev`, and
only `ai-needed` chunks proceed to the expensive provider.

```text
edit
 └─ changed range → safe context → local rules (full local issues + scores)
      └─ heuristic selects unresolved/ambiguous chunks
           └─ classifier.dev (batched excerpts + signals only)
                ├─ ai-needed → expensive provider for those chunks only
                ├─ locally-sufficient → keep local, no cloud model call
                └─ uncertain / other / fallback → keep local, no model call (skip policy)
```

## Contract

- Endpoint: `POST {baseUrl}/classify` where `baseUrl` defaults to
  `https://classifier.dev/v1`. HTTPS is required except for localhost.
- Auth: `Authorization: Bearer <classifier key>` in the service worker only.
  Content scripts never receive provider or classifier keys.
- Request body: `{ model, inputs: [{ chunkId, excerpt, signals, categories }] }`.
  `excerpt` is truncated to ~500 chars with URLs, emails, and long numbers
  redacted to `[url]` / `[email]` / `[number]`. The full document is never sent.
- Response: `{ results: [{ chunkId, decision, categories, confidence, reason }] }`.
  - `decision` is one of `ai-needed`, `locally-sufficient`, `uncertain`.
    Unknown values fall back to `uncertain`.
  - `categories` use the triage taxonomy: `correctness`, `clarity`,
    `conciseness`, `engagement`, `tone`, `consistency`, `structure`,
    `word-choice`, `style`, `other`. Unknown categories map to `other`.
  - `confidence` is clamped to `0..1`.
  - Any `replacement`, `rewrite`, `correctedText`, or similar fields are
    discarded. **classifier.dev must never directly rewrite user text.**
    Decisions only gate provider calls; all edits stay preview-first.

## Gating rules

- Cloud AI (classifier + provider) runs only when the single `aiEnabled`
  toggle is on. If `aiEnabled` is off, no classifier request is made.
- Heuristic-only mode (no classifier key) still avoids provider calls for
  clean chunks: unresolved candidates proceed to AI, clean chunks do not.
  This preserves recall when the classifier is unconfigured.
- With a classifier key, candidates are batched (up to 5 per request) after a
  650ms debounce. Rapid typing cancels stale requests via `AbortController`.
- Incremental ranges are preserved: each decision carries its originating
  `chunkId`, and provider issues are mapped from chunk-relative to absolute
  offsets with exact-`original` checks before display.
- Caching is bounded: per-excerpt LRU (64 entries) plus per-analysis LRU (24
  entries). Cache keys include excerpt hash + model + categories, never keys.
- Failure policy (`uncertainPolicy: "skip"` by default): classifier timeouts,
  network errors, invalid JSON, omitted chunks, or `uncertain` decisions keep
  local results and skip the expensive model. Metrics record `fallbackCount`.
  Use `"allow"` only for high-recall mode where `uncertain` also calls the
  provider.

## Privacy and safety

- Extension content scripts send `text`, `changedRange`, `goals`, `style`,
  and `requestId` only. Keys stay in `chrome.storage.local` and are read only
  in `background.js` (service worker).
- Provider-origin and classifier-origin permissions are granted separately
  from site access and never inferred from a site grant.
- Sensitive fields (passwords, payment fields, OTP, credentials, hidden,
  disabled, read-only) are skipped before any analysis; see
  `extension/field-classification.js`. Triage does not weaken those checks.
- Provider output remains untrusted: ranges, categories, replacements, URLs,
  numbers, and markup are validated before display. Accepting a suggestion is
  a targeted replacement guarded by an exact-text check; rewrites are
  preview-first.

## Evaluation

- Labelled dataset: `evaluation/triage-corpus.json` with
  `expectedDecision` (`ai-needed` / `locally-sufficient` / `uncertain`) and
  `expectedCategories` from the taxonomy above.
- Run `npm run evaluate:triage` to measure model calls avoided, issue recall,
  false filtering, latency, excerpt minimisation, and cloud calls per session
  (classifier + provider, batched 5 per request, 5 chunks per session).
- Use `npm run evaluate:triage -- --strict` as a release gate
  (recall ≥ 0.75, false filtering ≤ 0.25, avoided ≥ 0.25).
