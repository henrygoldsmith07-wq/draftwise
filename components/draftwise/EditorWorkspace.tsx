"use client";

import type { ChangeEvent } from "react";
import {
  ArrowDown,
  Check,
  CheckCheck,
  FileText,
  Highlighter,
  Keyboard,
  MoreHorizontal,
  PanelRight,
  RotateCw,
  ShieldCheck,
  Target,
  Trash2,
  Undo2,
  WandSparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HighlightLayer, GoalSelect, ScoreRing, SuggestionCard, categoryMatches } from "@/components/draftwise/EditorPrimitives";
import { RewritePreview } from "@/components/draftwise/RewritePreview";
import type { AnalysisResult, StylePreferences, WritingGoals, WritingIssue } from "@/packages/types/src";
import type { RewritePreviewState } from "@/hooks/useRewrite";

type IssueFilter = "all" | "grammar" | "style";

interface EditorWorkspaceProps {
  draft: string;
  goals: WritingGoals;
  style: StylePreferences;
  analysis: AnalysisResult;
  visibleIssues: WritingIssue[];
  activeIssueId: string | null;
  filter: IssueFilter;
  analyzing: boolean;
  statusLabel: string;
  analysisError?: string | null;
  savedLabel: string;
  selection: { start: number; end: number };
  selectedText: string;
  customInstruction: string;
  rewritePreview: RewritePreviewState | null;
  suggestionsOpen: boolean;
  focusMode: boolean;
  canUndo: boolean;
  canRedo: boolean;
  registerTextarea: (element: HTMLTextAreaElement | null) => void;
  registerHighlight: (element: HTMLDivElement | null) => void;
  onDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onGoalChange: (patch: Partial<WritingGoals>) => void;
  onFilterChange: (filter: IssueFilter) => void;
  onSelectionChange: () => void;
  onScroll: () => void;
  onSelectIssue: (issue: WritingIssue) => void;
  onAcceptIssue: (issue: WritingIssue) => void;
  onDismissIssue: (issue: WritingIssue) => void;
  onAddToDictionary: (word: string) => void;
  onAcceptAll: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRunRewrite: (label: string, instruction: string) => void;
  onCustomInstructionChange: (value: string) => void;
  onReplaceRewrite: (insert: boolean) => void;
  onCopyRewrite: () => void;
  onRetryRewrite: () => void;
  onCancelRewrite: () => void;
  onToggleSuggestions: () => void;
  onToggleFocusMode: () => void;
  onNewDocument: () => void;
  onClearDocument: () => void;
  onRestoreSample: () => void;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
}

const audienceOptions = [
  { value: "general", label: "General" },
  { value: "academic", label: "Academic" },
  { value: "professional", label: "Professional" },
  { value: "technical", label: "Technical" },
  { value: "casual", label: "Casual" },
];

const intentOptions = [
  { value: "inform", label: "Inform" },
  { value: "explain", label: "Explain" },
  { value: "persuade", label: "Persuade" },
  { value: "describe", label: "Describe" },
  { value: "story", label: "Tell a story" },
];

const toneOptions = [
  { value: "neutral", label: "Neutral" },
  { value: "confident", label: "Confident" },
  { value: "friendly", label: "Friendly" },
  { value: "professional", label: "Professional" },
  { value: "formal", label: "Formal" },
  { value: "casual", label: "Casual" },
];

