(function draftwiseContentScript() {
  "use strict";

  const TYPO_FIXES = {
    alot: "a lot", definately: "definitely", enviroment: "environment", occured: "occurred",
    recieve: "receive", seperate: "separate", thier: "their", untill: "until", wich: "which",
    repeatd: "repeated", writting: "writing", dont: "don't", cant: "can't", doesnt: "doesn't",
  };
  const FILLERS = new Set(["actually", "basically", "just", "really", "quite", "very"]);
  const issueColors = { spelling: "#e25d70", grammar: "#ef9f55", punctuation: "#8b78e6", repetition: "#d46191", conciseness: "#d8944a" };
  const cache = new Map();
  let settings = { excludedSites: [], disabledSites: [], aiEnabled: false, apiKey: "", baseUrl: "", model: "" };
  let activeField = null;
  let activeIssues = [];
  let scanTimer = 0;
  let abortController = null;
  let root = null;
  let button = null;
  let panel = null;

  const currentHost = () => location.hostname.replace(/^www\./, "");
  const isExcluded = () => settings.excludedSites.some((site) => currentHost() === site || currentHost().endsWith(`.${site}`)) || settings.disabledSites.includes(currentHost());
  const isEditable = (element) => element && (element.matches("textarea, input:not([type=password]):not([type=hidden]):not([type=submit]), [contenteditable=true]") && !element.disabled && !element.readOnly);
  const textOf = (element) => element.isContentEditable ? element.innerText : element.value;
  const escapeText = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[character]));

  function makeIssue(start, end, original, replacement, category, severity, title, explanation) {
    return { id: `${category}-${start}-${end}`, start, end, original, replacement, category, severity, title, explanation, source: "local" };
  }

  function localAnalyze(text) {
    const issues = [];
    for (const match of text.matchAll(/\b[\p{L}]+\b/gu)) {
      const replacement = TYPO_FIXES[match[0].toLowerCase()];
      if (replacement) issues.push(makeIssue(match.index, match.index + match[0].length, match[0], replacement, "spelling", "high", `Spelling: ${replacement}`, `Try “${replacement}” instead.`));
    }
    for (const match of text.matchAll(/\b([\p{L}][\p{L}'’-]*)\s+\1\b/giu)) issues.push(makeIssue(match.index, match.index + match[0].length, match[0], match[1], "repetition", "medium", "Repeated word", "Remove the repeat to keep the sentence moving."));
    for (const match of text.matchAll(/ {2,}/g)) issues.push(makeIssue(match.index, match.index + match[0].length, match[0], " ", "punctuation", "low", "Extra space", "A single space is enough here."));
    for (const match of text.matchAll(/\s+([,.;!?])/g)) issues.push(makeIssue(match.index, match.index + match[0].length, match[0], match[1], "punctuation", "medium", "Space before punctuation", "Punctuation sits directly after the word before it."));
    for (const match of text.matchAll(/([!?.,])\1+/g)) issues.push(makeIssue(match.index, match.index + match[0].length, match[0], match[1], "punctuation", "low", "Repeated punctuation", "One mark is enough here."));
    for (const match of text.matchAll(/(^|[.!?]\s+)([a-z])/g)) { const start = match.index + (match[1] || "").length; issues.push(makeIssue(start, start + 1, match[2], match[2].toUpperCase(), "grammar", "medium", "Start with a capital letter", "A new sentence usually begins with a capital letter.")); }
    for (const match of text.matchAll(/\b[\p{L}]+\b/gu)) if (FILLERS.has(match[0].toLowerCase()) && issues.length < 8) issues.push(makeIssue(match.index, match.index + match[0].length, match[0], "", "conciseness", "low", "Possible filler word", "Remove it if the sentence keeps its meaning without it."));
    const unique = [];
    for (const item of issues.sort((a, b) => a.start - b.start)) if (!unique.some((existing) => item.start < existing.end && item.end > existing.start)) unique.push(item);
    return unique;
  }

  function changedChunk(nextText, previousText) {
    let start = 0;
    while (start < nextText.length && start < previousText.length && nextText[start] === previousText[start]) start += 1;
    let end = 0;
    while (end < nextText.length - start && end < previousText.length - start && nextText[nextText.length - 1 - end] === previousText[previousText.length - 1 - end]) end += 1;
    const chunkStart = Math.max(0, start - 120);
    const chunkEnd = Math.min(nextText.length, nextText.length - end + 120);
    return { text: nextText.slice(chunkStart, chunkEnd), offset: chunkStart };
  }

  async function aiAnalyze(text, previousText) {
    if (!settings.aiEnabled || !settings.apiKey || !settings.baseUrl || !settings.model) return [];
    const chunk = changedChunk(text, previousText);
    const cacheKey = `${settings.model}:${chunk.text}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    abortController?.abort();
    abortController = new AbortController();
    const endpoint = `${settings.baseUrl.replace(/\/$/, "")}/chat/completions`;
    try {
      const response = await fetch(endpoint, { method: "POST", signal: abortController.signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` }, body: JSON.stringify({ model: settings.model, temperature: 0.2, max_tokens: 450, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Return JSON only: {\"issues\":[{\"start\":0,\"end\":4,\"original\":\"text\",\"replacement\":\"Text\",\"category\":\"grammar\",\"severity\":\"medium\",\"title\":\"Short title\",\"explanation\":\"Plain explanation.\"}]} Use offsets relative to the provided text. Never include HTML." }, { role: "user", content: chunk.text }] }) });
      if (!response.ok) return [];
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content;
      const parsed = typeof content === "string" ? JSON.parse(content.replace(/^```json\s*/i, "").replace(/```$/, "")) : content;
      const valid = Array.isArray(parsed?.issues) ? parsed.issues.filter((item) => typeof item.start === "number" && typeof item.end === "number" && typeof item.replacement === "string" && chunk.text.slice(item.start, item.end) === item.original).map((item) => ({ ...item, start: item.start + chunk.offset, end: item.end + chunk.offset, id: `ai-${item.start}-${item.end}`, source: "ai" })) : [];
      cache.set(cacheKey, valid);
      return valid;
    } catch { return []; }
  }

  function shadowStyles() {
    return `:host{all:initial;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#193a34}*{box-sizing:border-box}.dw-button{position:fixed;z-index:2147483647;width:34px;height:34px;border:1px solid #bedb75;border-radius:10px;background:#173f38;color:#d8f26b;box-shadow:0 7px 18px #173f3830;display:grid;place-items:center;cursor:pointer;font:700 15px system-ui}.dw-button:hover{transform:translateY(-1px)}.dw-panel{position:fixed;z-index:2147483647;width:290px;max-height:390px;overflow:auto;border:1px solid #d9e5db;border-radius:13px;background:#fff;box-shadow:0 16px 38px #193a3426;padding:12px;font:12px/1.4 system-ui;color:#193a34}.dw-head{display:flex;align-items:center;gap:7px;padding:2px 1px 11px;border-bottom:1px solid #edf2ed}.dw-mark{width:18px;height:18px;border-radius:6px;background:#173f38;position:relative}.dw-mark:after{content:' ';position:absolute;left:5px;right:4px;top:5px;height:2px;background:#d8f26b;box-shadow:0 4px #d8f26b,0 8px #d8f26b}.dw-title{font-weight:750}.dw-count{margin-left:auto;color:#7a9385;font-size:10px}.dw-close{border:0;background:none;color:#8a9a91;cursor:pointer}.dw-issue{padding:11px 2px;border-bottom:1px solid #edf2ed}.dw-issue:last-child{border-bottom:0}.dw-issue-title{display:flex;align-items:center;gap:6px;font-weight:750}.dw-dot{width:7px;height:7px;border-radius:50%;background:var(--dot,#e25d70)}.dw-meta{margin:3px 0 5px;color:#82938a;font-size:10px;text-transform:capitalize}.dw-copy{margin:0;color:#60766a;font-size:11px}.dw-fix{display:flex;align-items:center;gap:6px;margin-top:8px}.dw-old{color:#bd646a;text-decoration:line-through}.dw-new{color:#4c9066;font-weight:750}.dw-accept{margin-left:auto;border:0;border-radius:6px;padding:5px 8px;background:#173f38;color:#d8f26b;font:700 10px system-ui;cursor:pointer}.dw-footer{display:flex;justify-content:space-between;padding-top:9px;color:#8a9a91;font-size:9px}.dw-footer button{border:0;background:none;color:#57896b;cursor:pointer}`;
  }

  function render() {
    if (!root || !button || !panel) return;
    button.textContent = activeIssues.length ? String(Math.min(activeIssues.length, 9)) : "✦";
    button.setAttribute("aria-label", `${activeIssues.length} writing suggestions`);
    panel.innerHTML = `<div class="dw-head"><span class="dw-mark"></span><span class="dw-title">draftwise</span><span class="dw-count">${activeIssues.length} suggestion${activeIssues.length === 1 ? "" : "s"}</span><button class="dw-close" data-close>×</button></div>${activeIssues.length ? activeIssues.map((item, index) => `<div class="dw-issue"><div class="dw-issue-title"><span class="dw-dot" style="--dot:${issueColors[item.category] || "#759c83"}"></span><span>${escapeText(item.title || "Writing suggestion")}</span></div><div class="dw-meta">${escapeText(item.category || "style")} · ${escapeText(item.severity || "low")}</div><p class="dw-copy">${escapeText(item.explanation || "Review this change before applying it.")}</p><div class="dw-fix"><span class="dw-old">${escapeText(item.original)}</span>${item.replacement ? `<span>→</span><span class="dw-new">${escapeText(item.replacement)}</span><button class="dw-accept" data-index="${index}">Accept</button>` : ""}</div></div>`).join("") : `<div class="dw-issue"><p class="dw-copy">No local issues in this field yet. Draftwise skips passwords and sensitive fields.</p></div>`}<div class="dw-footer"><span>Local-first</span><button data-disable>Disable on this site</button></div>`;
    panel.querySelector("[data-close]")?.addEventListener("click", () => { panel.hidden = true; });
    panel.querySelectorAll("[data-index]").forEach((element) => element.addEventListener("click", () => applyIssue(activeIssues[Number(element.dataset.index)])));
    panel.querySelector("[data-disable]")?.addEventListener("click", () => { settings.disabledSites = [...new Set([...settings.disabledSites, currentHost()])]; chrome.storage.local.set({ disabledSites: settings.disabledSites }); panel.hidden = true; button.hidden = true; });
  }

  function place() {
    if (!activeField || !button) return;
    const rect = activeField.getBoundingClientRect();
    button.style.top = `${Math.max(8, Math.min(window.innerHeight - 42, rect.top + 8))}px`;
    button.style.left = `${Math.max(8, Math.min(window.innerWidth - 42, rect.right - 42))}px`;
    if (panel && !panel.hidden) { panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 410, rect.top + 47))}px`; panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 298, rect.right - 290))}px`; }
  }

  function rangeFor(element, start, end) {
    if (!element.isContentEditable) { element.focus(); element.setSelectionRange(start, end); return null; }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node; let offset = 0; const range = document.createRange();
    while ((node = walker.nextNode())) { const next = offset + node.textContent.length; if (start >= offset && start <= next) range.setStart(node, start - offset); if (end >= offset && end <= next) { range.setEnd(node, end - offset); return range; } offset = next; }
    return null;
  }

  function applyIssue(item) {
    if (!item || !activeField) return;
    if (activeField.isContentEditable) { const range = rangeFor(activeField, item.start, item.end); if (range) { range.deleteContents(); range.insertNode(document.createTextNode(item.replacement)); activeField.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" })); } }
    else { const value = activeField.value; if (value.slice(item.start, item.end) !== item.original) return; activeField.focus(); activeField.setRangeText(item.replacement, item.start, item.end, "end"); activeField.dispatchEvent(new Event("input", { bubbles: true })); }
    window.setTimeout(() => scan(activeField), 100);
  }

  async function scan(element) {
    if (!isEditable(element) || isExcluded()) return;
    const text = textOf(element); const previous = element.__draftwiseText || ""; element.__draftwiseText = text;
    activeField = element; activeIssues = localAnalyze(text); render(); place();
    const remote = await aiAnalyze(text, previous);
    if (activeField !== element || textOf(element) !== text) return;
    activeIssues = [...activeIssues, ...remote].sort((a, b) => a.start - b.start); render(); place();
  }

  function bind(element) {
    if (!isEditable(element) || element.dataset.draftwiseBound) return;
    element.dataset.draftwiseBound = "true";
    element.addEventListener("focus", () => { activeField = element; button.hidden = false; window.setTimeout(() => scan(element), 80); });
    element.addEventListener("input", () => { window.clearTimeout(scanTimer); scanTimer = window.setTimeout(() => scan(element), 520); });
  }

  function initShadow() {
    const host = document.createElement("div"); host.id = "draftwise-assistant-host"; root = host.attachShadow({ mode: "closed" });
    const styles = document.createElement("style"); styles.textContent = shadowStyles(); root.appendChild(styles);
    button = document.createElement("button"); button.className = "dw-button"; button.type = "button"; button.addEventListener("click", () => { panel.hidden = !panel.hidden; render(); place(); }); root.appendChild(button);
    panel = document.createElement("div"); panel.className = "dw-panel"; panel.hidden = true; root.appendChild(panel); document.documentElement.appendChild(host);
    button.hidden = true;
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
  }

  chrome.storage.local.get(["excludedSites", "disabledSites", "aiEnabled", "apiKey", "baseUrl", "model"], (stored) => {
    settings = { ...settings, ...stored };
    if (isExcluded()) return;
    initShadow(); document.querySelectorAll("textarea, input, [contenteditable=true]").forEach(bind);
    const observer = new MutationObserver(() => document.querySelectorAll("textarea, input, [contenteditable=true]").forEach(bind));
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
})();
