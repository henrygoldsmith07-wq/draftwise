import type { ProviderSettings, StylePreferences, WritingGoals } from "../packages/types/src";

export interface RewriteRetryPreview {
  label: string;
  instruction: string;
  original: string;
  selection: { start: number; end: number };
  goals: WritingGoals;
  style: StylePreferences;
  aiEnabled: boolean;
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
  };
}
