const get = (id) => document.getElementById(id);
const permissionsApi = globalThis.DraftwisePermissions;

const defaults = {
  aiEnabled: false,
  provider: { provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "", temperature: 0.2, maxTokens: 900, customHeaders: "" },
  classifier: { baseUrl: "https://classifier.dev", apiKey: "", uncertainPolicy: "provider", timeoutMs: 8000, maxExcerptChars: 500 },
  style: { dialect: "en-GB", names: [], allowContractions: true, passiveVoiceSensitivity: "normal" },
  excludedSites: [],
  disabledSites: [],
  siteAccess: [],
};

function setStatus(message, error = false) {
  const element = get("status");
  element.textContent = message;
  element.style.color = error ? "#b34f5b" : "#619171";
  if (message) window.setTimeout(() => { if (element.textContent === message) element.textContent = ""; }, 3200);
}

function setToggle(id, value) { get(id).setAttribute("aria-checked", String(Boolean(value))); }
function toggleValue(id) { return get(id).getAttribute("aria-checked") === "true"; }
function storageGet(keys) { return new Promise((resolve) => chrome.storage.local.get(keys, resolve)); }
function storageSet(value) { return new Promise((resolve) => chrome.storage.local.set(value, resolve)); }
function permissionRequest(value) { return new Promise((resolve) => chrome.permissions.request(value, resolve)); }
function permissionRemove(value) { return new Promise((resolve) => chrome.permissions.remove(value, resolve)); }
function permissionContains(value) { return new Promise((resolve) => chrome.permissions.contains(value, resolve)); }
function backgroundMessage(value) { return new Promise((resolve) => chrome.runtime.sendMessage(value, resolve)); }

async function readState() {
  const stored = await storageGet(Object.keys(defaults));
  const storedClassifier = { ...(stored.classifier || {}) };
  delete storedClassifier.model;
  return {
    ...defaults,
    ...stored,
    provider: { ...defaults.provider, ...(stored.provider || {}) },
    classifier: { ...defaults.classifier, ...storedClassifier },
    style: { ...defaults.style, ...(stored.style || {}) },
    excludedSites: Array.isArray(stored.excludedSites) ? stored.excludedSites : [],
    disabledSites: Array.isArray(stored.disabledSites) ? stored.disabledSites : [],
    siteAccess: Array.isArray(stored.siteAccess) ? stored.siteAccess : [],
  };
}

function providerPattern() {
  return permissionsApi.providerPattern(get("baseUrl").value.trim());
}

function classifierPattern() {
  return permissionsApi.providerPattern(get("classifierBaseUrl").value.trim());
}

async function renderProviderPermission() {
  const status = get("providerAccessStatus");
  const label = get("providerOriginLabel");
  try {
    const pattern = providerPattern();
    const granted = await permissionContains({ origins: [pattern] });
    status.textContent = granted ? "Granted" : "Not granted";
    status.style.color = granted ? "#619171" : "#a36b4e";
    label.textContent = `Service worker access: ${pattern.replace(/\/\*$/u, "")}`;
  } catch (error) {
    status.textContent = "Invalid provider URL";
    status.style.color = "#b34f5b";
    label.textContent = error instanceof Error ? error.message : "Enter a valid HTTPS provider URL.";
  }
}

function createPermissionButton(label, action, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = className;
  button.addEventListener("click", action);
  return button;
}

async function renderClassifierPermission() {
  const status = get("classifierAccessStatus");
  const label = get("classifierOriginLabel");
  if (!status || !label) return;
  try {
    const pattern = classifierPattern();
    const granted = await permissionContains({ origins: [pattern] });
    status.textContent = granted ? "Granted" : "Not granted";
    status.style.color = granted ? "#619171" : "#a36b4e";
    label.textContent = `Classifier worker access: ${pattern.replace(/\/\*$/u, "")} (decision only, never rewrites)`;
  } catch (error) {
    status.textContent = "Invalid classifier URL";
    status.style.color = "#b34f5b";
    label.textContent = error instanceof Error ? error.message : "Enter a valid HTTPS classifier URL.";
  }
}

