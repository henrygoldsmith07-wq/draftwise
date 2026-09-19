# Analysis observability

Draftwise issues already carry explainable metadata: `ruleId`, confidence, source (`local` or `ai`), and a plain-language explanation.

During development, `AnalysisResult.diagnostics` also reports `processingMs`, `issueCount`, and the engine (`local`, `incremental`, or `provider`). Production builds omit this optional timing payload. To enable it explicitly in a browser-like debug session, set:

```js
globalThis.DraftwiseDebug = true;
```

The diagnostics are intended for rule tuning, evaluation, and performance investigation. They are not rendered as user-facing copy by the product UI.
