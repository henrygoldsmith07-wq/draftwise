"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, CircleHelp, FileText, Flag, Moon, PenLine, Puzzle, Settings2, ShieldCheck, Sparkles, Sun, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditorWorkspace } from "@/components/draftwise/EditorWorkspace";
import { ExtensionGuide } from "@/components/draftwise/ExtensionGuide";
import { InsightsView } from "@/components/draftwise/InsightsView";
import { ProviderSettingsDialog } from "@/components/draftwise/ProviderSettingsDialog";
import { categoryMatches } from "@/components/draftwise/EditorPrimitives";
import { applyIssueReplacements, getIssueDismissalKey, getOpenIssues } from "@/lib/issue-actions";
import { canApplyRewritePreview } from "@/lib/rewrite-retry";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useHistory } from "@/hooks/useHistory";
import { createRewriteRetryArgs, useRewrite } from "@/hooks/useRewrite";
import { useSelection } from "@/hooks/useSelection";
import { getAiReviewStatus, type ProviderSettings, type StylePreferences, type WritingGoals, type WritingIssue } from "@/packages/types/src";
import { DEFAULT_WORKSPACE } from "@/packages/types/src";

const SAMPLE_DOCUMENT = `The best writing systems make the next sentence easier to write. Draftwise keeps your words private by default, then gives you a clear path from rough idea to finished copy.

It catches repeatd words, extra spaces  and common spelling slips as you draft. You can also ask a model to improve clarity, shorten a paragraph, or make the tone more confident — using your own API key.

The result is a calmer writing loop: notice one useful change, accept it when it helps, and keep your voice intact.`;

type WorkspaceView = "write" | "insights" | "extension";
type IssueFilter = "all" | "grammar" | "style";

function ShortcutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const shortcuts = [
    ["Save locally", "⌘ / Ctrl + S"],
    ["Accept visible suggestions", "⌘ / Ctrl + Enter"],
    ["Close rewrite preview", "Esc"],
    ["Open shortcuts", "?"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Keep your hands on the draft while you review suggestions.</DialogDescription>
        </DialogHeader>
        <div className="shortcut-list">{shortcuts.map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div>
      </DialogContent>
    </Dialog>
  );
}

function NewDraftDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a new draft?</DialogTitle>
          <DialogDescription>
            This replaces the current local document with a blank draft. The current text remains available through Undo during this session.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onConfirm(); onOpenChange(false); }}>Start new draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClearDataDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear all local Draftwise data?</DialogTitle>
          <DialogDescription>
            This removes the local draft, preferences, provider and classifier credentials, and migrated Draftwise storage from this browser. This action cannot be undone after the page is closed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onConfirm(); onOpenChange(false); }}>Clear local data</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Home() {
  const initialWorkspace = useMemo(() => DEFAULT_WORKSPACE(SAMPLE_DOCUMENT), []);
  const { workspace, hydrated, saveStatus, saveError, updateWorkspace, saveNow, clearLocalData: clearPersistedData } = useDraftPersistence(initialWorkspace);
  const { commit, undo: undoHistory, redo: redoHistory, reset: resetHistory, canUndo, canRedo } = useHistory(workspace.draft);
  const historyReady = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const registerTextarea = useCallback((element: HTMLTextAreaElement | null) => { textareaRef.current = element; }, []);
  const registerHighlight = useCallback((element: HTMLDivElement | null) => { highlightRef.current = element; }, []);
  const [view, setView] = useState<WorkspaceView>("write");
  const [filter, setFilter] = useState<IssueFilter>("all");
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [dismissedIssueKeys, setDismissedIssueKeys] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newDraftOpen, setNewDraftOpen] = useState(false);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");
  const [systemDark, setSystemDark] = useState(false);
  const { selection, selectedText, updateFromElement, setSelection } = useSelection(workspace.draft);
  const { preview: rewritePreview, run: requestRewrite, cancel: cancelRewrite, selectAlternative } = useRewrite();
  const analysisState = useAnalysis({ text: workspace.draft, goals: workspace.goals, style: workspace.style, settings: workspace.provider, aiEnabled: workspace.aiEnabled, classifier: workspace.classifier ?? null });
  const analysis = analysisState.analysis;
  const issues = analysis.issues;

  useEffect(() => {
    if (!hydrated || historyReady.current) return;
    resetHistory(workspace.draft);
    historyReady.current = true;
  }, [hydrated, resetHistory, workspace.draft]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const updateDraft = useCallback((next: string, recordHistory = true) => {
    updateWorkspace({ draft: next });
    if (recordHistory) commit(next);
  }, [commit, updateWorkspace]);

  const updateGoals = useCallback((patch: Partial<WritingGoals>) => {
    cancelRewrite();
    updateWorkspace((current) => ({ ...current, goals: { ...current.goals, ...patch } }));
  }, [cancelRewrite, updateWorkspace]);

  const updateStyle = useCallback((style: StylePreferences) => {
    cancelRewrite();
    updateWorkspace({ style });
  }, [cancelRewrite, updateWorkspace]);

  const updateProvider = useCallback((provider: ProviderSettings) => {
    cancelRewrite();
    updateWorkspace({ provider });
  }, [cancelRewrite, updateWorkspace]);

  const updateAiEnabled = useCallback((aiEnabled: boolean) => {
    if (!aiEnabled) cancelRewrite();
    updateWorkspace({ aiEnabled });
  }, [cancelRewrite, updateWorkspace]);

  const openIssues = useMemo(
    () => getOpenIssues(issues, dismissedIssueKeys),
    [issues, dismissedIssueKeys],
  );
  const visibleIssues = useMemo(
    () => openIssues.filter((issue) => categoryMatches(issue, filter)),
    [openIssues, filter],
  );

  const currentActiveIssueId = useMemo(
    () => activeIssueId && openIssues.some((issue) => issue.id === activeIssueId) ? activeIssueId : null,
    [activeIssueId, openIssues],
  );

  const acceptIssue = useCallback((issue: WritingIssue) => {
    if (!issue.replacement || issue.replacement === issue.original || workspace.draft.slice(issue.start, issue.end) !== issue.original) return;
    updateDraft(`${workspace.draft.slice(0, issue.start)}${issue.replacement}${workspace.draft.slice(issue.end)}`);
    setActiveIssueId(null);
    window.setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(issue.start, issue.start + issue.replacement.length); }, 0);
  }, [updateDraft, workspace.draft]);

  const acceptAll = useCallback(() => {
    const next = applyIssueReplacements(workspace.draft, visibleIssues);
    if (next !== workspace.draft) updateDraft(next);
    setActiveIssueId(null);
  }, [updateDraft, visibleIssues, workspace.draft]);

  const applyHistory = useCallback((next: string | undefined) => {
    if (next !== undefined) {
      updateDraft(next, false);
      setActiveIssueId(null);
    }
  }, [updateDraft]);

  const undo = useCallback(() => applyHistory(undoHistory()), [applyHistory, undoHistory]);
  const redo = useCallback(() => applyHistory(redoHistory()), [applyHistory, redoHistory]);

  const runRewrite = useCallback((label: string, instruction: string) => {
    if (!selectedText.trim()) return;
    void requestRewrite({ label, instruction, text: selectedText, selection, goals: workspace.goals, style: workspace.style, settings: workspace.provider, aiEnabled: workspace.aiEnabled });
  }, [requestRewrite, selectedText, selection, workspace.goals, workspace.provider, workspace.style, workspace.aiEnabled]);

  const applyRewrite = useCallback((insert: boolean) => {
    if (!rewritePreview || !canApplyRewritePreview(rewritePreview)) return;
    const { start, end } = rewritePreview.selection;
    if (workspace.draft.slice(start, end) !== rewritePreview.original) { cancelRewrite(); return; }
    const next = insert ? `${workspace.draft.slice(0, end)}\n${rewritePreview.replacement}${workspace.draft.slice(end)}` : `${workspace.draft.slice(0, start)}${rewritePreview.replacement}${workspace.draft.slice(end)}`;
    updateDraft(next);
    setSelection(insert ? { start: end + 1, end: end + 1 + rewritePreview.replacement.length } : { start, end: start + rewritePreview.replacement.length });
    cancelRewrite();
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [cancelRewrite, rewritePreview, setSelection, updateDraft, workspace.draft]);

  const retryRewrite = useCallback(() => {
    if (!rewritePreview) return;
    void requestRewrite(createRewriteRetryArgs(rewritePreview, workspace.provider));
  }, [requestRewrite, rewritePreview, workspace.provider]);

  const copyRewrite = useCallback(() => {
    if (rewritePreview && canApplyRewritePreview(rewritePreview)) void navigator.clipboard?.writeText(rewritePreview.replacement);
  }, [rewritePreview]);

  const startNewDocument = useCallback(() => {
    cancelRewrite();
    updateWorkspace({ title: "Untitled draft", draft: "" });
    commit("");
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
  }, [cancelRewrite, commit, setSelection, updateWorkspace]);

  const newDocument = useCallback(() => {
    if (!workspace.draft.trim()) {
      startNewDocument();
      return;
    }
    setNewDraftOpen(true);
  }, [startNewDocument, workspace.draft]);

  const clearDocument = useCallback(() => {
    cancelRewrite();
    updateDraft("");
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
  }, [cancelRewrite, setSelection, updateDraft]);

  const restoreSample = useCallback(() => {
    cancelRewrite();
    updateDraft(SAMPLE_DOCUMENT);
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
  }, [cancelRewrite, setSelection, updateDraft]);

  const onAddToDictionary = useCallback((word: string) => {
    const value = word.trim();
    if (!value) return;
    updateWorkspace((current) => ({ ...current, style: { ...current.style, personalDictionary: [...new Set([...current.style.personalDictionary, value])] } }));
    setDismissedIssueKeys((current) => [...new Set([...current, ...issues.filter((issue) => issue.original === word).map(getIssueDismissalKey)])]);
  }, [issues, updateWorkspace]);

  const scrollEditor = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const onSelectIssue = useCallback((issue: WritingIssue) => {
    setActiveIssueId(issue.id);
    window.setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(issue.start, issue.end); }, 0);
  }, []);

  const clearLocalData = useCallback(() => {
    cancelRewrite();
    clearPersistedData();
    resetHistory(SAMPLE_DOCUMENT);
    setSettingsOpen(false);
    setNewDraftOpen(false);
    setClearDataOpen(false);
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
  }, [cancelRewrite, clearPersistedData, resetHistory, setSelection]);

  useEffect(() => {
    const handleShortcuts = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "s") { event.preventDefault(); saveNow(); return; }
      if (settingsOpen || shortcutsOpen || newDraftOpen || clearDataOpen) return;
      if (modifier && event.key === "Enter") { event.preventDefault(); acceptAll(); return; }
      if (event.key === "Escape" && rewritePreview) { cancelRewrite(); return; }
      if (event.key === "?" && !modifier && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, [acceptAll, cancelRewrite, clearDataOpen, newDraftOpen, rewritePreview, saveNow, settingsOpen, shortcutsOpen]);

  const darkMode = workspace.theme === "dark" || (workspace.theme === "system" && systemDark);
  const savedLabel = !hydrated
    ? "Loading local draft…"
    : saveStatus === "saving"
      ? "Saving locally…"
      : saveStatus === "error"
        ? "Could not save locally"
        : saveStatus === "saved"
          ? "Saved locally"
          : "Not saved yet";
  const providerConfigured = Boolean(workspace.provider.apiKey.trim() && workspace.provider.baseUrl.trim() && workspace.provider.model.trim());
  const analysisStatusLabel = getAiReviewStatus(analysis.aiCoverage, workspace.aiEnabled, providerConfigured, analysisState.status);

  return (
    <main className={`app-shell ${focusMode ? "focus-mode" : ""}`} data-theme={darkMode ? "dark" : "light"}>
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span /></div><span className="brand-name">draftwise</span><Badge className="private-badge"><ShieldCheck size={12} /> private</Badge></div>
        <div className="document-name"><FileText size={15} /><input aria-label="Document title" value={workspace.title} onChange={(event) => updateWorkspace({ title: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><span className="saved-dot" title={savedLabel} /></div>
        <div className="topbar-actions"><div className="privacy-pill"><span className="privacy-dot" /> Local-first, cloud opt-in</div><Button variant="ghost" size="icon" aria-label={darkMode ? "Use light theme" : "Use dark theme"} onClick={() => updateWorkspace({ theme: darkMode ? "light" : "dark" })}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}</Button><Button variant="ghost" size="icon" aria-label="Open settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></Button></div>
      </header>

      <div className="app-body">
        <aside className="left-rail">
          <div className="rail-nav"><button className={view === "write" ? "rail-button active" : "rail-button"} onClick={() => setView("write")} type="button"><PenLine size={18} /><span>Write</span></button><button className={view === "insights" ? "rail-button active" : "rail-button"} onClick={() => setView("insights")} type="button"><BarChart3 size={18} /><span>Insights</span></button><button className={view === "extension" ? "rail-button active" : "rail-button"} onClick={() => setView("extension")} type="button"><Puzzle size={18} /><span>Extension</span><span className="rail-new">new</span></button></div>
          <div className="rail-divider" />
          <div className="rail-context"><span className="rail-eyebrow">Writing goals</span><div className="rail-goal"><Target size={15} /><span>{workspace.goals.audience}</span></div><div className="rail-goal"><Flag size={15} /><span>{workspace.goals.intent}</span></div><div className="rail-goal"><Sparkles size={15} /><span>{workspace.goals.tone}</span></div><button className="rail-edit" onClick={() => setView("write")} type="button">Edit goals <Target size={13} /></button></div>
          <div className="rail-bottom"><button className="rail-button" type="button" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /><span>Settings</span></button><button className="rail-button" type="button" onClick={() => setShortcutsOpen(true)}><CircleHelp size={17} /><span>Shortcuts</span><kbd>?</kbd></button></div>
        </aside>

        <div className="app-content">
          {view === "write" ? <EditorWorkspace draft={workspace.draft} goals={workspace.goals} style={workspace.style} analysis={analysis} openIssues={openIssues} visibleIssues={visibleIssues} activeIssueId={currentActiveIssueId} filter={filter} analyzing={analysisState.isAnalysing} analysisStatusLabel={analysisStatusLabel} analysisError={analysisState.error} savedLabel={savedLabel} saveError={saveError} selection={selection} selectedText={selectedText} customInstruction={customInstruction} rewritePreview={rewritePreview} suggestionsOpen={suggestionsOpen} focusMode={focusMode} canUndo={canUndo} canRedo={canRedo} registerTextarea={registerTextarea} registerHighlight={registerHighlight} onDraftChange={(event) => updateDraft(event.target.value)} onGoalChange={updateGoals} onFilterChange={setFilter} onSelectionChange={() => updateFromElement(textareaRef.current)} onScroll={scrollEditor} onSelectIssue={onSelectIssue} onAcceptIssue={acceptIssue} onDismissIssue={(issue) => { setDismissedIssueKeys((current) => [...new Set([...current, getIssueDismissalKey(issue)])]); setActiveIssueId(null); }} onAddToDictionary={onAddToDictionary} onAcceptAll={acceptAll} onUndo={undo} onRedo={redo} onRunRewrite={runRewrite} onCustomInstructionChange={setCustomInstruction} onReplaceRewrite={applyRewrite} onCopyRewrite={copyRewrite} onRetryRewrite={retryRewrite} onCancelRewrite={cancelRewrite} onSelectRewriteAlternative={selectAlternative} onToggleSuggestions={() => setSuggestionsOpen((value) => !value)} onToggleFocusMode={() => setFocusMode((value) => !value)} onNewDocument={newDocument} onClearDocument={clearDocument} onRestoreSample={restoreSample} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenSettings={() => setSettingsOpen(true)} /> : null}
          {view === "insights" ? <InsightsView analysis={analysis} goals={workspace.goals} onBack={() => setView("write")} onOpenSettings={() => setSettingsOpen(true)} /> : null}
          {view === "extension" ? <ExtensionGuide onOpenSettings={() => setSettingsOpen(true)} /> : null}
        </div>
      </div>

      <ProviderSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={workspace.provider} style={workspace.style} aiEnabled={workspace.aiEnabled} classifier={workspace.classifier ?? null} onSettingsChange={updateProvider} onClassifierChange={(classifier) => updateWorkspace({ classifier })} onStyleChange={updateStyle} onAiEnabledChange={updateAiEnabled} onForgetKeys={cancelRewrite} onSave={saveNow} onClearData={() => { setSettingsOpen(false); setClearDataOpen(true); }} />
      <ShortcutDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <NewDraftDialog open={newDraftOpen} onOpenChange={setNewDraftOpen} onConfirm={startNewDocument} />
      <ClearDataDialog open={clearDataOpen} onOpenChange={setClearDataOpen} onConfirm={clearLocalData} />
    </main>
  );
}
