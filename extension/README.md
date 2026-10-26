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

## Store packaging

```bash
npm run extension:package
```

This rebuilds the bundles, validates the manifest (version matches `package.json`, every referenced file ships, no `<all_urls>`), stages a clean directory at `dist/extension/`, and zips it as `dist/draftwise-extension-<version>.zip` when a zip tool exists (`zip`, or the bsdtar that ships with Windows/macOS). The zip is what a web-store upload takes; developer installs still use **Load unpacked** on this folder.

## What the writer sees

- A **toolbar badge** with the number of suggestions in the field they are in, cleared when the tab navigates. It carries a count and nothing else.
- A **popup** when they click the toolbar icon, listing the suggestions for the current field with their reasons, an Accept button for each, and a way to dismiss one. It used to open the options page in a new tab, which took the writer away from what they were writing.
- An **inline panel** in the page, over the field, with the same suggestions and keyboard navigation.

The badge and the inline button always agree: they are set from the same count. The popup asks the content script for what it is already showing rather than working it out for itself, and it never reads the field’s text.

## Security boundary

- Local rules run in `content.js` through `shared-analysis.js`.
- The content script sends text, goals, style, and a request ID to the service worker only when AI is enabled.
- `background.js` reads the provider key from extension storage and calls the provider through `shared-provider.js`. The key is never sent back to the page.
- The manifest has no static content script and no permanent `<all_urls>` permission. `scripting` registers a content script only after the user grants a specific site origin.
- The popup does not ask for the `tabs` permission. It reads the active tab's id and nothing else, and it cannot read the tab's address: the content script already knows which host it is running on, so it is the one that flips the per-site switch.
- Website access and provider access are separate permissions. A site grant controls which fields Draftwise may inspect; a provider-origin grant controls where the service worker may send optional AI requests.
- Settings shows every granted site and lets the user disable Draftwise on that site, re-enable it, or revoke its browser permission. Provider access can be granted or revoked independently.
- Provider strings are inserted with `textContent`; the extension does not render provider output as HTML.

## Safety behavior

Draftwise skips passwords, hidden fields, payment details, one-time codes, explicit authentication/credential fields, disabled fields, read-only fields, excluded sites, and fields individually disabled by the user. Field metadata is tokenised, so ordinary fields such as `author`, `authority`, `search`, `title`, and an “authentication explanation” textarea remain usable. Requests are debounced, stale per-field requests are ignored, and accepted replacements verify that the original text still matches before editing.

AI requests send the current field’s changed/context text to the configured provider. The provider’s own retention and training policies apply. Do not use the extension for secrets or highly sensitive content.
