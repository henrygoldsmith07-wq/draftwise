"use client";

import { useCallback, useRef, useState } from "react";
import { rewriteWithProvider, ProviderError } from "@/packages/ai/src";
import type { ProviderSettings, RewriteResult, StylePreferences, WritingGoals } from "@/packages/types/src";

export interface RewritePreviewState extends RewriteResult {
  label: string;
  original: string;
  selection: { start: number; end: number };
  loading?: boolean;
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
    setPreview({ label: args.label, original: args.text, selection: args.selection, replacement: "", explanation: "", source: "local", loading: true });
    try {
      const provider = args.aiEnabled ? args.settings : { ...args.settings, apiKey: "" };
      const result = await rewriteWithProvider({ text: args.text, instruction: args.instruction, goals: args.goals, preferences: args.style }, provider, controller.signal);
      if (controller.signal.aborted || currentRun !== runId.current) return;
      setPreview({ ...result, label: args.label, original: args.text, selection: args.selection });
    } catch (reason: unknown) {
      if (controller.signal.aborted || currentRun !== runId.current) return;
      setPreview({ label: args.label, original: args.text, selection: args.selection, replacement: args.text, explanation: reason instanceof ProviderError ? reason.message : "Rewrite failed. Nothing was changed.", source: "local" });
    }
  }, []);

  const cancel = useCallback(() => {
    abort.current?.abort();
    setPreview(null);
  }, []);

  return { preview, run, cancel };
}
