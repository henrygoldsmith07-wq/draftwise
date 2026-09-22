importScripts("shared-provider.js", "permissions.js");

const activeRequests = new Map();
const analysisCache = new Map();
const ANALYSIS_CACHE_LIMIT = 24;
const excludeMatches = ["*://chrome.google.com/*", "*://chromewebstore.google.com/*", "*://chromewebstore.googleusercontent.com/*"];
const defaults = {
  excludedSites: [],
  disabledSites: [],
  disabledFields: [],
  siteAccess: [],
  aiEnabled: false,
  classifier: {
    baseUrl: "https://classifier.dev",
    apiKey: "",
    uncertainPolicy: "provider",
    timeoutMs: 8000,
    maxExcerptChars: 500,
  },
  provider: {
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: "",
    temperature: 0.2,
    maxTokens: 900,
    customHeaders: "",
  },
};

function stableSerialise(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableSerialise).join(",") + "]";
  return "{" + Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => JSON.stringify(key) + ":" + stableSerialise(value[key])).join(",") + "}";
}

function settingsFingerprint(value) {
  const source = stableSerialise(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return "settings-" + (hash >>> 0).toString(16) + "-" + source.length;
}

function safeCustomHeadersFingerprint(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return settingsFingerprint({ invalid: true, length: String(raw || "").length });
    const safe = Object.entries(parsed)
      .filter(([name]) => !/(authorization|api[-_ ]?key|token|secret|password|credential)/iu.test(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, settingsFingerprint(value)]);
    return settingsFingerprint(safe);
  } catch {
    return settingsFingerprint({ invalid: true, length: String(raw || "").length });
  }
}

