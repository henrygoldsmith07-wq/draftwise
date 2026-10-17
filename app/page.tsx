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
import { buildSuggestionState, filterByCategory, filterByTier, filterableCategories, ruleFamily, sortForReview, type CategoryFilter, type TierFilter } from "@/lib/suggestions";
import { issueForReviewAction, reviewActionForKey, reviewAnnouncement as reviewAnnouncementFor, stepReviewIndex } from "@/lib/review-navigation";
import { clearAllLocalData } from "@/lib/clear-local-data";
import { recordAcceptance, recordDismissal, recordRuleControl } from "@/lib/writing-profile";
import { rewriteActionsFor, significantRewriteInstruction } from "@/lib/rewrite-actions";
import { captureBaseline, scoreProgress, type InsightBaseline } from "@/lib/insight-progress";
import { countWords, creditSince } from "@/lib/writing-activity";
import { WritingActivityStore } from "@/lib/activity-store";
import { downloadFile, exportAsMarkdown, exportAsText, importDocument, oversizedImport } from "@/lib/import-export";
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
    ["Next suggestion", "⌘ / Ctrl + ↓"],
    ["Previous suggestion", "⌘ / Ctrl + ↑"],
    ["Accept the current suggestion", "⌘ / Ctrl + Enter"],
    ["Ignore the current suggestion", "⌘ / Ctrl + Backspace"],
    ["Accept all visible suggestions", "Ctrl + Shift + Enter"],
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
  // A fresh install seeds an empty draft, never sample prose. The sample used
  // to be the seed, so first run opened the editor cursor-deep in foreign text
  // presented as the writer's own draft. The sample still exists as an
  // explicit action (loadSampleDocument); it is never persisted uninvited.
  const documents = useDocuments({ title: "Untitled draft", draft: "" }, hydrated, workspace.activeDocumentId);
  const draftText = documents.active?.draft ?? "";
  const draftTitle = documents.active?.title ?? "Untitled draft";
  // Goals belong to the document being written, not to the app globally: an
  // academic essay and a casual email need different audiences, intents and
  // tones. The workspace copy remains as the default that new documents start
  // from (and the fallback for documents saved before per-document goals
  // existed), so the writer's most recent choice carries forward.
  const activeGoals = documents.active?.goals ?? workspace.goals;
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
  // Home first. Opening in the editor used to land a fresh install inside the
  // seeded sample; the dashboard is the honest default, and opening any
  // document still lands in the editor from there.
  const [view, setView] = useState<WorkspaceView>("home");
  // Returning writers resume where they left off: once both stores hydrate,
  // a single render-phase adoption moves to the editor when real words exist.
  // A fresh install owns no words (the seed is empty by design), so it stays
  // on the dashboard. This is adoption during render, not setState in an
  // effect, following the same pattern as the dismissal hydration below.
  const [resumed, setResumed] = useState(false);
  if (hydrated && documents.hydrated && !resumed) {
    setResumed(true);
    if (documents.documents.some((document) => document.draft.trim() !== "")) setView("write");
  }
  const [filter, setFilter] = useState<TierFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  // Persist dismissals as the writer makes them.
  //
  // Two hazards, both of which destroyed data in earlier attempts:
  //
  // 1. The workspace hydrates from storage after first render, so state starts
  //    empty while storage holds the stored list. Writing immediately would save
  //    the empty list over it.
  // 2. Conversely, adopting storage's list whenever they differ silently reverts
  //    a dismissal the writer just made, because both effects see the same
  //    change.
  //
  // The distinction is timing: adopt storage only during the hydration window,
  // persist afterwards. lastPersisted is the single source of truth for "what
  // storage already has", so the two paths can never both act on one change.
  //
  // The adoption runs during render rather than in an effect. React's "adjust
  // state when a prop changes" pattern is legal there and re-renders
  // immediately without committing the intermediate value; calling setState in
  // an effect body instead commits twice and can cascade.
  const [dismissedIssueKeys, setDismissedIssueKeys] = useState<string[]>(workspace.dismissedIssueKeys ?? []);
  const [dismissalsAdopted, setDismissalsAdopted] = useState(false);
  if (hydrated && !dismissalsAdopted) {
    // Setting state from inside this branch is the supported pattern: React
    // bails out of the intermediate render and re-runs immediately with the new
    // value, so nothing is ever committed in the half-adopted state.
    setDismissalsAdopted(true);
    setDismissedIssueKeys(workspace.dismissedIssueKeys ?? []);
  }
  // After the hydration window the writer's state is authoritative: anything it
  // does that differs from what storage last held is persisted.
  //
  // The baseline is read from `workspace.dismissedIssueKeys` itself rather than
  // mirrored into more state. Workspace is the persisted record, so "what
  // storage already has" is exactly what it holds, and comparing against it
  // directly keeps the two paths from both acting on one change.
  useEffect(() => {
    if (!hydrated) return;
    const stored = workspace.dismissedIssueKeys ?? [];
    const unchanged = stored.length === dismissedIssueKeys.length
      && stored.every((key, index) => key === dismissedIssueKeys[index]);
    if (unchanged) return;
    updateWorkspace({ dismissedIssueKeys });
  }, [hydrated, workspace.dismissedIssueKeys, dismissedIssueKeys, updateWorkspace]);
  // Findings the writer explicitly opened out of the held-back list. Density
  // caps hide these by design; this is the deliberate override that makes the
  // cap inspectable rather than a silent ceiling.
  const [unhiddenIssueIds, setUnhiddenIssueIds] = useState<string[]>([]);
  // Issue ids embed offsets, so they are only meaningful against the text they
  // were computed from. Reset whenever that text is replaced wholesale: a new or
  // imported document, a restored version, the sample, or a clear. In each case
  // the same offsets describe different words, so a surviving id would force-show
  // a finding via alwaysDisplay that the writer never opened — and unlike a
  // dismissal, which is anchored to its surrounding sentence, this id is a bare
  // offset with nothing to match against.
  //
  // Keyed on text rather than document id, because version restore replaces the
  // draft inside the same document and a stale id survives that just the same.
  // Typing does not trip this: the reference is only updated from these paths.
  const unhiddenForText = useRef<string | null>(null);
  // Takes the replacement text rather than reading draftText, because callers
  // invoke this in the same tick as updateDraft and the state has not applied yet.
  const resetUnhidden = useCallback((nextText: string) => {
    unhiddenForText.current = nextText;
    setUnhiddenIssueIds([]);
  }, []);
  const [reviewedCount, setReviewedCount] = useState(0);
  // Spoken confirmation for keyboard review. Keyboard users get no hover
  // state, so without this a Tab through the list is silent.
  const [reviewAnnouncement, setReviewAnnouncement] = useState("");
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
  const { preview: rewritePreview, run: requestRewrite, cancel: cancelRewrite, selectAlternative, editReplacement, resetReplacement } = useRewrite();
  const analysisState = useAnalysis({ text: draftText, goals: activeGoals, style: workspace.style, settings: workspace.provider, aiEnabled: workspace.aiEnabled, classifier: workspace.classifier ?? null });
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

  const pendingDraft = useRef<string | null>(null);
  // Both persistence surfaces must be hydrated before anything can honestly
  // be called loaded: workspace settings and the document store hydrate
  // independently, and the editor must not present the seed text as a saved
  // document while the store is still loading.
  const loading = !hydrated || !documents.hydrated;

  // Writing-activity tracking. Keystrokes only flip a flag and stash the text
  // in a ref; a 30-second interval folds additions into the activity store.
  // The store is read through useSyncExternalStore (like the document store),
  // so render never touches storage: the shell still server-renders, and no
  // setState-in-effect exists anywhere on this path. Baselines are per
  // document so switching drafts never credits one document's words to
  // another, and a single tick credits at most a fast typist's output so
  // bulk restores cannot mint a week's worth of words in one go.
  const [activityStore] = useState(() => new WritingActivityStore());
  const activitySummary = useSyncExternalStore(activityStore.subscribe, activityStore.getSnapshot, activityStore.getServerSnapshot);
  const activityRef = useRef({ baselines: new Map<string, number>(), draft: "", keystrokeSinceTick: false });
  const docsReady = documents.hydrated;
  useEffect(() => {
    if (!hydrated || !docsReady) return;
    activityStore.hydrate(window.localStorage);
    // Closing the tab between ticks used to discard up to 30 seconds of
    // typed words: the interval was the only path that ever folded them in.
    // The fold below runs on the same interval and once on pagehide, so the
    // week's count survives a closed tab. A second invocation finds no
    // pending keystrokes and is a no-op, so overlapping handlers are safe.
    let lastTick = Date.now();
    const fold = (activeMs: number) => {
      lastTick = Date.now();
      const tracker = activityRef.current;
      if (!tracker.keystrokeSinceTick) return;
      tracker.keystrokeSinceTick = false;
      const words = countWords(tracker.draft);
      const baseline = tracker.baselines.get(activeId) ?? words;
      tracker.baselines.set(activeId, words);
      const credited = creditSince(baseline, words);
      if (credited === 0) return;
      activityStore.record(window.localStorage, credited, activeMs);
    };
    const timer = window.setInterval(() => fold(30_000), 30_000);
    // Attribute only time actually spent: the exit fold credits the slice
    // since the previous fold, never a full extra interval.
    const onActivityHide = () => fold(Math.min(Math.max(0, Date.now() - lastTick), 30_000));
    window.addEventListener("pagehide", onActivityHide);
    return () => { window.clearInterval(timer); window.removeEventListener("pagehide", onActivityHide); };
  }, [hydrated, docsReady, activeId, activityStore]);

  const updateDraft = useCallback((next: string, recordHistory = true) => {
    // Until both stores have hydrated there is no active document to write to,
    // and updateActive silently no-ops — the editor is disabled during that
    // window, but rewrite/import paths can still land here. Hold the value and
    // apply it once hydration completes so no work is discarded.
    if (loading) {
      pendingDraft.current = next;
      return;
    }
    documents.updateActive({ draft: next });
    activityRef.current.keystrokeSinceTick = true;
    activityRef.current.draft = next;
    if (recordHistory) {
      historyStore.commit(activeId, next);
    }
  }, [activeId, documents, historyStore, loading]);

  // Apply anything held while the document store was still loading.
  useEffect(() => {
    if (loading || pendingDraft.current === null) return;
    const held = pendingDraft.current;
    pendingDraft.current = null;
    documents.updateActive({ draft: held });
    historyStore.commit(activeId, held);
  }, [loading, documents, activeId, historyStore]);

  const updateGoals = useCallback((patch: Partial<WritingGoals>) => {
    cancelRewrite();
    const next = { ...activeGoals, ...patch };
    documents.updateActive({ goals: next });
    updateWorkspace((current) => ({ ...current, goals: next }));
  }, [activeGoals, cancelRewrite, documents, updateWorkspace]);

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
    () => getOpenIssues(issues, dismissedIssueKeys, draftText),
    [issues, dismissedIssueKeys, draftText],
  );
  const suggestions = useMemo(
    () => buildSuggestionState({ issues: openIssues, goals: activeGoals, style: workspace.style, dismissedKeys: dismissedIssueKeys, text: draftText, unhiddenIssueIds }),
    [activeGoals, dismissedIssueKeys, openIssues, draftText, workspace.style, unhiddenIssueIds],
  );
  const visibleIssues = useMemo(
    () => sortForReview(filterByTier(filterByCategory(suggestions.displayed, categoryFilter), filter)),
    [categoryFilter, filter, suggestions.displayed],
  );

  // Keep the document list's review signal current with what we just found.
  // Only stored, never re-derived by the list view, so opening the dashboard
  // does not mean re-analysing every draft the writer has.
  //
  // Guarded by the values themselves rather than by effect dependencies: the
  // hook returns a fresh object every render, so depending on it re-ran this
  // effect on every render, and writing on every render is an update loop.
  const recordedReviewRef = useRef<string | null>(null);
  useEffect(() => {
    const fixFirst = suggestions.report.byTier["fix-first"];
    const worthMaking = suggestions.changesWorthMaking;
    const key = `${activeId}:${draftText.length}:${worthMaking}:${fixFirst}`;
    if (recordedReviewRef.current === key) return;
    recordedReviewRef.current = key;
    documents.recordReview({ worthMaking, fixFirst, analysedAt: Date.now() });
  }, [activeId, documents, draftText, suggestions.changesWorthMaking, suggestions.report.byTier]);

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
    // Move to the *next* suggestion, not the first one.
    //
    // This previously took `issues.find(issue => issue.id !== handled.id)`,
    // which is the first element of the list whenever the handled issue is not
    // itself first. Accepting card 5 of 12 threw the writer back to card 1, so
    // Ctrl+Enter looped over the same two suggestions instead of walking the
    // draft, and the count climbed while nothing new was reviewed.
    const index = issues.findIndex((issue) => issue.id === handled.id);
    const next = index === -1
      // The handled issue is no longer in the visible list (it was resolved, or
      // filtered out). Stay where the writer was rather than jumping to the top.
      ? issues[0]
      : issues[index + 1] ?? issues[0];
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
    // Acting on a suggestion is evidence too. Dismissal learning alone could
    // only ever suppress a rule, so a family the writer accepted every time
    // looked exactly like one they had never seen.
    updateWorkspace((current) => ({ ...current, style: recordAcceptance(current.style, issue) }));
    advanceFocus(visibleIssues, issue);
    window.setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(issue.start, issue.start + issue.replacement.length); }, 0);
  }, [advanceFocus, updateDraft, updateWorkspace, visibleIssues, draftText]);

  const dismissIssue = useCallback((issue: WritingIssue) => {
    setDismissedIssueKeys((current) => [...new Set([...current, getIssueDismissalKey(issue, draftText)])]);
    // The Writing Profile learns from repeated dismissals of the same type.
    updateWorkspace((current) => ({ ...current, style: recordDismissal(current.style, issue) }));
    advanceFocus(visibleIssues, issue);
  }, [advanceFocus, draftText, updateWorkspace, visibleIssues]);

  const acceptAll = useCallback(() => {
    const next = applyIssueReplacements(draftText, visibleIssues);
    if (next !== draftText) {
      // Checkpoint first: bulk-applying suggestions is a major operation.
      documents.saveSnapshot("manual");
      updateDraft(next);
      // Bulk acceptance is the strongest evidence of all: the writer read a set
      // of suggestions and took every one. Recorded per family so a single
      // sweep can cross the threshold for the kinds they actually act on.
      updateWorkspace((current) => {
        let style = current.style;
        for (const issue of visibleIssues) style = recordAcceptance(style, issue);
        return { ...current, style };
      });
    }
    setActiveIssueId(null);
  }, [documents, updateDraft, updateWorkspace, visibleIssues, draftText]);

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
    const action = rewriteActionsFor(selectedText, activeGoals, workspace.style).find((candidate) => candidate.label === label);
    const finalInstruction = action?.significant ? significantRewriteInstruction(instruction) : instruction;
    void requestRewrite({ label, instruction: finalInstruction, text: selectedText, selection, goals: activeGoals, style: workspace.style, settings: workspace.provider, aiEnabled: workspace.aiEnabled, draft: draftText });
  }, [activeGoals, requestRewrite, selectedText, selection, draftText, workspace.provider, workspace.style, workspace.aiEnabled]);

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

  // New documents start from the writer's current goals: the workspace copy
  // is the sticky default, so a new draft opens with the audience, intent and
  // tone the writer last chose rather than a factory reset.
  const defaultGoals = workspace.goals;
  const startNewDocument = useCallback(() => {
    cancelRewrite();
    const document = documents.createNew("Untitled draft", "", defaultGoals);
    // The new document opens its own history with its blank text as the base
    // state: the previous document's content can never be undone into it.
    historyStore.open(document.id, document.draft);
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
    // A new document means the writer is writing: land them in the editor.
    setView("write");
    resetUnhidden(document.draft);
  }, [cancelRewrite, defaultGoals, documents, resetUnhidden, setSelection]);

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
    resetUnhidden("");
  }, [cancelRewrite, resetUnhidden, setSelection, updateDraft]);

  const restoreSample = useCallback(() => {
    cancelRewrite();
    updateDraft(SAMPLE_DOCUMENT);
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
    resetUnhidden(SAMPLE_DOCUMENT);
  }, [cancelRewrite, resetUnhidden, setSelection, updateDraft]);

  /**
   * The first-run "try the sample" path. Unlike the seed (which must stay
   * empty), this is the writer explicitly asking for sample prose — so it
   * arrives in its own clearly-titled document and lands in the editor.
   */
  const loadSampleDocument = useCallback(() => {
    cancelRewrite();
    const document = documents.createNew("Sample draft", SAMPLE_DOCUMENT, defaultGoals);
    historyStore.open(document.id, document.draft);
    setSelection({ start: 0, end: 0 });
    setDismissedIssueKeys([]);
    setActiveIssueId(null);
    setView("write");
    resetUnhidden(document.draft);
  }, [cancelRewrite, defaultGoals, documents, resetUnhidden, setSelection]);

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
    // Refuse an oversized file before reading it. `file.text()` loads the whole
    // file into memory, so checking afterwards meant a huge file was fully read
    // and only then rejected.
    const tooLarge = oversizedImport(file);
    if (tooLarge) {
      setImportError(tooLarge);
      return;
    }
    void file.text().then((content) => {
      const result = importDocument(file.name, content);
      if (!result.ok) {
        setImportError(result.error);
        return;
      }
      setImportError(null);
      const document = documents.createNew(result.title, result.text, defaultGoals);
      historyStore.open(document.id, document.draft);
      setDismissedIssueKeys([]);
      setActiveIssueId(null);
      setView("write");
      resetUnhidden(result.text);
    });
  }, [defaultGoals, documents, resetUnhidden]);

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
    setDismissedIssueKeys((current) => [...new Set([...current, ...issues.filter((issue) => issue.original === word).map((entry) => getIssueDismissalKey(entry, draftText))])]);
  }, [draftText, issues, updateWorkspace]);

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
    setDismissedIssueKeys((current) => [...new Set([...current, ...groupIssues.map((entry) => getIssueDismissalKey(entry, draftText))])]);
    setReviewedCount((count) => count + 1);
    setActiveIssueId(null);
  }, [documents, updateDraft, draftText]);

  const dismissGroup = useCallback((groupIssues: WritingIssue[]) => {
    setDismissedIssueKeys((current) => [...new Set([...current, ...groupIssues.map((entry) => getIssueDismissalKey(entry, draftText))])]);
    setActiveIssueId(null);
    // A bulk dismissal is a stronger signal than a single one, and the Writing
    // Profile is what turns repeated dismissals into "show fewer of this". Without
    // this, dismissing thirty findings at once taught the profile nothing while
    // dismissing them one at a time would have dampened the family.
    updateWorkspace((current) => {
      let style = current.style;
      for (const entry of groupIssues) style = recordDismissal(style, entry);
      return { ...current, style };
    });
  }, [draftText, updateWorkspace]);

  const scrollEditor = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const onSelectIssue = useCallback((issue: WritingIssue) => {
    setActiveIssueId(issue.id);
    // A finding from the held-back list is not in openIssues, so there is no
    // card to act on. Unhiding it by id puts exactly that one finding into the
    // review list: the writer reached for it deliberately, and this is the
    // difference between "we held 51 back" being informative and being a dead
    // end. Everything else stays suppressed.
    setUnhiddenIssueIds((current) => (current.includes(issue.id) ? current : [...current, issue.id]));
    window.setTimeout(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(issue.start, issue.end); }, 0);
  }, []);

  // Jump from a document-level note or outline section to the passage it is
  // about, so whole-draft feedback is navigable rather than abstract.
  const onSelectRange = useCallback((start: number, end: number) => {
    setActiveIssueId(null);
    setSelection({ start, end });
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
      textareaRef.current?.scrollIntoView?.({ block: "center" });
    }, 0);
  }, [setSelection]);

  const clearLocalData = useCallback(() => {
    cancelRewrite();
    void clearAllLocalData({
      documentBackend: documents.backend,
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
      // Keyboard-driven review. The shortcuts dialog promises the writer can
      // keep their hands on the draft; without these bindings the only way to
      // move between findings, or to accept and ignore one, was the mouse.
      // Guarded inside reviewActionForKey so it never fires while typing.
      const reviewAction = view === "write" && !rewritePreview ? reviewActionForKey(event) : null;
      if (reviewAction) {
        event.preventDefault();
        if (reviewAction === "next" || reviewAction === "previous") {
          const current = visibleIssues.findIndex((issue) => issue.id === currentActiveIssueId);
          const index = stepReviewIndex(current === -1 ? null : current, visibleIssues.length, reviewAction);
          const target = issueForReviewAction(visibleIssues, index);
          if (target) {
            setActiveIssueId(target.id);
            setReviewAnnouncement(reviewAnnouncementFor(target, index, visibleIssues.length));
            // Move the caret so the finding is visible in the editor, but do NOT
            // call focus(). An earlier version focused the textarea here, which
            // put focus inside the guarded field and blocked the next press —
            // the review loop advanced exactly once and then went dead.
            window.setTimeout(() => {
              const editor = textareaRef.current;
              if (!editor) return;
              editor.setSelectionRange(target.start, target.end);
              editor.blur();
            }, 0);
          }
          return;
        }
        // Accept/ignore act on the current finding, or the highest-priority one
        // when nothing is selected yet, so the first keypress is never a no-op.
        const current = visibleIssues.findIndex((issue) => issue.id === currentActiveIssueId);
        const target = issueForReviewAction(visibleIssues, current === -1 ? 0 : current);
        if (!target) return;
        if (reviewAction === "accept") {
          if (!target.replacement || target.replacement === target.original) {
            // Nothing safe to insert. Say so rather than silently doing
            // nothing: a keypress with no feedback reads as a broken key.
            setReviewAnnouncement(`${target.title} has no automatic change. Press Backspace to ignore it.`);
            return;
          }
          acceptIssue(target);
        } else {
          dismissIssue(target);
        }
        return;
      }
      // Accept-all rewrites the whole document, so it must never fire while the
      // caret is in the draft: Ctrl+Enter is a common way to finish a paragraph,
      // and this branch used to rewrite the text mid-sentence.
      const inEditableProse = event.target instanceof HTMLTextAreaElement
        || (event.target instanceof HTMLElement && (event.target.isContentEditable || event.target.getAttribute("data-review-guard") !== null));
      if (modifier && event.key === "Enter" && !event.shiftKey && !inEditableProse) { event.preventDefault(); acceptAll(); return; }
      if (event.key === "Escape" && rewritePreview) { cancelRewrite(); return; }
      if (event.key === "?" && !modifier && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, [acceptAll, acceptIssue, cancelRewrite, clearDataOpen, currentActiveIssueId, dismissIssue, documents, newDraftOpen, redo, rewritePreview, saveAll, settingsOpen, shortcutsOpen, undo, view, visibleIssues]);

  const darkMode = workspace.theme === "dark" || (workspace.theme === "system" && systemDark);
  // Truthful save state: combines workspace-settings persistence and the
  // document store's own confirmed writes. "Saved locally" appears only after
  // both persisted; degraded storage tiers are named rather than hidden.
  const docSaving = documents.saveStatus === "saving" || saveStatus === "saving";
  const docFailed = documents.saveStatus === "error" || saveStatus === "error";
  const memoryOnly = documents.storageMode === "memory";
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
        <aside className="left-rail" aria-label="Draftwise sections">
          <div className="rail-nav"><button className={view === "home" ? "rail-button active" : "rail-button"} onClick={() => setView("home")} type="button" aria-label="Documents"><FileText size={18} aria-hidden="true" /><span>Documents</span></button><button className={view === "write" ? "rail-button active" : "rail-button"} onClick={() => setView("write")} type="button" aria-label="Write"><PenLine size={18} aria-hidden="true" /><span>Write</span></button>{/* The "new" badge is decorative, but its text still contributes to the
    button's computed visible text. axe's label-content-name-mismatch wants the
    accessible name to CONTAIN that text, so the label keeps the full string
    ("Insights new") rather than just "Insights" — a screen reader announces
    the whole thing, which is accurate: the item is marked new. */}
<button className={view === "insights" ? "rail-button active" : "rail-button"} onClick={() => setView("insights")} type="button" aria-label="Insights new"><BarChart3 size={18} aria-hidden="true" /><span>Insights</span><span className="rail-new" aria-hidden="true"> new</span></button><button className={view === "extension" ? "rail-button active" : "rail-button"} onClick={() => setView("extension")} type="button" aria-label="Extension new"><Puzzle size={18} aria-hidden="true" /><span>Extension</span><span className="rail-new" aria-hidden="true"> new</span></button></div>
          <div className="rail-divider" />
          <div className="rail-context"><span className="rail-eyebrow">Writing goals · this document</span><div className="rail-goal"><Target size={15} /><span>{activeGoals.audience}</span></div><div className="rail-goal"><Flag size={15} /><span>{activeGoals.intent}</span></div><div className="rail-goal"><Sparkles size={15} /><span>{activeGoals.tone}</span></div><button className="rail-edit" onClick={() => setView("write")} type="button">Edit goals <Target size={13} /></button></div>
          <div className="rail-bottom"><button className="rail-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings2 size={17} aria-hidden="true" /><span>Settings</span></button><button className="rail-button" type="button" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts"><CircleHelp size={17} aria-hidden="true" /><span>Shortcuts</span><kbd aria-hidden="true">?</kbd></button></div>
        </aside>

        <div className="app-content">
          {view === "home" ? <DocumentDashboard summaries={documents.summaries} activeId={documents.activeId} importError={importError} loading={loading} onOpen={openDocument} onNew={startNewDocument} onSample={loadSampleDocument} onDuplicate={duplicateDocument} onDelete={deleteDocument} onImport={importFromFile} onExport={exportDocument} onHistory={(id) => { documents.open(id); setView("history"); }} /> : null}
          {view === "write" ? <EditorWorkspace draft={draftText} loading={loading} goals={activeGoals} style={workspace.style} analysis={analysis} openIssues={openIssues} visibleIssues={visibleIssues} suggestions={suggestions} activeIssueId={currentActiveIssueId} filter={filter} categoryFilter={categoryFilter} categoryOptions={filterableCategories(suggestions.report)} onCategoryFilterChange={setCategoryFilter} analyzing={analysisState.isAnalysing} analysisStatusLabel={analysisStatusLabel} analysisError={analysisState.error} savedLabel={savedLabel} saveError={saveError} reviewAnnouncement={reviewAnnouncement} selection={selection} selectedText={selectedText} customInstruction={customInstruction} rewritePreview={rewritePreview} suggestionsOpen={suggestionsOpen} focusMode={focusMode} canUndo={historySnapshot.canUndo} canRedo={historySnapshot.canRedo} registerTextarea={registerTextarea} registerHighlight={registerHighlight} onDraftChange={(event) => updateDraft(event.target.value)} onGoalChange={updateGoals} onFilterChange={setFilter} onSelectionChange={() => updateFromElement(textareaRef.current)} onScroll={scrollEditor} onSelectIssue={onSelectIssue} onAcceptIssue={acceptIssue} onDismissIssue={dismissIssue} onAddToDictionary={onAddToDictionary} onRuleControl={ruleControl} onApplyGroup={applyGroup} onDismissGroup={dismissGroup} reviewedCount={reviewedCount} onAcceptAll={acceptAll} onUndo={undo} onRedo={redo} onRunRewrite={runRewrite} onCustomInstructionChange={setCustomInstruction} onReplaceRewrite={applyRewrite} onCopyRewrite={copyRewrite} onRetryRewrite={retryRewrite} onCancelRewrite={cancelRewrite} onSelectRewriteAlternative={selectAlternative} onEditRewriteReplacement={editReplacement} onResetRewriteReplacement={resetReplacement} onToggleSuggestions={() => setSuggestionsOpen((value) => !value)} onToggleFocusMode={() => setFocusMode((value) => !value)} onNewDocument={newDocument} onClearDocument={clearDocument} onRestoreSample={restoreSample} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenSettings={() => setSettingsOpen(true)} onSelectRange={onSelectRange} /> : null}
          {view === "insights" ? <InsightsView analysis={analysis} goals={activeGoals} openIssues={openIssues} tierCounts={suggestions.report.byTier} progress={progress} activity={activitySummary} style={workspace.style} displayed={suggestions.displayed} report={suggestions.report} onBack={() => setView("write")} onOpenSettings={() => setSettingsOpen(true)} onJumpToIssue={(issue) => { setView("write"); onSelectIssue(issue); }} /> : null}
          {view === "history" && documents.active ? <VersionHistoryView document={documents.active} onBack={() => setView("write")} onRestore={(snapshot) => { documents.restoreSnapshot(documents.activeId, snapshot.id); setView("write"); resetUnhidden(snapshot.text); }} onDuplicateSnapshot={(snapshot) => { documents.duplicateSnapshot(documents.activeId, snapshot.id); setView("write"); }} /> : null}
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