async function renderSitePermissions() {
  const state = await readState();
  const container = get("sitePermissions");
  while (container.firstChild) container.removeChild(container.firstChild);
  if (!state.siteAccess.length) {
    const empty = document.createElement("span"); empty.className = "hint"; empty.textContent = "No site access granted yet."; container.append(empty); return;
  }
  for (const site of state.siteAccess) {
    const row = document.createElement("div"); row.className = "permission-item";
    const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = site; copy.append(name);
    const status = document.createElement("small"); status.textContent = state.disabledSites.includes(site) ? "Disabled in Draftwise" : "Enabled"; copy.append(document.createElement("br"), status);
    const actions = document.createElement("div");
    if (state.disabledSites.includes(site)) {
      actions.append(createPermissionButton("Enable", async () => { await storageSet({ disabledSites: state.disabledSites.filter((item) => item !== site) }); await backgroundMessage({ type: "register-site", hostname: site }); await renderSitePermissions(); setStatus(`Enabled on ${site}`); }));
    } else {
      actions.append(createPermissionButton("Disable", async () => { await storageSet({ disabledSites: [...new Set([...state.disabledSites, site])] }); await backgroundMessage({ type: "unregister-site", hostname: site }); await renderSitePermissions(); setStatus(`Disabled on ${site}`); }));
    }
    actions.append(createPermissionButton("Revoke", async () => {
      const removed = await permissionRemove({ origins: permissionsApi.sitePatterns(site) });
      if (!removed) { setStatus(`Could not revoke ${site}.`, true); return; }
      await storageSet({ siteAccess: state.siteAccess.filter((item) => item !== site), disabledSites: state.disabledSites.filter((item) => item !== site) });
      await backgroundMessage({ type: "unregister-site", hostname: site });
      await renderSitePermissions(); setStatus(`Access revoked for ${site}`);
    }, "danger"));
    row.append(copy, actions); container.append(row);
  }
}

