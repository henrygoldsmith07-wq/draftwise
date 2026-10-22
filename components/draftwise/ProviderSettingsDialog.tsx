"use client";

import { useState } from "react";
import { ChevronRight, Download, Info, ShieldCheck, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppInstallSection } from "@/components/draftwise/AppInstallSection";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { downloadFile } from "@/lib/import-export";
import { testProviderConnection } from "@/lib/ai-provider";
import { formatRelativeTime } from "@/lib/time";
import { exportProfile, importProfile } from "@/lib/profile-transfer";
import { buildBackup, oversizedBackupFile, parseBackup, readRawActivityLog, serializeBackup, type RestorableBackup } from "@/lib/backup";
import type { StoredDocument } from "@/lib/documents";
import type { ClassifierSettings, DraftwiseWorkspace, ProviderSettings, StylePreferences } from "@/packages/types/src";
import { DEFAULT_CLASSIFIER_SETTINGS } from "@/packages/types/src";

const PROVIDER_PRESETS: Array<{ value: ProviderSettings["provider"]; label: string; baseUrl: string; modelPlaceholder: string }> = [
  { value: "openai-compatible", label: "OpenAI", baseUrl: "https://api.openai.com/v1", modelPlaceholder: "gpt-4o-mini" },
  { value: "custom", label: "OpenRouter / compatible", baseUrl: "https://openrouter.ai/api/v1", modelPlaceholder: "openai/gpt-4o-mini" },
];

interface ProviderSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** App theme: the dialog portals outside .app-shell, so it carries its own scope for the dark palette. */
  theme: "dark" | "light";
  settings: ProviderSettings;
  style: StylePreferences;
  aiEnabled: boolean;
  classifier?: ClassifierSettings | null;
  onSettingsChange: (settings: ProviderSettings) => void;
  onClassifierChange?: (classifier: ClassifierSettings) => void;
  onStyleChange: (style: StylePreferences) => void;
  onAiEnabledChange: (enabled: boolean) => void;
  onForgetKeys?: () => void;
  onSave?: () => { ok: true } | { ok: false; error: string };
  onClearData: () => void;
  /** Full library for the backup export. */
  backupDocuments: StoredDocument[];
  /** Current workspace for the backup export. */
  backupWorkspace: DraftwiseWorkspace;
  /** Reads the raw activity log for the backup export; unreadable content exports as empty. */
  readBackupActivityRaw: () => string | null;
  /**
   * Restore a parsed backup. Replace swaps the whole library, settings and
   * activity, then reloads — and must not reload on failure. Merge adds the
   * backup's documents alongside the current ones, touches nothing else,
   * and reports per-document counts on success. Merge must not reload at all.
   */
  onRestoreBackup: (backup: RestorableBackup, mode: "replace" | "merge") => Promise<{ ok: true; merged?: { added: number; skipped: number; renamed: number } } | { ok: false; error: string }>;
  /** Stamps the backup reminder's last-export time after a settings export. */
  onBackupExported?: () => void;
}

