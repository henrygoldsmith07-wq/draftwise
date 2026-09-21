"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { analyzeWithTriage, ProviderError, TRIAGE_LABEL_FORMULATION_ID } from "@/packages/ai/src";
import { createAnalysisCacheKey, createAnalysisSettingsFingerprint, detectChangedRange, LruCache } from "@/packages/analysis/src";
import { analyzeLocally, analyzeLocallyIncremental } from "@/packages/grammar/src";
import type { AnalysisResult, ClassifierSettings, ProviderSettings, StylePreferences, WritingGoals } from "@/packages/types/src";

const emptyResult = (text: string, goals: WritingGoals, style: StylePreferences): AnalysisResult => {
  const local = analyzeLocally(text, style, goals);
  return { ...local, analysedText: text, source: "local" };
};

const ANALYSIS_ENGINE_VERSION = "analysis-engine-v3";

function safeCustomHeadersFingerprint(raw: string) {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return createAnalysisSettingsFingerprint({ invalid: true, length: raw.length });
    const safeEntries = Object.entries(parsed as Record<string, unknown>)
      .filter(([name]) => !/(authorization|api[-_ ]?key|token|secret|password|credential)/iu.test(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, createAnalysisSettingsFingerprint(value)] as const);
    return createAnalysisSettingsFingerprint(safeEntries);
  } catch {
    return createAnalysisSettingsFingerprint({ invalid: true, length: raw.length });
  }
}

interface UseAnalysisArgs {
  text: string;
  goals: WritingGoals;
  style: StylePreferences;
  settings: ProviderSettings;
  aiEnabled: boolean;
  classifier?: ClassifierSettings | null;
}

export function useAnalysis({ text, goals, style, settings, aiEnabled, classifier }: UseAnalysisArgs) {
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

    // Cloud AI (provider + classifier.dev) only runs when explicitly enabled.
    // Local analysis above already ran synchronously; triage below decides
    // whether unresolved chunks need the expensive model at all.
    if (!aiEnabled || !settings.apiKey.trim() || !settings.baseUrl.trim() || !settings.model.trim() || !text.trim()) {
      cache.current.clear();
      return;
    }
    const settingsFingerprint = createAnalysisSettingsFingerprint({
      engineVersion: ANALYSIS_ENGINE_VERSION,
      goals,
      style,
      provider: {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        customHeaders: safeCustomHeadersFingerprint(settings.customHeaders),
      },
      classifier: classifier
        ? {
            baseUrl: classifier.baseUrl,
            timeoutMs: classifier.timeoutMs ?? 8_000,
            maxExcerptChars: classifier.maxExcerptChars ?? 500,
            credentialConfigured: Boolean(classifier.apiKey?.trim()),
            labelFormulationId: TRIAGE_LABEL_FORMULATION_ID,
            uncertainPolicy: classifier.uncertainPolicy ?? "provider",
          }
        : null,
      triagePolicy: classifier?.uncertainPolicy ?? "provider",
    });
    const cacheKey = createAnalysisCacheKey(text, settingsFingerprint, changedRange);
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
    // Intelligent debounce: 650ms avoids a classifier request on every keystroke
    // while batching the changed/context chunks into one triage pass.
    const timer = window.setTimeout(() => {
      setStatus("analysing");
      void analyzeWithTriage(text, goals, settings, {
        signal: controller.signal,
        preferences: style,
        changedRange,
        localAnalysis: local,
        classifier: classifier ?? null,
        triageEnabled: true,
        uncertainPolicy: classifier?.uncertainPolicy ?? "provider",
        labelFormulationId: TRIAGE_LABEL_FORMULATION_ID,
      })
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
    }, 650);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [aiEnabled, classifier, goals, settings, style, text]);

  useEffect(() => () => abort.current?.abort(), []);
  return { analysis, status, error, isAnalysing: status === "analysing" };
}
