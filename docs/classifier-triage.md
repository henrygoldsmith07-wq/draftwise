# Classifier triage (classifier.dev)

Draftwise runs local rules first. Only unresolved candidates are considered for semantic triage. The classifier returns a routing decision and never rewrites text.

edit
 └─ changed range → safe context → local rules
      ├─ locally sufficient → keep local; no cloud request
      └─ unresolved candidate → redacted excerpt → classifier.dev
           ├─ local label + high confidence → keep local
           ├─ AI label + high confidence → configured provider for that chunk
           └─ low confidence, unknown label, omission, or outage → internal uncertain state

## Contract

- Endpoint: POST https://classifier.dev/v1/classify by default. A configured base URL ending in /v1 or /classify is also accepted. HTTPS is required except for localhost development.
- Authentication is optional. Draftwise sends an Authorization bearer header only when an optional classifier workspace key is configured.
- Request body follows the classifier.dev contract: { inputs: string[], labels: string[], instructions?: string }. Inputs are ordered redacted excerpts, never Draftwise objects with chunk IDs, local signals, categories, goals, or provider settings.
- The selected semantic-v2 labels are:
  1. The local writing checks are sufficient; no semantic AI review is needed.
  2. A semantic AI writing review would likely find useful issues the local checks cannot reliably detect.
- classifier.dev returns results in input order: { results: [{ label, confidence, scores }] }. Draftwise accepts only label and finite confidence. The exact label is retained for evaluation; scores and rewrite-like fields are ignored.
- Confidence is the uncertainty mechanism. The configurable defaults are AI threshold 0.75 and local threshold 0.80. Unknown labels and malformed confidence are uncertain. Uncertain is an internal Draftwise state, never a classifier label.

## Fallback, load, and observability

- With no classifier URL configured, unresolved candidates go directly to the provider. Clean chunks still stop locally.
- A classifier timeout, retryable outage, invalid response, or omitted result is recorded and the affected candidate is marked AI-needed. Outages never silently downgrade semantic review to local-only.
- Uncertain results default to the provider. A workspace may choose local when it explicitly accepts lower recall.
- Classifier requests use batches of up to 100 inputs. The live evaluator can benchmark 5, 10, 25, 50, and 100.
- Provider calls use a three-worker pool by default. Each analysis is limited to 10 AI chunks and 50,000 AI characters. Changed/current context is prioritised; skipped chunks are reported.
- Classifier and provider requests retry only bounded transient failures (up to two retries), honour Retry-After, use exponential backoff, and stop immediately on AbortSignal cancellation. Invalid configuration, authentication, endpoint, schema, and model errors are not retried.

The shared metrics interface is:

```ts
interface TriageMetrics {
  candidateChunks: number;
  classifierRequests: number;
  classifierHttpRequests: number;
  classifiedChunks: number;
  locallySufficientChunks: number;
  aiNeededChunks: number;
  uncertainChunks: number;
  classifierFailures: number;
  omittedClassifierResults: number;
  providerRequests: number;
  providerHttpRequests: number;
  providerChunks: number;
  avoidedProviderChunks: number;
  confidentLocalRate: number;
  confidentAiRate: number;
  uncertainRate: number;
  fallbackRate: number;
  actualProviderAvoidanceRate: number;
  classifierRetries: number;
  classifierRetryDelayMs: number;
}
```

Provider results also expose:

```ts
aiCoverage: {
  requestedChunks: number;
  attemptedChunks: number;
  successfulChunks: number;
  failedChunks: number;
  skippedChunks: number;
}
```

Coverage invariants are `requestedChunks = attemptedChunks + skippedChunks` and `attemptedChunks = successfulChunks + failedChunks`. Partial AI coverage is not presented as complete review: the web app and extension show local-only, complete, partial, limited, or unavailable states.

## Privacy boundaries

Classifier.dev is a separate cloud path from the configured AI provider. When AI is enabled, local rules stay on-device, redacted candidate excerpts may leave for classifier triage, and selected chunks may leave for provider analysis. The UI and documentation do not claim that nothing leaves the device.

Excerpts redact URLs, emails, phone numbers, currencies, percentages, dates, identifiers, filenames, model/version strings, UUIDs, API tokens, quoted secrets, and long numeric values. The full document is never sent to classifier.dev.

In the extension, provider and classifier origins require separate permissions. Content scripts never receive credentials; the service worker owns requests and clears active AI work and caches when requested.

## Evaluation

- Corpus: evaluation/triage-corpus.json, including scientific, technical, academic, formal, legal-style, narrative, and marketing cases. Goal metadata is used only by local candidate selection.
- Offline: npm run evaluate:triage:offline -- --strict uses deterministic fixtures and never calls the network. It reports accuracy, AI precision/recall, false-filter rate, uncertain rate, candidate-selection precision/recall, per-trigger useful/unnecessary/missed metrics, calls, avoided provider chunks, excerpt size, latency, request bytes, redaction checks, and outage fallback.
- Benchmark: npm run benchmark:triage -- --strict compares local-to-provider for every chunk with local-to-classifier-to-provider routing. It reports logical provider chunks, classifier overhead, estimated provider input-token savings, latency, and quality. Provider execution is count-only; it does not send provider requests.
- Live: npm run evaluate:triage:live -- --strict calls the configured classifier.dev endpoint for every entry and formulation, then evaluates the 5 × 5 confidence-threshold grid without pretending the offline positional fixture is evidence. It ranks provider-routing false-filter rate and review recall first, then exact semantic decision safety, provider-call avoidance, and accuracy; uncertain decisions count as provider review when the default policy is provider. A strict run fails if the full corpus has classifier failures or omitted results.
- Add --benchmark-batching to the live command to measure classifier batch sizes 5, 10, 25, 50, and 100 for latency, request count, failure, and omitted-result behaviour.
- Rule evaluation: npm run evaluate -- --strict prefers exact expected spans and original text when present, while preserving rule/category matching for older cases. It includes evaluation/clean-prose.json, a 150-example multi-style subset, and a false-positive budget per 1,000 words.
- Live evaluation stays out of normal PR CI. It is available through .github/workflows/triage-live.yml and the manual .github/workflows/release-validation.yml. The selected formulation and threshold rationale are recorded in evaluation/triage-label-formulations.json; the live evaluator reports recommendations but never edits production thresholds automatically.
