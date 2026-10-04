"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BarChart3, CircleHelp, FileText, Flag, Moon, PenLine, Puzzle, Settings2, ShieldCheck, Sparkles, Sun, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditorWorkspace } from "@/components/draftwise/EditorWorkspace";
import { DocumentDashboard } from "@/components/draftwise/DocumentDashboard";
import { VersionHistoryView } from "@/components/draftwise/VersionHistoryView";
import { ExtensionGuide } from "@/components/draftwise/ExtensionGuide";
import { InsightsView } from "@/components/draftwise/InsightsView";
import { ProviderSettingsDialog } from "@/components/draftwise/ProviderSettingsDialog";
import { applyIssueReplacements, getIssueDismissalKey, getOpenIssues } from "@/lib/issue-actions";
import { canApplyRewritePreview } from "@/lib/rewrite-retry";
import { buildSuggestionState, filterByTier, ruleFamily, type TierFilter } from "@/lib/suggestions";
import { clearAllLocalData } from "@/lib/clear-local-data";
import { recordDismissal, recordRuleControl } from "@/lib/writing-profile";
import { rewriteActionsFor, significantRewriteInstruction } from "@/lib/rewrite-actions";
import { captureBaseline, scoreProgress, type InsightBaseline } from "@/lib/insight-progress";
import { downloadFile, exportAsMarkdown, exportAsText, importDocument } from "@/lib/import-export";
import { useDocuments } from "@/hooks/useDocuments";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { DocumentHistoryStore } from "@/lib/document-history";
import { createRewriteRetryArgs, useRewrite } from "@/hooks/useRewrite";
import { useSelection } from "@/hooks/useSelection";
import { getAiReviewStatus, type PrioritisedIssue, type ProviderSettings, type StylePreferences, type WritingGoals, type WritingIssue } from "@/packages/types/src";
import { DEFAULT_WORKSPACE } from "@/packages/types/src";

const SAMPLE_DOCUMENT = `The best writing systems make the next sentence easier to write. Draftwise keeps your words private by default, then gives you a clear path from rough idea to finished copy.

It catches repeatd words, extra spaces  and common spelling slips as you draft. You can also ask a model to improve clarity, shorten a paragraph, or make the tone more confident — using your own API key.

The result is a calmer writing loop: notice one useful change, accept it when it helps, and keep your voice intact.`;

