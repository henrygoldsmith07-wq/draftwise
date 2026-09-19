(function () {
  "use strict";

  const EDITABLE_SELECTOR = 'textarea, input, [contenteditable="true"]';
  const BLOCK_TAGS = new Set([
    "address", "article", "aside", "blockquote", "div", "dl", "dt", "dd", "fieldset", "figcaption", "figure", "footer", "form",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
  ]);

  function nodeName(node) {
    return String(node?.tagName || node?.nodeName || "").toLowerCase();
  }

  function childrenOf(node) {
    return Array.from(node?.childNodes || []);
  }

  function isElement(node) {
    return Boolean(node && (node.nodeType === 1 || node.tagName));
  }

  function isBlock(node) {
    return BLOCK_TAGS.has(nodeName(node));
  }

  function point(node, offset) {
    return { node, offset };
  }

  function buildEditableTextMap(element) {
    let text = "";
    const startPoints = [];
    const endPoints = [];
    const breakKinds = [];

    function appendTextNode(node) {
      const value = String(node.textContent || "");
      if (!value) return;
      const start = text.length;
      startPoints[start] = point(node, 0);
      if (!endPoints[start]) endPoints[start] = point(node, 0);
      text += value;
      for (let index = 1; index <= value.length; index += 1) {
        startPoints[start + index] = point(node, index);
        endPoints[start + index] = point(node, index);
      }
    }

    function appendBreak(before, after, kind) {
      if (text.endsWith("\n")) {
        startPoints[text.length] = after;
        endPoints[text.length] = after;
        return;
      }
      const start = text.length;
      startPoints[start] = before;
      if (!endPoints[start]) endPoints[start] = before;
      text += "\n";
      startPoints[start + 1] = after;
      endPoints[start + 1] = after;
      breakKinds.push(kind);
    }

    function pointAfterNode(node) {
      const parent = node?.parentNode || element;
      const siblings = childrenOf(parent);
      const index = siblings.indexOf(node);
      return point(parent, index >= 0 ? index + 1 : siblings.length);
    }

    function pointBeforeNode(node) {
      const parent = node?.parentNode || element;
      const siblings = childrenOf(parent);
      const index = siblings.indexOf(node);
      return point(parent, Math.max(0, index));
    }

    function walk(node, isRoot = false) {
      if (!node) return;
      if (node.nodeType === 3 || (!isElement(node) && typeof node.textContent === "string" && !childrenOf(node).length)) {
        appendTextNode(node);
        return;
      }
      const name = nodeName(node);
      if (name === "br") {
        appendBreak(pointBeforeNode(node), pointAfterNode(node), "br");
        return;
      }
      const block = isBlock(node);
      for (const child of childrenOf(node)) walk(child);
      if (block && !isRoot && text && !text.endsWith("\n")) appendBreak(pointAfterNode(node), pointAfterNode(node), "block");
    }

    walk(element, true);
    while (text.endsWith("\n") && breakKinds[breakKinds.length - 1] === "block") {
      text = text.slice(0, -1);
      breakKinds.pop();
      startPoints.length = text.length + 1;
      endPoints.length = text.length + 1;
    }
    const fallbackStart = point(element, 0);
    const fallbackEnd = point(element, childrenOf(element).length);
    return {
      text,
      points: startPoints,
      rangeFor(start, end) {
        if (!globalThis.document?.createRange) return null;
        const safeStart = Math.max(0, Math.min(text.length, Number.isFinite(start) ? start : 0));
        const safeEnd = Math.max(safeStart, Math.min(text.length, Number.isFinite(end) ? end : safeStart));
        const from = (safeStart === safeEnd ? endPoints[safeStart] : startPoints[safeStart]) || fallbackStart;
        const to = endPoints[safeEnd] || fallbackEnd;
        const range = globalThis.document.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        return range;
      },
    };
  }

  function bindEditableSubtree(root, bind) {
    if (!root || typeof bind !== "function") return;
    if (typeof root.matches === "function" && root.matches(EDITABLE_SELECTOR)) bind(root);
    if (typeof root.querySelectorAll === "function") root.querySelectorAll(EDITABLE_SELECTOR).forEach(bind);
  }

  function handleAddedNodes(records, bind) {
    for (const record of records || []) {
      if (record?.type !== "childList") continue;
      for (const node of record.addedNodes || []) bindEditableSubtree(node, bind);
    }
  }

  globalThis.DraftwiseDom = { EDITABLE_SELECTOR, bindEditableSubtree, buildEditableTextMap, handleAddedNodes };
})();
