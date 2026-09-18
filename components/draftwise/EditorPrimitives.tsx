"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import { ArrowDown, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { categoryColors } from "@/packages/grammar/src";
import type { IssueCategory, WritingIssue } from "@/packages/types/src";

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

export function SuggestionCard({ issue, active, onSelect, onAccept, onDismiss, onAddToDictionary }: { issue: WritingIssue; active: boolean; onSelect: () => void; onAccept: () => void; onDismiss: () => void; onAddToDictionary?: () => void }) {
  const color = categoryColors[issue.category];
  return <article className={`suggestion-card ${active ? "is-active" : ""}`} style={{ "--suggestion-color": color } as CSSProperties}>
    <button className="suggestion-main" onClick={onSelect} type="button"><span className="suggestion-heading"><span className="suggestion-color-dot" /><span>{issue.title}</span>{issue.source === "ai" ? <Badge className="ai-badge">AI</Badge> : <Badge className="local-badge">Local</Badge>}</span><span className="suggestion-category">{issue.category} · {issue.severity} · {Math.round(issue.confidence * 100)}% confidence</span><span className="suggestion-copy">{issue.explanation}</span></button>
    <div className="suggestion-replacement"><span className="suggestion-original">{issue.original}</span>{issue.replacement && issue.replacement !== issue.original ? <><ArrowDown size={14} aria-hidden="true" /><span className="suggestion-new">{issue.replacement}</span></> : <span className="suggestion-review">Review wording</span>}</div>
    <div className="suggestion-actions"><Button size="sm" onClick={onAccept} disabled={!issue.replacement || issue.replacement === issue.original}><Check size={14} /> Accept</Button><Button size="sm" variant="ghost" onClick={onDismiss} aria-label={`Dismiss ${issue.title}`}><X size={14} /></Button>{onAddToDictionary && issue.category === "spelling" ? <Button size="sm" variant="ghost" onClick={onAddToDictionary}>Add word</Button> : null}</div>
  </article>;
}

export function categoryMatches(issue: WritingIssue, filter: "all" | "grammar" | "style" | IssueCategory) {
  if (filter === "all") return true;
  if (filter === "grammar") return ["grammar", "spelling", "punctuation", "capitalization"].includes(issue.category);
  if (filter === "style") return !["grammar", "spelling", "punctuation", "capitalization"].includes(issue.category);
  return issue.category === filter;
}
