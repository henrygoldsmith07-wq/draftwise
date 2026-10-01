import type {
  IssueCategory,
  IssueSeverity,
  StylePreferences,
  WritingIssue,
} from "../../types/src/index.js";
import {
  createIssueId,
} from "./util.ts";

export function shouldIgnore(ruleId: string, original: string, preferences: StylePreferences) {
  const lower = original.trim().toLocaleLowerCase();
  return preferences.ignoredRuleIds.includes(ruleId) || preferences.ignoredWords.some((word) => word.toLocaleLowerCase() === lower) || preferences.personalDictionary.some((word) => word.toLocaleLowerCase() === lower) || preferences.names?.some((word) => word.toLocaleLowerCase() === lower);
}

export function makeIssue(
  ruleId: string,
  start: number,
  end: number,
  original: string,
  replacement: string,
  category: IssueCategory,
  severity: IssueSeverity,
  title: string,
  explanation: string,
  confidence: number,
  preferences: StylePreferences,
): WritingIssue | null {
  if (!original || end <= start || shouldIgnore(ruleId, original, preferences)) return null;
  return {
    id: createIssueId(ruleId, start, end, original),
    ruleId,
    start,
    end,
    original,
    replacement,
    category,
    severity,
    confidence: Math.max(0, Math.min(1, confidence)),
    title,
    explanation,
    source: "local",
  };
}

export function pushIssue(target: WritingIssue[], value: WritingIssue | null) {
  if (value) target.push(value);
}
