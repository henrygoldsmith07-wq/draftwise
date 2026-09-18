# Privacy model

## Data paths

| Data | Local-only path | Sent to provider |
| --- | --- | --- |
| Draft text | React state and versioned browser storage | Only when AI is enabled, for the current analysis/rewrite |
| Local rules, scores, stats | Browser runtime | Never |
| API key | Web `localStorage` or extension `chrome.storage.local` | Only as an HTTPS Authorization header to the configured endpoint |
| Goals/style | Browser storage and runtime | Included as prompt context when AI is enabled |
| Site exclusions | Browser storage | Never |

The repository has no account flow, analytics, telemetry, remote draft database, or default backend proxy. The configured provider can still log requests according to its own policy.

## User controls

- AI is disabled by default.
- The web app has one `aiEnabled` toggle and exposes the provider boundary in Settings.
- The extension uses optional site permissions and a local exclusion list.
- “Forget key” removes the configured key and disables AI.
- “Clear local data” removes the versioned workspace and migrated legacy keys.
- Local checks remain available when the provider is offline, rate-limited, invalid, or disabled.

## Important limits

Browser storage is not a hardware-backed secret store. Other extensions, malware, a compromised browser profile, or a user with access to the profile may be able to read it. Do not use Draftwise as a vault for passwords, access tokens, payment data, or regulated records. The extension applies sensitive-field heuristics, but users should still avoid pasting secrets.
