"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import {
  analyzeWithTriage,
  CLASSIFIER_MAX_BATCH_CHUNKS,
  MAX_AI_CHARS_PER_ANALYSIS,
  MAX_AI_CHUNKS_PER_ANALYSIS,
  PROVIDER_CONCURRENCY,
  ProviderError,
  TRIAGE_LABEL_FORMULATION_ID,
} from "@/packages/ai/src";
import { createAnalysisCacheKey, createAnalysisSettingsFingerprint, detectChangedRange, LruCache } from "@/packages/analysis/src";
import { analyzeLocally, analyzeLocallyIncremental } from "@/packages/grammar/src";
import type { AnalysisResult, ClassifierSettings, ProviderSettings, StylePreferences, WritingGoals, WritingIssue } from "@/packages/types/src";

const emptyResult = (text: string, goals: WritingGoals, style: StylePreferences): AnalysisResult => {
  const local = analyzeLocally(text, style, goals);
  return { ...local, analysedText: text, source: "local" };
};

const ANALYSIS_ENGINE_VERSION = "analysis-engine-v4";

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
  const previousLocalAnalysis = useRef<AnalysisResult | null>(null);
  const previousAiIssues = useRef<WritingIssue[]>([]);
  const runId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const cache = useRef(new LruCache<AnalysisResult>(24));
  const credentialIdentity = useRef({ providerApiKey: settings.apiKey, classifierApiKey: classifier?.apiKey ?? "" });

  useEffect(() => {
    const currentRun = ++runId.current;
    const beforeText = previousText.current;
    const beforeLocalAnalysis = previousLocalAnalysis.current;
    const changedRange = detectChangedRange(beforeText, text);
    previousText.current = text;
    const localBase = beforeLocalAnalysis && changedRange
      ? analyzeLocallyIncremental(beforeText, text, beforeLocalAnalysis.issues, changedRange, style, goals)
      : emptyResult(text, goals, style);
    const local = { ...localBase, analysedText: text, source: "local" as const, changedRange: changedRange ?? undefined };
    previousLocalAnalysis.current = local;
    // AI issues are intentionally a separate history. They are not fed into
    // the local incremental analyser and are cleared while the edited text
    // waits for a fresh provider result.
    previousAiIssues.current = [];
    startTransition(() => {
      setAnalysis(local);
      setError(null);
      setStatus("local");
    });
    abort.current?.abort();

    const nextCredentialIdentity = { providerApiKey: settings.apiKey, classifierApiKey: classifier?.apiKey ?? "" };
    const credentialsChanged = credentialIdentity.current.providerApiKey !== nextCredentialIdentity.providerApiKey
      || credentialIdentity.current.classifierApiKey !== nextCredentialIdentity.classifierApiKey;
    if (credentialsChanged) {
      cache.current.clear();
      credentialIdentity.current = nextCredentialIdentity;
    }

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
        providerConcurrency: PROVIDER_CONCURRENCY,
        maxAiChunks: MAX_AI_CHUNKS_PER_ANALYSIS,
        maxAiChars: MAX_AI_CHARS_PER_ANALYSIS,
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
      classifierBatchSize: CLASSIFIER_MAX_BATCH_CHUNKS,
    });
    const cacheKey = createAnalysisCacheKey(text, settingsFingerprint, changedRange);
    const cached = cache.current.get(cacheKey);
    if (cached) {
      previousAiIssues.current = cached.issues.filter((issue) => issue.source === "ai");
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
          previousAiIssues.current = remote.issues.filter((issue) => issue.source === "ai");
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
