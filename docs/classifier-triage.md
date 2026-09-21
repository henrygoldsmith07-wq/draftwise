# Classifier triage (classifier.dev)

Draftwise runs local rules first. Only unresolved candidates are considered for semantic triage. A classifier response is a routing decision; it never rewrites text.

```text
edit
 └─ changed range → safe context → local rules
      ├─ locally sufficient → keep local; no cloud request
      └─ unresolved candidate → redacted excerpt → classifier.dev (optional)
           ├─ locally-sufficient → keep local
           ├─ ai-needed → configured provider for that chunk
           └─ uncertain → provider by default, or local when explicitly configured
```

## Contract

- Endpoint: `POST https://classifier.dev/v1/classify` by default. A configured base URL ending in `/v1` or `/classify` is also accepted. HTTPS is required except for localhost development.
- Authentication is optional. Draftwise sends `Authorization: Bearer <key>` only when an optional classifier workspace key is configured. No key is required for the default classifier.dev path.
- Request body follows classifier.dev’s contract: `{ inputs: string[], labels: string[], instructions?: string }`. Inputs are ordered excerpts, never Draftwise objects with chunk IDs, local signals, categories, goals, or provider settings.
- Draftwise sends the selected semantic-v2 labels:
  1. `The local writing checks are sufficient; no semantic AI review is needed.`
  2. `A semantic AI writing review would likely find useful issues the local checks cannot reliably detect.`
  3. `It is unclear whether semantic AI review would add enough value.`
- Response shape is `{ results: [{ label, confidence, scores }] }`. Results are paired to inputs strictly by response order. Draftwise maps the first label to `locally-sufficient`, the second to `ai-needed`, and the third or an unknown label to `uncertain`.
- Confidence thresholds are conservative: `ai-needed` requires at least `0.75`, `locally-sufficient` requires at least `0.80`; otherwise the result is `uncertain`.
- Excerpts are bounded and redact URLs, emails, phone numbers, currencies, percentages, dates, identifiers, filenames, model/version strings, UUIDs, API tokens, quoted secrets, and long numeric values. The full document is never sent to classifier.dev.
- `scores` are accepted as classifier metadata but are not trusted for edits. Any rewrite-like field is ignored.

## Fallback and observability

- With no classifier URL configured, unresolved candidates go directly to the provider. Clean chunks still stop locally.
- A classifier timeout, rate limit, invalid response, CORS/network failure, or omitted result is recorded as a classifier failure/omission and the affected candidate is marked `ai-needed`. Outages never silently downgrade semantic review to local-only.
- `uncertainPolicy` defaults to `"provider"`. `"local"` is available when a workspace explicitly accepts lower recall.
- The production path uses the hook/extension debounce and direct batches of up to classifier.dev’s 1,000-input limit. The removed scheduler is not part of the request path.
- Cache identities include document text/range plus an engine version, goals, style, provider URL/model/temperature/max tokens, safe custom-header fingerprint, classifier URL/config, and triage policy. Raw credentials are never cache keys.
- The shared metrics interface is:

```ts
interface TriageMetrics {
  candidateChunks: number;
  classifierRequests: number;
  classifiedChunks: number;
  locallySufficientChunks: number;
  aiNeededChunks: number;
  uncertainChunks: number;
  classifierFailures: number;
  omittedClassifierResults: number;
  providerRequests: number;
  providerChunks: number;
  avoidedProviderChunks: number;
}
```

## Privacy boundaries

Classifier.dev is a separate cloud path from the configured AI provider. When AI is enabled, the UI and docs must not imply that nothing leaves the device: local rules stay on-device, redacted candidate excerpts may leave for classifier triage, and selected chunks may leave for provider analysis.

In the extension, provider and classifier origins require separate permissions. Content scripts never receive credentials; the service worker owns the requests.

## Evaluation

- Corpus: `evaluation/triage-corpus.json`, with labelled expected decisions/categories and short excerpts.
- Offline: `npm run evaluate:triage:offline` uses deterministic fixtures and never calls the network. It reports accuracy, AI precision/recall, false-filter rate, uncertain rate, candidate-selection precision/recall, calls, avoided provider chunks, excerpt size, local/classifier latency, request bytes, redaction checks, and fallback metrics. It also compares the recorded semantic-v2 and direct-v1 label formulations.
- Live: `npm run evaluate:triage:live` uses the configured classifier URL (default `https://classifier.dev`) and an optional `CLASSIFIER_API_KEY`. Run it manually, not in normal tests. It reports p50/p95 latency and development-only request observability; provider latency/token estimates remain empty because the evaluator stops before making provider calls.
- The manual workflow `.github/workflows/triage-live.yml` records live evaluation output without placing credentials in the repository.
