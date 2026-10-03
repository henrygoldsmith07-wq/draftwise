"use client";

import { useCallback } from "react";
import { Activity, BarChart3, Check, Clock3, PenLine, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Metric, ScoreRing } from "@/components/draftwise/EditorPrimitives";
import type { ScoreProgress } from "@/lib/insight-progress";
import type { AnalysisResult, ScoreDimension, SuggestionTier, WritingGoals, WritingIssue } from "@/packages/types/src";

const SCORE_LABELS: Array<[ScoreDimension, string]> = [
  ["correctness", "Correctness"],
  ["clarity", "Clarity"],
  ["conciseness", "Conciseness"],
  ["readability", "Readability"],
  ["engagement", "Engagement"],
  ["consistency", "Consistency"],
  ["goalAlignment", "Goal alignment"],
];

interface InsightReason {
  label: string;
  detail: string;
  issues: WritingIssue[];
}

const DIMENSION_CATEGORIES: Record<ScoreDimension, string[]> = {
  correctness: ["spelling", "grammar", "punctuation", "capitalization"],
  clarity: ["clarity", "sentence structure", "passive voice"],
  conciseness: ["conciseness", "repetition", "word choice"],
  readability: ["sentence structure", "readability"],
  engagement: ["repetition", "tone"],
  consistency: ["consistency", "spelling", "capitalization"],
  goalAlignment: ["formality", "tone"],
};

function reasonsFor(dimension: ScoreDimension, analysis: AnalysisResult, issues: WritingIssue[]): InsightReason[] {
  const categories = new Set(DIMENSION_CATEGORIES[dimension]);
  const matching = issues.filter((issue) => categories.has(issue.category));
  const reasons: InsightReason[] = [];
  const byRule = new Map<string, WritingIssue[]>();
  for (const issue of matching) {
    const bucket = byRule.get(issue.ruleId);
    if (bucket) bucket.push(issue);
    else byRule.set(issue.ruleId, [issue]);
  }
  for (const [ruleId, group] of byRule) {
    const label = group.length === 1 ? group[0].title : `${group.length} × ${group[0].title.toLowerCase()}`;
    reasons.push({ label, detail: `${group.length} passage${group.length === 1 ? "" : "s"} in the draft${ruleId === "structure-long-sentence" ? ` · longest sentence ${analysis.stats.longestSentence.slice(0, 40)}…` : ""}`, issues: group });
  }
  if (dimension === "clarity" && analysis.stats.longSentences > 0 && !matching.some((issue) => issue.ruleId === "structure-long-sentence")) {
    reasons.push({
      label: `${analysis.stats.longSentences} long sentence${analysis.stats.longSentences === 1 ? "" : "s"}`,
      detail: `Sentences over 32 words ask more of the reader. Average is ${analysis.stats.averageSentenceLength} words.`,
      issues: issues.filter((issue) => issue.ruleId === "structure-long-sentence"),
    });
  }
  if (dimension === "conciseness" && analysis.stats.fillerWords > 0 && !matching.some((issue) => issue.ruleId === "conciseness-filler")) {
    reasons.push({
      label: `${analysis.stats.fillerWords} filler word${analysis.stats.fillerWords === 1 ? "" : "s"}`,
      detail: analysis.stats.fillerWordFrequency.map((item) => `${item.value} ×${item.count}`).join(" · ") || "Filler words weaken emphasis when overused.",
      issues: issues.filter((issue) => issue.ruleId === "conciseness-filler"),
    });
  }
  if (dimension === "readability") {
    reasons.push({ label: `Average sentence length: ${analysis.stats.averageSentenceLength || 0} words`, detail: "Shorter sentences usually read faster without losing meaning.", issues: [] });
  }
  if (dimension === "goalAlignment") {
    reasons.push({ label: `${analysis.scores.breakdown.goalAlignment.signals.slice(0, 3).join(" · ") || "No goal signals yet"}`, detail: analysis.scores.breakdown.goalAlignment.summary, issues: [] });
  }
  return reasons.sort((left, right) => right.issues.length - left.issues.length).slice(0, 4);
}

