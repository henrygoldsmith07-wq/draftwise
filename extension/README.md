# Draftwise browser extension

The extension is a dependency-light Chrome/Edge Manifest V3 build. It provides local writing checks inside textareas, text inputs, and contenteditable fields, with optional BYOK AI.

## Build and install

From the repository root:

```bash
npm install
npm run extension:build
```

Then:

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this `extension/` folder.
4. Open the extension’s options page.
5. Grant access only to the sites where you want Draftwise to run.

The generated `shared-analysis.js` and `shared-provider.js` bundles are checked in so the folder can be loaded directly. They are generated artifacts: do not edit them manually. Rebuild them after changing `packages/grammar`, `packages/analysis`, or `packages/ai`; CI fails when the committed bundles are stale.

## Security boundary

- Local rules run in `content.js` through `shared-analysis.js`.
- The content script sends text, goals, style, and a request ID to the service worker only when AI is enabled.
- `background.js` reads the provider key from extension storage and calls the provider through `shared-provider.js`. The key is never sent back to the page.
- The manifest has no static content script and no permanent `<all_urls>` permission. `scripting` registers a content script only after the user grants a specific site origin.
- Website access and provider access are separate permissions. A site grant controls which fields Draftwise may inspect; a provider-origin grant controls where the service worker may send optional AI requests.
- Settings shows every granted site and lets the user disable Draftwise on that site, re-enable it, or revoke its browser permission. Provider access can be granted or revoked independently.
- Provider strings are inserted with `textContent`; the extension does not render provider output as HTML.

## Safety behavior

Draftwise skips passwords, hidden fields, payment details, one-time codes, explicit authentication/credential fields, disabled fields, read-only fields, excluded sites, and fields individually disabled by the user. Field metadata is tokenised, so ordinary fields such as `author`, `authority`, `search`, `title`, and an “authentication explanation” textarea remain usable. Requests are debounced, stale per-field requests are ignored, and accepted replacements verify that the original text still matches before editing.

AI requests send the current field’s changed/context text to the configured provider. The provider’s own retention and training policies apply. Do not use the extension for secrets or highly sensitive content.
