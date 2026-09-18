"use client";

import { useEffect, useRef, useState } from "react";
import { analyzeWithProvider, ProviderError } from "@/packages/ai/src";
import { detectChangedRange, LruCache, createAnalysisCacheKey } from "@/packages/analysis/src";
import { analyzeLocally } from "@/packages/grammar/src";
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
  const runId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const cache = useRef(new LruCache<AnalysisResult>(24));

  useEffect(() => {
    const currentRun = ++runId.current;
    const changedRange = detectChangedRange(previousText.current, text);
    previousText.current = text;
    const local = emptyResult(text, goals, style);
    setAnalysis({ ...local, changedRange: changedRange ?? undefined });
    setError(null);
    setStatus("local");
    abort.current?.abort();

    if (!aiEnabled || !settings.apiKey.trim() || !settings.baseUrl.trim() || !settings.model.trim() || !text.trim()) return;
    const cacheKey = createAnalysisCacheKey(text, JSON.stringify({ settings: { baseUrl: settings.baseUrl, model: settings.model }, goals, style }), changedRange);
    const cached = cache.current.get(cacheKey);
    if (cached) {
      setAnalysis(cached);
      setStatus("ready");
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    const timer = window.setTimeout(() => {
      setStatus("analysing");
      void analyzeWithProvider(text, goals, settings, { signal: controller.signal, preferences: style, changedRange })
        .then((remote) => {
          if (controller.signal.aborted || currentRun !== runId.current) return;
          cache.current.set(cacheKey, remote);
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
