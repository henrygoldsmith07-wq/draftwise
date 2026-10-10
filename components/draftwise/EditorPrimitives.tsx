"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import { ArrowDown, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildExplanation, categoryColors } from "@/packages/grammar/src";
import type { PrioritisedIssue, StylePreferences, WritingGoals, WritingIssue } from "@/packages/types/src";

export function HighlightLayer({ text, issues, activeIssueId }: { text: string; issues: WritingIssue[]; activeIssueId: string | null }) {
  const nodes = useMemo<ReactNode[]>(() => {
    const output: ReactNode[] = [];
    let cursor = 0;
    const safeIssues = issues
      .filter((item) => item.start >= 0 && item.end <= text.length && item.end > item.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    for (const item of safeIssues) {
      if (item.start < cursor) continue;
      if (item.start > cursor) output.push(<span key={`plain-${cursor}`}>{text.slice(cursor, item.start)}</span>);
      output.push(
        <mark key={item.id} className={`editor-highlight ${activeIssueId === item.id ? "is-active" : ""}`} data-category={item.category} style={{ "--issue-color": categoryColors[item.category] } as CSSProperties}>
          {text.slice(item.start, item.end)}
        </mark>,
      );
      cursor = item.end;
    }
    if (cursor < text.length) output.push(<span key={`plain-${cursor}`}>{text.slice(cursor)}</span>);
    return output;
  }, [activeIssueId, issues, text]);

  return <div aria-hidden="true" className="editor-highlights">{nodes}</div>;
}

export function Metric({ label, value, note, color = "mint" }: { label: string; value: number | string; note?: string; color?: "mint" | "amber" | "violet" | "blue" }) {
  return <div className="metric-card"><div className="metric-card-topline"><span>{label}</span><span className={`metric-dot metric-dot-${color}`} /></div><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>;
}

export function ScoreRing({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 44;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
  return <div className="score-ring" aria-label={`Overall writing score ${score} out of 100`}><svg viewBox="0 0 110 110" aria-hidden="true"><circle className="score-ring-track" cx="55" cy="55" r="44" /><circle className="score-ring-progress" cx="55" cy="55" r="44" strokeDasharray={circumference} strokeDashoffset={offset} /></svg><span><strong>{score}</strong><small>/100</small></span></div>;
}

export function GoalSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="goal-select"><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export interface SuggestionCardControls {
  onIgnoreRule?: () => void;
  onReduceRule?: () => void;
  onTurnOffRule?: () => void;
}

export interface SuggestionGroupActions {
  label: string;
  count: number;
  safeToApplyAll: boolean;
  onApplyAll: () => void;
  onDismissAll: () => void;
}

/**
 * Plain-language reading of the ranking signals a suggestion already carries.
 *
 * The decision was made from transparent inputs; this shows the writer the same
 * reasoning in words. It is how a suggestion becomes explainable without asking
 * a model to explain it, which keeps the behaviour identical with AI disabled.
 */
function rankingSummary(issue: PrioritisedIssue) {
  const parts: string[] = [];
  if (issue.confidence < 0.75) parts.push(`${Math.round(issue.confidence * 100)}% confident`);
  if (issue.reasonCodes.includes("register-dampened")) parts.push("less relevant to your audience");
  if (issue.impact >= 0.7) parts.push("high impact on the reader");
  else if (issue.impact < 0.35) parts.push("small effect on the reader");
  return parts;
}

export function SuggestionCard({ issue, active, onSelect, onAccept, onDismiss, onAddToDictionary, controls, groupActions, goals, style }: {
  issue: PrioritisedIssue;
  active: boolean;
  onSelect: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  onAddToDictionary?: () => void;
  controls?: SuggestionCardControls;
  groupActions?: SuggestionGroupActions;
  goals?: WritingGoals;
  style?: StylePreferences;
}) {
  const color = categoryColors[issue.category];
  const isStylistic = issue.kind === "style";
  const tierLabel = issue.tier === "fix-first" ? "Fix first" : issue.tier === "improve" ? "Improve" : issue.tier === "optional" ? "Optional" : null;
  const explanation = buildExplanation(issue, goals, style);
  const ranking = rankingSummary(issue);
  return <article className={`suggestion-card ${active ? "is-active" : ""}`} style={{ "--suggestion-color": color } as CSSProperties}>
    <button className="suggestion-main" onClick={onSelect} type="button"><span className="suggestion-heading"><span className="suggestion-color-dot" /><span>{issue.title}</span>{tierLabel ? <Badge className={`tier-badge tier-badge-${issue.tier}`}>{tierLabel}</Badge> : null}{issue.source === "ai" ? <Badge className="ai-badge">AI</Badge> : <Badge className="local-badge">Local</Badge>}</span><span className="suggestion-category">{issue.category} · {issue.severity}{issue.kind ? ` · ${isStylistic ? "style preference" : issue.kind === "objective" ? "objective rule" : "clarity"}` : ""}{issue.groupedCount ? ` · ${issue.groupedCount + 1} similar` : ""}</span>{issue.context ? <span className="suggestion-context">{issue.context}</span> : null}<span className="suggestion-copy">{issue.explanation}</span>{explanation.relevance ? <span className="suggestion-relevance"><strong>Why here:</strong> {explanation.relevance}</span> : null}</button>
    <div className="suggestion-replacement"><span className="suggestion-original">{issue.original}</span>{issue.replacement && issue.replacement !== issue.original ? <><ArrowDown size={14} aria-hidden="true" /><span className="suggestion-new">{issue.replacement}</span></> : <span className="suggestion-review">Review wording</span>}</div>
    <p className="suggestion-action"><strong>Do this:</strong> {explanation.action}</p>
    {ranking.length ? <p className="suggestion-ranking">{ranking.join(" · ")}</p> : null}
    <div className="suggestion-actions"><Button size="sm" onClick={onAccept} disabled={!issue.replacement || issue.replacement === issue.original}><Check size={14} /> Accept</Button><Button size="sm" variant="ghost" onClick={onDismiss} aria-label={`Dismiss ${issue.title}`}><X size={14} /> Ignore this</Button>{onAddToDictionary && issue.category === "spelling" ? <Button size="sm" variant="ghost" onClick={onAddToDictionary}>Add word</Button> : null}</div>
    {groupActions && groupActions.count > 1 ? <div className="suggestion-group-actions"><span>{groupActions.label}</span><button type="button" onClick={groupActions.onApplyAll} disabled={!groupActions.safeToApplyAll} title={groupActions.safeToApplyAll ? `Replace all ${groupActions.count} occurrences` : "Meaning can differ by context, so this pattern is reviewed one at a time"}>{groupActions.safeToApplyAll ? `Replace all ${groupActions.count}` : "Review one by one"}</button><button type="button" onClick={groupActions.onDismissAll}>Dismiss all {groupActions.count}</button></div> : null}
    {controls ? <div className="suggestion-controls"><span>Suggestion type</span><button type="button" onClick={controls.onReduceRule}>Show fewer</button><button type="button" onClick={controls.onTurnOffRule}>Turn off</button></div> : null}
  </article>;
}
