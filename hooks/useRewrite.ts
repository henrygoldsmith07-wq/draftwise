"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rewriteWithProvider, ProviderError } from "@/packages/ai/src";
import { surroundingContext } from "@/lib/rewrite-context";
import type { ProviderSettings, RewriteResult, StylePreferences, WritingGoals } from "@/packages/types/src";
export { createRewriteRetryArgs } from "@/lib/rewrite-retry";
export { surroundingContext } from "@/lib/rewrite-context";

/** Shown when a manual edit leaves nothing to apply. */
export const NOTHING_TO_APPLY = "Nothing to apply. Restore a suggestion or write your own version.";

export interface RewritePreviewState extends RewriteResult {
  label: string;
  instruction: string;
  original: string;
  selection: { start: number; end: number };
  goals: WritingGoals;
  style: StylePreferences;
  aiEnabled: boolean;
  /** Kept so a retry re-sends the same surrounding context as the first attempt. */
  draft?: string;
  /**
   * What was suggested, held separately from `replacement` so a writer who edits
   * the wording by hand can always get back to the original suggestion.
   */
  suggested?: string;
  loading?: boolean;
  failed?: boolean;
}

/**
 * The sentences immediately around a selection.
 *
 * Lives in lib/ so it can be tested without a React runtime; re-exported here
 * because callers already reach for the hook module.
 */
export function useRewrite() {
  const [preview, setPreview] = useState<RewritePreviewState | null>(null);
  const runId = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (args: {
    label: string;
    instruction: string;
    text: string;
    selection: { start: number; end: number };
    goals: WritingGoals;
    style: StylePreferences;
    settings: ProviderSettings;
    aiEnabled: boolean;
    /** The whole draft, used only to give the rewrite its surrounding sentences. */
    draft?: string;
  }) => {
    if (!args.text.trim()) return;
    const currentRun = ++runId.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const base = {
      label: args.label,
      instruction: args.instruction,
      original: args.text,
      selection: args.selection,
      goals: args.goals,
      style: args.style,
      aiEnabled: args.aiEnabled,
      draft: args.draft,
    };
    setPreview({ ...base, replacement: "", explanation: "", source: "local", loading: true });
    try {
      const provider = args.aiEnabled ? args.settings : { ...args.settings, apiKey: "" };
      const context = args.draft ? surroundingContext(args.draft, args.selection) : {};
      const result = await rewriteWithProvider({ text: args.text, instruction: args.instruction, goals: args.goals, preferences: args.style, ...context }, provider, controller.signal);
      if (controller.signal.aborted || currentRun !== runId.current) return;
      setPreview({ ...base, ...result, suggested: result.replacement });
    } catch (reason: unknown) {
      if (controller.signal.aborted || currentRun !== runId.current) return;
      setPreview({ ...base, replacement: "", explanation: reason instanceof ProviderError ? reason.message : "Rewrite failed. Nothing was changed.", source: "local", failed: true });
    } finally {
      if (currentRun === runId.current && abort.current === controller) abort.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    // Invalidate the logical run as well as aborting its transport. This keeps a
    // provider that resolves despite AbortSignal from resurrecting a cancelled preview.
    runId.current += 1;
    abort.current?.abort();
    abort.current = null;
    setPreview(null);
  }, []);

  const selectAlternative = useCallback((index: number) => {
    setPreview((current) => {
      const alternative = current?.alternatives?.[index];
      return current && alternative ? { ...current, replacement: alternative, suggested: alternative } : current;
    });
  }, []);

  /**
   * Let the writer adjust the wording before it is applied.
   *
   * A suggested rewrite is a draft, not an instruction. Being able to take it
   * and finish it by hand is the difference between a preview the writer
   * approves and a preview the writer works around. The edited text goes
   * through exactly the same validation as the suggestion on the way out, so a
   * writer cannot apply an empty replacement or reintroduce the original text
   * by accident.
   */
  const editReplacement = useCallback((value: string) => {
    setPreview((current) => {
      if (!current || current.loading || current.failed) return current;
      if (value.trim() === "" || value === current.original) {
        return { ...current, replacement: value, failed: true, explanation: NOTHING_TO_APPLY };
      }
      return { ...current, replacement: value, failed: false, explanation: current.explanation === NOTHING_TO_APPLY ? "" : current.explanation };
    });
  }, []);

  /** Discard the writer's manual edit and go back to the original suggestion. */
  const resetReplacement = useCallback(() => {
    setPreview((current) => {
      if (!current || current.suggested === undefined || current.replacement === current.suggested) return current;
      return { ...current, replacement: current.suggested, failed: false, explanation: current.explanation === NOTHING_TO_APPLY ? "" : current.explanation };
    });
  }, []);

  useEffect(() => () => {
    runId.current += 1;
    abort.current?.abort();
    abort.current = null;
  }, []);

  return { preview, run, cancel, selectAlternative, editReplacement, resetReplacement };
}
