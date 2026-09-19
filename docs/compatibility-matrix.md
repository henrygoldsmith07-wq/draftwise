# Browser compatibility matrix

This matrix describes the supported editor shapes for the Manifest V3 extension. It is a manual/integration test plan rather than a claim that every third-party editor has been certified. Test with the current Chrome or Edge release after granting access to the specific site.

| Surface | Status | What works | Known limitation / test note |
| --- | --- | --- | --- |
| Standard `<textarea>` | Works | Local analysis, optional AI, issue acceptance, selection offsets | Custom widgets that replace the textarea value without dispatching `input` can delay rescans. |
| Standard text `<input>` | Works | Short-form local checks and replacements | Intended for one-line fields; browser-native search, password, date, number, and other sensitive/specialized inputs are skipped. |
| Simple `contenteditable` | Works | Nested spans, inline formatting, paragraphs, `<br>`, local checks, and stale-safe replacement | The editor must expose a real `contenteditable="true"` element and dispatch normal DOM input events. |
| Gmail compose | Partial | Compose textareas/contenteditable fields can be checked after granting `mail.google.com` | Gmail’s continuously replaced editor nodes and draft syncing should be regression-tested after Gmail UI changes; password/account fields are skipped. |
| Outlook on the web | Partial | Message compose contenteditable fields can be checked after granting the Outlook host | Outlook may recreate editor subtrees while typing. Draftwise rescans added subtrees, but browser-native send/format controls are outside scope. |
| LinkedIn | Partial | Post/comment message editors can be checked after granting LinkedIn | Modal editors and delayed React state updates can vary by flow; verify that an accepted replacement remains after the editor rerenders. |
| Reddit | Partial | Markdown textareas and comment fields can be checked after granting Reddit | Rich-text mode is a site-owned editor and may expose a different DOM shape; Markdown textarea mode is the more predictable path. |
| GitHub textareas | Works | Issue, PR, discussion, and comment textareas can be checked after granting GitHub | CodeMirror/Monaco and other code editors are not treated as ordinary writing fields. |
| CMS editors | Partial | Plain textareas and simple contenteditable article fields | ProseMirror, Slate, Draft.js, Quill, CodeMirror, Monaco, and custom iframe editors may require site-specific adapters and are not guaranteed. |
| Cross-origin iframe editors | Unsupported | — | The extension does not inject into an iframe unless the user separately grants that frame’s origin and the browser registration matches it. |
| Password, payment, credential, OTP, and secret fields | Unsupported by design | — | Field classification intentionally skips these surfaces to keep the privacy boundary predictable. |

## Repeatable manual pass

For each site, grant only its origin, focus one supported editor, type a sentence containing `recieve`, `the the`, and `She are`, then verify that suggestions appear. Accept one suggestion, replace the text before accepting another, and confirm the stale suggestion is discarded. Add a new editor node after page load and confirm it binds without a full-page rescan. Finally revoke the site permission and confirm the panel disappears.

The automated coverage for the DOM mapping and added-node observer lives in `tests/extension.test.mjs`. It uses browser-like fake nodes and does not replace the manual checks against vendor-owned editors.
