import type { AnalysisResult, ScoreDimension, WritingIssue } from "../packages/types/src/index.ts";

/**
 * Before/after progress for Insights.
 *
 * The baseline is the analysis at the moment the writer opened the document
 * (or restored a version). Everything since is measured against it, and every
 * change is attributed to something concrete the writer did — never a bare
 * number moving up or down.
 */

export interface InsightBaseline {
  scores: AnalysisResult["scores"];
  stats: AnalysisResult["stats"];
  issueCounts: Record<string, number>;
}

export interface ScoreProgress {
  dimension: ScoreDimension;
  from: number;
  to: number;
  change: number;
  drivers: string[];
}

export function captureBaseline(analysis: AnalysisResult, issues: WritingIssue[]): InsightBaseline {
  const issueCounts: Record<string, number> = {};
  for (const issue of issues) issueCounts[issue.ruleId] = (issueCounts[issue.ruleId] ?? 0) + 1;
  return { scores: analysis.scores, stats: analysis.stats, issueCounts };
}

function countByRule(issues: WritingIssue[]) {
  const counts: Record<string, number> = {};
  for (const issue of issues) counts[issue.ruleId] = (counts[issue.ruleId] ?? 0) + 1;
  return counts;
}

const RULE_DRIVER_LABELS: Record<string, string> = {
  "clarity-vague-word": "vague expressions",
  "structure-long-sentence": "long sentences",
  "structure-sticky-sentence": "sentences dense with connecting words",
  "conciseness-filler": "filler words",
  "wordiness": "wordy phrases",
  "style-passive-voice": "passive constructions",
  "repetition-adjacent-word": "repeated words",
  "repetition-repeated-phrase": "repeated phrases",
  "spelling-common-typo": "spelling slips",
  "spelling-lexicon": "spelling slips",
  "grammar-subject-verb-agreement": "agreement problems",
  "punctuation-space-before": "punctuation problems",
  "punctuation-repeated": "punctuation problems",
  "structure-note-repeated-idea": "repeated ideas",
  "structure-note-weak-transition": "weak transitions",
  "structure-note-unsupported-claim": "unsupported claims",
  "structure-note-hedging": "stacked hedges",
};

function labelForRule(rule: string) {
  if (rule.startsWith("wordiness-")) return "wordy phrases";
  if (rule.startsWith("style-cliche-")) return "clichés";
  return RULE_DRIVER_LABELS[rule] ?? "suggestions";
}

function driverChanges(baseline: InsightBaseline, currentIssues: WritingIssue[]): string[] {
  const current = countByRule(currentIssues);
  const rules = new Set([...Object.keys(baseline.issueCounts), ...Object.keys(current)]);
  const drivers: string[] = [];
  for (const rule of rules) {
    const before = baseline.issueCounts[rule] ?? 0;
    const after = current[rule] ?? 0;
    if (before === after) continue;
    const label = labelForRule(rule);
    const delta = before - after;
    if (delta > 0) drivers.push(`${delta} ${label} resolved`);
    else drivers.push(`${-delta} new ${label} appeared`);
  }
  return drivers;
}

/**
 * Progress per dimension, with the concrete reasons the score moved. Only
 * dimensions whose score actually changed are reported, and each one names
 * what happened rather than asserting improvement the writer cannot check.
 */
export function scoreProgress(baseline: InsightBaseline, analysis: AnalysisResult, currentIssues: WritingIssue[]): ScoreProgress[] {
  const dimensions: ScoreDimension[] = ["correctness", "clarity", "conciseness", "readability", "engagement", "consistency", "goalAlignment"];
  const drivers = driverChanges(baseline, currentIssues);
  const progress: ScoreProgress[] = [];
  for (const dimension of dimensions) {
    const from = baseline.scores[dimension];
    const to = analysis.scores[dimension];
    if (from === to) continue;
    const change = to - from;
    const detail: string[] = [...drivers];
    if (dimension === "clarity" && baseline.stats.averageSentenceLength !== analysis.stats.averageSentenceLength) {
      const delta = analysis.stats.averageSentenceLength - baseline.stats.averageSentenceLength;
      detail.push(delta < 0
        ? `average sentence length dropped from ${baseline.stats.averageSentenceLength} to ${analysis.stats.averageSentenceLength} words`
        : `average sentence length rose from ${baseline.stats.averageSentenceLength} to ${analysis.stats.averageSentenceLength} words`);
    }
    if (dimension === "conciseness" && baseline.stats.fillerWords !== analysis.stats.fillerWords) {
      const delta = analysis.stats.fillerWords - baseline.stats.fillerWords;
      detail.push(delta < 0 ? `${-delta} filler words removed` : `${delta} filler words added`);
    }
    progress.push({ dimension, from, to, change, drivers: detail.slice(0, 3) });
  }
  return progress.sort((left, right) => right.change - left.change);
}
