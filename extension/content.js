(function () {
  "use strict";

  const grammar = globalThis.DraftwiseGrammar;
  const classifier = globalThis.DraftwiseFieldClassifier;
  const dom = globalThis.DraftwiseDom;
  if (!grammar || typeof grammar.analyzeLocally !== "function" || !classifier || !dom) return;

  const defaultSettings = {
    excludedSites: [],
    disabledSites: [],
    disabledFields: [],
    siteAccess: [],
    aiEnabled: false,
    goals: { audience: "general", intent: "inform", tone: "professional" },
    style: { dialect: "en-GB", personalDictionary: [], names: [], ignoredWords: [], ignoredRuleIds: [], preferredTerminology: {}, oxfordComma: true, allowContractions: true, passiveVoiceSensitivity: "normal", preferredSentenceLength: "balanced", blockedWords: [] },
  };
  const settings = {
    ...defaultSettings,
    excludedSites: [],
    disabledSites: [],
    disabledFields: [],
    siteAccess: [],
    goals: { ...defaultSettings.goals },
    style: { ...defaultSettings.style },
  };

  function defaultSetting(key) {
    const value = defaultSettings[key];
    if (Array.isArray(value)) return [];
    return value && typeof value === "object" ? { ...value } : value;
  }
  let activeField = null;
  let activeIssues = [];
  let scanTimer = 0;
  let requestId = 0;
  let root = null;
  let button = null;
  let panel = null;
  let cache = new Map();
  let observer = null;
  const boundElements = new WeakSet();
  let aiTimer = 0;
  let aiPending = false;
  let aiError = "";
  let aiCoverage = null;

  const host = () => location.hostname.replace(/^www\./u, "");
  const siteHasAccess = () => Array.isArray(settings.siteAccess) && settings.siteAccess.includes(host());
  const siteIsDisabled = () => !siteHasAccess()
    || (Array.isArray(settings.excludedSites) && settings.excludedSites.some((site) => host() === site || host().endsWith(`.${site}`)))
    || (Array.isArray(settings.disabledSites) && settings.disabledSites.includes(host()));
  const fieldSignature = (element) => `${host()}|${element.name || element.id || element.getAttribute("aria-label") || element.tagName}`;
  const fieldIsDisabled = (element) => Array.isArray(settings.disabledFields) && settings.disabledFields.includes(fieldSignature(element));
  const isSensitive = (element) => classifier.isSensitiveField(element);
  const isEditable = (element) => Boolean(element && !isSensitive(element) && !fieldIsDisabled(element) && element.matches(dom.EDITABLE_SELECTOR));
  const textOf = (element) => element.isContentEditable ? dom.buildEditableTextMap(element).text : element.value;
  const issueColor = { spelling: "#e25d70", grammar: "#ef9f55", punctuation: "#8b78e6", repetition: "#d46191", conciseness: "#d8944a", clarity: "#4a9a9d", consistency: "#6a8f68" };

  function fingerprintText(text) {
    let first = 2_166_136_261;
    let second = 2_654_435_761;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 16_777_619);
      second = Math.imul(second ^ (code + ((index & 255) << 8)), 2_246_822_519);
    }
    return `${text.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
  }

  function fingerprintStyle(style) {
    const serialised = JSON.stringify(style || {});
    let hash = 2_166_136_261;
    for (let index = 0; index < serialised.length; index += 1) {
      hash ^= serialised.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    return (hash >>> 0).toString(16);
  }

  function localAnalysis(text, previous, previousResult) {
    const key = `${fingerprintText(text)}:${fingerprintStyle(settings.style)}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const changed = previous !== text && grammar.detectChangedRange ? grammar.detectChangedRange(previous, text) : null;
    const result = previousResult && changed && typeof grammar.analyzeLocallyIncremental === "function"
      ? grammar.analyzeLocallyIncremental(previous, text, previousResult.issues || [], changed, settings.style, settings.goals)
      : grammar.analyzeLocally(text, settings.style, settings.goals);
    cache.set(key, result);
    while (cache.size > 24) cache.delete(cache.keys().next().value);
    return result;
  }

  function shadowStyles() {
    return `:host{all:initial;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#193a34}*{box-sizing:border-box}.dw-button{position:fixed;z-index:2147483647;width:36px;height:36px;border:1px solid #bedb75;border-radius:11px;background:#173f38;color:#d8f26b;box-shadow:0 7px 18px #173f3830;display:grid;place-items:center;cursor:pointer;font:700 14px system-ui}.dw-button:focus-visible,.dw-accept:focus-visible,.dw-close:focus-visible,.dw-footer button:focus-visible{outline:3px solid #91bdf7;outline-offset:2px}.dw-button:hover{transform:translateY(-1px)}.dw-panel{position:fixed;z-index:2147483647;width:310px;max-height:430px;overflow:auto;border:1px solid #d9e5db;border-radius:14px;background:#fff;box-shadow:0 16px 38px #193a3426;padding:12px;font:13px/1.45 system-ui;color:#193a34}.dw-head{display:flex;align-items:center;gap:7px;padding:2px 1px 11px;border-bottom:1px solid #edf2ed}.dw-mark{width:18px;height:18px;border-radius:6px;background:#173f38;position:relative}.dw-mark:after{content:' ';position:absolute;left:5px;right:4px;top:5px;height:2px;background:#d8f26b;box-shadow:0 4px #d8f26b,0 8px #d8f26b}.dw-title{font-weight:750}.dw-source{padding:2px 5px;border-radius:5px;background:#edf5e5;color:#638744;font-size:9px;font-weight:700}.dw-count{margin-left:auto;color:#7a9385;font-size:11px}.dw-close{border:0;background:none;color:#71847a;cursor:pointer;font-size:18px;line-height:1}.dw-issue{padding:11px 2px;border-bottom:1px solid #edf2ed}.dw-issue:last-child{border-bottom:0}.dw-issue-title{display:flex;align-items:center;gap:6px;font-weight:750}.dw-dot{width:7px;height:7px;border-radius:50%;background:var(--dot,#e25d70);flex:none}.dw-meta{margin:3px 0 5px;color:#82938a;font-size:11px;text-transform:capitalize}.dw-copy{margin:0;color:#60766a;font-size:12px}.dw-fix{display:flex;align-items:center;gap:6px;margin-top:8px}.dw-old{color:#bd646a;text-decoration:line-through;overflow-wrap:anywhere}.dw-new{color:#4c9066;font-weight:750;overflow-wrap:anywhere}.dw-accept{margin-left:auto;border:0;border-radius:7px;padding:6px 9px;background:#173f38;color:#d8f26b;font:700 11px system-ui;cursor:pointer}.dw-dismiss{border:0;background:none;color:#84968c;cursor:pointer;font-size:16px}.dw-pending{color:#78984d;font-size:10px}.dw-error{margin:9px 0 0;padding:7px 8px;border-radius:7px;background:#fff0ee;color:#9a514d;font-size:11px}.dw-footer{display:flex;justify-content:space-between;gap:8px;padding-top:10px;color:#8a9a91;font-size:10px}.dw-footer button{border:0;background:none;color:#57896b;cursor:pointer;font:inherit;text-decoration:underline}@media(prefers-color-scheme:dark){.dw-panel{background:#18322f;color:#eff8ef;border-color:#36534b;box-shadow:0 16px 38px #0008}.dw-head,.dw-issue{border-color:#315049}.dw-count,.dw-meta,.dw-copy,.dw-footer{color:#a7beb1}.dw-old{color:#ffadb0}.dw-new{color:#c9f68a}.dw-footer button{color:#b9e5b7}.dw-source{background:#315049;color:#d8f26b}.dw-error{background:#5b3534;color:#ffd1cc}}`;
  }

  function clearPanel() { while (panel?.firstChild) panel.removeChild(panel.firstChild); }
  function textNode(tag, value, className) { const element = document.createElement(tag); element.textContent = value; if (className) element.className = className; return element; }

  function startObserver() {
    if (observer || siteIsDisabled()) return;
    observer = new MutationObserver((records) => dom.handleAddedNodes(records, bind));
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
  }

  function deactivateCurrentPage() {
    stopObserver();
    if (scanTimer) window.clearTimeout(scanTimer);
    if (aiTimer) window.clearTimeout(aiTimer);
    scanTimer = 0;
    aiTimer = 0;
    requestId += 1;
    activeIssues = [];
    aiPending = false;
    aiError = "";
    aiCoverage = null;
    if (activeField) {
      activeField.__draftwiseAiIssues = [];
      activeField.__draftwiseAiCoverage = null;
    }
    activeField = null;
    if (button) button.hidden = true;
    if (panel) panel.hidden = true;
  }

  function aiStateLabel() {
    if (!settings.aiEnabled) return "Local";
    if (aiError) return "AI unavailable";
    if (aiPending) return "Checking AI...";
    if (!aiCoverage || aiCoverage.requestedChunks === 0) return "Local";
    if (aiCoverage.failedChunks > 0 && aiCoverage.successfulChunks === 0) return "AI unavailable";
    if (aiCoverage.failedChunks > 0 || aiCoverage.skippedChunks > 0) return "Partial AI";
    return aiCoverage.successfulChunks > 0 ? "Local + AI" : "Local";
  }

  function render() {
    if (!root || !button || !panel) return;
    const actionable = activeIssues.filter((item) => item.replacement && item.replacement !== item.original);
    button.textContent = activeIssues.length ? String(Math.min(activeIssues.length, 99)) : "✦";
    button.setAttribute("aria-label", `${activeIssues.length} writing suggestion${activeIssues.length === 1 ? "" : "s"}`);
    clearPanel();
    const header = document.createElement("div"); header.className = "dw-head";
    header.append(textNode("span", "", "dw-mark"), textNode("span", "draftwise", "dw-title"), textNode("span", aiStateLabel(), "dw-source"), textNode("span", String(activeIssues.length) + " suggestion" + (activeIssues.length === 1 ? "" : "s"), "dw-count"));
    if (aiPending) header.append(textNode("span", "Checking AI…", "dw-pending"));
    const close = textNode("button", "×", "dw-close"); close.type = "button"; close.setAttribute("aria-label", "Close Draftwise suggestions"); close.addEventListener("click", () => { panel.hidden = true; }); header.append(close); panel.append(header);
    if (aiError) panel.append(textNode("div", aiError, "dw-error"));
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
    const footer = document.createElement("div"); footer.className = "dw-footer"; footer.append(textNode("span", aiStateLabel()));
    const disable = textNode("button", "Disable on this site"); disable.type = "button"; disable.addEventListener("click", () => { settings.disabledSites = [...new Set([...settings.disabledSites, host()])]; deactivateCurrentPage(); chrome.storage.local.set({ disabledSites: settings.disabledSites }); }); footer.append(disable); panel.append(footer);
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

  function applyIssue(item) {
    if (!item || !activeField) return;
    if (activeField.isContentEditable) {
      const map = dom.buildEditableTextMap(activeField);
      if (map.text.slice(item.start, item.end) !== item.original) return;
      const range = map.rangeFor(item.start, item.end);
      if (!range) return;
      range.deleteContents();
      range.insertNode(document.createTextNode(item.replacement));
      activeField.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    } else {
      const value = activeField.value;
      if (value.slice(item.start, item.end) !== item.original) return;
      activeField.focus(); activeField.setRangeText(item.replacement, item.start, item.end, "end"); activeField.dispatchEvent(new Event("input", { bubbles: true }));
    }
    panel.hidden = true; window.setTimeout(() => scan(activeField), 80);
  }

  async function requestAi(element, text, previous, local) {
    // Intelligent debounce: classifier.dev is never hit on every keystroke.
    // Local rules already ran; only unresolved text is scheduled for cloud triage.
    if (!settings.aiEnabled || !text.trim() || text.trim().length < 20) return;
    const currentRequest = ++requestId;
    const changedRange = previous !== text && typeof grammar.detectChangedRange === "function" ? grammar.detectChangedRange(previous, text) : null;
    aiPending = true; render();
    // NOTE: message contains text/goals/style/requestId only. Provider and
    // classifier keys stay in the service worker and never enter page context.
    const response = await chrome.runtime.sendMessage({ type: "analyse", requestId: currentRequest, text, changedRange, goals: settings.goals, style: settings.style }).catch(() => ({ issues: null, error: "AI analysis is unavailable; local suggestions are still active." }));
    if (currentRequest !== requestId || activeField !== element || textOf(element) !== text) return;
    aiPending = false;
    aiError = response?.error || "";
    aiCoverage = response?.aiCoverage || null;
    element.__draftwiseAiCoverage = aiCoverage;
    if (!response) {
      aiError = "AI analysis is unavailable; local suggestions are still active.";
      render();
      place();
      return;
    }
    if (Array.isArray(response.issues)) {
      const aiIssues = response.issues.filter((issue) => issue && issue.source === "ai");
      element.__draftwiseAiIssues = aiIssues;
      activeIssues = [...(local.issues || []), ...aiIssues];
    }
    render(); place();
  }

  async function scan(element) {
    if (!isEditable(element) || siteIsDisabled()) return;
    const text = textOf(element); const previous = element.__draftwiseText || ""; const previousResult = element.__draftwiseLocalResult || null; element.__draftwiseText = text; activeField = element;
    const local = localAnalysis(text, previous, previousResult);
    element.__draftwiseLocalResult = local;
    element.__draftwiseAiIssues = [];
    element.__draftwiseAiCoverage = null;
    activeIssues = local.issues || []; aiError = ""; aiCoverage = null; aiPending = false; render(); place();
    // Cancel any pending cloud triage from rapid typing (cancellation support).
    if (aiTimer) window.clearTimeout(aiTimer);
    if (!settings.aiEnabled || !text.trim()) return;
    aiTimer = window.setTimeout(() => { void requestAi(element, text, previous, local); }, 650);
  }

  function bind(element) {
    if (siteIsDisabled() || !isEditable(element) || boundElements.has(element)) return;
    boundElements.add(element);
    element.addEventListener("focus", () => {
      if (siteIsDisabled() || !isEditable(element)) {
        deactivateCurrentPage();
        return;
      }
      activeField = element;
      if (button) button.hidden = false;
      window.setTimeout(() => scan(element), 80);
    });
    element.addEventListener("input", () => {
      if (siteIsDisabled() || !isEditable(element)) return;
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(() => scan(element), 360);
    });
    element.addEventListener("blur", () => { window.setTimeout(() => { if (document.activeElement !== element && panel) panel.hidden = true; }, 120); });
  }

  function initShadow() {
    const hostElement = document.createElement("div"); hostElement.id = "draftwise-assistant-host"; root = hostElement.attachShadow({ mode: "open" });
    const styles = document.createElement("style"); styles.textContent = shadowStyles(); root.append(styles);
    button = document.createElement("button"); button.className = "dw-button"; button.type = "button"; button.setAttribute("aria-haspopup", "dialog"); button.addEventListener("click", () => { panel.hidden = !panel.hidden; render(); place(); if (!panel.hidden) panel.querySelector("button")?.focus(); }); root.append(button);
    panel = document.createElement("div"); panel.className = "dw-panel"; panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Draftwise suggestions"); panel.setAttribute("aria-live", "polite"); root.append(panel); document.documentElement.append(hostElement); button.hidden = true;
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place); window.addEventListener("keydown", (event) => { if (event.key === "Escape" && panel && !panel.hidden) { panel.hidden = true; button.focus(); } });
  }

  function init(stored) {
    Object.assign(settings, stored || {});
    if (siteIsDisabled()) return;
    initShadow();
    dom.bindEditableSubtree(document.documentElement, bind);
    startObserver();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area && area !== "local") return;
      for (const [key, value] of Object.entries(changes)) {
        if (!(key in defaultSettings)) continue;
        settings[key] = value.newValue === undefined ? defaultSetting(key) : value.newValue;
      }
      cache.clear();
      requestId += 1;
      if (aiTimer) window.clearTimeout(aiTimer);
      aiTimer = 0;
      if (siteIsDisabled() || (activeField && !isEditable(activeField))) {
        deactivateCurrentPage();
      } else {
        startObserver();
        dom.bindEditableSubtree(document.documentElement, bind);
        const focused = document.activeElement;
        if (isEditable(focused)) void scan(focused);
        else if (activeField) void scan(activeField);
      }
    });
  }

  chrome.storage.local.get(["excludedSites", "disabledSites", "disabledFields", "siteAccess", "aiEnabled", "goals", "style"], init);
})();
