# Draftwise architecture

Draftwise is intentionally local-first. The web app and extension share the same concepts — `WritingIssue`, `AnalysisResult`, `WritingGoals`, and `ProviderSettings` — while the extension stays dependency-free so it can be loaded unpacked without a bundler.

## Web flow

1. The editor stores the draft in React state and mirrors it to `localStorage`.
2. A 360 ms debounce runs `packages/grammar`, which checks spelling, punctuation, repetition, filler words, capitalization, passive voice, and document stats.
3. If AI is enabled and a key exists, the previous request is aborted, the current text is cache-keyed, and an OpenAI-compatible JSON request is sent. The provider response is parsed and validated with Zod before it can reach the editor.
4. Local and AI issues are merged by range. Invalid offsets, categories, severities, mismatched originals, and malformed JSON are discarded without changing the draft.
5. Accepting a suggestion writes a targeted range replacement. Rewrite actions show a preview before replacement or insertion.

## Extension flow

The Manifest V3 content script discovers editable fields with a `MutationObserver`, skips passwords, and uses a 520 ms debounce. Its UI is inside a closed Shadow DOM. Local rules run first; when opted in, only the changed neighborhood is sent to the configured provider and the previous request is aborted when the field changes.

## Privacy boundaries

- No account, analytics, or server-side draft storage is required.
- Keys live in browser `localStorage` or extension storage only.
- Local analysis never makes a network call.
- AI requests are opt-in and visible in the settings UI.
- Password fields are excluded in both surfaces.
- “Forget key” and per-site disable controls are available in the settings surfaces.
