/**
 * The toolbar popup.
 *
 * This is the extension's front door. Before it existed, clicking the
 * toolbar icon opened the options page in a new tab, which took the writer
 * away from what they were writing to show them a settings form. Every
 * assistant in this category opens a small panel instead, showing what it
 * has found in the field the writer is in.
 *
 * The findings live in the content script, in the page, where the text is.
 * So the popup asks for them rather than working them out for itself: it
 * sends a question to the tab, the content script answers with the
 * suggestions it is already showing, and the popup presents them.
 *
 * Nothing here reaches outside the extension. The popup reads the findings
 * for the current field, and it never reads the field's text — the
 * suggestions it shows are the ones the writer is being shown in the page
 * anyway.
 */

const logic = globalThis.DraftwisePopupLogic;

const body = document.getElementById("body");
const countLabel = document.getElementById("count");
const sourceLabel = document.getElementById("source");
const disableSiteButton = document.getElementById("disable-site");

let activeTabId = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Say a state in words, with a heading and an explanation. */
function renderMessage(message) {
  body.replaceChildren();
  const wrapper = element("div", "dw-empty");
  wrapper.append(element("strong", "", message.title));
  wrapper.append(element("span", "", message.detail));
  body.append(wrapper);
  countLabel.textContent = "";
}

function renderFinding(finding) {
  const card = element("div", "dw-issue");

  const title = element("div", "dw-issue-title");
  const dot = element("span", "dw-dot");
  dot.style.setProperty("--dot", logic.ISSUE_COLOR[finding.category] || "#759c83");
  title.append(dot, element("span", "", finding.title));
  card.append(title);

  card.append(element("div", "dw-meta", `${finding.category} · ${finding.severity}`));
  if (finding.explanation) card.append(element("p", "dw-copy", finding.explanation));

  const fix = element("div", "dw-fix");
  fix.append(element("span", "dw-old", finding.original));
  if (finding.replacement && finding.replacement !== finding.original) {
    fix.append(element("span", "", "→"), element("span", "dw-new", finding.replacement));
    const accept = element("button", "dw-accept", "Accept");
    accept.type = "button";
    accept.addEventListener("click", () => void send("draftwise-popup-apply", { finding }));
    fix.append(accept);
  }
  const dismiss = element("button", "dw-dismiss", "×");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", `Dismiss ${finding.title}`);
  dismiss.addEventListener("click", () => void send("draftwise-popup-dismiss", { finding }));
  fix.append(dismiss);

  card.append(fix);
  return card;
}

function renderState(state) {
  body.replaceChildren();
  const findings = Array.isArray(state.findings) ? state.findings : [];
  countLabel.textContent = logic.countLabel(findings);

  if (!findings.length) {
    renderMessage(logic.cleanState(state));
    return;
  }

  for (const finding of findings) body.append(renderFinding(finding));
}

/**
 * Ask the content script something about the current tab.
 *
 * The failure here is ordinary and expected: the extension only runs on
 * sites the writer has granted, so on any other page there is no content
 * script to answer. That is not an error to report — it is the answer.
 */
async function send(type, payload) {
  if (activeTabId === null) return null;
  try {
    return await chrome.tabs.sendMessage(activeTabId, { type, ...(payload || {}) });
  } catch {
    return null;
  }
}

async function load() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    tabs = [];
  }
  const tab = tabs[0];
  if (!tab || typeof tab.id !== "number") {
    renderMessage({ title: "No page to check", detail: "Open a page with a text field and try again." });
    return;
  }
  activeTabId = tab.id;

  const state = await send("draftwise-popup-state");
  if (!state) {
    disableSiteButton.hidden = true;
    renderMessage(logic.notRunningState());
    return;
  }
  if (!state.ok) {
    disableSiteButton.hidden = true;
    renderMessage(logic.blockedState(state));
    return;
  }

  disableSiteButton.hidden = false;
  sourceLabel.textContent = state.source || "Local";
  renderState(state);
}

document.getElementById("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

disableSiteButton.addEventListener("click", async () => {
  // The popup cannot name the page: it has no permission to read the tab's
  // address, and it should not have one. The content script knows which
  // host it is running on, so it flips the switch itself.
  const result = await send("draftwise-popup-disable-site");
  if (result && result.disabled) {
    disableSiteButton.hidden = true;
    renderMessage({
      title: "Draftwise is switched off",
      detail: "Draftwise will not check this site until you turn it back on.",
    });
  }
});

void load();
