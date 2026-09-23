"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rewriteWithProvider, ProviderError } from "@/packages/ai/src";
import type { ProviderSettings, RewriteResult, StylePreferences, WritingGoals } from "@/packages/types/src";
export { createRewriteRetryArgs } from "@/lib/rewrite-retry";

export interface RewritePreviewState extends RewriteResult {
  label: string;
  instruction: string;
  original: string;
  selection: { start: number; end: number };
  goals: WritingGoals;
  style: StylePreferences;
  aiEnabled: boolean;
  loading?: boolean;
  failed?: boolean;
}

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
  }) => {
    if (!args.text.trim()) return;
    const currentRun = ++runId.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPreview({ label: args.label, instruction: args.instruction, original: args.text, selection: args.selection, goals: args.goals, style: args.style, aiEnabled: args.aiEnabled, replacement: "", explanation: "", source: "local", loading: true });
    try {
      const provider = args.aiEnabled ? args.settings : { ...args.settings, apiKey: "" };
      const result = await rewriteWithProvider({ text: args.text, instruction: args.instruction, goals: args.goals, preferences: args.style }, provider, controller.signal);
      if (controller.signal.aborted || currentRun !== runId.current) return;
      setPreview({ ...result, label: args.label, instruction: args.instruction, original: args.text, selection: args.selection, goals: args.goals, style: args.style, aiEnabled: args.aiEnabled });
    } catch (reason: unknown) {
      if (controller.signal.aborted || currentRun !== runId.current) return;
      setPreview({ label: args.label, instruction: args.instruction, original: args.text, selection: args.selection, goals: args.goals, style: args.style, aiEnabled: args.aiEnabled, replacement: "", explanation: reason instanceof ProviderError ? reason.message : "Rewrite failed. Nothing was changed.", source: "local", failed: true });
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
      return current && alternative ? { ...current, replacement: alternative } : current;
    });
  }, []);

  useEffect(() => () => {
    runId.current += 1;
    abort.current?.abort();
    abort.current = null;
  }, []);

  return { preview, run, cancel, selectAlternative };
}