function chromeCall(method, args = []) {
  return new Promise((resolve, reject) => {
    method(...args, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

const storageGet = (keys) => chromeCall(chrome.storage.local.get.bind(chrome.storage.local), [keys]);
const storageSet = (value) => chromeCall(chrome.storage.local.set.bind(chrome.storage.local), [value]);
const permissionsContains = (value) => chromeCall(chrome.permissions.contains.bind(chrome.permissions), [value]);

async function unregisterSite(hostname) {
  const id = globalThis.DraftwisePermissions.siteScriptId(hostname);
  await chromeCall(chrome.scripting.unregisterContentScripts.bind(chrome.scripting), [{ ids: [id] }]).catch(() => undefined);
}

async function registerSite(hostname) {
  const normalised = globalThis.DraftwisePermissions.normaliseHostname(hostname);
  const origins = globalThis.DraftwisePermissions.sitePatterns(normalised);
  if (!await permissionsContains({ origins })) throw new Error(`Grant site access before enabling Draftwise on ${normalised}.`);
  await unregisterSite(normalised);
  await chromeCall(chrome.scripting.registerContentScripts.bind(chrome.scripting), [{
    id: globalThis.DraftwisePermissions.siteScriptId(normalised),
    matches: origins,
    excludeMatches,
    js: ["shared-analysis.js", "field-classification.js", "dom-utils.js", "content.js"],
    runAt: "document_idle",
    persistAcrossSessions: true,
  }]);
  return normalised;
}

async function syncRegisteredSites() {
  const stored = await storageGet(["siteAccess", "disabledSites"]);
  const disabled = new Set(Array.isArray(stored.disabledSites) ? stored.disabledSites : []);
  const sites = Array.isArray(stored.siteAccess) ? stored.siteAccess : [];
  for (const site of sites) {
    try {
      if (disabled.has(site)) await unregisterSite(site);
      else await registerSite(site);
    } catch {
      // A user may have revoked a permission outside Draftwise. The settings page
      // reflects that state; a missing permission never causes a broad fallback.
      await unregisterSite(site);
    }
  }
}

async function initialise() {
  const stored = await storageGet(Object.keys(defaults));
  const storedClassifier = { ...(stored.classifier || {}) };
  delete storedClassifier.model;
  await storageSet({
    excludedSites: Array.isArray(stored.excludedSites) ? stored.excludedSites : defaults.excludedSites,
    disabledSites: Array.isArray(stored.disabledSites) ? stored.disabledSites : defaults.disabledSites,
    disabledFields: Array.isArray(stored.disabledFields) ? stored.disabledFields : defaults.disabledFields,
    siteAccess: Array.isArray(stored.siteAccess) ? stored.siteAccess : defaults.siteAccess,
    aiEnabled: typeof stored.aiEnabled === "boolean" ? stored.aiEnabled : defaults.aiEnabled,
    provider: { ...defaults.provider, ...(stored.provider || {}) },
    classifier: { ...defaults.classifier, ...storedClassifier },
  });
  await syncRegisteredSites();
}

chrome.runtime.onInstalled.addListener(() => { void initialise(); });
chrome.runtime.onStartup.addListener(() => { void initialise(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.siteAccess || changes.disabledSites)) void syncRegisteredSites();
});
chrome.permissions.onRemoved.addListener(() => { void syncRegisteredSites(); });

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "clear-ai-cache") {
    for (const controller of activeRequests.values()) controller.abort();
    activeRequests.clear();
    analysisCache.clear();
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "register-site" || message?.type === "unregister-site") {
    const operation = message.type === "register-site" ? registerSite(message.hostname) : unregisterSite(message.hostname);
    operation.then((hostname) => sendResponse({ ok: true, hostname })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Site permission update failed." }));
    return true;
  }
  if (message?.type === "list-permissions") {
    chrome.permissions.getAll((permissions) => sendResponse({ ok: true, origins: permissions.origins || [] }));
    return true;
  }
  if (message?.type !== "analyse") return false;
  const key = `${sender.tab?.id || "unknown"}:${sender.frameId || 0}`;
  activeRequests.get(key)?.abort();
  const controller = new AbortController();
  activeRequests.set(key, controller);
  (async () => {
    try {
      const stored = await storageGet(["aiEnabled", "provider", "classifier"]);
      const text = String(message.text || "");
      if (!stored.aiEnabled || !stored.provider?.apiKey) { sendResponse({ requestId: message.requestId, issues: null }); return; }
      if (!text.trim()) { sendResponse({ requestId: message.requestId, issues: null }); return; }
      let providerOrigin;
      try {
        providerOrigin = globalThis.DraftwisePermissions.providerPattern(stored.provider.baseUrl);
      } catch (error) {
        sendResponse({ requestId: message.requestId, issues: null, error: error instanceof Error ? error.message : "Invalid provider URL." });
        return;
      }
      if (!await permissionsContains({ origins: [providerOrigin] })) {
        sendResponse({ requestId: message.requestId, issues: null, error: "Grant provider access in Draftwise settings before enabling AI." });
        return;
      }
      // Classifier origin requires a separate grant. classifier.dev itself is keyless;
      // a workspace key is only an optional limit/identity credential.
      const classifier = stored.classifier && stored.classifier.baseUrl ? stored.classifier : null;
      if (classifier) {
        let classifierOrigin;
        try {
          classifierOrigin = globalThis.DraftwisePermissions.providerPattern(classifier.baseUrl);
        } catch (error) {
          sendResponse({ requestId: message.requestId, issues: null, error: error instanceof Error ? error.message : "Invalid classifier URL." });
          return;
        }
        if (!await permissionsContains({ origins: [classifierOrigin] })) {
          sendResponse({ requestId: message.requestId, issues: null, error: "Grant classifier access in Draftwise settings before enabling AI triage." });
          return;
        }
      }
      const cacheKey = JSON.stringify({
        text,
        goals: message.goals,
        style: message.style,
        range: message.changedRange,
        settings: settingsFingerprint({
          engineVersion: "analysis-engine-v4",
          provider: {
            provider: stored.provider.provider,
            baseUrl: stored.provider.baseUrl,
            model: stored.provider.model,
            temperature: stored.provider.temperature,
            maxTokens: stored.provider.maxTokens,
            customHeaders: safeCustomHeadersFingerprint(stored.provider.customHeaders),
            providerConcurrency: 3,
            maxAiChunks: 10,
            maxAiChars: 50000,
          },
          classifier: classifier
            ? {
                baseUrl: classifier.baseUrl,
                timeoutMs: classifier.timeoutMs || 8000,
                maxExcerptChars: classifier.maxExcerptChars || 500,
                credentialConfigured: Boolean(classifier.apiKey),
                labelFormulationId: "semantic-v2",
                uncertainPolicy: classifier.uncertainPolicy || "provider",
              }
            : null,
          triagePolicy: classifier?.uncertainPolicy || "provider",
          classifierBatchSize: 100,
        }),
      });
      const cached = analysisCache.get(cacheKey);
      if (cached) {
        if (!controller.signal.aborted) sendResponse({ requestId: message.requestId, issues: cached.issues, triage: cached.triage, aiCoverage: cached.aiCoverage || null });
        return;
      }
      const triageFn = globalThis.DraftwiseProvider.analyzeWithTriage || globalThis.DraftwiseProvider.analyzeWithProvider;
      const result = await triageFn(
        text,
        message.goals || { audience: "general", intent: "inform", tone: "professional" },
        stored.provider,
        { signal: controller.signal, preferences: message.style, changedRange: message.changedRange, classifier, triageEnabled: true, uncertainPolicy: classifier?.uncertainPolicy === "local" ? "local" : "provider", labelFormulationId: "semantic-v2", classifierBatchSize: 100, providerConcurrency: 3, maxAiChunks: 10, maxAiChars: 50000 },
      );
      if (!controller.signal.aborted) {
        analysisCache.set(cacheKey, { issues: result.issues, triage: result.triage || null, aiCoverage: result.aiCoverage || null });
        while (analysisCache.size > ANALYSIS_CACHE_LIMIT) analysisCache.delete(analysisCache.keys().next().value);
        sendResponse({ requestId: message.requestId, issues: result.issues, triage: result.triage || null, aiCoverage: result.aiCoverage || null });
      }
    } catch (error) {
      if (!controller.signal.aborted) sendResponse({ requestId: message.requestId, issues: null, error: error instanceof Error ? error.message : "AI analysis failed." });
    } finally {
      if (activeRequests.get(key) === controller) activeRequests.delete(key);
    }
  })();
  return true;
});
