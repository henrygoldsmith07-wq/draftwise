# Threat model

## Assets

- Draft content and selected rewrite text.
- User-supplied provider API keys.
- Writing goals, style preferences, and site exclusions.
- Integrity of issue ranges and rewrite previews.

## Trust boundaries

1. Web page ↔ Draftwise UI: React state and DOM event boundaries.
2. Extension content script ↔ host page: page-facing code runs in an untrusted document.
3. Extension content script ↔ service worker: runtime messages contain text but must not contain provider secrets.
4. Draftwise client ↔ user-configured provider: provider output is untrusted and provider retention is outside Draftwise’s control.
5. Browser storage ↔ local user profile: storage is convenient, not a secure enclave.

## Main threats and mitigations

| Threat | Mitigation |
| --- | --- |
| API key leaks to a page | Extension keys stay in the service worker; content messages omit provider settings and keys. |
| Accidental broad site access | No static global content script or permanent `<all_urls>` permission; dynamic HTTP(S) site access is optional and user-granted. |
| Provider endpoint contacted without consent | Provider origins are derived from the configured endpoint and require a separate optional permission grant. |
| Provider XSS or markup injection | Provider text is rendered as React text/DOM `textContent`; rewrite HTML is rejected. |
| Corrupted or malicious offsets | `original` must exactly match the submitted range; offsets are mapped and overlap-merged before display. |
| Stale rewrite overwrites new text | Apply requires the captured selection to still equal the original. |
| Long-document truncation | Local analysis covers the full text; remote analysis uses bounded chunks and absolute offset mapping. |
| Sensitive-field leakage | Extension tokenises field metadata, blocks explicit password/payment/OTP/credential patterns, skips hidden/disabled/read-only fields, and lets users exclude or disable sites. |
| Local storage overwrite on hydration | Persistence writes only after the versioned workspace has loaded. |
| Provider URL interception | HTTPS is required except for explicit localhost development hosts. |

## Residual risk

The client cannot control what a third-party provider retains, whether a browser profile is compromised, or whether a site uses a custom editor that defeats field heuristics. Treat AI as an external processor and review suggestions before applying them.
