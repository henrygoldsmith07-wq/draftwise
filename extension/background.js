importScripts("shared-provider.js");

const activeRequests = new Map();

function changedRange(previous, next) {
  if (previous === next) return null;
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
  let previousEnd = previous.length;
  let end = next.length;
  while (previousEnd > start && end > start && previous[previousEnd - 1] === next[end - 1]) { previousEnd -= 1; end -= 1; }
  return { start, end, previousEnd };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["excludedSites", "disabledSites", "disabledFields", "aiEnabled", "provider", "apiKey", "baseUrl", "model"], (stored) => {
    const provider = stored.provider || {
      provider: "openai-compatible",
      baseUrl: stored.baseUrl || "https://api.openai.com/v1",
      model: stored.model || "gpt-4o-mini",
      apiKey: stored.apiKey || "",
      temperature: 0.2,
      maxTokens: 900,
      customHeaders: "",
    };
    chrome.storage.local.set({
      excludedSites: Array.isArray(stored.excludedSites) ? stored.excludedSites : [],
      disabledSites: Array.isArray(stored.disabledSites) ? stored.disabledSites : [],
      disabledFields: Array.isArray(stored.disabledFields) ? stored.disabledFields : [],
      aiEnabled: typeof stored.aiEnabled === "boolean" ? stored.aiEnabled : false,
      provider,
    });
  });
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "analyse") return false;
  const key = `${sender.tab?.id || "unknown"}:${sender.frameId || 0}`;
  activeRequests.get(key)?.abort();
  const controller = new AbortController();
  activeRequests.set(key, controller);
  chrome.storage.local.get(["aiEnabled", "provider"], async (stored) => {
    try {
      if (!stored.aiEnabled || !stored.provider?.apiKey) { sendResponse({ requestId: message.requestId, issues: null }); return; }
      const result = await globalThis.DraftwiseProvider.analyzeWithProvider(
        String(message.text || ""),
        message.goals || { audience: "general", intent: "inform", tone: "professional" },
        stored.provider,
        { signal: controller.signal, preferences: message.style, changedRange: changedRange(String(message.previousText || ""), String(message.text || "")) },
      );
      if (!controller.signal.aborted) sendResponse({ requestId: message.requestId, issues: result.issues });
    } catch (error) {
      if (!controller.signal.aborted) sendResponse({ requestId: message.requestId, issues: null, error: error instanceof Error ? error.message : "AI analysis failed" });
    } finally {
      if (activeRequests.get(key) === controller) activeRequests.delete(key);
    }
  });
  return true;
});
