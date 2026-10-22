"use client";

import type { ChangeEvent } from "react";
import { useState } from "react";
import {
  ArrowDown,
  Check,
  CheckCheck,
  FileText,
  Highlighter,
  Keyboard,
  PanelRight,
  RotateCw,
  Settings2,
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
import { HighlightLayer, GoalSelect, ScoreRing, SuggestionCard, type SuggestionCardControls } from "@/components/draftwise/EditorPrimitives";
import { ReadAloudControls } from "@/components/draftwise/ReadAloudControls";
import { DocumentOverview, SuppressedFindings } from "@/components/draftwise/DocumentOverview";
import { RewritePreview } from "@/components/draftwise/RewritePreview";
import { hasActionableReplacement } from "@/lib/issue-actions";
import { rewriteActionsFor } from "@/lib/rewrite-actions";
import { type CategoryFilter, type SuggestionState, TIER_DESCRIPTIONS, TIER_LABELS, type TierFilter } from "@/lib/suggestions";
import type { AnalysisResult, Dialect, PrioritisedIssue, StylePreferences, WritingGoals, WritingIssue } from "@/packages/types/src";
import { formatPreferredReplacements, formatTerminologyList, parsePreferredReplacements, parseTerminologyList } from "@/lib/terminology";
import { lengthProgress, lengthProgressLabel } from "@/lib/goal-progress";
import type { RewritePreviewState } from "@/hooks/useRewrite";
import { useReadAloud } from "@/hooks/useReadAloud";

interface EditorWorkspaceProps {
  draft: string;
  /** True while the document store is still hydrating: the draft on screen is
   * the seed, not the writer's, so the editor must stay read-only. */
  loading: boolean;
  goals: WritingGoals;
  style: StylePreferences;
  /** The active document's dialect; changing it re-analyses spelling for this draft only. */
  dialect: Dialect;
  onDialectChange: (dialect: Dialect) => void;
  analysis: AnalysisResult;
  openIssues: WritingIssue[];
  visibleIssues: PrioritisedIssue[];
  suggestions: SuggestionState;
  activeIssueId: string | null;
  filter: TierFilter;
  categoryFilter: CategoryFilter;
  categoryOptions: Array<{ value: CategoryFilter; label: string; count: number }>;
  onCategoryFilterChange: (filter: CategoryFilter) => void;
  analyzing: boolean;
  analysisStatusLabel: string;
  analysisError?: string | null;
  savedLabel: string;
  /** Live-region text for keyboard review moves; empty when not reviewing by keyboard. */
  reviewAnnouncement: string;
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
  onEditRewriteReplacement: (value: string) => void;
  onResetRewriteReplacement: () => void;
  onToggleSuggestions: () => void;
  onToggleFocusMode: () => void;
  onNewDocument: () => void;
  onClearDocument: () => void;
  onRestoreSample: () => void;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
  onSelectRange?: (start: number, end: number) => void;
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

/**
 * A comma-separated terminology input that commits on blur/Enter.
 *
 * Local state while typing so every keystroke does not rewrite the document
 * (each commit moves updatedAt and re-queues a save); the parent value is
 * the source of truth on document switch, via the key the caller passes.
 */
function TerminologyField({ label, hint, value, onCommit }: {
  label: string;
  hint: string;
  value: string[] | undefined;
  onCommit: (terms: string[]) => void;
}) {
  const [text, setText] = useState(() => formatTerminologyList(value));
  const commit = () => {
    const terms = parseTerminologyList(text);
    if (terms.join("\0") !== (value ?? []).join("\0")) onCommit(terms);
    else setText(formatTerminologyList(value));
  };
  return (
    <label className="terminology-field">
      <span>{label} <em>{hint}</em></span>
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
        placeholder="comma, separated, terms"
        aria-label={label}
      />
    </label>
  );
}

/**
 * A comma-separated word-swap input that commits on blur/Enter.
 *
 * Same commit-on-blur contract as TerminologyField: local text while typing
 * so keystrokes do not rewrite the document, and the parent value is the
 * source of truth on document switch via the key the caller passes. An
 * explicit commit that parses to an empty map still calls back when the
 * document previously held swaps, so clearing the field removes them.
 */
function SwapsField({ value, onCommit }: {
  value: Record<string, string> | undefined;
  onCommit: (swaps: Record<string, string>) => void;
}) {
  const [text, setText] = useState(() => formatPreferredReplacements(value));
  const commit = () => {
    const swaps = parsePreferredReplacements(text);
    const same = Object.entries(swaps).join("\0") === Object.entries(value ?? {}).join("\0");
    if (!same) onCommit(swaps);
    else setText(formatPreferredReplacements(value));
  };
  return (
    <label className="terminology-field">
      <span>Word swaps <em>flagged with this document&apos;s replacement</em></span>
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
        placeholder="login -> sign in, utilise -> use"
        aria-label="Word swaps"
      />
    </label>
  );
}

export function EditorWorkspace(props: EditorWorkspaceProps) {
  const { registerTextarea, registerHighlight } = props;
  // Live length-goal progress. The goal bar sets the target; this answers
  // "how far along am I" next to it, from the same word count the analysis
  // already computes — no extra counting pass over the draft.
  const goalProgress = lengthProgress(props.analysis.stats.words, props.goals.targetLength);
  const goalProgressLabel = lengthProgressLabel(goalProgress);
  // Read-aloud is owned here because the draft, the dialect and the highlight
  // layer all live in this component: no page-level state is needed, and the
  // text that is spoken cannot drift from the text on screen.
  const readAloud = useReadAloud({ text: props.draft, dialect: props.dialect });
  const scoreMessage = props.analysis.scores.overall >= 90
    ? "Polished draft"
    : props.analysis.scores.overall >= 75
      ? "Strong foundation"
      : "A few useful changes";
  return (
    <div className={`workspace-grid ${props.focusMode ? "is-focus-mode" : ""}`}>
      {/* Spoken confirmation for keyboard review. Visually hidden but in the
          accessibility tree: a keyboard writer gets no hover state, so this is
          the only signal that Tab moved the review cursor and what it landed
          on. */}
      <p className="sr-only" role="status" aria-live="polite">{props.reviewAnnouncement}</p>
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
          <div className="goal-bar-label" title="Goals apply to this document only — each draft keeps its own audience, intent and tone."><Target size={15} /><span>Writing goals · this document</span></div>
          <GoalSelect label="Audience" value={props.goals.audience} options={audienceOptions} onChange={(value) => props.onGoalChange({ audience: value as WritingGoals["audience"] })} />
          <GoalSelect label="Intent" value={props.goals.intent} options={intentOptions} onChange={(value) => props.onGoalChange({ intent: value as WritingGoals["intent"] })} />
          <GoalSelect label="Tone" value={props.goals.tone} options={toneOptions} onChange={(value) => props.onGoalChange({ tone: value as WritingGoals["tone"] })} />
          <GoalSelect label="Type" value={props.goals.documentType ?? ""} options={documentTypeOptions} onChange={(value) => props.onGoalChange({ documentType: value ? (value as WritingGoals["documentType"]) : undefined })} />
          <GoalSelect label="Length" value={props.goals.targetLength ? String(props.goals.targetLength) : ""} options={[{ value: "", label: "Any" }, { value: "300", label: "~300 words" }, { value: "600", label: "~600 words" }, { value: "1200", label: "~1,200 words" }, { value: "2500", label: "~2,500 words" }]} onChange={(value) => props.onGoalChange({ targetLength: value ? Number(value) : undefined })} />
          <GoalSelect label="English" value={props.dialect} options={[{ value: "en-GB", label: "British" }, { value: "en-US", label: "American" }]} onChange={(value) => props.onDialectChange(value as Dialect)} />
        </div>
        {goalProgressLabel !== null ? (
          <div className="goal-progress" role="progressbar" aria-label="Length goal progress" aria-valuenow={goalProgress.percent} aria-valuemin={0} aria-valuemax={100} aria-valuetext={goalProgressLabel}>
            <div className="goal-progress-track" aria-hidden="true"><i style={{ width: `${goalProgress.percent}%` }} /></div>
            <span>{goalProgressLabel}</span>
          </div>
        ) : null}

        {/* Per-document terminology: terms this draft must use or must avoid,
            plus word swaps it enforces ("login -> sign in"). The swaps are
            the per-document counterpart to the global style guide: a client
            draft can prefer one form while another draft prefers the opposite,
            and the document's own map wins for that draft only. Collapsed by
            default to keep the goal bar a single row. */}
        <details className="terminology-details">
          <summary>
            Terminology · must use {(props.goals.requiredTerminology ?? []).length} · avoid {(props.goals.forbiddenTerminology ?? []).length} · swaps {Object.keys(props.goals.preferredReplacements ?? {}).length}
          </summary>
          <div className="terminology-fields">
            <TerminologyField
              key={`required-${(props.goals.requiredTerminology ?? []).join("|")}`}
              label="Must use"
              hint="flagged when missing from the draft"
              value={props.goals.requiredTerminology}
              onCommit={(terms) => props.onGoalChange({ requiredTerminology: terms })}
            />
            <TerminologyField
              key={`forbidden-${(props.goals.forbiddenTerminology ?? []).join("|")}`}
              label="Avoid"
              hint="flagged on every occurrence"
              value={props.goals.forbiddenTerminology}
              onCommit={(terms) => props.onGoalChange({ forbiddenTerminology: terms })}
            />
            <SwapsField
              key={`swaps-${Object.entries(props.goals.preferredReplacements ?? {}).map(([from, to]) => `${from}=${to}`).join("|")}`}
              value={props.goals.preferredReplacements}
              onCommit={(swaps) => props.onGoalChange({ preferredReplacements: swaps })}
            />
          </div>
          <p className="terminology-hint">Applies to this document only — each draft keeps its own terms. Separate terms with commas; write swaps as “login -&gt; sign in”.</p>
        </details>

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
          <RewritePreview preview={props.rewritePreview} onReplace={() => props.onReplaceRewrite(false)} onInsert={() => props.onReplaceRewrite(true)} onCopy={props.onCopyRewrite} onRetry={props.onRetryRewrite} onCancel={props.onCancelRewrite} onSelectAlternative={props.onSelectRewriteAlternative} onEditReplacement={props.onEditRewriteReplacement} onResetReplacement={props.onResetRewriteReplacement} />
        ) : null}

        <div className="editor-card">
          <div className="editor-toolbar">
            <div className="editor-toolbar-left">
              <Button size="icon-xs" variant="ghost" aria-label="Undo" disabled={!props.canUndo} onClick={props.onUndo}><Undo2 size={15} /></Button>
              <Button size="icon-xs" variant="ghost" aria-label="Redo" disabled={!props.canRedo} onClick={props.onRedo}><RotateCw size={15} /></Button>
              <span className="toolbar-separator" />
              <button type="button" className="toolbar-text active" onClick={props.onToggleFocusMode} aria-pressed={props.focusMode} aria-label={props.focusMode ? "Exit focus mode" : "Check as I write mode"}><Highlighter size={14} aria-hidden="true" /> {props.focusMode ? "Exit focus" : "Check as I write"}</button>
              <span className="toolbar-separator" />
              <ReadAloudControls controller={readAloud} hasText={props.draft.trim().length > 0} disabled={props.loading} />
            </div>
            <div className="editor-toolbar-right">
              <span className={`analysis-status ${props.analyzing ? "is-working" : ""}`} role="status" aria-live="polite">
                {props.analyzing
                  ? <><span className="status-spinner" aria-hidden="true" /> Analysing changed text</>
                  : <><span className="status-check" aria-hidden="true"><Check size={11} /></span> {props.analysisStatusLabel}</>}
              </span>
              <Button variant="ghost" size="icon-xs" aria-label="Open editor shortcuts" onClick={props.onOpenShortcuts}><Keyboard size={16} /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="Clear document" onClick={props.onClearDocument}><Trash2 size={16} /></Button>
              <Button variant="ghost" size="icon-xs" aria-label="Open settings" onClick={props.onOpenSettings}><Settings2 size={16} /></Button>
            </div>
          </div>
          <div className="editor-scroll-wrap">
            <div ref={registerHighlight} className="editor-highlight-scroll"><HighlightLayer text={props.draft} issues={props.openIssues} activeIssueId={props.activeIssueId} spokenRange={readAloud.range} /></div>
            <textarea ref={registerTextarea} className="editor-input" value={props.draft} onChange={props.onDraftChange} onSelect={props.onSelectionChange} onKeyUp={props.onSelectionChange} onScroll={props.onScroll} spellCheck={false} data-review-guard aria-label="Draft editor" disabled={props.loading} placeholder="Start writing…" />
          </div>
          <div className="editor-footer">
            <span><Keyboard size={14} /> Select text for rewrite tools</span>
            <span>{props.draft.length.toLocaleString("en-GB")} characters · {Math.ceil(props.draft.length / 4).toLocaleString("en-GB")} tokens</span>
            {/* Mobile only (see .editor-jump): the suggestions sit below the
                whole editor column on small screens, so review is a blind
                scroll without this. A plain anchor needs no state and moves
                focus nowhere it should not go. */}
            {props.suggestionsOpen && props.visibleIssues.length > 0 ? (
              <a className="editor-jump" href="#suggestions">↓ {props.visibleIssues.length} suggestion{props.visibleIssues.length === 1 ? "" : "s"}</a>
            ) : null}
          </div>
        </div>

        {props.analysisError ? <div className="analysis-error" role="status"><span>AI analysis paused: {props.analysisError}</span><button onClick={props.onOpenSettings} type="button">Review settings</button></div> : null}
        <div className="workspace-footnote"><span><ShieldCheck size={14} /> No account required</span><span role={props.saveError ? "status" : undefined} title={props.saveError ?? undefined}>{props.saveError ? "Could not save locally" : props.savedLabel}</span><button onClick={props.onOpenSettings} type="button">Privacy controls</button></div>
      </section>

      {props.suggestionsOpen ? (
        <aside id="suggestions" className="suggestions-column" aria-label="Writing suggestions">
          <div className="suggestions-header">
            <div><p className="eyebrow">Live analysis</p><h2>Suggestions <span>{props.suggestions.report.displayedCount}</span></h2></div>
            <Button size="icon-sm" variant="ghost" aria-label={props.suggestionsOpen ? "Collapse suggestions" : "Show suggestions"} aria-expanded={props.suggestionsOpen} onClick={props.onToggleSuggestions}><PanelRight size={17} /></Button>
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
          <DocumentOverview text={props.draft} stats={props.analysis.stats} goals={props.goals} style={props.style} onJumpToRange={props.onSelectRange} />
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
            {/* A radiogroup, not Tabs. This is a single-select filter with no
                content panels, and Radix Tabs emits aria-controls pointing at a
                tabpanel that does not exist — axe-core flags that as a critical
                aria-valid-attr-value violation. role="radiogroup" describes what
                the control actually is, and each option reports its own checked
                state rather than implying a hidden panel. */}
            <div className="issue-tabs-list" role="radiogroup" aria-label="Filter suggestions by urgency">
              {(["fix-first", "improve", "optional"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={props.filter === value}
                  className={props.filter === value ? "issue-tab is-active" : "issue-tab"}
                  onClick={() => props.onFilterChange(value)}
                >
                  {TIER_LABELS[value]} <span>{props.suggestions.report.byTier[value]}</span>
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={props.filter === "all"}
                className={props.filter === "all" ? "issue-tab is-active" : "issue-tab"}
                onClick={() => props.onFilterChange("all")}
              >
                All <span>{props.suggestions.report.displayedCount}</span>
              </button>
            </div>
            <p className="issue-tabs-help">{TIER_DESCRIPTIONS[props.filter === "all" ? "improve" : props.filter]}</p>
          </div>
          {props.categoryOptions.length > 0 && (
            <div className="category-filters" role="group" aria-label="Filter suggestions by kind of problem">
              <button type="button" className={props.categoryFilter === "all" ? "category-filter is-active" : "category-filter"} onClick={() => props.onCategoryFilterChange("all")}>
                Every kind
              </button>
              {props.categoryOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={props.categoryFilter === option.value}
                  className={props.categoryFilter === option.value ? "category-filter is-active" : "category-filter"}
                  onClick={() => props.onCategoryFilterChange(option.value)}
                >
                  {option.label} <span>{option.count}</span>
                </button>
              ))}
            </div>
          )}
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
              return <SuggestionCard key={issue.id} issue={issue} active={issue.id === props.activeIssueId} onSelect={() => props.onSelectIssue(issue)} onAccept={() => props.onAcceptIssue(issue)} onDismiss={() => props.onDismissIssue(issue)} onAddToDictionary={() => props.onAddToDictionary(issue.original)} controls={controls} groupActions={groupActions} goals={props.goals} style={props.style} />;
            }) : <div className="empty-suggestions"><div className="empty-icon"><CheckCheck size={22} /></div><h3>{props.analyzing ? "Checking deeper analysis" : "Clean so far"}</h3><p>{props.analyzing ? "Local checks are complete while deeper analysis runs." : "Your draft has no open suggestions in this view."}</p></div>}
          </div>
          <SuppressedFindings suppressed={props.suggestions.suppressed} report={props.suggestions.report} onSelectIssue={props.onSelectIssue} onDismissMany={props.onDismissGroup} />
          {props.reviewedCount > 0 ? <div className="review-completion" role="status">{props.reviewedCount} important change{props.reviewedCount === 1 ? "" : "s"} reviewed.</div> : null}
          <div className="suggestions-footer"><span role="status" aria-live="polite"><Zap size={14} /> {props.analysisStatusLabel}</span><button onClick={props.onOpenSettings} type="button">Configure AI <ArrowDown size={13} /></button></div>
        </aside>
      ) : (
        <aside className="suggestions-collapsed"><Button size="sm" variant="outline" aria-label="Show suggestions" aria-expanded={false} onClick={props.onToggleSuggestions}><PanelRight size={15} /> Show suggestions</Button></aside>
      )}
    </div>
  );
}
