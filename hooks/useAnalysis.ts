"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { analyzeWithProvider, ProviderError } from "@/packages/ai/src";
import { detectChangedRange, LruCache, createAnalysisCacheKey } from "@/packages/analysis/src";
import { analyzeLocally, analyzeLocallyIncremental } from "@/packages/grammar/src";
import type { AnalysisResult, ProviderSettings, StylePreferences, WritingGoals } from "@/packages/types/src";

const emptyResult = (text: string, goals: WritingGoals, style: StylePreferences): AnalysisResult => {
  const local = analyzeLocally(text, style, goals);
  return { ...local, analysedText: text, source: "local" };
};

interface UseAnalysisArgs {
  text: string;
  goals: WritingGoals;
  style: StylePreferences;
  settings: ProviderSettings;
  aiEnabled: boolean;
}

export function useAnalysis({ text, goals, style, settings, aiEnabled }: UseAnalysisArgs) {
  const [analysis, setAnalysis] = useState(() => emptyResult(text, goals, style));
  const [status, setStatus] = useState<"local" | "analysing" | "ready" | "error">("local");
  const [error, setError] = useState<string | null>(null);
  const previousText = useRef("");
  const previousAnalysis = useRef<AnalysisResult | null>(null);
  const runId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const cache = useRef(new LruCache<AnalysisResult>(24));

  useEffect(() => {
    const currentRun = ++runId.current;
    const beforeText = previousText.current;
    const beforeAnalysis = previousAnalysis.current;
    const changedRange = detectChangedRange(beforeText, text);
    previousText.current = text;
    const localBase = beforeAnalysis && changedRange
      ? analyzeLocallyIncremental(beforeText, text, beforeAnalysis.issues, changedRange, style, goals)
      : emptyResult(text, goals, style);
    const local = { ...localBase, analysedText: text, source: "local" as const, changedRange: changedRange ?? undefined };
    previousAnalysis.current = local;
    startTransition(() => {
      setAnalysis(local);
      setError(null);
      setStatus("local");
    });
    abort.current?.abort();

    if (!aiEnabled || !settings.apiKey.trim() || !settings.baseUrl.trim() || !settings.model.trim() || !text.trim()) return;
    const cacheKey = createAnalysisCacheKey(text, JSON.stringify({ settings: { baseUrl: settings.baseUrl, model: settings.model }, goals, style }), changedRange);
    const cached = cache.current.get(cacheKey);
    if (cached) {
      startTransition(() => {
        setAnalysis(cached);
        setStatus("ready");
      });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    const timer = window.setTimeout(() => {
      setStatus("analysing");
      void analyzeWithProvider(text, goals, settings, { signal: controller.signal, preferences: style, changedRange, localAnalysis: local })
        .then((remote) => {
          if (controller.signal.aborted || currentRun !== runId.current) return;
          cache.current.set(cacheKey, remote);
          previousAnalysis.current = remote;
          setAnalysis(remote);
          setStatus("ready");
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || currentRun !== runId.current) return;
          setStatus("error");
          setError(reason instanceof ProviderError ? reason.message : reason instanceof Error ? reason.message : "AI analysis failed. Local checks are still available.");
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [aiEnabled, goals, settings, style, text]);

  useEffect(() => () => abort.current?.abort(), []);
  return { analysis, status, error, isAnalysing: status === "analysing" };
}
