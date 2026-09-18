const get = (id) => document.getElementById(id);

const defaults = {
  aiEnabled: false,
  provider: { provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: "", temperature: 0.2, maxTokens: 900, customHeaders: "" },
  style: { dialect: "en-GB", allowContractions: true, passiveVoiceSensitivity: "normal" },
  excludedSites: [],
};

function setStatus(message, error = false) {
  const element = get("status"); element.textContent = message; element.style.color = error ? "#b34f5b" : "#619171";
  if (message) window.setTimeout(() => { element.textContent = ""; }, 2400);
}

function setToggle(id, value) {
  get(id).setAttribute("aria-checked", String(Boolean(value)));
}

function toggleValue(id) { return get(id).getAttribute("aria-checked") === "true"; }

get("aiEnabled").addEventListener("click", () => setToggle("aiEnabled", !toggleValue("aiEnabled")));
get("allowContractions").addEventListener("click", () => setToggle("allowContractions", !toggleValue("allowContractions")));

chrome.storage.local.get(["aiEnabled", "provider", "style", "excludedSites"], (stored) => {
  const provider = { ...defaults.provider, ...(stored.provider || {}) };
  const style = { ...defaults.style, ...(stored.style || {}) };
  setToggle("aiEnabled", stored.aiEnabled ?? defaults.aiEnabled);
  setToggle("allowContractions", style.allowContractions);
  get("baseUrl").value = provider.baseUrl;
  get("model").value = provider.model;
  get("apiKey").value = provider.apiKey;
  get("dialect").value = style.dialect;
  get("passiveSensitivity").value = style.passiveVoiceSensitivity;
  get("excludedSites").value = Array.isArray(stored.excludedSites) ? stored.excludedSites.join("\n") : "";
});

get("save").addEventListener("click", () => {
  const baseUrl = get("baseUrl").value.trim().replace(/\/$/u, "");
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) throw new Error("Use HTTPS, except for localhost.");
  } catch (error) { setStatus(error instanceof Error ? error.message : "Enter a valid HTTPS provider URL.", true); return; }
  const excludedSites = get("excludedSites").value.split(/\n|,/u).map((site) => site.trim().toLowerCase().replace(/^https?:\/\//u, "").replace(/\/.*$/u, "")).filter((site) => /^[a-z0-9.-]+$/u.test(site));
  chrome.storage.local.set({
    aiEnabled: toggleValue("aiEnabled"),
    provider: { provider: "openai-compatible", baseUrl, model: get("model").value.trim(), apiKey: get("apiKey").value.trim(), temperature: 0.2, maxTokens: 900, customHeaders: "" },
    style: { dialect: get("dialect").value, allowContractions: toggleValue("allowContractions"), passiveVoiceSensitivity: get("passiveSensitivity").value },
    excludedSites: [...new Set(excludedSites)],
  }, () => setStatus("Saved locally"));
});

get("forgetKey").addEventListener("click", () => chrome.storage.local.set({ provider: { ...defaults.provider } }, () => { get("apiKey").value = ""; setToggle("aiEnabled", false); chrome.storage.local.set({ aiEnabled: false }); setStatus("Key forgotten"); }));

get("clearData").addEventListener("click", () => {
  if (!window.confirm("Clear Draftwise extension settings and the stored API key?")) return;
  chrome.storage.local.clear(() => { setToggle("aiEnabled", false); setToggle("allowContractions", true); get("apiKey").value = ""; get("excludedSites").value = ""; setStatus("Local extension data cleared"); });
});

get("grantAccess").addEventListener("click", () => {
  const host = get("siteAccess").value.trim().toLowerCase().replace(/^https?:\/\//u, "").replace(/\/.*$/u, "");
  if (!/^[a-z0-9.-]+$/u.test(host)) { setStatus("Enter a hostname such as example.com.", true); return; }
  chrome.permissions.request({ origins: [`https://${host}/*`, `http://${host}/*`] }, (granted) => setStatus(granted ? `Access granted for ${host}` : "Access was not granted.", !granted));
});
