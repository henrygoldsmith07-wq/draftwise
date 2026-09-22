# Analysis observability

Draftwise issues already carry explainable metadata: `ruleId`, confidence, source (`local` or `ai`), and a plain-language explanation.

During development, `AnalysisResult.diagnostics` also reports `processingMs`, `issueCount`, and the engine (`local`, `incremental`, or `provider`). Production builds omit this optional timing payload. To enable it explicitly in a browser-like debug session, set:

```js
globalThis.DraftwiseDebug = true;
```

The diagnostics are intended for rule tuning, evaluation, and performance investigation. They are not rendered as user-facing copy by the product UI.

The language evaluator reports corpus size, precision, recall, false positives per 1,000 words, per-category and per-rule metrics, and a one-finding-per-1,000-word false-positive budget. Triage evaluators separately report candidate selection, per-trigger metrics, classifier request/latency/bytes, excerpt size, provider chunks avoided, provider coverage, and explicit classifier failure/omission counts. The live evaluator compares multiple two-label formulations across an AI-needed/local-sufficiency confidence grid and can benchmark classifier batches of 5, 10, 25, 50, and 100 inputs.
