"use client";

import type { CSSProperties, ChangeEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  BarChart3,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  FileText,
  Flag,
  Highlighter,
  Info,
  Keyboard,
  Laptop,
  Lightbulb,
  Moon,
  MoreHorizontal,
  PanelRight,
  PenLine,
  Puzzle,
  RotateCcw,
  RotateCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  Trash2,
  Undo2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { analyzeLocally, categoryColors } from "@/lib/analysis";
import { analyzeWithProvider, estimateTokens, rewriteWithProvider } from "@/lib/ai-provider";
import type {
  AnalysisResult,
  IssueCategory,
  ProviderSettings,
  WritingGoals,
  WritingIssue,
} from "@/packages/types/src";
import { DEFAULT_GOALS, DEFAULT_PROVIDER_SETTINGS } from "@/packages/types/src";

const SAMPLE_DOCUMENT = `The best writing systems make the next sentence easier to write. Draftwise keeps your words private by default, then gives you a clear path from rough idea to finished copy.

It catches repeatd words, extra spaces  and common spelling slips as you draft. You can also ask a model to improve clarity, shorten a paragraph, or make the tone more confident — using your own API key.

The result is a calmer writing loop: notice one useful change, accept it when it helps, and keep your voice intact.`;

type WorkspaceView = "write" | "insights" | "extension";
type IssueFilter = "all" | IssueCategory;

const LOCAL_STORAGE_KEYS = {
  draft: "draftwise:draft",
  goals: "draftwise:goals",
  provider: "draftwise:provider",
  theme: "draftwise:theme",
  aiEnabled: "draftwise:ai-enabled",
};

const emptyAnalysis = (text: string): AnalysisResult => {
  const local = analyzeLocally(text);
  return { ...local, analysedText: text, source: "local" };
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function categoryLabel(category: IssueCategory) {
  return category;
}

function HighlightLayer({ text, issues, activeIssueId }: { text: string; issues: WritingIssue[]; activeIssueId: string | null }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  const safeIssues = issues.filter((item) => item.start >= 0 && item.end <= text.length && item.end > item.start).sort((a, b) => a.start - b.start);
  safeIssues.forEach((item) => {
    if (item.start < cursor) return;
    if (item.start > cursor) nodes.push(<span key={`plain-${cursor}`}>{text.slice(cursor, item.start)}</span>);
    nodes.push(<mark key={item.id} className={`editor-highlight ${activeIssueId === item.id ? "is-active" : ""}`} data-category={item.category} style={{ "--issue-color": categoryColors[item.category] } as CSSProperties}>{text.slice(item.start, item.end)}</mark>);
    cursor = item.end;
  });
  if (cursor < text.length) nodes.push(<span key={`plain-${cursor}`}>{text.slice(cursor)}</span>);
  return <div aria-hidden="true" className="editor-highlights">{nodes}</div>;
}

function Metric({ label, value, note, color = "mint" }: { label: string; value: number | string; note?: string; color?: "mint" | "amber" | "violet" | "blue" }) {
  return <div className="metric-card"><div className="metric-card-topline"><span>{label}</span><span className={`metric-dot metric-dot-${color}`} /></div><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>;
}

function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 44;
  const offset = circumference - (score / 100) * circumference;
  return <div className="score-ring" aria-label={`Overall writing score ${score} out of 100`}><svg viewBox="0 0 110 110" aria-hidden="true"><circle className="score-ring-track" cx="55" cy="55" r="44" /><circle className="score-ring-progress" cx="55" cy="55" r="44" strokeDasharray={circumference} strokeDashoffset={offset} /></svg><span><strong>{score}</strong><small>/100</small></span></div>;
}

function GoalSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="goal-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown aria-hidden="true" size={14} /></label>;
}

