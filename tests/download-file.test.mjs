import assert from "node:assert/strict";
import test from "node:test";

/**
 * A download starts asynchronously in the browser. Revoking the blob URL in
 * the same task as click() can cancel it before the browser has read the blob,
 * so the URL must be released on the next task.
 */
test("downloadFile keeps the blob URL alive until the download has started", async () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const anchor = { href: "", download: "", click() {}, remove() {} };
  const appended = [];
  const revoked = [];
  globalThis.document = {
    createElement: () => anchor,
    body: { appendChild: (node) => appended.push(node) },
  };
  URL.createObjectURL = () => "blob:draftwise-test";
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const { downloadFile } = await import("../lib/import-export.ts");
    downloadFile({ filename: "draft.txt", content: "hello", type: "text/plain" });

    assert.equal(anchor.download, "draft.txt");
    assert.equal(anchor.href, "blob:draftwise-test");
    assert.deepEqual(appended, [anchor]);
    assert.deepEqual(revoked, [], "must not revoke synchronously after click()");

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(revoked, ["blob:draftwise-test"], "the URL is released afterwards");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
