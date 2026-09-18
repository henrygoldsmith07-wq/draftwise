const get = (id) => document.getElementById(id);

function setToggle(value) {
  const element = get("aiEnabled");
  element.setAttribute("aria-checked", String(Boolean(value)));
}

get("aiEnabled").addEventListener("click", () => setToggle(get("aiEnabled").getAttribute("aria-checked") !== "true"));

chrome.storage.local.get(["aiEnabled", "baseUrl", "model", "apiKey", "excludedSites"], (settings) => {
  setToggle(settings.aiEnabled);
  get("baseUrl").value = settings.baseUrl || "https://api.openai.com/v1";
  get("model").value = settings.model || "gpt-4o-mini";
  get("apiKey").value = settings.apiKey || "";
  get("excludedSites").value = Array.isArray(settings.excludedSites) ? settings.excludedSites.join("\n") : "";
});

get("save").addEventListener("click", () => {
  const settings = {
    aiEnabled: get("aiEnabled").getAttribute("aria-checked") === "true",
    baseUrl: get("baseUrl").value.trim().replace(/\/$/, ""),
    model: get("model").value.trim(),
    apiKey: get("apiKey").value.trim(),
    excludedSites: get("excludedSites").value.split(/\n|,/).map((site) => site.trim().toLowerCase()).filter(Boolean),
  };
  chrome.storage.local.set(settings, () => {
    get("status").textContent = "Saved locally";
    window.setTimeout(() => { get("status").textContent = ""; }, 1800);
  });
});