function SuggestionCard({ issue, active, onSelect, onAccept, onDismiss }: { issue: WritingIssue; active: boolean; onSelect: () => void; onAccept: () => void; onDismiss: () => void }) {
  const color = categoryColors[issue.category];
  return <article className={`suggestion-card ${active ? "is-active" : ""}`} style={{ "--suggestion-color": color } as CSSProperties}>
    <button className="suggestion-main" onClick={onSelect} type="button"><span className="suggestion-heading"><span className="suggestion-color-dot" /><span>{issue.title}</span>{issue.source === "ai" ? <Badge className="ai-badge">AI</Badge> : null}</span><span className="suggestion-category">{categoryLabel(issue.category)} · {issue.severity}</span><span className="suggestion-copy">{issue.explanation}</span></button>
    <div className="suggestion-replacement"><span className="suggestion-original">{issue.original}</span>{issue.replacement && issue.replacement !== issue.original ? <ArrowDown size={14} aria-hidden="true" /> : null}{issue.replacement && issue.replacement !== issue.original ? <span className="suggestion-new">{issue.replacement}</span> : <span className="suggestion-review">Review wording</span>}</div>
    <div className="suggestion-actions"><Button size="sm" onClick={onAccept} disabled={!issue.replacement || issue.replacement === issue.original}><Check size={14} /> Accept</Button><Button size="sm" variant="ghost" onClick={onDismiss} aria-label={`Dismiss ${issue.title}`}><X size={14} /></Button></div>
  </article>;
}

