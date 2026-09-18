# Provider contract

Draftwise supports providers with an OpenAI-compatible `POST /chat/completions` endpoint.

## Configuration

- `baseUrl`: HTTPS URL such as `https://api.openai.com/v1`. HTTP is accepted only for `localhost`, `127.0.0.1`, or `::1` development endpoints.
- `model`: provider model ID.
- `apiKey`: user-supplied key kept in browser storage. It is never logged or included in page-facing extension messages.
- `temperature`: clamped to `0..1`.
- `maxTokens`: clamped to `100..4000`.
- `customHeaders`: optional JSON object. Authorization, cookie, host, and content-length headers are rejected so users cannot accidentally override the security boundary.

## Analysis request

The client sends a system message followed by a user message containing goals, style context, and one bounded chunk. The prompt asks for JSON only:

```json
{
  "issues": [
    {
      "start": 0,
      "end": 4,
      "original": "teh ",
      "replacement": "the ",
      "category": "spelling",
      "severity": "high",
      "confidence": 0.99,
      "ruleId": "spelling-example",
      "title": "Check the spelling",
      "explanation": "Use the standard spelling."
    }
  ],
  "tone": ["direct"],
  "scores": { "overall": 88 }
}
```

Ranges are relative to the submitted chunk. `original` must exactly equal `chunk.text.slice(start, end)`. The client maps accepted ranges to the full document and merges them with local issues.

## Failure behavior

The adapter handles JSON wrapped in a fenced block, unsupported `response_format` errors, invalid URL schemes, auth/model/rate-limit statuses, timeouts, network failures, cancellation, and malformed fields. One failed chunk does not discard successful chunks; if every chunk fails, the web UI keeps local analysis and shows a provider error with a Settings link.

Rewrite responses must contain a non-empty `replacement` and optional `explanation`. HTML/markup is rejected, and every URL and numeric token from the original selection must survive. The caller receives a preview and must explicitly apply it.

The provider contract is deliberately advisory: provider output is untrusted and must not be rendered with `dangerouslySetInnerHTML` or applied without the exact-range guard.
