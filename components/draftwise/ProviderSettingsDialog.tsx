"use client";

import { Info, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ClassifierSettings, ProviderSettings, StylePreferences } from "@/packages/types/src";

interface ProviderSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ProviderSettings;
  style: StylePreferences;
  aiEnabled: boolean;
  classifier?: ClassifierSettings | null;
  onSettingsChange: (settings: ProviderSettings) => void;
  onClassifierChange?: (classifier: ClassifierSettings) => void;
  onStyleChange: (style: StylePreferences) => void;
  onAiEnabledChange: (enabled: boolean) => void;
  onForgetKeys?: () => void;
  onSave?: () => void;
  onClearData: () => void;
}

export function ProviderSettingsDialog({
  open,
  onOpenChange,
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
}: ProviderSettingsDialogProps) {
  const patchSettings = (patch: Partial<ProviderSettings>) => onSettingsChange({ ...settings, ...patch });
  const patchStyle = (patch: Partial<StylePreferences>) => onStyleChange({ ...style, ...patch });
  const classifierValue: ClassifierSettings = classifier ?? { baseUrl: "https://classifier.dev", apiKey: "", uncertainPolicy: "provider" };
  const patchClassifier = (patch: Partial<ClassifierSettings>) => onClassifierChange?.({ ...classifierValue, ...patch });
  const save = () => {
    onSave?.();
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
      <DialogContent className="settings-dialog">
        <DialogHeader>
          <DialogTitle>Provider & privacy</DialogTitle>
          <DialogDescription>
            Local checks run on this device. If AI is enabled, redacted candidate excerpts may go to classifier.dev for triage,
            and selected chunks go directly to your configured provider. Draftwise does not proxy or store those requests.
          </DialogDescription>
        </DialogHeader>

        <div className="settings-stack">
          <div className="settings-callout">
            <ShieldCheck size={18} />
            <div>
              <strong>Three explicit paths</strong>
              <span>Local-only checks stay on-device; classifier.dev receives excerpts for routing; your provider receives only chunks selected for AI review.</span>
            </div>
          </div>

          <div className="settings-row settings-row-toggle">
            <div>
              <strong>Enable AI suggestions</strong>
              <span>One setting controls AI analysis and rewrites. Turning it off cancels active requests and clears the AI result cache.</span>
            </div>
            <Switch checked={aiEnabled} onCheckedChange={onAiEnabledChange} aria-label="Enable AI suggestions" />
          </div>

          <div className="settings-grid">
            <label className="field-label">
              <span>Provider</span>
              <select value={settings.provider} onChange={(event) => patchSettings({ provider: event.target.value as ProviderSettings["provider"] })}>
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="custom">Custom adapter</option>
              </select>
            </label>
            <label className="field-label">
              <span>Model ID</span>
              <Input value={settings.model} onChange={(event) => patchSettings({ model: event.target.value })} placeholder="gpt-4o-mini" />
            </label>
          </div>

          <label className="field-label">
            <span>Base URL <em>HTTPS required outside localhost</em></span>
            <Input value={settings.baseUrl} onChange={(event) => patchSettings({ baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" inputMode="url" />
          </label>

          <label className="field-label">
            <span>API key <em>stored locally on this device</em></span>
            <Input type="password" value={settings.apiKey} onChange={(event) => patchSettings({ apiKey: event.target.value })} placeholder="sk-…" autoComplete="off" />
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
              <strong>Optional classifier triage</strong>
              <span>Local rules run first. Only unresolved, redacted excerpts go to classifier.dev; it returns a label and confidence, never a rewrite. Selected ai-needed chunks then reach your provider.</span>
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

          <div className="settings-footnote">
            <Info size={14} />
            No account or analytics are required. classifier.dev is keyless by default; an optional workspace key only changes its limits. Clearing local data removes the draft, preferences, credentials, and local analysis cache.
          </div>
        </div>

        <DialogFooter className="settings-footer">
          <Button variant="ghost" onClick={forget}><Trash2 size={14} /> Forget cloud credentials</Button>
          <Button variant="ghost" onClick={onClearData}>Clear local data</Button>
          <Button onClick={save}><ShieldCheck size={14} /> Save & close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
