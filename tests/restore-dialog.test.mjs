import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsUrl = new URL("../components/draftwise/ProviderSettingsDialog.tsx", import.meta.url);
const historyUrl = new URL("../components/draftwise/VersionHistoryView.tsx", import.meta.url);

/**
 * Restore is the one action in the app that can replace every document and
 * setting, so its confirmation carries real dialog semantics and predictable
 * focus. These are source assertions (the repo has no component harness):
 * they pin the a11y contract that a regression could quietly drop.
 */

test("backup restore confirmation is a focus-managed alertdialog", async () => {
  const settings = await readFile(settingsUrl, "utf8");

  // It used to be a role="alert" with four paragraphs and three buttons: no
  // dialog semantics, no focus move, no Escape, focus stranded on the file
  // input. It is now a proper alertdialog driven by the shared trap.
  assert.match(settings, /ref=\{restoreDialogRef\}\s+className="writing-profile-transfer-message"\s+role="alertdialog"/u);
  assert.match(settings, /aria-modal="true"\s+aria-label="Confirm backup restore"\s+tabIndex=\{-1\}/u);
  assert.doesNotMatch(settings, /className="writing-profile-transfer-message" role="alert"/u);
  assert.match(settings, /useDialogFocusTrap<HTMLDivElement>\(\s*pendingBackup !== null, closeRestoreConfirm, undefined, restoreCancelRef\)/u);
  assert.match(settings, /const closeRestoreConfirm = useCallback\(\(\) => setPendingBackup\(null\), \[\]\)/u);

  // Cancel — the least destructive action and the last button — is named as
  // the initial focus, rather than the first (Replace/Merge) button.
  assert.match(settings, /ref=\{restoreCancelRef\}[^>]*>Cancel<\/Button>/u);
  for (const action of ["Merge into library", "Replace everything", "Cancel"]) {
    assert.ok(settings.includes(action), `the confirmation should keep the ${action} action`);
  }
});

test("an untrusted exportedAt date is bounded before it is displayed", async () => {
  const settings = await readFile(settingsUrl, "utf8");
  assert.doesNotMatch(settings, /\{pendingBackup\.backup\.exportedAt\}/u);
  assert.match(settings, /\{displayBackupDate\(pendingBackup\.backup\.exportedAt\)\}/u);
  assert.match(settings, /const MAX_EXPORTED_AT_LENGTH = 40;/u);
  assert.match(settings, /raw\.slice\(0, MAX_EXPORTED_AT_LENGTH\)/u);
});

test("settings status messages live in always-mounted regions", async () => {
  const settings = await readFile(settingsUrl, "utf8");

  // A region mounted together with its first message is frequently missed by
  // screen readers. Each container now exists from the first render and only
  // its text changes — the same contract as the toast live region.
  assert.match(settings, /<span role="status" aria-live="polite" className=\{connectionTest[^\n]*\{connectionTest\?\.message \?\? ""\}<\/span>/u);
  assert.doesNotMatch(settings, /connectionTest \? <span role="status"/u);

  assert.match(settings, /<p className="writing-profile-transfer-message" role="status" aria-live="polite">\{transferMessage \?\? ""\}<\/p>/u);
  assert.doesNotMatch(settings, /\{transferMessage \? <p/u);

  assert.match(settings, /<p className="writing-profile-transfer-message" role="status" aria-live="polite">\{backupMessage \?\? ""\}<\/p>/u);
  assert.doesNotMatch(settings, /\{backupMessage \? <p/u);

  // The save-error box stays mounted and empty (collapsed visually) so its
  // assertive region is already in the accessibility tree when text arrives.
  assert.match(settings, /<span role="alert" aria-live="assertive">\{saveError \?\? ""\}<\/span>/u);
  assert.match(settings, /className="settings-save-error"/u);
  assert.match(settings, /style=\{saveError \? undefined : \{ height: 0, padding: 0, borderWidth: 0, margin: 0, overflow: "hidden" \}\}/u);
  assert.doesNotMatch(settings, /\{saveError \? \(\s*<div className="settings-save-error"/u);
});

test("version restore inline confirmation focuses Cancel and closes on Escape", async () => {
  const history = await readFile(historyUrl, "utf8");

  assert.match(history, /function useRestoreConfirmFocus\(onCancel: \(\) => void\)/u);
  assert.match(history, /cancelRef\.current\?\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(history, /event\.key !== "Escape"/u);
  assert.match(history, /onCancelRef\.current\(\);/u);
  assert.match(history, /document\.addEventListener\("keydown", onKeyDown, true\)/u);

  // A labelled group with a screen-reader prompt explains the choice, and
  // Cancel is the focused action in both the list and the preview.
  assert.match(history, /role="group" aria-label="Confirm restore"/u);
  assert.match(history, /<span className="sr-only">Restore this version\?/u);
  assert.match(history, /ref=\{cancelRef\}[^>]*>Cancel<\/Button>/u);
  assert.equal((history.match(/<RestoreConfirmActions/gu) ?? []).length, 2);

  // One Escape must not dismiss both the inline confirmation and the preview.
  assert.match(history, /const previewTrapOpen = preview !== null && confirmRestoreId === null;/u);
  assert.match(history, /useDialogFocusTrap<HTMLDivElement>\(previewTrapOpen, closePreview\)/u);
});
