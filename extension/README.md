# Draftwise browser extension

This is a dependency-free Chrome / Edge Manifest V3 extension. It detects `textarea`, text inputs, and `contenteditable` fields, skips password fields, debounces analysis, and mounts its UI inside a closed Shadow DOM so host-page CSS does not leak in.

## Install locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select this `extension/` folder.
5. Open the extension’s **Details → Extension options** to add an optional OpenAI-compatible endpoint, model, and API key.

The local analyzer works without a key. AI is off by default. API keys are stored in extension storage only and are never included in the repository.

## Safety behavior

- Password, hidden, disabled, and read-only fields are skipped.
- Text is analyzed after a 520 ms debounce.
- Only the changed neighborhood is sent when AI is enabled.
- Previous AI requests are aborted when the field changes.
- Site exclusions and “disable on this site” are stored locally.