export function InsightsView({ analysis, goals, openIssues, tierCounts, progress, onBack, onOpenSettings, onJumpToIssue }: {
  analysis: AnalysisResult;
  goals: WritingGoals;
  openIssues: WritingIssue[];
  tierCounts: Record<SuggestionTier, number>;
  progress: ScoreProgress[];
  onBack: () => void;
  onOpenSettings: () => void;
  onJumpToIssue: (issue: WritingIssue) => void;
}) {
  const jumpToReason = useCallback((reason: InsightReason) => {
    const first = reason.issues[0];
    if (first) onJumpToIssue(first);
  }, [onJumpToIssue]);

  const scoreMessage = analysis.scores.overall >= 90 ? "Polished draft" : analysis.scores.overall >= 75 ? "Strong foundation" : "A few useful changes";
  return <section className="full-view"><div className="full-view-heading"><div><p className="eyebrow">Writing insights</p><h1>See what makes the draft work.</h1><p>Each score below lists what moved it and which passages to look at. Scores are explainable guides, not objective measurements.</p></div><Button onClick={onBack}><PenLine size={15} /> Back to draft</Button></div><div className="insights-grid"><div className="insights-score-panel"><div className="insights-score-heading"><div><span className="eyebrow">Overall guide</span><h2>{analysis.scores.overall}<small>/100</small></h2><p>{scoreMessage} · {tierCounts["fix-first"] + tierCounts.improve} change{tierCounts["fix-first"] + tierCounts.improve === 1 ? "" : "s"} worth making</p>{progress.length ? <div className="insight-progress"><strong>Since you opened this document</strong>{progress.slice(0, 3).map((item) => <div key={item.dimension} className="insight-progress-row"><span>{item.dimension === "goalAlignment" ? "Goal alignment" : item.dimension}</span><em className={item.change > 0 ? "progress-up" : "progress-down"}>{item.from} → {item.to}</em><small>{item.drivers.join(" · ") || (item.change > 0 ? "fewer findings overall" : "more findings overall")}</small></div>)}</div> : null}</div><ScoreRing score={analysis.scores.overall} /></div><div className="score-bars">{SCORE_LABELS.map(([key, label]) => <div key={key}><div className="score-bar-row"><span>{label}</span><div role="progressbar" aria-label={`${label} score`} aria-valuenow={analysis.scores[key]} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${analysis.scores[key]}%` }} /></div><strong>{analysis.scores[key]}</strong></div><div className="score-reasons">{reasonsFor(key, analysis, openIssues).map((reason) => <button key={reason.label} type="button" className="score-reason" onClick={() => jumpToReason(reason)} title={reason.detail} disabled={reason.issues.length === 0}><span>{reason.label}</span>{reason.issues.length > 0 ? <em>Review {reason.issues.length} {reason.issues.length === 1 ? "issue" : "issues"} →</em> : null}</button>)}</div></div>)}</div></div><div className="insights-stats-panel"><div className="panel-title"><span>Document stats</span><Clock3 size={16} /></div><div className="large-stat-grid"><Metric label="Words" value={analysis.stats.words.toLocaleString("en-GB")} note="in this draft" color="mint" /><Metric label="Sentences" value={analysis.stats.sentences.toLocaleString("en-GB")} note={`${analysis.stats.longSentences} long`} color="amber" /><Metric label="Read time" value={`${analysis.stats.readingTime} min`} note="at 200 wpm" color="violet" /><Metric label="Readability" value={Math.round(analysis.stats.readability || 0)} note="Flesch-style guide" color="blue" /></div><div className="insight-detail-grid"><div><strong>Average sentence</strong><span>{analysis.stats.averageSentenceLength || 0} words</span></div><div><strong>Vocabulary diversity</strong><span>{Math.round(analysis.stats.vocabularyDiversity * 100)}%</span></div><div><strong>Passive voice</strong><span>{analysis.stats.passiveVoicePercentage}% estimate</span></div><div><strong>Paragraphs</strong><span>{analysis.stats.paragraphs}</span></div></div></div><div className="insights-tone-panel"><div className="panel-title"><span>Tone & goals</span><Activity size={16} /></div><div className="tone-orbit"><div className="orbit-center"><span aria-hidden="true">✦</span><span>your voice</span></div>{analysis.tone.map((tone, index) => <span key={tone} className={`orbit-tag orbit-tag-${index}`}>{tone}</span>)}</div><p>Goal: <strong>{goals.intent}</strong> for a <strong>{goals.audience}</strong> reader in a <strong>{goals.tone}</strong> tone.</p></div><div className="insights-privacy-panel"><div className="panel-title"><span>Actionable patterns</span><BarChart3 size={16} /></div><div className="insight-list">{analysis.stats.repeatedWords.length ? <div><strong>Repeated words</strong><span>{analysis.stats.repeatedWords.map((item) => `${item.value} ×${item.count}`).join(" · ")}</span></div> : null}{analysis.stats.fillerWordFrequency.length ? <div><strong>Filler words</strong><span>{analysis.stats.fillerWordFrequency.map((item) => `${item.value} ×${item.count}`).join(" · ")}</span></div> : null}{analysis.stats.repeatedPhrases.length ? <div><strong>Repeated phrases</strong><span>{analysis.stats.repeatedPhrases.map((item) => `${item.value} ×${item.count}`).join(" · ")}</span></div> : null}{!analysis.stats.repeatedWords.length && !analysis.stats.fillerWordFrequency.length && !analysis.stats.repeatedPhrases.length ? <div><Check size={15} /><span>No repeated or filler patterns detected.</span></div> : null}</div><Button variant="outline" size="sm" onClick={onOpenSettings}><ShieldCheck size={14} /> Review controls</Button></div></div></section>;
}