export function ProviderSettingsDialog({
  open,
  onOpenChange,
  theme,
  settings,
  style,
  aiEnabled,
  classifier,
  onSettingsChange,
  onClassifierChange,
  onStyleChange,
  onAiEnabledChange,
  onForgetKeys,
  onSave,
  onClearData,
  backupDocuments,
  backupWorkspace,
  readBackupActivityRaw,
  onRestoreBackup,
  onBackupExported,
}: ProviderSettingsDialogProps) {
  const patchSettings = (patch: Partial<ProviderSettings>) => onSettingsChange({ ...settings, ...patch });
  const patchStyle = (patch: Partial<StylePreferences>) => onStyleChange({ ...style, ...patch });
  const classifierValue: ClassifierSettings = classifier ?? DEFAULT_CLASSIFIER_SETTINGS;
  const patchClassifier = (patch: Partial<ClassifierSettings>) => onClassifierChange?.({ ...classifierValue, ...patch });
  // A failed save used to just refuse to close the dialog, leaving the writer
  // clicking "Save & close" with no idea why nothing happened. The error exists
  // (useDraftPersistence returns one when hydration has not finished, and the
  // document store returns one when local storage is unavailable), so it is now
  // shown with a next action instead of silently discarded.
  const [saveError, setSaveError] = useState<string | null>(null);
  // BYOK setup fails silently today: a typo'd URL or revoked key only
  // surfaces later as a vague mid-draft analysis error. The test lists
  // models (key in the header, nothing else sent) so settings can say
  // "connected" before the writer depends on it.
  const [connectionTest, setConnectionTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const runConnectionTest = () => {
    if (testingConnection) return;
    setTestingConnection(true);
    setConnectionTest(null);
    void testProviderConnection({ baseUrl: settings.baseUrl, apiKey: settings.apiKey, customHeaders: settings.customHeaders })
      .then((result) => setConnectionTest(result))
      .catch(() => setConnectionTest({ ok: false, message: "The test failed unexpectedly. Check the URL and try again." }))
      .finally(() => setTestingConnection(false));
  };
  // Profile portability: the writer's learned language data as a file they
  // own. Export downloads it; import merges a file additively and reports
  // exactly what changed. Secrets never enter the file (see profile-transfer).
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const exportStyleProfile = () => {
    const exported = exportProfile(style);
    downloadFile({ filename: "draftwise-profile.json", content: JSON.stringify(exported, null, 2), type: "application/json;charset=utf-8" });
    setTransferMessage("Profile exported. It holds your words and preferences only — no keys, no drafts.");
  };
  const importStyleProfile = (file: File) => {
    // Refuse anything implausible before reading it into memory.
    if (file.size > 1_000_000) {
      setTransferMessage("That file is too large to be a profile (over 1 MB).");
      return;
    }
    void file.text().then((text) => {
      const result = importProfile(style, text);
      setTransferMessage(result.message);
      if (result.ok && result.merged) patchStyle(result.merged);
    }).catch(() => {
      setTransferMessage("That file could not be read.");
    });
  };
  // Full backup: every document plus settings and activity in one file the
  // writer owns. Unlike the profile export this necessarily includes API
  // keys, so both directions say so. Restore is a deliberate two-step:
  // parse first, then an inline confirmation naming exactly what arrives —
  // neither replacing the whole library nor merging into it must ever happen
  // as a side effect of merely picking a file.
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [pendingBackup, setPendingBackup] = useState<{ backup: RestorableBackup; warnings: string[] } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const exportBackup = () => {
    const backup = buildBackup({
      documents: backupDocuments,
      workspace: backupWorkspace,
      activity: readRawActivityLog(readBackupActivityRaw()),
    });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile({ filename: `draftwise-backup-${stamp}.json`, content: serializeBackup(backup), type: "application/json;charset=utf-8" });
    onBackupExported?.();
    setPendingBackup(null);
    setBackupMessage(`Backup exported: ${backup.documents.length} ${backup.documents.length === 1 ? "document" : "documents"}, settings and activity. It contains your API keys — keep the file somewhere private.`);
  };
  const importBackupFile = (file: File) => {
    const tooLarge = oversizedBackupFile(file);
    if (tooLarge) {
      setBackupMessage(tooLarge);
      return;
    }
    void file.text().then((text) => {
      const result = parseBackup(text);
      if (!result.ok) {
        setPendingBackup(null);
        setBackupMessage(result.error);
        return;
      }
      setBackupMessage(null);
      setPendingBackup({ backup: result.backup, warnings: result.warnings });
    }).catch(() => {
      setPendingBackup(null);
      setBackupMessage("That file could not be read.");
    });
  };
  const confirmRestore = (mode: "replace" | "merge") => {
    if (!pendingBackup || restoring) return;
    setRestoring(true);
    void onRestoreBackup(pendingBackup.backup, mode).then((result) => {
      setRestoring(false);
      if (!result.ok) {
        setPendingBackup(null);
        setBackupMessage(result.error);
        return;
      }
      // A merge leaves the dialog open on the writer's intact library: say
      // exactly what arrived. A replace reloads the app, so no message needed.
      if (mode === "merge" && result.merged) {
        const { added, skipped, renamed } = result.merged;
        const parts: string[] = [];
        if (added > 0) parts.push(`${added} added`);
        if (renamed > 0) parts.push(`${renamed} kept as titled ${renamed === 1 ? "copy" : "copies"} (same identity, different text)`);
        if (skipped > 0) parts.push(`${skipped} already here`);
        setPendingBackup(null);
        setBackupMessage(`Merged into your library: ${parts.join(", ")}. Your current documents, settings and activity were left untouched.`);
      }
    });
  };
  const save = () => {
    const result = onSave?.();
    if (result && !result.ok) {
      setSaveError(result.error || "Your settings could not be saved on this device. Your text is still in the editor.");
      return;
    }
    setSaveError(null);
    onOpenChange(false);
  };
  const forget = () => {
    onSettingsChange({ ...settings, apiKey: "", customHeaders: "" });
    onClassifierChange?.({ ...classifierValue, apiKey: "" });
    onAiEnabledChange(false);
    onForgetKeys?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog" data-theme={theme}>
        <DialogHeader>
          <DialogTitle>Provider & privacy</DialogTitle>
          <DialogDescription>
            Local checks run on this device. If AI is enabled, selected chunks go directly to your configured provider.
            Classifier triage is off unless you fill in an endpoint below. Draftwise does not proxy or store those requests.
          </DialogDescription>
        </DialogHeader>

        <div className="settings-stack">
          <div className="settings-row settings-row-toggle">
            <div>
              <strong>Enable AI suggestions</strong>
              <span>One setting controls AI analysis and rewrites. Turning it off cancels active requests and clears the AI result cache.</span>
            </div>
            <Switch checked={aiEnabled} onCheckedChange={onAiEnabledChange} aria-label="Enable AI suggestions" />
          </div>

          <label className="field-label">
            <span>Provider</span>
            <select value={settings.provider} onChange={(event) => {
              const value = event.target.value as ProviderSettings["provider"];
              const preset = PROVIDER_PRESETS.find((item) => item.value === value);
              patchSettings({ provider: value, ...(preset && !settings.baseUrl.trim() ? { baseUrl: preset.baseUrl } : {}) });
            }}>
              {PROVIDER_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
            </select>
          </label>

          <label className="field-label">
            <span>API key <em>stored locally on this device</em></span>
            <Input type="password" value={settings.apiKey} onChange={(event) => patchSettings({ apiKey: event.target.value })} placeholder="sk-…" autoComplete="off" />
          </label>

          <label className="field-label">
            <span>Model</span>
            <Input value={settings.model} onChange={(event) => patchSettings({ model: event.target.value })} placeholder={PROVIDER_PRESETS.find((item) => item.value === settings.provider)?.modelPlaceholder ?? "gpt-4o-mini"} />
          </label>

          <div className="settings-connection">
            <Button size="sm" variant="outline" onClick={runConnectionTest} disabled={testingConnection}>{testingConnection ? "Testing…" : "Test connection"}</Button>
            {connectionTest ? <span role="status" className={connectionTest.ok ? "connection-ok" : "connection-error"}>{connectionTest.message}</span> : <span className="connection-hint">Checks the URL and key against the provider&apos;s model list. No draft text is sent.</span>}
          </div>

          <details className="settings-advanced">
            <summary><ChevronRight size={14} className="settings-advanced-chevron" /> Advanced</summary>
            <div className="settings-stack settings-advanced-body">

          <div className="settings-callout">
            <ShieldCheck size={18} />
            <div>
              <strong>Explicit paths, and nothing sends by default</strong>
              <span>Local checks stay on-device. A classifier receives excerpts for routing only if you configure one; your provider receives only chunks selected for AI review.</span>
            </div>
          </div>

          <label className="field-label">
            <span>Base URL <em>HTTPS required outside localhost</em></span>
            <Input value={settings.baseUrl} onChange={(event) => patchSettings({ baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" inputMode="url" />
          </label>

          <div className="settings-grid">
            <label className="field-label">
              <span>Temperature <b>{settings.temperature.toFixed(1)}</b></span>
              <input className="range-input" type="range" min="0" max="1" step="0.1" value={settings.temperature} onChange={(event) => patchSettings({ temperature: Number(event.target.value) })} />
            </label>
            <label className="field-label">
              <span>Max tokens</span>
              <Input type="number" min="100" max="4000" value={settings.maxTokens} onChange={(event) => patchSettings({ maxTokens: Math.max(100, Math.min(4000, Number(event.target.value) || 900)) })} />
            </label>
          </div>

          <label className="field-label">
            <span>Custom headers <em>optional JSON; authorization headers are ignored</em></span>
            <Input value={settings.customHeaders} onChange={(event) => patchSettings({ customHeaders: event.target.value })} placeholder='{"X-Org": "…"}' />
          </label>

          <div className="settings-callout">
            <ShieldCheck size={18} />
            <div>
              <strong>Optional classifier triage <em>off by default</em></strong>
              <span>Local rules run first. If you fill in an endpoint below, only unresolved, redacted excerpts go there; it returns a label and confidence, never a rewrite. Selected ai-needed chunks then reach your provider. Leave this empty and nothing is sent to any classifier.</span>
            </div>
          </div>

          <label className="field-label">
            <span>Classifier base URL <em>advanced override; HTTPS required outside localhost</em></span>
            <Input value={classifierValue.baseUrl} onChange={(event) => patchClassifier({ baseUrl: event.target.value })} placeholder="https://classifier.dev" inputMode="url" />
          </label>

          <label className="field-label">
            <span>Classifier workspace key <em>optional; stored locally</em></span>
            <Input type="password" value={classifierValue.apiKey ?? ""} onChange={(event) => patchClassifier({ apiKey: event.target.value })} placeholder="Optional classifier.dev key" autoComplete="off" />
          </label>

          <label className="field-label">
            <span>Uncertain classifier results</span>
            <select value={classifierValue.uncertainPolicy ?? "provider"} onChange={(event) => patchClassifier({ uncertainPolicy: event.target.value as ClassifierSettings["uncertainPolicy"] })}>
              <option value="provider">Send to provider (higher recall)</option>
              <option value="local">Keep local (lower cost)</option>
            </select>
          </label>

            </div>
          </details>

          <div className="settings-grid">
            <label className="field-label">
              <span>Dialect</span>
              <select value={style.dialect} onChange={(event) => patchStyle({ dialect: event.target.value as StylePreferences["dialect"] })}>
                <option value="en-GB">British English</option>
                <option value="en-US">US English</option>
              </select>
            </label>
            <label className="field-label">
              <span>Passive voice</span>
              <select value={style.passiveVoiceSensitivity} onChange={(event) => patchStyle({ passiveVoiceSensitivity: event.target.value as StylePreferences["passiveVoiceSensitivity"] })}>
                <option value="off">Off</option>
                <option value="normal">Normal</option>
                <option value="strict">Strict</option>
              </select>
            </label>
          </div>

          <div className="settings-row">
            <div>
              <strong>Allow contractions</strong>
              <span>Keep natural forms such as “can’t” when enabled.</span>
            </div>
            <Switch checked={style.allowContractions} onCheckedChange={(value) => patchStyle({ allowContractions: value })} aria-label="Allow contractions" />
          </div>

          <div className="writing-profile">
            <div className="writing-profile-heading">
              <strong>Writing profile</strong>
              <span>What Draftwise has learned from how you use suggestions, on this device only. Dismissing the same kind three times holds it back; accepting the same kind five times keeps it in view. Every entry is editable and removable — nothing here is automatic or hidden.</span>
            </div>
            {style.learned?.length ? (
              <div className="writing-profile-list">
                {style.learned.map((entry) => (
                  <div key={entry.id} className="writing-profile-entry">
                    <div>
                      <strong>{entry.label}</strong>
                      <span>{entry.detail}</span>
                    </div>
                    <div className="writing-profile-actions">
                      {entry.kind === "disabled-family" ? (
                        <button type="button" onClick={() => patchStyle({ ignoredRuleIds: style.ignoredRuleIds.filter((id) => id !== entry.family), learned: style.learned?.filter((item) => item.id !== entry.id) })}>Turn back on</button>
                      ) : entry.kind === "reduced-family" ? (
                        <button type="button" onClick={() => patchStyle({ reducedRuleIds: style.reducedRuleIds.filter((id) => id !== entry.family), learned: style.learned?.filter((item) => item.id !== entry.id) })}>Show normally</button>
                      ) : entry.kind === "accepted-pattern" ? (
                        // Accepted advice is not "forgotten" like a dampening; the
                        // writer is undoing a promotion, so the wording says so.
                        <button type="button" onClick={() => patchStyle({ acceptanceCounts: Object.fromEntries(Object.entries(style.acceptanceCounts ?? {}).filter(([family]) => family !== entry.family)), learned: style.learned?.filter((item) => item.id !== entry.id) })}>Stop prioritising this</button>
                      ) : (
                        <button type="button" onClick={() => patchStyle({ dismissalCounts: Object.fromEntries(Object.entries(style.dismissalCounts ?? {}).filter(([family]) => family !== entry.family)), learned: style.learned?.filter((item) => item.id !== entry.id) })}>Forget this</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="writing-profile-empty">Nothing learned yet. When you repeatedly dismiss or reduce a suggestion type, it appears here so you can see exactly what changed.</p>
            )}
            {style.personalDictionary.length ? (
              <div className="writing-profile-dictionary">
                <strong>Personal dictionary</strong>
                <span>{style.personalDictionary.join(" · ")}</span>
              </div>
            ) : null}
            <div className="writing-profile-transfer">
              <Button size="sm" variant="outline" onClick={exportStyleProfile}><Download size={13} /> Export profile</Button>
              <label className="writing-profile-import">
                <Upload size={13} /> Import profile
                <input type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importStyleProfile(file); event.target.value = ""; }} />
              </label>
            </div>
            {transferMessage ? <p className="writing-profile-transfer-message" role="status">{transferMessage}</p> : null}
          </div>

          <div className="writing-profile">
            <div className="writing-profile-heading">
              <strong>Backup & restore</strong>
              <span>Your whole library — every document with its goals and history, settings, and writing activity — as one file. A backup includes your API keys so a restore brings back a working app; keep the file somewhere private.</span>
            </div>
            <div className="writing-profile-transfer">
              <Button size="sm" variant="outline" onClick={exportBackup}><Download size={13} /> Export backup</Button>
              <label className="writing-profile-import">
                <Upload size={13} /> Restore backup
                <input type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) importBackupFile(file); event.target.value = ""; }} />
              </label>
            </div>
            <p className="backup-age">{backupWorkspace.lastBackupAt ? `Last exported ${formatRelativeTime(backupWorkspace.lastBackupAt)}.` : "Never exported yet — your words live only in this browser."}</p>
            {pendingBackup ? (
              <div className="writing-profile-transfer-message" role="alert">
                <span>Restore {pendingBackup.backup.documents.length} {pendingBackup.backup.documents.length === 1 ? "document" : "documents"} from {pendingBackup.backup.exportedAt}?</span>
                {pendingBackup.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                <span><strong>Merge into library</strong> adds the documents from the backup alongside your current ones — settings, activity and open draft untouched. Documents already here with identical text are skipped; same identity but different text is kept as a titled copy. Nothing is removed and nothing reloads.</span>
                <span><strong>Replace everything</strong> swaps every current document, setting, and activity record — including API keys — and reloads Draftwise. Export a backup of your current work first if you might want it back.</span>
                <span>
                  <Button size="sm" variant="outline" disabled={restoring} onClick={() => confirmRestore("merge")}>{restoring ? "Merging…" : "Merge into library"}</Button>{' '}
                  <Button size="sm" variant="outline" disabled={restoring} onClick={() => confirmRestore("replace")}>{restoring ? "Restoring…" : "Replace everything"}</Button>{' '}
                  <Button size="sm" variant="ghost" disabled={restoring} onClick={() => setPendingBackup(null)}>Cancel</Button>
                </span>
              </div>
            ) : null}
            {backupMessage ? <p className="writing-profile-transfer-message" role="status">{backupMessage}</p> : null}
          </div>

          <AppInstallSection />

          <div className="settings-footnote">
            <Info size={14} />
            No account or analytics are required. Classifier triage is off until you enter an endpoint above, and nothing leaves this device while AI is off. Clearing local data removes the draft, preferences, credentials, and local analysis cache.
          </div>
        </div>

        <DialogFooter className="settings-footer">
          {saveError ? (
            <div className="settings-save-error" role="alert">
              <span>{saveError}</span>
              <button type="button" onClick={() => setSaveError(null)}>Dismiss</button>
            </div>
          ) : null}
          <Button variant="ghost" onClick={forget}><Trash2 size={14} /> Forget cloud credentials</Button>
          <Button variant="ghost" onClick={onClearData}>Clear local data</Button>
          <Button onClick={save}><ShieldCheck size={14} /> Save & close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
