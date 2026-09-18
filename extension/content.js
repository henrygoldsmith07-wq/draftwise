(function () {
  "use strict";

  const grammar = globalThis.DraftwiseGrammar;
  if (!grammar || typeof grammar.analyzeLocally !== "function") return;

  const settings = {
    excludedSites: [],
    disabledSites: [],
    disabledFields: [],
    aiEnabled: false,
    goals: { audience: "general", intent: "inform", tone: "professional" },
    style: { dialect: "en-GB", personalDictionary: [], ignoredWords: [], ignoredRuleIds: [], preferredTerminology: {}, oxfordComma: true, allowContractions: true, passiveVoiceSensitivity: "normal", preferredSentenceLength: "balanced", blockedWords: [] },
  };
  let activeField = null;
  let activeIssues = [];
  let previousText = "";
  let scanTimer = 0;
  let requestId = 0;
  let root = null;
  let button = null;
  let panel = null;
  let cache = new Map();

  const host = () => location.hostname.replace(/^www\./u, "");
  const siteIsDisabled = () => settings.excludedSites.some((site) => host() === site || host().endsWith(`.${site}`)) || settings.disabledSites.includes(host());
  const fieldSignature = (element) => `${host()}|${element.name || element.id || element.getAttribute("aria-label") || element.tagName}`;
  const fieldIsDisabled = (element) => settings.disabledFields.includes(fieldSignature(element));
  const fieldMetadata = (element) => [
    element.type,
    element.name,
    element.id,
    element.getAttribute("autocomplete"),
    element.getAttribute("aria-label"),
    element.getAttribute("placeholder"),
    element.closest("form")?.getAttribute("autocomplete"),
  ].filter(Boolean).join(" ").toLowerCase();
  const isSensitive = (element) => {
    if (!element || element.disabled || element.readOnly || element.hidden || element.getAttribute("aria-hidden") === "true") return true;
    const type = (element.type || "").toLowerCase();
    if (["password", "hidden", "submit", "button", "file", "checkbox", "radio"].includes(type)) return true;
    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase();
    if (["current-password", "new-password", "one-time-code", "cc-number", "cc-csc", "cc-exp", "security-code"].includes(autocomplete)) return true;
    return /password|passcode|otp|one[- ]time|secret|token|api[-_ ]?key|auth|login|credential|credit[- ]?card|card[- ]?number|cvv|cvc|security[- ]?code|social[- ]?security|ssn|private[- ]?key|pin/iu.test(fieldMetadata(element));
  };
  const isEditable = (element) => Boolean(element && !isSensitive(element) && !fieldIsDisabled(element) && (element.matches("textarea, input, [contenteditable=true]")));
  const textOf = (element) => element.isContentEditable ? element.innerText : element.value;
  const issueColor = { spelling: "#e25d70", grammar: "#ef9f55", punctuation: "#8b78e6", repetition: "#d46191", conciseness: "#d8944a", clarity: "#4a9a9d", consistency: "#6a8f68" };

  function localAnalysis(text) {
    const key = `${text}|${JSON.stringify(settings.style)}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const result = grammar.analyzeLocally(text, settings.style, settings.goals);
    cache.set(key, result);
    while (cache.size > 24) cache.delete(cache.keys().next().value);
    return result;
  }

  function shadowStyles() {
    return `:host{all:initial;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#193a34}*{box-sizing:border-box}.dw-button{position:fixed;z-index:2147483647;width:36px;height:36px;border:1px solid #bedb75;border-radius:11px;background:#173f38;color:#d8f26b;box-shadow:0 7px 18px #173f3830;display:grid;place-items:center;cursor:pointer;font:700 14px system-ui}.dw-button:focus-visible,.dw-accept:focus-visible,.dw-close:focus-visible,.dw-footer button:focus-visible{outline:3px solid #91bdf7;outline-offset:2px}.dw-button:hover{transform:translateY(-1px)}.dw-panel{position:fixed;z-index:2147483647;width:310px;max-height:430px;overflow:auto;border:1px solid #d9e5db;border-radius:14px;background:#fff;box-shadow:0 16px 38px #193a3426;padding:12px;font:13px/1.45 system-ui;color:#193a34}.dw-head{display:flex;align-items:center;gap:7px;padding:2px 1px 11px;border-bottom:1px solid #edf2ed}.dw-mark{width:18px;height:18px;border-radius:6px;background:#173f38;position:relative}.dw-mark:after{content:' ';position:absolute;left:5px;right:4px;top:5px;height:2px;background:#d8f26b;box-shadow:0 4px #d8f26b,0 8px #d8f26b}.dw-title{font-weight:750}.dw-count{margin-left:auto;color:#7a9385;font-size:11px}.dw-close{border:0;background:none;color:#71847a;cursor:pointer;font-size:18px;line-height:1}.dw-issue{padding:11px 2px;border-bottom:1px solid #edf2ed}.dw-issue:last-child{border-bottom:0}.dw-issue-title{display:flex;align-items:center;gap:6px;font-weight:750}.dw-dot{width:7px;height:7px;border-radius:50%;background:var(--dot,#e25d70);flex:none}.dw-meta{margin:3px 0 5px;color:#82938a;font-size:11px;text-transform:capitalize}.dw-copy{margin:0;color:#60766a;font-size:12px}.dw-fix{display:flex;align-items:center;gap:6px;margin-top:8px}.dw-old{color:#bd646a;text-decoration:line-through;overflow-wrap:anywhere}.dw-new{color:#4c9066;font-weight:750;overflow-wrap:anywhere}.dw-accept{margin-left:auto;border:0;border-radius:7px;padding:6px 9px;background:#173f38;color:#d8f26b;font:700 11px system-ui;cursor:pointer}.dw-dismiss{border:0;background:none;color:#84968c;cursor:pointer;font-size:16px}.dw-footer{display:flex;justify-content:space-between;gap:8px;padding-top:10px;color:#8a9a91;font-size:10px}.dw-footer button{border:0;background:none;color:#57896b;cursor:pointer;font:inherit;text-decoration:underline}@media(prefers-color-scheme:dark){.dw-panel{background:#18322f;color:#eff8ef;border-color:#36534b;box-shadow:0 16px 38px #0008}.dw-head,.dw-issue{border-color:#315049}.dw-count,.dw-meta,.dw-copy,.dw-footer{color:#a7beb1}.dw-old{color:#ffadb0}.dw-new{color:#c9f68a}.dw-footer button{color:#b9e5b7}}`;
  }

  function clearPanel() { while (panel?.firstChild) panel.removeChild(panel.firstChild); }
  function textNode(tag, value, className) { const element = document.createElement(tag); element.textContent = value; if (className) element.className = className; return element; }

  function render() {
    if (!root || !button || !panel) return;
    const actionable = activeIssues.filter((item) => item.replacement && item.replacement !== item.original);
    button.textContent = activeIssues.length ? String(Math.min(activeIssues.length, 99)) : "✦";
    button.setAttribute("aria-label", `${activeIssues.length} writing suggestion${activeIssues.length === 1 ? "" : "s"}`);
    clearPanel();
    const header = document.createElement("div"); header.className = "dw-head";
    header.append(textNode("span", "", "dw-mark"), textNode("span", "draftwise", "dw-title"), textNode("span", `${activeIssues.length} suggestion${activeIssues.length === 1 ? "" : "s"}`, "dw-count"));
    const close = textNode("button", "×", "dw-close"); close.type = "button"; close.setAttribute("aria-label", "Close Draftwise suggestions"); close.addEventListener("click", () => { panel.hidden = true; }); header.append(close); panel.append(header);
    if (activeIssues.length === 0) {
      const empty = document.createElement("div"); empty.className = "dw-issue"; empty.append(textNode("p", "No local issues in this field yet. Draftwise skips sensitive fields.", "dw-copy")); panel.append(empty);
    }
    activeIssues.forEach((item) => {
      const issue = document.createElement("div"); issue.className = "dw-issue";
      const title = document.createElement("div"); title.className = "dw-issue-title"; const dot = textNode("span", "", "dw-dot"); dot.style.setProperty("--dot", issueColor[item.category] || "#759c83"); title.append(dot, textNode("span", item.title || "Writing suggestion")); issue.append(title);
      issue.append(textNode("div", `${item.category || "style"} · ${item.severity || "low"}`, "dw-meta"), textNode("p", item.explanation || "Review this change before applying it.", "dw-copy"));
      const fix = document.createElement("div"); fix.className = "dw-fix"; fix.append(textNode("span", item.original, "dw-old"));
      if (item.replacement && item.replacement !== item.original) {
        fix.append(textNode("span", "→"), textNode("span", item.replacement, "dw-new"));
        const accept = textNode("button", "Accept", "dw-accept"); accept.type = "button"; accept.addEventListener("click", () => applyIssue(item)); fix.append(accept);
      }
      const dismiss = textNode("button", "×", "dw-dismiss"); dismiss.type = "button"; dismiss.setAttribute("aria-label", `Dismiss ${item.title || "suggestion"}`); dismiss.addEventListener("click", () => { activeIssues = activeIssues.filter((candidate) => candidate.id !== item.id); render(); }); fix.append(dismiss); issue.append(fix); panel.append(issue);
    });
    const footer = document.createElement("div"); footer.className = "dw-footer"; footer.append(textNode("span", "Local-first"));
    const disable = textNode("button", "Disable on this site"); disable.type = "button"; disable.addEventListener("click", () => { settings.disabledSites = [...new Set([...settings.disabledSites, host()])]; chrome.storage.local.set({ disabledSites: settings.disabledSites }); panel.hidden = true; button.hidden = true; }); footer.append(disable); panel.append(footer);
    if (actionable.length) panel.setAttribute("aria-label", `${actionable.length} actionable writing suggestions`);
  }

  function place() {
    if (!activeField || !button) return;
    const rect = activeField.getBoundingClientRect();
    const buttonTop = Math.max(8, Math.min(window.innerHeight - 44, rect.top + 8));
    const buttonLeft = Math.max(8, Math.min(window.innerWidth - 44, rect.right - 44));
    button.style.top = `${buttonTop}px`; button.style.left = `${buttonLeft}px`;
    if (!panel || panel.hidden) return;
    const panelWidth = 310; const panelHeight = Math.min(panel.scrollHeight || 430, 430);
    const left = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, rect.right - panelWidth));
    const below = rect.bottom + 12; const top = below + panelHeight <= window.innerHeight ? below : Math.max(8, rect.top - panelHeight - 12);
    panel.style.top = `${top}px`; panel.style.left = `${left}px`;
  }

  function contentRange(element, start, end) {
    if (!element.isContentEditable) { element.focus(); element.setSelectionRange(start, end); return null; }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT); let node; let offset = 0; const range = document.createRange();
    while ((node = walker.nextNode())) { const length = node.textContent?.length || 0; const next = offset + length; if (start >= offset && start <= next) range.setStart(node, start - offset); if (end >= offset && end <= next) { range.setEnd(node, end - offset); return range; } offset = next; }
    return null;
  }

  function applyIssue(item) {
    if (!item || !activeField || activeField.isContentEditable && !contentRange(activeField, item.start, item.end)) return;
    if (activeField.isContentEditable) { const range = contentRange(activeField, item.start, item.end); if (!range) return; range.deleteContents(); range.insertNode(document.createTextNode(item.replacement)); activeField.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" })); }
    else { const value = activeField.value; if (value.slice(item.start, item.end) !== item.original) return; activeField.focus(); activeField.setRangeText(item.replacement, item.start, item.end, "end"); activeField.dispatchEvent(new Event("input", { bubbles: true })); }
    panel.hidden = true; window.setTimeout(() => scan(activeField), 80);
  }

  async function scan(element) {
    if (!isEditable(element) || siteIsDisabled()) return;
    const text = textOf(element); const previous = element.__draftwiseText || previousText; element.__draftwiseText = text; previousText = text; activeField = element;
    activeIssues = localAnalysis(text).issues || []; render(); place();
    if (!settings.aiEnabled || !text.trim()) return;
    const currentRequest = ++requestId;
    const response = await chrome.runtime.sendMessage({ type: "analyse", requestId: currentRequest, text, previousText: previous, goals: settings.goals, style: settings.style }).catch(() => null);
    if (!response || currentRequest !== requestId || activeField !== element || textOf(element) !== text) return;
    if (Array.isArray(response.issues)) activeIssues = response.issues;
    render(); place();
  }

  function bind(element) {
    if (!isEditable(element) || element.dataset.draftwiseBound) return;
    element.dataset.draftwiseBound = "true";
    element.addEventListener("focus", () => { activeField = element; button.hidden = false; window.setTimeout(() => scan(element), 80); });
    element.addEventListener("input", () => { window.clearTimeout(scanTimer); scanTimer = window.setTimeout(() => scan(element), 360); });
    element.addEventListener("blur", () => { window.setTimeout(() => { if (document.activeElement !== element && panel) panel.hidden = true; }, 120); });
  }

  function initShadow() {
    const hostElement = document.createElement("div"); hostElement.id = "draftwise-assistant-host"; root = hostElement.attachShadow({ mode: "open" });
    const styles = document.createElement("style"); styles.textContent = shadowStyles(); root.append(styles);
    button = document.createElement("button"); button.className = "dw-button"; button.type = "button"; button.setAttribute("aria-haspopup", "dialog"); button.addEventListener("click", () => { panel.hidden = !panel.hidden; render(); place(); if (!panel.hidden) panel.querySelector("button")?.focus(); }); root.append(button);
    panel = document.createElement("div"); panel.className = "dw-panel"; panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Draftwise suggestions"); root.append(panel); document.documentElement.append(hostElement); button.hidden = true;
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
  }

  function init(stored) {
    Object.assign(settings, stored || {});
    if (siteIsDisabled()) return;
    initShadow(); document.querySelectorAll("textarea, input, [contenteditable=true]").forEach(bind);
    const observer = new MutationObserver(() => document.querySelectorAll("textarea, input, [contenteditable=true]").forEach(bind));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    chrome.storage.onChanged.addListener((changes) => { for (const [key, value] of Object.entries(changes)) settings[key] = value.newValue; if (siteIsDisabled()) { button.hidden = true; panel.hidden = true; } });
  }

  chrome.storage.local.get(["excludedSites", "disabledSites", "disabledFields", "aiEnabled", "goals", "style"], init);
})();
