import assert from "node:assert/strict";
import test from "node:test";

/** Capture the HTML written to the print iframe, with a minimal DOM stand-in. */
async function capturePrintHtml(title, draft) {
  let written = "";
  const contentDocument = {
    open() {},
    write(value) { written = value; },
    close() {},
  };
  const iframe = {
    id: "",
    style: {},
    contentDocument,
    onload: null,
    remove() {},
  };
  const original = globalThis.document;
  globalThis.document = {
    createElement: () => iframe,
    body: { appendChild() {}, removeChild() {} },
  };
  try {
    const { exportAsPDF } = await import("../lib/export-pdf.ts");
    await exportAsPDF(title, draft);
  } finally {
    iframe.onload?.();
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
  return written;
}

test("PDF export escapes the title in the HTML head as well as the body", async () => {
  const malicious = "</title><script>alert(1)</script>";
  const html = await capturePrintHtml(malicious, "A normal draft");
  assert.doesNotMatch(html, /<\/title><script>/u, "a raw closing tag and script must never reach the iframe");
  assert.match(html, /<title>&lt;\/title&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/u);
  assert.match(html, /<h1>&lt;\/title&gt;&lt;script&gt;/u);
});

test("PDF export escapes draft text so pasted markup cannot become HTML", async () => {
  const html = await capturePrintHtml("Safe title", '<img src=x onerror="alert(1)">');
  assert.doesNotMatch(html, /<img src=x onerror=/u);
  assert.match(html, /&lt;img src=x onerror=/u);
});

test("a failed print removes the hidden iframe", async () => {
  let removed = false;
  const iframe = {
    id: "",
    style: {},
    contentDocument: null,
    contentWindow: null,
    onload: null,
    remove() { removed = true; },
  };
  const original = globalThis.document;
  globalThis.document = {
    createElement: () => iframe,
    body: { appendChild() {}, removeChild() {} },
  };
  try {
    const { exportAsPDF } = await import("../lib/export-pdf.ts");
    await assert.rejects(
      () => exportAsPDF("Title", "draft"),
      /Unable to access the print iframe document/u,
    );
    assert.equal(removed, true, "the hidden iframe must not be left behind on failure");
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});
