# Provider contract

Draftwise speaks to any provider that exposes an OpenAI-compatible `POST /chat/completions` endpoint. Configure:

- Base URL, such as `https://api.openai.com/v1` or a self-hosted gateway.
- Model ID.
- API key.
- Temperature and maximum tokens.
- Optional JSON headers in the web app.

Analysis requests ask for JSON with `issues`, `tone`, and `scores`. Each issue must include character offsets and an `original` string that exactly matches the submitted document range. The client validates the response before use and falls back to local analysis on provider, network, timeout, rate-limit, or parsing errors.

Requests are debounced, cached by model/goals/text, limited to the latest 8,000 characters in the web editor, and cancelled when the draft changes. This keeps ordinary typing local and avoids sending the full document for every keystroke.