export function EditorWorkspace(props: EditorWorkspaceProps) {
  const { registerTextarea, registerHighlight } = props;
  const scoreMessage = props.analysis.scores.overall >= 90
    ? "Polished draft"
    : props.analysis.scores.overall >= 75
      ? "Strong foundation"
      : "A few useful changes";
  return (
    <div className={`workspace-grid ${props.focusMode ? "is-focus-mode" : ""}`}>
      <section className="editor-column">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Writing workspace</p>
            <h1>Make the next sentence easier.</h1>
          </div>
          <div className="heading-actions">
            <Button variant="outline" size="sm" onClick={props.onNewDocument}><FileText size={14} /> New</Button>
            <Button variant="outline" size="sm" onClick={props.onRestoreSample}><RotateCw size={14} /> Sample</Button>
            <Button size="sm" onClick={props.onAcceptAll} disabled={!props.visibleIssues.some((issue) => issue.replacement && issue.replacement !== issue.original)}><CheckCheck size={14} /> Accept all</Button>
          </div>
        </div>

        <div className="goal-bar">
          <div className="goal-bar-label"><Target size={15} /><span>Writing goals</span></div>
          <GoalSelect label="Audience" value={props.goals.audience} options={audienceOptions} onChange={(value) => props.onGoalChange({ audience: value as WritingGoals["audience"] })} />
          <GoalSelect label="Intent" value={props.goals.intent} options={intentOptions} onChange={(value) => props.onGoalChange({ intent: value as WritingGoals["intent"] })} />
          <GoalSelect label="Tone" value={props.goals.tone} options={toneOptions} onChange={(value) => props.onGoalChange({ tone: value as WritingGoals["tone"] })} />
        </div>

        {props.selection.end > props.selection.start ? (
          <div className="rewrite-toolbar">
            <span className="rewrite-toolbar-label"><WandSparkles size={14} /> Rewrite selection</span>
            <button onClick={() => props.onRunRewrite("Improve", "Improve writing while preserving meaning")} type="button">Improve</button>
            <button onClick={() => props.onRunRewrite("Fix grammar", "Fix grammar only")} type="button">Fix grammar</button>
            <button onClick={() => props.onRunRewrite("Shorten", "Shorten without losing facts")} type="button">Shorten</button>
            <button onClick={() => props.onRunRewrite("Expand", "Expand with useful detail")} type="button">Expand</button>
            <button onClick={() => props.onRunRewrite("Simplify", "Simplify for a general reader")} type="button">Simplify</button>
            <button onClick={() => props.onRunRewrite("Formal", "Make more formal and professional")} type="button">Formal</button>
            <button onClick={() => props.onRunRewrite("Friendly", "Make warmer and more friendly")} type="button">Friendly</button>
            <div className="custom-rewrite">
              <Input value={props.customInstruction} onChange={(event) => props.onCustomInstructionChange(event.target.value)} placeholder="Custom instruction" aria-label="Custom rewrite instruction" />
              <button aria-label="Run custom instruction" onClick={() => { if (props.customInstruction.trim()) props.onRunRewrite("Custom rewrite", props.customInstruction); }} type="button"><Zap size={13} /></button>
            </div>
          </div>
        ) : null}

        {props.rewritePreview ? (
          <RewritePreview preview={props.rewritePreview} onReplace={() => props.onReplaceRewrite(false)} onInsert={() => props.onReplaceRewrite(true)} onCopy={props.onCopyRewrite} onRetry={props.onRetryRewrite} onCancel={props.onCancelRewrite} />
        ) : null}

        <div className="editor-card">
          <div className="editor-toolbar">
            <div className="editor-toolbar-left">
              <Button size="icon-xs" variant="ghost" aria-label="Undo" disabled={!props.canUndo} onClick={props.onUndo}><Undo2 size={15} /></Button>
              <Button size="icon-xs" variant="ghost" aria-label="Redo" disabled={!props.canRedo} onClick={props.onRedo}><RotateCw size={15} /></Button>
              <span className="toolbar-separator" />
              <button type="button" className="toolbar-text active" onClick={props.onToggleFocusMode}><Highlighter size={14} /> {props.focusMode ? "Exit focus" : "Check as I write"}</button>
            </div>
            <div className="editor-toolbar-right">
              <span className={`analysis-status ${props.analyzing ? "is-working" : ""}`}>
                {props.analyzing ? <><span className="status-spinner" /> Analysing changed text</> : <><span className="status-check"><Check size={11} /></span> {props.statusLabel}</>}
              </span>
              <Button variant="ghost" size="icon-xs" aria-label="Open editor shortcuts" onClick={props.onOpenShortcuts}><Keyboard size={16} /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="Clear document" onClick={props.onClearDocument}><Trash2 size={16} /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="More editor actions" onClick={props.onOpenShortcuts}><MoreHorizontal size={16} /></Button>
            </div>
          </div>
          <div className="editor-scroll-wrap">
            <div ref={registerHighlight} className="editor-highlight-scroll"><HighlightLayer text={props.draft} issues={props.analysis.issues} activeIssueId={props.activeIssueId} /></div>
            <textarea ref={registerTextarea} className="editor-input" value={props.draft} onChange={props.onDraftChange} onSelect={props.onSelectionChange} onKeyUp={props.onSelectionChange} onScroll={props.onScroll} spellCheck={false} aria-label="Draft editor" placeholder="Start writing…" />
          </div>
          <div className="editor-footer">
            <span><Keyboard size={14} /> Select text for rewrite tools</span>
            <span>{props.draft.length.toLocaleString("en-GB")} characters · {Math.ceil(props.draft.length / 4).toLocaleString("en-GB")} tokens</span>
          </div>
        </div>

        {props.analysisError ? <div className="analysis-error" role="status"><span>AI analysis paused: {props.analysisError}</span><button onClick={props.onOpenSettings} type="button">Review settings</button></div> : null}
        <div className="workspace-footnote"><span><ShieldCheck size={14} /> No account required</span><span>{props.savedLabel}</span><button onClick={props.onOpenSettings} type="button">Privacy controls</button></div>
      </section>

      {props.suggestionsOpen ? (
        <aside className="suggestions-column">
          <div className="suggestions-header">
            <div><p className="eyebrow">Live analysis</p><h2>Suggestions <span>{props.visibleIssues.length}</span></h2></div>
            <Button size="icon-sm" variant="ghost" aria-label="Collapse suggestions" onClick={props.onToggleSuggestions}><PanelRight size={17} /></Button>
          </div>
          <div className="score-card">
            <div>
              <p className="score-kicker">Overall writing guide</p>
              <h3>{scoreMessage}</h3>
              <p className="score-description">A transparent guide built from local signals and suggestions you can review.</p>
              <div className="tone-row"><span>Tone</span>{props.analysis.tone.map((tone) => <Badge key={tone} className="tone-badge">{tone}</Badge>)}</div>
            </div>
            <ScoreRing score={props.analysis.scores.overall} />
          </div>
          <div className="issue-tabs">
            <Tabs value={props.filter} onValueChange={(value) => props.onFilterChange(value as IssueFilter)}>
              <TabsList variant="line">
                <TabsTrigger value="all">All <span>{props.analysis.issues.length}</span></TabsTrigger>
                <TabsTrigger value="grammar">Correctness <span>{props.analysis.issues.filter((item) => categoryMatches(item, "grammar")).length}</span></TabsTrigger>
                <TabsTrigger value="style">Style <span>{props.analysis.issues.filter((item) => categoryMatches(item, "style")).length}</span></TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="suggestions-list">
            {props.visibleIssues.length ? props.visibleIssues.map((issue) => <SuggestionCard key={issue.id} issue={issue} active={issue.id === props.activeIssueId} onSelect={() => props.onSelectIssue(issue)} onAccept={() => props.onAcceptIssue(issue)} onDismiss={() => props.onDismissIssue(issue)} onAddToDictionary={() => props.onAddToDictionary(issue.original)} />) : <div className="empty-suggestions"><div className="empty-icon"><CheckCheck size={22} /></div><h3>{props.statusLabel === "Saved locally" ? "Clean so far" : "Checking your draft"}</h3><p>{props.statusLabel === "Saved locally" ? "Your draft has no open suggestions in this view." : "Local checks appear immediately while deeper analysis runs."}</p></div>}
          </div>
          <div className="suggestions-footer"><span><Zap size={14} /> {props.analysis.source === "local+ai" ? "Local + AI analysis" : "Local analysis"}</span><button onClick={props.onOpenSettings} type="button">Configure AI <ArrowDown size={13} /></button></div>
        </aside>
      ) : (
        <aside className="suggestions-collapsed"><Button size="sm" variant="outline" onClick={props.onToggleSuggestions}><PanelRight size={15} /> Show suggestions</Button></aside>
      )}
    </div>
  );
}