async function saveSettings() {
  const baseUrl = get("baseUrl").value.trim().replace(/\/$/u, "");
  let providerPatternValue;
  try {
    new URL(baseUrl);
    providerPatternValue = permissionsApi.providerPattern(baseUrl);
  } catch (error) { setStatus(error instanceof Error ? error.message : "Enter a valid HTTPS provider URL.", true); return; }
  const classifierBaseUrlEl = get("classifierBaseUrl");
  const classifierKeyEl = get("classifierKey");
  const classifierBaseUrl = classifierBaseUrlEl ? classifierBaseUrlEl.value.trim().replace(/\/$/u, "") : "";
  const classifierKey = classifierKeyEl ? classifierKeyEl.value.trim() : "";
  const uncertainPolicy = get("uncertainPolicy")?.value === "local" ? "local" : "provider";
  if (classifierBaseUrl) { try { permissionsApi.providerPattern(classifierBaseUrl); } catch (error) { setStatus(error instanceof Error ? error.message : "Enter a valid HTTPS classifier URL.", true); return; } }
  const model = get("model").value.trim();
  if (!model || model.length > 200 || /[\u0000-\u001f]/u.test(model)) { setStatus("Enter a valid model ID.", true); return; }
  const state = await readState();
  const excludedSites = get("excludedSites").value.split(/\n|,/u).map((site) => site.trim().toLowerCase().replace(/^https?:\/\//u, "").replace(/\/.*$/u, "")).filter((site) => /^[a-z0-9.-]+$/u.test(site));
  await storageSet({
    aiEnabled: toggleValue("aiEnabled"),
    provider: { ...state.provider, provider: "openai-compatible", baseUrl, model, apiKey: get("apiKey").value.trim(), temperature: 0.2, maxTokens: 900, customHeaders: "" },
    classifier: { ...state.classifier, baseUrl: classifierBaseUrl || state.classifier.baseUrl, apiKey: classifierKey, uncertainPolicy },
    style: { ...state.style, dialect: get("dialect").value, allowContractions: toggleValue("allowContractions"), passiveVoiceSensitivity: get("passiveSensitivity").value },
    excludedSites: [...new Set(excludedSites)],
  });
  await renderProviderPermission();
  await renderClassifierPermission();
  setStatus(`Saved locally. Provider origin: ${providerPatternValue.replace(/\/\*$/u, "")}`);
}

async function grantProviderAccess() {
  try {
    const pattern = providerPattern();
    const granted = await permissionRequest({ origins: [pattern] });
    if (!granted) { setStatus("Provider access was not granted.", true); return; }
    await renderProviderPermission(); setStatus("Provider access granted.");
  } catch (error) { setStatus(error instanceof Error ? error.message : "Provider access could not be granted.", true); }
}

async function revokeProviderAccess() {
  try {
    const pattern = providerPattern();
    const removed = await permissionRemove({ origins: [pattern] });
    await renderProviderPermission(); setStatus(removed ? "Provider access revoked." : "Provider access was not revoked.", !removed);
  } catch (error) { setStatus(error instanceof Error ? error.message : "Provider access could not be revoked.", true); }
}

async function grantClassifierAccess() {
  try {
    const pattern = classifierPattern();
    const granted = await permissionRequest({ origins: [pattern] });
    if (!granted) { setStatus("Classifier access was not granted.", true); return; }
    await renderClassifierPermission(); setStatus("Classifier access granted.");
  } catch (error) { setStatus(error instanceof Error ? error.message : "Classifier access could not be granted.", true); }
}

async function revokeClassifierAccess() {
  try {
    const pattern = classifierPattern();
    const removed = await permissionRemove({ origins: [pattern] });
    await renderClassifierPermission(); setStatus(removed ? "Classifier access revoked." : "Classifier access was not revoked.", !removed);
  } catch (error) { setStatus(error instanceof Error ? error.message : "Classifier access could not be revoked.", true); }
}

async function grantSiteAccess() {
  let hostname;
  try { hostname = permissionsApi.normaliseHostname(get("siteAccess").value); } catch (error) { setStatus(error instanceof Error ? error.message : "Enter a valid hostname.", true); return; }
  const granted = await permissionRequest({ origins: permissionsApi.sitePatterns(hostname) });
  if (!granted) { setStatus(`Access was not granted for ${hostname}.`, true); return; }
  const state = await readState();
  await storageSet({ siteAccess: [...new Set([...state.siteAccess, hostname])], disabledSites: state.disabledSites.filter((site) => site !== hostname) });
  const registered = await backgroundMessage({ type: "register-site", hostname });
  if (!registered?.ok) { setStatus(registered?.error || `Could not enable ${hostname}.`, true); return; }
  get("siteAccess").value = ""; await renderSitePermissions(); setStatus(`Draftwise enabled on ${hostname}`);
}

async function load() {
  const state = await readState();
  const provider = state.provider; const style = state.style;
  setToggle("aiEnabled", state.aiEnabled); setToggle("allowContractions", style.allowContractions);
  get("baseUrl").value = provider.baseUrl; get("model").value = provider.model; get("apiKey").value = provider.apiKey;
  const classifier = state.classifier;
  if (get("classifierBaseUrl")) get("classifierBaseUrl").value = classifier.baseUrl;
  if (get("classifierKey")) get("classifierKey").value = classifier.apiKey || "";
  if (get("uncertainPolicy")) get("uncertainPolicy").value = classifier.uncertainPolicy === "local" ? "local" : "provider";
  get("dialect").value = style.dialect; get("passiveSensitivity").value = style.passiveVoiceSensitivity; get("excludedSites").value = state.excludedSites.join("\n");
  await renderProviderPermission(); await renderClassifierPermission(); await renderSitePermissions();
}

get("aiEnabled").addEventListener("click", () => setToggle("aiEnabled", !toggleValue("aiEnabled")));
get("allowContractions").addEventListener("click", () => setToggle("allowContractions", !toggleValue("allowContractions")));
get("baseUrl").addEventListener("input", () => { void renderProviderPermission(); });
get("save").addEventListener("click", () => { void saveSettings(); });
get("grantProviderAccess").addEventListener("click", () => { void grantProviderAccess(); });
if (get("grantClassifierAccess")) get("grantClassifierAccess").addEventListener("click", () => { void grantClassifierAccess(); });
if (get("revokeClassifierAccess")) get("revokeClassifierAccess").addEventListener("click", () => { void revokeClassifierAccess(); });
if (get("classifierBaseUrl")) get("classifierBaseUrl").addEventListener("input", () => { void renderClassifierPermission(); });
get("revokeProviderAccess").addEventListener("click", () => { void revokeProviderAccess(); });
get("grantAccess").addEventListener("click", () => { void grantSiteAccess(); });
get("forgetKey").addEventListener("click", async () => {
  const state = await readState();
  await backgroundMessage({ type: "clear-ai-cache" });
  await storageSet({ provider: { ...state.provider, apiKey: "" }, classifier: { ...state.classifier, apiKey: "" }, aiEnabled: false });
  get("apiKey").value = "";
  if (get("classifierKey")) get("classifierKey").value = "";
  setToggle("aiEnabled", false);
  setStatus("Cloud credentials forgotten");
});
get("clearData").addEventListener("click", async () => {
  if (!window.confirm("Clear Draftwise extension settings and the stored API key?")) return;
  const state = await readState();
  await backgroundMessage({ type: "clear-ai-cache" });
  for (const site of state.siteAccess) await permissionRemove({ origins: permissionsApi.sitePatterns(site) });
  try { await permissionRemove({ origins: [permissionsApi.providerPattern(state.provider.baseUrl)] }); } catch { /* already invalid or revoked */ }
  try { await permissionRemove({ origins: [permissionsApi.providerPattern(state.classifier.baseUrl)] }); } catch { /* already invalid or revoked */ }
  await new Promise((resolve) => chrome.storage.local.clear(resolve));
  await load(); setStatus("Local extension data cleared");
});

void load();