type WorkspaceView = "home" | "write" | "insights" | "extension" | "history";

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
            This starts a fresh blank document. Your current text stays intact in Documents and its version history — undo now works within each document, so return to the previous document to recover anything.
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
            This removes every document and version snapshot, your draft and preferences (personal dictionary, dismissed and disabled suggestion rules), provider and classifier credentials, and all other local Draftwise storage from this browser. Reload and Draftwise starts clean. This cannot be undone.
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
  const initialWorkspace = useMemo(() => DEFAULT_WORKSPACE(), []);
  const { workspace, hydrated, saveStatus, saveError, updateWorkspace, saveNow, clearLocalData: clearPersistedData } = useDraftPersistence(initialWorkspace);
  // Document content lives in exactly one state system: the document store.
  // The editor reads documents.active and writes back through updateActive;
  // workspace holds only global configuration plus activeDocumentId metadata.
  const documents = useDocuments({ title: "Untitled draft", draft: SAMPLE_DOCUMENT }, hydrated, workspace.activeDocumentId);
  const draftText = documents.active?.draft ?? "";
  const draftTitle = documents.active?.title ?? "Untitled draft";
  // Undo/redo is scoped per document: each document owns its own stack, so
  // switching documents can never expose one document's text to another's undo.
  // The store is a proper external store: mutations notify React through
  // useSyncExternalStore, never through render-time refs or effect setState.
  const [historyStore] = useState(() => new DocumentHistoryStore());
  const activeId = documents.activeId || "draft";
  const historySnapshot = useSyncExternalStore(
    historyStore.subscribe,
    useCallback(() => historyStore.snapshot(activeId), [activeId, historyStore]),
    useCallback(() => historyStore.snapshot(activeId), [activeId, historyStore]),
  );
  // Persist the last-opened document as workspace metadata so reopening
  // Draftwise restores it. Stale IDs fall back safely inside lifecycle.load().
  const storedActiveId = useRef<string | null>(null);
  useEffect(() => {
    if (!documents.activeId || documents.activeId === storedActiveId.current) return;
    storedActiveId.current = documents.activeId;
    updateWorkspace({ activeDocumentId: documents.activeId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- metadata sync only
  }, [documents.activeId]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const registerTextarea = useCallback((element: HTMLTextAreaElement | null) => { textareaRef.current = element; }, []);
  const registerHighlight = useCallback((element: HTMLDivElement | null) => { highlightRef.current = element; }, []);
  const [view, setView] = useState<WorkspaceView>("write");
  const [filter, setFilter] = useState<TierFilter>("all");
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [dismissedIssueKeys, setDismissedIssueKeys] = useState<string[]>([]);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newDraftOpen, setNewDraftOpen] = useState(false);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [systemDark, setSystemDark] = useState(false);
  const { selection, selectedText, updateFromElement, setSelection } = useSelection(draftText);
  const { preview: rewritePreview, run: requestRewrite, cancel: cancelRewrite, selectAlternative } = useRewrite();
  const analysisState = useAnalysis({ text: draftText, goals: workspace.goals, style: workspace.style, settings: workspace.provider, aiEnabled: workspace.aiEnabled, classifier: workspace.classifier ?? null });
  const analysis = analysisState.analysis;
  const issues = analysis.issues;

  useEffect(() => {
    // Each document opens its own history the first time it becomes active.
    // Opening a document never adds its text to another document's undo chain.
    if (!activeId) return;
    historyStore.open(activeId, draftText);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the active document changes
  }, [activeId]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const updateDraft = useCallback((next: string, recordHistory = true) => {
    documents.updateActive({ draft: next });
    if (recordHistory) {
      historyStore.commit(activeId, next);
    }
  }, [activeId, documents, historyStore]);

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
  const suggestions = useMemo(
    () => buildSuggestionState({ issues: openIssues, goals: workspace.goals, style: workspace.style, dismissedKeys: dismissedIssueKeys, text: draftText }),
    [dismissedIssueKeys, openIssues, draftText, workspace.goals, workspace.style],
  );
  const visibleIssues = useMemo(
    () => filterByTier(suggestions.displayed, filter),
    [filter, suggestions.displayed],
  );

  // Insights progress: the baseline is captured when the document becomes
  // active, so the writer sees what their editing actually changed.
  const baselineKeyRef = useRef<string | null>(null);
  const [insightBaseline, setInsightBaseline] = useState<InsightBaseline | null>(null);
  const baselineReady = !analysisState.isAnalysing && analysis.analysedText === draftText;
  useEffect(() => {
    if (!baselineReady) return;
    const key = documents.activeId || "single";
    if (baselineKeyRef.current === key) return;
    baselineKeyRef.current = key;
    setInsightBaseline(captureBaseline(analysis, openIssues));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineReady, documents.activeId]);
  const progress = useMemo(
    () => (insightBaseline && baselineReady ? scoreProgress(insightBaseline, analysis, openIssues) : []),
    [analysis, baselineReady, insightBaseline, openIssues],
  );

  const currentActiveIssueId = useMemo(
    () => activeIssueId && openIssues.some((issue) => issue.id === activeIssueId) ? activeIssueId : null,
    [activeIssueId, openIssues],
  );

  const advanceFocus = useCallback((issues: PrioritisedIssue[], handled: WritingIssue) => {
    setReviewedCount((count) => count + 1);
    const next = issues.find((issue) => issue.id !== handled.id);
    if (!next) {
      setActiveIssueId(null);
      return;
    }
    setActiveIssueId(next.id);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.start, next.end);
    }, 0);
  }, []);

  const acceptIssue = useCallback((issue: WritingIssue) => {
    if (!issue.replacement || issue.replacement === issue.original || draftText.slice(issue.start, issue.end) !== issue.original) return;
    updateDraft(`${draftText.slice(0, issue.start)}${issue.replacement}${draftText.slice(issue.end)}`);
    advanceFocus(visibleIssues, issue);
    window.setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(issue.start, issue.start + issue.replacement.length); }, 0);
  }, [advanceFocus, updateDraft, visibleIssues, draftText]);

  const dismissIssue = useCallback((issue: WritingIssue) => {
    setDismissedIssueKeys((current) => [...new Set([...current, getIssueDismissalKey(issue)])]);
    // The Writing Profile learns from repeated dismissals of the same type.
    updateWorkspace((current) => ({ ...current, style: recordDismissal(current.style, issue) }));
    advanceFocus(visibleIssues, issue);
  }, [advanceFocus, updateWorkspace, visibleIssues]);

  const acceptAll = useCallback(() => {
    const next = applyIssueReplacements(draftText, visibleIssues);
    if (next !== draftText) {
      // Checkpoint first: bulk-applying suggestions is a major operation.
      documents.saveSnapshot("manual");
      updateDraft(next);
    }
    setActiveIssueId(null);
  }, [documents, updateDraft, visibleIssues, draftText]);

  const applyHistory = useCallback((next: string | null) => {
    if (next !== null) {
      cancelRewrite();
      updateDraft(next, false);
      setSelection({ start: 0, end: 0 });
      setActiveIssueId(null);
    }
  }, [cancelRewrite, setSelection, updateDraft]);

  const undo = useCallback(() => {
    applyHistory(historyStore.undo(activeId || "draft"));
  }, [activeId, applyHistory]);
  const redo = useCallback(() => {
    applyHistory(historyStore.redo(activeId || "draft"));
  }, [activeId, applyHistory]);

  const runRewrite = useCallback((label: string, instruction: string) => {
    if (!selectedText.trim()) return;
    // Significant rewrites ask the provider for genuinely different
    // alternatives; small fixes stay single-answer. The preview still decides.
    const action = rewriteActionsFor(selectedText, workspace.goals, workspace.style).find((candidate) => candidate.label === label);
    const finalInstruction = action?.significant ? significantRewriteInstruction(instruction) : instruction;
    void requestRewrite({ label, instruction: finalInstruction, text: selectedText, selection, goals: workspace.goals, style: workspace.style, settings: workspace.provider, aiEnabled: workspace.aiEnabled, draft: draftText });
  }, [requestRewrite, selectedText, selection, draftText, workspace.goals, workspace.provider, workspace.style, workspace.aiEnabled]);

  const applyRewrite = useCallback((insert: boolean) => {
    if (!rewritePreview || !canApplyRewritePreview(rewritePreview)) return;
    const { start, end } = rewritePreview.selection;
    if (draftText.slice(start, end) !== rewritePreview.original) { cancelRewrite(); return; }
    // Checkpoint before a significant rewrite: replacing a large selection is
    // exactly the kind of change worth being able to undo from history.
    const selectedLength = end - start;
    if (selectedLength >= 200 || rewritePreview.source === "ai") documents.saveSnapshot("manual");
    const next = insert ? `${draftText.slice(0, end)}\n${rewritePreview.replacement}${draftText.slice(end)}` : `${draftText.slice(0, start)}${rewritePreview.replacement}${draftText.slice(end)}`;
    updateDraft(next);
    setSelection(insert ? { start: end + 1, end: end + 1 + rewritePreview.replacement.length } : { start, end: start + rewritePreview.replacement.length });
    cancelRewrite();
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [cancelRewrite, documents, rewritePreview, setSelection, updateDraft, draftText]);

  const retryRewrite = useCallback(() => {
    if (!rewritePreview) return;
    void requestRewrite({ ...createRewriteRetryArgs(rewritePreview, workspace.provider), draft: rewritePreview.draft ?? draftText });
  }, [requestRewrite, rewritePreview, workspace.provider, draftText]);

  const copyRewrite = useCallback(() => {
    if (rewritePreview && canApplyRewritePreview(rewritePreview)) void navigator.clipboard?.writeText(rewritePreview.replacement);
  }, [rewritePreview]);

  const startNewDocument = useCallback(() => {
    cancelRewrite();
    const document = documents.createNew("Untitled draft", "");
    // The new document opens its own history with its blank text as the base
    // state: the previous document's content can never be undone into it.
    historyStore.open(document.id, document.draft);
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
    // A new document means the writer is writing: land them in the editor.
    setView("write");
  }, [cancelRewrite, documents, setSelection]);

  const newDocument = useCallback(() => {
    if (!(documents.active?.draft ?? "").trim()) {
      startNewDocument();
      return;
    }
    setNewDraftOpen(true);
  }, [documents.active, startNewDocument]);

  /**
   * The one canonical save: flush the active document and the global workspace
   * configuration together. "Saved" is only reported when both persistence
   * surfaces confirm their writes; a failure on either reports failure while
   * the text stays in memory and retryable.
   */
  const saveAll = useCallback(() => {
    const settingsResult = saveNow();
    void documents.flush();
    if (!settingsResult.ok) return settingsResult;
    if (documents.saveStatus === "error") return { ok: false as const, error: "Could not save the document locally." };
    return { ok: true as const };
  }, [documents, saveNow]);

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

  const openDocument = useCallback((id: string) => {
    if (id === documents.activeId) {
      setView("write");
      return;
    }
    // Flush any pending edit of the current document before switching so a
    // pending write can never land on the document being opened.
    void documents.flush();
    const target = documents.documents.find((document) => document.id === id);
    if (!target) return;
    cancelRewrite();
    documents.open(id);
    // Opening a document opens (or reuses) its own history. Nothing is ever
    // appended to the previous document's undo chain here.
    historyStore.open(id, target.draft);
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
    setView("write");
  }, [cancelRewrite, documents, setSelection]);

  const importFromFile = useCallback((file: File) => {
    void file.text().then((content) => {
      const result = importDocument(file.name, content);
      if (!result.ok) {
        setImportError(result.error);
        return;
      }
      setImportError(null);
      const document = documents.createNew(result.title, result.text);
      historyStore.open(document.id, document.draft);
      setDismissedIssueKeys([]);
      setActiveIssueId(null);
      setView("write");
    });
  }, [documents]);

  const exportDocument = useCallback((id: string, format: "txt" | "md") => {
    const target = documents.documents.find((document) => document.id === id);
    if (!target) return;
    const file = format === "md" ? exportAsMarkdown(target.title, target.draft) : exportAsText(target.title, target.draft);
    downloadFile(file);
  }, [documents.documents]);

  const duplicateDocument = useCallback((id: string) => {
    const copy = documents.duplicate(id);
    if (!copy) return;
    // The duplicate's history starts from its copied text only.
    historyStore.open(copy.id, copy.draft);
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
    setView("write");
  }, [documents, setSelection]);

  const deleteDocument = useCallback((id: string) => {
    const wasActive = id === documents.activeId;
    // Drop the deleted document's undo history so its text cannot reappear.
    historyStore.remove(id);
    documents.remove(id);
    if (!wasActive) return;
    // The lifecycle guarantees a real active document after deletion; mirror it.
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
    setSelection({ start: 0, end: 0 });
  }, [documents, setSelection]);

  // Document content lives in exactly one state system (the document store),
  // so no mirror or repair effect is needed: the editor reads documents.active
  // directly and every edit writes back through updateActive.
  useEffect(() => {
    if (documents.active) historyStore.open(documents.active.id, documents.active.draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open is idempotent per document
  }, [documents.active?.id]);

  const onAddToDictionary = useCallback((word: string) => {
    const value = word.trim();
    if (!value) return;
    updateWorkspace((current) => ({ ...current, style: { ...current.style, personalDictionary: [...new Set([...current.style.personalDictionary, value])] } }));
    setDismissedIssueKeys((current) => [...new Set([...current, ...issues.filter((issue) => issue.original === word).map(getIssueDismissalKey)])]);
  }, [issues, updateWorkspace]);

  const ruleControl = useCallback((ruleId: string, action: "reduce" | "off") => {
    updateWorkspace((current) => {
      const style = current.style;
      const ignoredRuleIds = action === "off" ? [...new Set([...style.ignoredRuleIds, ruleFamily(ruleId)])] : style.ignoredRuleIds;
      const reducedRuleIds = action === "reduce" ? [...new Set([...style.reducedRuleIds, ruleFamily(ruleId)])] : style.reducedRuleIds;
      return { ...current, style: recordRuleControl({ ...style, ignoredRuleIds, reducedRuleIds }, ruleFamily(ruleId), action) };
    });
    setActiveIssueId(null);
  }, [updateWorkspace]);

  const applyGroup = useCallback((groupIssues: WritingIssue[]) => {
    // Only offered when every occurrence is the same edit; still validated
    // span by span before anything is written.
    const actionable = groupIssues.filter((issue) => issue.replacement && issue.replacement !== issue.original && draftText.slice(issue.start, issue.end) === issue.original);
    if (!actionable.length) return;
    const next = applyIssueReplacements(draftText, actionable);
    if (next === draftText) return;
    documents.saveSnapshot("manual");
    updateDraft(next);
    setDismissedIssueKeys((current) => [...new Set([...current, ...groupIssues.map(getIssueDismissalKey)])]);
    setReviewedCount((count) => count + 1);
    setActiveIssueId(null);
  }, [documents, updateDraft, draftText]);

  const dismissGroup = useCallback((groupIssues: WritingIssue[]) => {
    setDismissedIssueKeys((current) => [...new Set([...current, ...groupIssues.map(getIssueDismissalKey)])]);
    setActiveIssueId(null);
  }, []);

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
    void clearAllLocalData({
      onClearMemory: () => {
        clearPersistedData();
        void documents.clearAll({ title: "Untitled draft", draft: "" });
      },
    });
    // Clearing local data clears every undo history too.
    historyStore.clear();
    setSettingsOpen(false);
    setNewDraftOpen(false);
    setClearDataOpen(false);
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
  }, [cancelRewrite, clearPersistedData, documents, setSelection, updateWorkspace]);

  useEffect(() => {
    const handleShortcuts = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        // A deliberate save is a checkpoint the writer can return to later.
        documents.saveSnapshot("manual");
        saveAll();
        return;
      }
      // Undo/redo inside the editor is Draftwise's per-document history. The
      // browser's native textarea undo must be suppressed: it mutates a
      // controlled value outside React state and would corrupt the document.
      const inEditor = event.target instanceof HTMLTextAreaElement;
      if (inEditor && modifier && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (inEditor && modifier && (event.shiftKey && event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
        event.preventDefault();
        redo();
        return;
      }
      if (settingsOpen || shortcutsOpen || newDraftOpen || clearDataOpen) return;
      if (modifier && event.key === "Enter") { event.preventDefault(); acceptAll(); return; }
      if (event.key === "Escape" && rewritePreview) { cancelRewrite(); return; }
      if (event.key === "?" && !modifier && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, [acceptAll, cancelRewrite, clearDataOpen, documents, newDraftOpen, redo, rewritePreview, saveAll, settingsOpen, shortcutsOpen, undo]);

  const darkMode = workspace.theme === "dark" || (workspace.theme === "system" && systemDark);
  // Truthful save state: combines workspace-settings persistence and the
  // document store's own confirmed writes. "Saved locally" appears only after
  // both persisted; degraded storage tiers are named rather than hidden.
  const docSaving = documents.saveStatus === "saving" || saveStatus === "saving";
  const docFailed = documents.saveStatus === "error" || saveStatus === "error";
  const memoryOnly = documents.storageMode === "memory";
  // Both persistence surfaces must be hydrated before anything can honestly
  // be called loaded: workspace settings and the document store hydrate
  // independently, and the editor must not present the seed text as a saved
  // document while the store is still loading.
  const loading = !hydrated || !documents.hydrated;
  const savedLabel = loading
    ? "Loading local draft…"
    : docFailed
      ? "Could not save locally — your text is still here; we'll retry"
      : memoryOnly
        ? "Storage unavailable — changes are kept only until this tab closes"
        : docSaving
          ? "Saving…"
          : documents.saveStatus === "saved" || saveStatus === "saved"
            ? documents.storageMode === "localstorage"
              ? "Saved locally (fallback storage)"
              : "Saved locally"
            : "Unsaved changes";
  const providerConfigured = Boolean(workspace.provider.apiKey.trim() && workspace.provider.baseUrl.trim() && workspace.provider.model.trim());
  const analysisStatusLabel = getAiReviewStatus(analysis.aiCoverage, workspace.aiEnabled, providerConfigured, analysisState.status);

  return (
    <main className={`app-shell ${focusMode ? "focus-mode" : ""}`} data-theme={darkMode ? "dark" : "light"}>
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span /></div><span className="brand-name">draftwise</span><Badge className="private-badge"><ShieldCheck size={12} /> private</Badge></div>
        <div className="document-name"><FileText size={15} /><input aria-label="Document title" value={draftTitle} onChange={(event) => {
          // The stored document is authoritative for the title: every rename
          // writes through the lifecycle so dashboard, exports, history and
          // reload all see the same name.
          documents.updateActive({ title: event.target.value });
        }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><span className="saved-dot" title={savedLabel} /></div>
        <div className="topbar-actions"><div className="privacy-pill"><span className="privacy-dot" /> Local-first, cloud opt-in</div><Button variant="ghost" size="icon" aria-label={darkMode ? "Use light theme" : "Use dark theme"} onClick={() => updateWorkspace({ theme: darkMode ? "light" : "dark" })}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}</Button><Button variant="ghost" size="icon" aria-label="Open settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></Button></div>
      </header>

      <div className="app-body">
        <aside className="left-rail">
          <div className="rail-nav"><button className={view === "home" ? "rail-button active" : "rail-button"} onClick={() => setView("home")} type="button"><FileText size={18} /><span>Documents</span></button><button className={view === "write" ? "rail-button active" : "rail-button"} onClick={() => setView("write")} type="button"><PenLine size={18} /><span>Write</span></button><button className={view === "insights" ? "rail-button active" : "rail-button"} onClick={() => setView("insights")} type="button"><BarChart3 size={18} /><span>Insights</span></button><button className={view === "extension" ? "rail-button active" : "rail-button"} onClick={() => setView("extension")} type="button"><Puzzle size={18} /><span>Extension</span><span className="rail-new">new</span></button></div>
          <div className="rail-divider" />
          <div className="rail-context"><span className="rail-eyebrow">Writing goals</span><div className="rail-goal"><Target size={15} /><span>{workspace.goals.audience}</span></div><div className="rail-goal"><Flag size={15} /><span>{workspace.goals.intent}</span></div><div className="rail-goal"><Sparkles size={15} /><span>{workspace.goals.tone}</span></div><button className="rail-edit" onClick={() => setView("write")} type="button">Edit goals <Target size={13} /></button></div>
          <div className="rail-bottom"><button className="rail-button" type="button" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /><span>Settings</span></button><button className="rail-button" type="button" onClick={() => setShortcutsOpen(true)}><CircleHelp size={17} /><span>Shortcuts</span><kbd>?</kbd></button></div>
        </aside>

        <div className="app-content">
          {view === "home" ? <DocumentDashboard summaries={documents.summaries} activeId={documents.activeId} importError={importError} onOpen={openDocument} onNew={startNewDocument} onDuplicate={duplicateDocument} onDelete={deleteDocument} onImport={importFromFile} onExport={exportDocument} onHistory={(id) => { documents.open(id); setView("history"); }} /> : null}
          {view === "write" ? <EditorWorkspace draft={draftText} goals={workspace.goals} style={workspace.style} analysis={analysis} openIssues={openIssues} visibleIssues={visibleIssues} suggestions={suggestions} activeIssueId={currentActiveIssueId} filter={filter} analyzing={analysisState.isAnalysing} analysisStatusLabel={analysisStatusLabel} analysisError={analysisState.error} savedLabel={savedLabel} saveError={saveError} selection={selection} selectedText={selectedText} customInstruction={customInstruction} rewritePreview={rewritePreview} suggestionsOpen={suggestionsOpen} focusMode={focusMode} canUndo={historySnapshot.canUndo} canRedo={historySnapshot.canRedo} registerTextarea={registerTextarea} registerHighlight={registerHighlight} onDraftChange={(event) => updateDraft(event.target.value)} onGoalChange={updateGoals} onFilterChange={setFilter} onSelectionChange={() => updateFromElement(textareaRef.current)} onScroll={scrollEditor} onSelectIssue={onSelectIssue} onAcceptIssue={acceptIssue} onDismissIssue={dismissIssue} onAddToDictionary={onAddToDictionary} onRuleControl={ruleControl} onApplyGroup={applyGroup} onDismissGroup={dismissGroup} reviewedCount={reviewedCount} onAcceptAll={acceptAll} onUndo={undo} onRedo={redo} onRunRewrite={runRewrite} onCustomInstructionChange={setCustomInstruction} onReplaceRewrite={applyRewrite} onCopyRewrite={copyRewrite} onRetryRewrite={retryRewrite} onCancelRewrite={cancelRewrite} onSelectRewriteAlternative={selectAlternative} onToggleSuggestions={() => setSuggestionsOpen((value) => !value)} onToggleFocusMode={() => setFocusMode((value) => !value)} onNewDocument={newDocument} onClearDocument={clearDocument} onRestoreSample={restoreSample} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenSettings={() => setSettingsOpen(true)} /> : null}
          {view === "insights" ? <InsightsView analysis={analysis} goals={workspace.goals} openIssues={openIssues} tierCounts={suggestions.report.byTier} progress={progress} onBack={() => setView("write")} onOpenSettings={() => setSettingsOpen(true)} onJumpToIssue={(issue) => { setView("write"); onSelectIssue(issue); }} /> : null}
          {view === "history" && documents.active ? <VersionHistoryView document={documents.active} onBack={() => setView("write")} onRestore={(snapshot) => { documents.restoreSnapshot(documents.activeId, snapshot.id); setView("write"); }} onDuplicateSnapshot={(snapshot) => { documents.duplicateSnapshot(documents.activeId, snapshot.id); setView("write"); }} /> : null}
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
