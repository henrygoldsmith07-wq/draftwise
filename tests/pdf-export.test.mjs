import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Capture the HTML the print iframe receives, with a minimal DOM stand-in.
 * exportAsPDF only needs createElement, body.appendChild and a writable
 * contentDocument; the stub keeps the test in Node without a browser.
 */
async function capturePrintHtml(title, draft) {
  let written = '';
  const contentDocument = {
    open() {},
    write(value) { written = value; },
    close() {},
  };
  const iframe = {
    id: '',
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
    const { exportAsPDF } = await import('../lib/export-pdf.ts');
    await exportAsPDF(title, draft);
  } finally {
    // Fire the browser's load event so the component clears its fallback timer
    // instead of leaving the test process waiting on a ten-second timeout.
    iframe.onload?.();
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
  return written;
}

test('PDF export escapes the document title before placing it in the HTML head', async () => {
  const html = await capturePrintHtml('</title><script>alert(1)</script>', 'a normal draft');

  assert.ok(!html.includes('</title><script>'), 'raw closing tag and script must not reach the iframe');
  assert.ok(html.includes('<title>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>'));
  assert.ok(html.includes('<h1>&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;</h1>'));
});

test('PDF export escapes draft text so pasted markup cannot become HTML', async () => {
  const html = await capturePrintHtml('Safe title', '<img src=x onerror="alert(1)">');

  assert.ok(!html.includes('<img src=x onerror='));
  assert.ok(html.includes('&lt;img src=x onerror='));
});

test('PDF export removes the hidden iframe when the print document cannot be opened', async () => {
  let removed = false;
  const iframe = {
    id: '',
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
    const { exportAsPDF } = await import('../lib/export-pdf.ts');
    await assert.rejects(
      () => exportAsPDF('Title', 'draft'),
      /Unable to access the print iframe document/,
    );
    assert.equal(removed, true, 'the hidden iframe must not be left behind on failure');
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});
