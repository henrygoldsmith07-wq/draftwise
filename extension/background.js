chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["excludedSites", "disabledSites", "aiEnabled"], (settings) => {
    const defaults = {};
    if (!Array.isArray(settings.excludedSites)) defaults.excludedSites = [];
    if (!Array.isArray(settings.disabledSites)) defaults.disabledSites = [];
    if (typeof settings.aiEnabled !== "boolean") defaults.aiEnabled = false;
    if (Object.keys(defaults).length) chrome.storage.local.set(defaults);
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