function SettingsDialog({ open, onOpenChange, settings, onSettingsChange, aiEnabled, onAiEnabledChange }: { open: boolean; onOpenChange: (value: boolean) => void; settings: ProviderSettings; onSettingsChange: (value: ProviderSettings) => void; aiEnabled: boolean; onAiEnabledChange: (value: boolean) => void }) {
  const [saved, setSaved] = useState(false);
  const patch = (next: Partial<ProviderSettings>) => onSettingsChange({ ...settings, ...next });
  const save = () => { window.localStorage.setItem(LOCAL_STORAGE_KEYS.provider, JSON.stringify(settings)); window.localStorage.setItem(LOCAL_STORAGE_KEYS.aiEnabled, String(aiEnabled)); setSaved(true); window.setTimeout(() => setSaved(false), 1800); };
  const forget = () => { const next = { ...settings, apiKey: "", enabled: false }; onSettingsChange(next); window.localStorage.removeItem(LOCAL_STORAGE_KEYS.provider); onAiEnabledChange(false); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>Provider & privacy</DialogTitle><DialogDescription>Draftwise is local-first. Add your own OpenAI-compatible key only when you want model-powered suggestions.</DialogDescription></DialogHeader><div className="settings-stack"><div className="settings-callout"><ShieldCheck size={18} /><div><strong>Nothing leaves this browser by default.</strong><span>Local rules stay on-device. When AI is on, only the changed chunk is sent to the endpoint below.</span></div></div><div className="settings-row settings-row-toggle"><div><strong>Enable AI suggestions</strong><span>Uses your key and model. You can switch this off at any time.</span></div><Switch checked={aiEnabled} onCheckedChange={onAiEnabledChange} aria-label="Enable AI suggestions" /></div><div className="settings-grid"><label className="field-label"><span>Provider</span><select value={settings.provider} onChange={(event) => patch({ provider: event.target.value as ProviderSettings["provider"] })}><option value="openai-compatible">OpenAI-compatible</option><option value="custom">Custom provider</option></select></label><label className="field-label"><span>Model ID</span><Input value={settings.model} onChange={(event) => patch({ model: event.target.value })} placeholder="gpt-4o-mini" /></label></div><label className="field-label"><span>Base URL</span><Input value={settings.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" /></label><label className="field-label"><span>API key <em>stored locally</em></span><Input type="password" value={settings.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-…" autoComplete="off" /></label><div className="settings-grid"><label className="field-label"><span>Temperature <b>{settings.temperature.toFixed(1)}</b></span><input className="range-input" type="range" min="0" max="1" step="0.1" value={settings.temperature} onChange={(event) => patch({ temperature: Number(event.target.value) })} /></label><label className="field-label"><span>Max tokens</span><Input type="number" min="100" max="4000" value={settings.maxTokens} onChange={(event) => patch({ maxTokens: Number(event.target.value) || 900 })} /></label></div><label className="field-label"><span>Custom headers <em>optional JSON</em></span><Input value={settings.customHeaders} onChange={(event) => patch({ customHeaders: event.target.value })} placeholder='{"X-Org": "…"}' /></label><div className="settings-footnote"><Info size={14} /> Keys never enter the repository. They are kept in localStorage on this device and omitted from logs.</div></div><DialogFooter className="settings-footer"><Button variant="ghost" onClick={forget}><Trash2 size={14} /> Forget key</Button><Button onClick={save}>{saved ? <><Check size={14} /> Saved locally</> : <><ShieldCheck size={14} /> Save locally</>}</Button></DialogFooter></DialogContent></Dialog>;
}

function RewritePreview({ preview, onReplace, onInsert, onCopy, onRetry, onCancel }: { preview: { label: string; original: string; replacement: string; explanation: string; source: "local" | "ai"; loading?: boolean }; onReplace: () => void; onInsert: () => void; onCopy: () => void; onRetry: () => void; onCancel: () => void }) {
  return <section className="rewrite-preview" aria-live="polite"><div className="rewrite-preview-header"><span><WandSparkles size={15} /> {preview.label}</span><button onClick={onCancel} aria-label="Close rewrite preview" type="button"><X size={15} /></button></div>{preview.loading ? <div className="rewrite-loading"><span className="loading-pulse" /> Drafting a better version…</div> : <><div className="rewrite-columns"><div><small>Original</small><p>{preview.original}</p></div><ArrowDown className="rewrite-arrow" size={16} /><div><small>Suggested</small><p className="rewrite-suggested">{preview.replacement}</p></div></div>{preview.explanation ? <p className="rewrite-explanation"><Lightbulb size={14} /> {preview.explanation}</p> : null}<div className="rewrite-actions"><Button size="sm" onClick={onReplace}><Check size={14} /> Replace</Button><Button size="sm" variant="outline" onClick={onInsert}><ArrowDown size={14} /> Insert</Button><Button size="sm" variant="ghost" onClick={onCopy}><Copy size={14} /> Copy</Button><Button size="sm" variant="ghost" onClick={onRetry}><RotateCw size={14} /> Retry</Button><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button></div></>}</section>;
}

export default function Home() {
  const [view, setView] = useState<WorkspaceView>("write");
  const [draft, setDraft] = useState(SAMPLE_DOCUMENT);
  const [goals, setGoals] = useState<WritingGoals>(DEFAULT_GOALS);
  const [settings, setSettings] = useState<ProviderSettings>(DEFAULT_PROVIDER_SETTINGS);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult>(() => emptyAnalysis(SAMPLE_DOCUMENT));
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [filter, setFilter] = useState<IssueFilter>("all");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [customInstruction, setCustomInstruction] = useState("");
  const [rewritePreview, setRewritePreview] = useState<{ label: string; original: string; replacement: string; explanation: string; source: "local" | "ai"; loading?: boolean } | null>(null);
  const [history, setHistory] = useState<string[]>([SAMPLE_DOCUMENT]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const analysisCache = useRef(new Map<string, AnalysisResult>());
  const analysisAbort = useRef<AbortController | null>(null);
  const analysisRun = useRef(0);

  useEffect(() => {
    const hydrate = window.setTimeout(() => {
      const storedDraft = window.localStorage.getItem(LOCAL_STORAGE_KEYS.draft);
      const storedGoals = window.localStorage.getItem(LOCAL_STORAGE_KEYS.goals);
      const storedProvider = window.localStorage.getItem(LOCAL_STORAGE_KEYS.provider);
      const storedTheme = window.localStorage.getItem(LOCAL_STORAGE_KEYS.theme);
      const storedAiEnabled = window.localStorage.getItem(LOCAL_STORAGE_KEYS.aiEnabled);
      if (storedDraft) setDraft(storedDraft);
      if (storedGoals) { try { setGoals({ ...DEFAULT_GOALS, ...JSON.parse(storedGoals) }); } catch { /* keep defaults */ } }
      if (storedProvider) { try { setSettings({ ...DEFAULT_PROVIDER_SETTINGS, ...JSON.parse(storedProvider) }); } catch { /* keep defaults */ } }
      if (storedTheme) setDarkMode(storedTheme === "dark");
      if (storedAiEnabled) setAiEnabled(storedAiEnabled === "true");
    }, 0);
    return () => window.clearTimeout(hydrate);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.draft, draft);
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.goals, JSON.stringify(goals));
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.theme, darkMode ? "dark" : "light");
  }, [draft, goals, darkMode]);

  const runAnalysis = useCallback(async (text: string) => {
    const run = ++analysisRun.current;
    const local = emptyAnalysis(text);
    setAnalysis(local);
    setAnalysisError(null);
    if (!aiEnabled || !settings.enabled || !settings.apiKey.trim() || text.trim().length < 24) return;
    const cacheKey = `${settings.model}:${JSON.stringify(goals)}:${text}`;
    const cached = analysisCache.current.get(cacheKey);
    if (cached) { setAnalysis(cached); return; }
    analysisAbort.current?.abort();
    const controller = new AbortController();
    analysisAbort.current = controller;
    setAnalyzing(true);
    try {
      const remote = await analyzeWithProvider(text, goals, settings, controller.signal);
      if (analysisRun.current !== run) return;
      analysisCache.current.set(cacheKey, remote);
      setAnalysis(remote);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (analysisRun.current === run) setAnalysisError(error instanceof Error ? error.message : "AI analysis failed. Local checks are still on.");
    } finally {
      if (analysisRun.current === run) setAnalyzing(false);
    }
  }, [aiEnabled, goals, settings]);

  useEffect(() => { const timeout = window.setTimeout(() => void runAnalysis(draft), 360); return () => window.clearTimeout(timeout); }, [draft, runAnalysis]);
  useEffect(() => () => analysisAbort.current?.abort(), []);

  const issues = useMemo(() => filter === "all" ? analysis.issues : filter === "grammar" ? analysis.issues.filter((item) => item.category === "grammar" || item.category === "spelling") : analysis.issues.filter((item) => item.category !== "grammar" && item.category !== "spelling"), [analysis.issues, filter]);
  const activeIssue = analysis.issues.find((item) => item.id === activeIssueId) ?? null;
  const selectedText = draft.slice(selection.start, selection.end);
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const updateDraft = useCallback((next: string, replaceHistory = true) => {
    setDraft(next);
    if (!replaceHistory) return;
    setHistory((current) => { const nextHistory = [...current.slice(0, historyIndex + 1), next].slice(-80); setHistoryIndex(nextHistory.length - 1); return nextHistory; });
  }, [historyIndex]);
  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => updateDraft(event.target.value);
  const restoreHistory = (index: number) => { const next = history[index]; if (next === undefined) return; setHistoryIndex(index); setDraft(next); window.setTimeout(() => textareaRef.current?.focus(), 0); };

  const acceptIssue = (issue: WritingIssue) => {
    if (!issue.replacement || issue.replacement === issue.original || draft.slice(issue.start, issue.end) !== issue.original) return;
    const next = `${draft.slice(0, issue.start)}${issue.replacement}${draft.slice(issue.end)}`;
    updateDraft(next); setActiveIssueId(null); window.setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(issue.start, issue.start + issue.replacement.length); }, 0);
  };
  const dismissIssue = (issue: WritingIssue) => { setAnalysis((current) => ({ ...current, issues: current.issues.filter((item) => item.id !== issue.id) })); setActiveIssueId(null); };
  const acceptAll = () => { const actionable = analysis.issues.filter((item) => item.replacement && item.replacement !== item.original).sort((a, b) => b.start - a.start); if (!actionable.length) return; let next = draft; for (const item of actionable) if (next.slice(item.start, item.end) === item.original) next = `${next.slice(0, item.start)}${item.replacement}${next.slice(item.end)}`; updateDraft(next); setActiveIssueId(null); };

  const runRewrite = async (label: string, instruction: string) => {
    if (!selectedText.trim()) return;
    const original = selectedText;
    setRewritePreview({ label, original, replacement: "", explanation: "", source: "local", loading: true });
    try { const result = await rewriteWithProvider({ text: original, instruction, goals }, { ...settings, enabled: aiEnabled && settings.enabled }); setRewritePreview({ label, original, ...result }); } catch (error) { setRewritePreview({ label, original, replacement: original, explanation: error instanceof Error ? error.message : "Rewrite failed. Nothing was changed.", source: "local" }); }
  };
  const replaceSelection = (insert: boolean) => { if (!rewritePreview || rewritePreview.loading) return; const next = insert ? `${draft.slice(0, selection.end)}\n${rewritePreview.replacement}${draft.slice(selection.end)}` : `${draft.slice(0, selection.start)}${rewritePreview.replacement}${draft.slice(selection.end)}`; updateDraft(next); setRewritePreview(null); window.setTimeout(() => textareaRef.current?.focus(), 0); };
  const retryRewrite = () => { if (rewritePreview) void runRewrite(rewritePreview.label, rewritePreview.label); };
  const copyRewrite = async () => { if (rewritePreview?.replacement) await navigator.clipboard?.writeText(rewritePreview.replacement); };
  const scrollEditor = () => { if (textareaRef.current && highlightRef.current) { highlightRef.current.scrollTop = textareaRef.current.scrollTop; highlightRef.current.scrollLeft = textareaRef.current.scrollLeft; } };
  const updateSelection = () => { if (textareaRef.current) setSelection({ start: textareaRef.current.selectionStart, end: textareaRef.current.selectionEnd }); };
  const scoreMessage = analysis.scores.overall >= 90 ? "Polished draft" : analysis.scores.overall >= 75 ? "Strong foundation" : "A few easy wins";

  return <main className="app-shell" data-theme={darkMode ? "dark" : "light"}>
    <header className="topbar"><div className="brand-lockup"><div className="brand-mark"><span /></div><span className="brand-name">draftwise</span><Badge className="private-badge"><ShieldCheck size={12} /> private</Badge></div><div className="document-name"><FileText size={15} /><span>Untitled draft</span><span className="saved-dot" title="Saved locally" /></div><div className="topbar-actions"><div className="privacy-pill"><span className="privacy-dot" /> Local-first</div><Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={() => setDarkMode((value) => !value)}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}</Button><Button variant="ghost" size="icon" aria-label="Open settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></Button><Button className="avatar-button" size="icon" aria-label="Profile">R</Button></div></header>
    <div className="app-body"><aside className="left-rail"><div className="rail-nav"><button className={view === "write" ? "rail-button active" : "rail-button"} onClick={() => setView("write")} type="button"><PenLine size={18} /><span>Write</span></button><button className={view === "insights" ? "rail-button active" : "rail-button"} onClick={() => setView("insights")} type="button"><BarChart3 size={18} /><span>Insights</span></button><button className={view === "extension" ? "rail-button active" : "rail-button"} onClick={() => setView("extension")} type="button"><Puzzle size={18} /><span>Extension</span><span className="rail-new">new</span></button></div><div className="rail-divider" /><div className="rail-context"><span className="rail-eyebrow">Writing goals</span><div className="rail-goal"><Target size={15} /><span>{goals.audience}</span></div><div className="rail-goal"><Flag size={15} /><span>{goals.intent}</span></div><div className="rail-goal"><Sparkles size={15} /><span>{goals.tone}</span></div><button className="rail-edit" onClick={() => setView("write")} type="button">Edit goals <ArrowDown size={13} /></button></div><div className="rail-bottom"><button className="rail-button" type="button" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /><span>Settings</span></button><button className="rail-button" type="button"><CircleHelp size={17} /><span>Shortcuts</span><kbd>?</kbd></button></div></aside>
      {view === "write" ? <div className="workspace-grid"><section className="editor-column"><div className="workspace-heading"><div><p className="eyebrow">Writing workspace</p><h1>Make the next sentence easier.</h1></div><div className="heading-actions"><Button variant="outline" size="sm" onClick={() => setDraft(SAMPLE_DOCUMENT)}><RotateCcw size={14} /> Reset</Button><Button size="sm" onClick={acceptAll}><CheckCheck size={14} /> Accept all</Button></div></div><div className="goal-bar"><div className="goal-bar-label"><Target size={15} /><span>Writing goals</span></div><GoalSelect label="Audience" value={goals.audience} options={[{ value: "general", label: "General" }, { value: "academic", label: "Academic" }, { value: "professional", label: "Professional" }, { value: "technical", label: "Technical" }, { value: "casual", label: "Casual" }]} onChange={(value) => setGoals((current) => ({ ...current, audience: value as WritingGoals["audience"] }))} /><GoalSelect label="Intent" value={goals.intent} options={[{ value: "inform", label: "Inform" }, { value: "explain", label: "Explain" }, { value: "persuade", label: "Persuade" }, { value: "describe", label: "Describe" }, { value: "story", label: "Tell a story" }]} onChange={(value) => setGoals((current) => ({ ...current, intent: value as WritingGoals["intent"] }))} /><GoalSelect label="Tone" value={goals.tone} options={[{ value: "neutral", label: "Neutral" }, { value: "confident", label: "Confident" }, { value: "friendly", label: "Friendly" }, { value: "professional", label: "Professional" }, { value: "formal", label: "Formal" }, { value: "casual", label: "Casual" }]} onChange={(value) => setGoals((current) => ({ ...current, tone: value as WritingGoals["tone"] }))} /></div>{selection.end > selection.start ? <div className="rewrite-toolbar"><span className="rewrite-toolbar-label"><WandSparkles size={14} /> Rewrite selection</span><button onClick={() => void runRewrite("Improve writing", "Improve writing")} type="button">Improve</button><button onClick={() => void runRewrite("Fix grammar", "Fix grammar")} type="button">Fix grammar</button><button onClick={() => void runRewrite("Shorten", "Shorten")} type="button">Shorten</button><button onClick={() => void runRewrite("Make confident", "Make confident")} type="button">Confident</button><button onClick={() => void runRewrite("Make formal", "Make formal")} type="button">Formal</button><div className="custom-rewrite"><Input value={customInstruction} onChange={(event) => setCustomInstruction(event.target.value)} placeholder="Custom instruction" /><button aria-label="Run custom instruction" onClick={() => { if (customInstruction.trim()) void runRewrite("Custom rewrite", customInstruction); }} type="button"><Zap size={13} /></button></div></div> : null}{rewritePreview ? <RewritePreview preview={rewritePreview} onReplace={() => replaceSelection(false)} onInsert={() => replaceSelection(true)} onCopy={() => void copyRewrite()} onRetry={retryRewrite} onCancel={() => setRewritePreview(null)} /> : null}<div className="editor-card"><div className="editor-toolbar"><div className="editor-toolbar-left"><Button size="icon-xs" variant="ghost" aria-label="Undo" disabled={!canUndo} onClick={() => restoreHistory(historyIndex - 1)}><Undo2 size={15} /></Button><Button size="icon-xs" variant="ghost" aria-label="Redo" disabled={!canRedo} onClick={() => restoreHistory(historyIndex + 1)}><RotateCw size={15} /></Button><span className="toolbar-separator" /><button type="button" className="toolbar-text active"><Highlighter size={14} /> Check as I write</button></div><div className="editor-toolbar-right"><span className="analysis-status">{analyzing ? <><span className="status-spinner" /> Analysing changed text</> : <><span className="status-check"><Check size={11} /></span> Saved locally</>}</span><Button variant="ghost" size="icon-xs" aria-label="More editor actions"><MoreHorizontal size={16} /></Button></div></div><div className="editor-scroll-wrap"><div ref={highlightRef} className="editor-highlight-scroll"><HighlightLayer text={draft} issues={analysis.issues} activeIssueId={activeIssueId} /></div><textarea ref={textareaRef} className="editor-input" value={draft} onChange={handleDraftChange} onSelect={updateSelection} onKeyUp={updateSelection} onScroll={scrollEditor} spellCheck={false} aria-label="Draft editor" placeholder="Start writing…" /></div><div className="editor-footer"><span><Keyboard size={14} /> Select text for rewrite tools</span><span>{estimateTokens(draft)} tokens estimated</span></div></div>{analysisError ? <div className="analysis-error"><Info size={15} /><span>{analysisError}</span><button onClick={() => setSettingsOpen(true)} type="button">Review provider settings</button></div> : null}<div className="workspace-footnote"><span><ShieldCheck size={14} /> No account required</span><span>Writing stays in this browser unless you enable AI.</span><button onClick={() => setSettingsOpen(true)} type="button">Privacy controls</button></div></section><aside className="suggestions-column"><div className="suggestions-header"><div><p className="eyebrow">Live analysis</p><h2>Suggestions <span>{analysis.issues.length}</span></h2></div><Button size="icon-sm" variant="ghost" aria-label="Collapse suggestions"><PanelRight size={17} /></Button></div><div className="score-card"><div><p className="score-kicker">Overall writing score</p><h3>{scoreMessage}</h3><p className="score-description">A strong base with a few small improvements ready to review.</p><div className="tone-row"><span>Tone</span>{analysis.tone.map((tone) => <Badge key={tone} className="tone-badge">{tone}</Badge>)}</div></div><ScoreRing score={analysis.scores.overall} /></div><div className="issue-tabs"><Tabs value={filter} onValueChange={(value) => setFilter(value as IssueFilter)}><TabsList variant="line"><TabsTrigger value="all">All <span>{analysis.issues.length}</span></TabsTrigger><TabsTrigger value="grammar">Grammar <span>{analysis.issues.filter((item) => item.category === "grammar" || item.category === "spelling").length}</span></TabsTrigger><TabsTrigger value="clarity">Style <span>{analysis.issues.filter((item) => item.category !== "grammar" && item.category !== "spelling").length}</span></TabsTrigger></TabsList></Tabs></div><div className="suggestions-list">{issues.length ? issues.map((issue) => <SuggestionCard key={issue.id} issue={issue} active={issue.id === activeIssueId} onSelect={() => { setActiveIssueId(issue.id); textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(issue.start, issue.end); }} onAccept={() => acceptIssue(issue)} onDismiss={() => dismissIssue(issue)} />) : <div className="empty-suggestions"><div className="empty-icon"><CheckCheck size={22} /></div><h3>Clean so far</h3><p>Your draft has no open suggestions in this view.</p></div>}</div>{activeIssue ? <div className="selected-issue"><div className="selected-issue-title"><span className="selected-issue-dot" style={{ background: categoryColors[activeIssue.category] }} /><span>{activeIssue.title}</span><button onClick={() => setActiveIssueId(null)} type="button" aria-label="Close selected suggestion"><X size={14} /></button></div><p>{activeIssue.explanation}</p><div className="selected-issue-example"><span>{activeIssue.original}</span><ArrowDown size={13} /><strong>{activeIssue.replacement || "Review wording"}</strong></div></div> : null}<div className="suggestions-footer"><span><Zap size={14} /> {analysis.source === "local+ai" ? "Local + AI analysis" : "Local analysis"}</span><button onClick={() => setSettingsOpen(true)} type="button">Configure AI <ArrowDown size={13} /></button></div></aside></div> : null}
      {view === "insights" ? <section className="full-view"><div className="full-view-heading"><div><p className="eyebrow">Writing insights</p><h1>See what makes the draft work.</h1><p>Simple signals from the words already on your screen. No account, tracking, or hidden score.</p></div><Button onClick={() => setView("write")}><PenLine size={15} /> Back to draft</Button></div><div className="insights-grid"><div className="insights-score-panel"><div className="insights-score-heading"><div><span className="eyebrow">Overall score</span><h2>{analysis.scores.overall}<small>/100</small></h2><p>{scoreMessage}</p></div><ScoreRing score={analysis.scores.overall} /></div><div className="score-bars">{(["grammar", "clarity", "conciseness", "engagement"] as const).map((key) => <div className="score-bar-row" key={key}><span>{key}</span><div><i style={{ width: `${analysis.scores[key]}%` }} /></div><strong>{analysis.scores[key]}</strong></div>)}</div></div><div className="insights-stats-panel"><div className="panel-title"><span>Document stats</span><Clock3 size={16} /></div><div className="large-stat-grid"><Metric label="Words" value={formatNumber(analysis.stats.words)} note="in this draft" color="mint" /><Metric label="Sentences" value={formatNumber(analysis.stats.sentences)} note={`${analysis.stats.longSentences} long`} color="amber" /><Metric label="Read time" value={`${analysis.stats.readingTime} min`} note="at 200 wpm" color="violet" /><Metric label="Readability" value={Math.round(analysis.stats.readability || 0)} note="Flesch estimate" color="blue" /></div></div><div className="insights-tone-panel"><div className="panel-title"><span>Tone signals</span><Activity size={16} /></div><div className="tone-orbit"><div className="orbit-center"><Sparkles size={18} /><span>your voice</span></div>{analysis.tone.map((tone, index) => <span key={tone} className={`orbit-tag orbit-tag-${index}`}>{tone}</span>)}</div><p>Draftwise uses tone as a guide, not a verdict. Set a writing goal when the context matters more than the average signal.</p></div><div className="insights-privacy-panel"><div className="panel-title"><span>Privacy check</span><ShieldCheck size={16} /></div><div className="privacy-check-list"><div><Check size={15} /><span>No account required</span></div><div><Check size={15} /><span>No analytics by default</span></div><div><Check size={15} /><span>Keys stay on this device</span></div><div><Check size={15} /><span>AI is opt-in</span></div></div><Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>Review controls <ArrowDown size={13} /></Button></div></div></section> : null}
      {view === "extension" ? <section className="full-view extension-view"><div className="extension-hero"><div className="extension-hero-copy"><div className="extension-icon"><Puzzle size={24} /></div><p className="eyebrow">Draftwise extension</p><h1>Helpful, wherever you write.</h1><p>Bring local checks to textareas, forms, and contenteditable fields across the web. The assistant stays out of your way until you ask.</p><div className="extension-hero-actions"><Button onClick={() => navigator.clipboard?.writeText("extension/")}><Copy size={15} /> Copy install folder</Button><Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /> Extension settings</Button></div></div><div className="extension-preview"><div className="fake-browser-bar"><span /><span /><span /><strong>docs.example.com</strong></div><div className="fake-page"><div className="fake-page-copy"><span className="fake-line wide" /><span className="fake-line" /><span className="fake-line short" /><span className="fake-underline">The draft is ready to review.</span></div><div className="fake-assistant"><div className="fake-assistant-header"><span className="mini-mark" /> <strong>draftwise</strong><span className="fake-close">×</span></div><p>One spelling suggestion</p><div className="fake-fix"><span>recieve</span><ArrowDown size={12} /><strong>receive</strong></div><button type="button">Accept</button></div></div></div></div><div className="extension-grid"><div className="extension-card"><div className="extension-card-icon"><Laptop size={18} /></div><h3>Install locally</h3><p>Open <code>chrome://extensions</code>, turn on Developer mode, choose “Load unpacked”, and select the <code>extension</code> folder.</p><span className="extension-card-note"><Check size={13} /> Chrome + Edge, Manifest V3</span></div><div className="extension-card"><div className="extension-card-icon"><ShieldCheck size={18} /></div><h3>Private by design</h3><p>Passwords and sensitive fields are skipped. Site exclusions, AI opt-in, and local data deletion live in the extension options.</p><span className="extension-card-note"><Check size={13} /> No page analytics</span></div><div className="extension-card"><div className="extension-card-icon"><Code2 size={18} /></div><h3>Built to extend</h3><p>Shared issue types and provider contracts keep the browser assistant aligned with the web editor and ready for new providers.</p><span className="extension-card-note"><Check size={13} /> BYOK provider layer</span></div></div></section> : null}</div>
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} onSettingsChange={(next) => { setSettings(next); window.localStorage.setItem(LOCAL_STORAGE_KEYS.provider, JSON.stringify(next)); }} aiEnabled={aiEnabled} onAiEnabledChange={(next) => { setAiEnabled(next); window.localStorage.setItem(LOCAL_STORAGE_KEYS.aiEnabled, String(next)); }} />
  </main>;
}
