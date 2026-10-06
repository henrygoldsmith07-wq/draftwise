# Privacy model

Draftwise has three explicit data paths. “Local-first” does not mean “nothing leaves the device” when AI is enabled.

## Nothing is pre-configured

AI is off, and classifier triage ships with **no endpoint configured**. Turning on AI routes unresolved candidates to the provider the user entered, and nowhere else. Draftwise does not choose a destination for you: an earlier version shipped classifier.dev as the default, which meant adding your own provider key was enough to start sending draft excerpts to a third party you had never configured. That is now opt-in, and a regression test holds it there.

## Data paths

| Data | Local path | Configured classifier path | Configured provider path |
| --- | --- | --- | --- |
| Draft text | Held in browser state/storage and analysed locally | Only bounded, redacted candidate excerpts, and only when an endpoint is configured | Only chunks selected for provider review or rewrite |
| Local rules, scores, stats, and issue spans | On-device | Never sent | Only the selected prompt context is sent when needed |
| URLs, emails, phone numbers, currencies, percentages, dates, IDs, filenames, model/version strings, UUIDs, tokens, and quoted secrets | Available to local rules | Redacted before transmission | Preserved only when needed for provider validation and protected from accidental rewrites |
| Provider API key | Local storage only | Never sent to the classifier | HTTPS `Authorization` header to the configured provider |
| Optional classifier workspace key | Local storage only | HTTPS `Authorization` header to the configured classifier | Never sent to the provider |
| Goals and style preferences | Browser storage and runtime | Not sent in the classifier request | Included as provider prompt context when AI analysis is enabled |
| Site exclusions and granted origins | Browser/extension storage and permissions | Never sent | Never sent |

The web app has no account flow, analytics, telemetry, remote draft database, or default backend proxy. A configured provider or classifier can still log requests according to its own policy.

## User controls

- AI is disabled by default.
- One AI toggle controls provider analysis and classifier triage.
- `Forget keys` clears the provider key and optional classifier key, disables AI, cancels active requests, and clears the AI analysis cache.
- `Clear local data` removes the versioned workspace, migrated legacy keys, credentials, and local caches.
- The extension grants site, provider, and classifier origins separately.
- Extension revocation is live: disabling AI, changing cloud configuration, revoking permissions, excluding a site, or clearing extension data cancels in-flight cloud work and invalidates the extension AI cache.
- Web and extension analysis caches use bounded text fingerprints in cache identifiers rather than retaining raw draft text inside cache keys.
- Open pages observe site-access changes immediately; removed or excluded sites hide Draftwise in the current page, and stale dynamically registered content scripts are unregistered.
- Local checks remain available when AI is disabled or a provider is unavailable.

## Important limits

Browser storage is not a hardware-backed secret store. Other extensions, malware, a compromised browser profile, or a user with access to the profile may be able to read it. Do not use Draftwise as a vault for passwords, access tokens, payment data, or regulated records. Sensitive-field heuristics reduce exposure but cannot guarantee that pasted text contains no secrets.
