import type { ProviderSettings, StylePreferences, WritingGoals } from "../packages/types/src";

export interface RewriteRetryPreview {
  label: string;
  instruction: string;
  original: string;
  selection: { start: number; end: number };
  goals: WritingGoals;
  style: StylePreferences;
  aiEnabled: boolean;
  /**
   * The draft the rewrite was requested from, kept so a retry carries the same
   * surrounding context as the original attempt. Without it a retry silently
   * degrades to an isolated selection, which is the case most likely to fail
   * again.
   */
  draft?: string;
}

export function createRewriteRetryArgs(preview: RewriteRetryPreview, settings: ProviderSettings) {
  return {
    label: preview.label,
    instruction: preview.instruction,
    text: preview.original,
    selection: preview.selection,
    goals: preview.goals,
    style: preview.style,
    settings,
    aiEnabled: preview.aiEnabled,
    draft: preview.draft,
  };
}


export interface RewriteApplyPreview {
  original: string;
  replacement: string;
  loading?: boolean;
  failed?: boolean;
}

export function canApplyRewritePreview(preview: RewriteApplyPreview) {
  return !preview.loading
    && !preview.failed
    && preview.replacement.trim().length > 0
    && preview.replacement !== preview.original;
}
