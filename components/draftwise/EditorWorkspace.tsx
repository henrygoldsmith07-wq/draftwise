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
import { HighlightLayer, GoalSelect, ScoreRing, SuggestionCard, type SuggestionCardControls } from "@/components/draftwise/EditorPrimitives";
import { RewritePreview } from "@/components/draftwise/RewritePreview";
import { hasActionableReplacement } from "@/lib/issue-actions";
import { rewriteActionsFor } from "@/lib/rewrite-actions";
import { type SuggestionState, type TierFilter } from "@/lib/suggestions";
import type { AnalysisResult, PrioritisedIssue, StylePreferences, WritingGoals, WritingIssue } from "@/packages/types/src";
import type { RewritePreviewState } from "@/hooks/useRewrite";

interface EditorWorkspaceProps {
  draft: string;
  goals: WritingGoals;
  style: StylePreferences;
  analysis: AnalysisResult;
  openIssues: WritingIssue[];
  visibleIssues: PrioritisedIssue[];
  suggestions: SuggestionState;
  activeIssueId: string | null;
  filter: TierFilter;
  analyzing: boolean;
  analysisStatusLabel: string;
  analysisError?: string | null;
  savedLabel: string;
  saveError?: string | null;
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
  onFilterChange: (filter: TierFilter) => void;
  onSelectionChange: () => void;
  onScroll: () => void;
  onSelectIssue: (issue: WritingIssue) => void;
  onAcceptIssue: (issue: WritingIssue) => void;
  onDismissIssue: (issue: WritingIssue) => void;
  onAddToDictionary: (word: string) => void;
  onRuleControl: (ruleId: string, action: "reduce" | "off") => void;
  onApplyGroup: (issues: WritingIssue[]) => void;
  onDismissGroup: (issues: WritingIssue[]) => void;
  reviewedCount: number;
  onAcceptAll: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRunRewrite: (label: string, instruction: string) => void;
  onCustomInstructionChange: (value: string) => void;
  onReplaceRewrite: (insert: boolean) => void;
  onCopyRewrite: () => void;
  onRetryRewrite: () => void;
  onCancelRewrite: () => void;
  onSelectRewriteAlternative: (index: number) => void;
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

const documentTypeOptions = [
  { value: "", label: "No type" },
  { value: "essay", label: "Essay" },
  { value: "report", label: "Report" },
  { value: "email", label: "Email" },
  { value: "article", label: "Article" },
  { value: "personal-statement", label: "Personal statement" },
  { value: "technical-explanation", label: "Technical explanation" },
  { value: "notes", label: "Notes" },
  { value: "general", label: "General writing" },
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
            <Button size="sm" onClick={props.onAcceptAll} disabled={!props.visibleIssues.some(hasActionableReplacement)}><CheckCheck size={14} /> {props.filter === "all" ? "Accept all" : "Accept visible"}</Button>
          </div>
        </div>

        <div className="goal-bar">
          <div className="goal-bar-label"><Target size={15} /><span>Writing goals</span></div>
          <GoalSelect label="Audience" value={props.goals.audience} options={audienceOptions} onChange={(value) => props.onGoalChange({ audience: value as WritingGoals["audience"] })} />
          <GoalSelect label="Intent" value={props.goals.intent} options={intentOptions} onChange={(value) => props.onGoalChange({ intent: value as WritingGoals["intent"] })} />
          <GoalSelect label="Tone" value={props.goals.tone} options={toneOptions} onChange={(value) => props.onGoalChange({ tone: value as WritingGoals["tone"] })} />
          <GoalSelect label="Type" value={props.goals.documentType ?? ""} options={documentTypeOptions} onChange={(value) => props.onGoalChange({ documentType: value ? (value as WritingGoals["documentType"]) : undefined })} />
          <GoalSelect label="Length" value={props.goals.targetLength ? String(props.goals.targetLength) : ""} options={[{ value: "", label: "Any" }, { value: "300", label: "~300 words" }, { value: "600", label: "~600 words" }, { value: "1200", label: "~1,200 words" }, { value: "2500", label: "~2,500 words" }]} onChange={(value) => props.onGoalChange({ targetLength: value ? Number(value) : undefined })} />
        </div>

        {props.selection.end > props.selection.start ? (
          <div className="rewrite-toolbar">
            <span className="rewrite-toolbar-label"><WandSparkles size={14} /> Rewrite selection</span>
            {rewriteActionsFor(props.selectedText, props.goals, props.style).map((action) => (
              <button key={action.label} onClick={() => props.onRunRewrite(action.label, action.instruction)} type="button">{action.label}</button>
            ))}
            <div className="custom-rewrite">
              <Input value={props.customInstruction} onChange={(event) => props.onCustomInstructionChange(event.target.value)} placeholder="Custom instruction" aria-label="Custom rewrite instruction" />
              <button aria-label="Run custom instruction" onClick={() => { if (props.customInstruction.trim()) props.onRunRewrite("Custom rewrite", props.customInstruction); }} type="button"><Zap size={13} /></button>
            </div>
          </div>
        ) : null}

        {props.rewritePreview ? (
          <RewritePreview preview={props.rewritePreview} onReplace={() => props.onReplaceRewrite(false)} onInsert={() => props.onReplaceRewrite(true)} onCopy={props.onCopyRewrite} onRetry={props.onRetryRewrite} onCancel={props.onCancelRewrite} onSelectAlternative={props.onSelectRewriteAlternative} />
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
              <span className={`analysis-status ${props.analyzing ? "is-working" : ""}`} role="status" aria-live="polite">
                {props.analyzing ? <><span className="status-spinner" /> Analysing changed text</> : <><span className="status-check"><Check size={11} /></span> {props.analysisStatusLabel}</>}
              </span>
              <Button variant="ghost" size="icon-xs" aria-label="Open editor shortcuts" onClick={props.onOpenShortcuts}><Keyboard size={16} /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="Clear document" onClick={props.onClearDocument}><Trash2 size={16} /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="More editor actions" onClick={props.onOpenShortcuts}><MoreHorizontal size={16} /></Button>
            </div>
          </div>
          <div className="editor-scroll-wrap">
            <div ref={registerHighlight} className="editor-highlight-scroll"><HighlightLayer text={props.draft} issues={props.openIssues} activeIssueId={props.activeIssueId} /></div>
            <textarea ref={registerTextarea} className="editor-input" value={props.draft} onChange={props.onDraftChange} onSelect={props.onSelectionChange} onKeyUp={props.onSelectionChange} onScroll={props.onScroll} spellCheck={false} aria-label="Draft editor" placeholder="Start writing…" />
          </div>
          <div className="editor-footer">
            <span><Keyboard size={14} /> Select text for rewrite tools</span>
            <span>{props.draft.length.toLocaleString("en-GB")} characters · {Math.ceil(props.draft.length / 4).toLocaleString("en-GB")} tokens</span>
          </div>
        </div>

        {props.analysisError ? <div className="analysis-error" role="status"><span>AI analysis paused: {props.analysisError}</span><button onClick={props.onOpenSettings} type="button">Review settings</button></div> : null}
        <div className="workspace-footnote"><span><ShieldCheck size={14} /> No account required</span><span role={props.saveError ? "status" : undefined} title={props.saveError ?? undefined}>{props.saveError ? "Could not save locally" : props.savedLabel}</span><button onClick={props.onOpenSettings} type="button">Privacy controls</button></div>
      </section>

      {props.suggestionsOpen ? (
        <aside className="suggestions-column">
          <div className="suggestions-header">
            <div><p className="eyebrow">Live analysis</p><h2>Suggestions <span>{props.suggestions.report.displayedCount}</span></h2></div>
            <Button size="icon-sm" variant="ghost" aria-label="Collapse suggestions" onClick={props.onToggleSuggestions}><PanelRight size={17} /></Button>
          </div>
          {props.suggestions.changesWorthMaking > 0 ? (
            <div className="fix-first-banner">
              <strong>{props.suggestions.changesWorthMaking} change{props.suggestions.changesWorthMaking === 1 ? "" : "s"} worth making</strong>
              <span>{props.suggestions.report.suppressedCount > 0
                ? `${props.suggestions.report.suppressedCount} lower-value finding${props.suggestions.report.suppressedCount === 1 ? "" : "s"} held back to keep the list focused.`
                : "High-confidence problems first, then improvements, then preferences."}</span>
              {props.suggestions.focus && props.suggestions.focus.id !== props.activeIssueId ? (
                <button type="button" className="fix-first-next" onClick={() => props.onSelectIssue(props.suggestions.focus as PrioritisedIssue)}>
                  Start with “{(props.suggestions.focus.original || props.suggestions.focus.title).trim().slice(0, 30)}” <ArrowDown size={12} />
                </button>
              ) : null}
            </div>
          ) : null}
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
            <Tabs value={props.filter} onValueChange={(value) => props.onFilterChange(value as TierFilter)}>
              <TabsList variant="line">
                <TabsTrigger value="fix-first">Fix first <span>{props.suggestions.report.byTier["fix-first"]}</span></TabsTrigger>
                <TabsTrigger value="improve">Improve <span>{props.suggestions.report.byTier.improve}</span></TabsTrigger>
                <TabsTrigger value="optional">Optional <span>{props.suggestions.report.byTier.optional}</span></TabsTrigger>
                <TabsTrigger value="all">All <span>{props.suggestions.report.displayedCount}</span></TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="suggestions-list">
            {props.visibleIssues.length ? props.visibleIssues.map((issue) => {
              const controls: SuggestionCardControls = {
                onReduceRule: () => props.onRuleControl(issue.ruleId, "reduce"),
                onTurnOffRule: () => props.onRuleControl(issue.ruleId, "off"),
              };
              const group = props.suggestions.groups.find((candidate) => candidate.members.some((member) => member.id === issue.id));
              const groupActions = group ? {
                label: group.label,
                count: group.members.reduce((total, member) => total + 1 + member.groupedCount, 0),
                safeToApplyAll: group.safeToApplyAll,
                onApplyAll: () => props.onApplyGroup(group.members),
                onDismissAll: () => props.onDismissGroup(group.members),
              } : undefined;
              return <SuggestionCard key={issue.id} issue={issue} active={issue.id === props.activeIssueId} onSelect={() => props.onSelectIssue(issue)} onAccept={() => props.onAcceptIssue(issue)} onDismiss={() => props.onDismissIssue(issue)} onAddToDictionary={() => props.onAddToDictionary(issue.original)} controls={controls} groupActions={groupActions} />;
            }) : <div className="empty-suggestions"><div className="empty-icon"><CheckCheck size={22} /></div><h3>{props.analyzing ? "Checking deeper analysis" : "Clean so far"}</h3><p>{props.analyzing ? "Local checks are complete while deeper analysis runs." : "Your draft has no open suggestions in this view."}</p></div>}
          </div>
          {props.reviewedCount > 0 ? <div className="review-completion" role="status">{props.reviewedCount} important change{props.reviewedCount === 1 ? "" : "s"} reviewed.</div> : null}
          <div className="suggestions-footer"><span role="status" aria-live="polite"><Zap size={14} /> {props.analysisStatusLabel}</span><button onClick={props.onOpenSettings} type="button">Configure AI <ArrowDown size={13} /></button></div>
        </aside>
      ) : (
        <aside className="suggestions-collapsed"><Button size="sm" variant="outline" onClick={props.onToggleSuggestions}><PanelRight size={15} /> Show suggestions</Button></aside>
      )}
    </div>
  );
}
