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
  /** Kept so a retry re-sends the same surrounding context as the first attempt. */
  draft?: string;
  loading?: boolean;
  failed?: boolean;
}

/**
 * The sentences immediately around a selection.
 *
 * Sentences, not characters: a context window cut mid-word misleads the model
 * about what the selection is, and a half-sentence in the prompt reads as part
 * of the thing to rewrite. Bounded so a selection inside a very long document
 * does not send the whole draft to the provider.
 */
export function surroundingContext(draft: string, selection: { start: number; end: number }, limit = 600) {
  const before = draft.slice(Math.max(0, selection.start - limit), selection.start);
  const after = draft.slice(selection.end, Math.min(draft.length, selection.end + limit));
  const trimBack = (value: string) => {
    const boundary = value.search(/[.!?…](?:\s|$)/u);
    // Drop a trailing fragment, but keep enough that the model has a sentence.
    return boundary >= 0 && boundary < value.length - 40 ? value.slice(boundary + 1).trim() : value.trim();
  };
  const trimForward = (value: string) => {
    const boundary = value.search(/[.!?…](?:\s|$)/u);
    return boundary >= 0 ? value.slice(0, boundary + 1).trim() : value.trim();
  };
  return { contextBefore: trimBack(before), contextAfter: trimForward(after) };
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
      setPreview({ ...base, ...result });
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
