"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_CLASSIFIER_SETTINGS,
  DEFAULT_GOALS,
  DEFAULT_PROVIDER_SETTINGS,
  DEFAULT_STYLE_PREFERENCES,
  type ClassifierSettings,
  type DraftwiseWorkspace,
  type ProviderSettings,
  type StylePreferences,
  type WritingGoals,
} from "../packages/types/src/index.ts";

export const WORKSPACE_STORAGE_KEY = "draftwise:workspace:v2";
export const LEGACY_STORAGE_KEYS = [
  "draftwise:draft",
  "draftwise:goals",
  "draftwise:provider",
  "draftwise:theme",
  "draftwise:ai-enabled",
] as const;

export type SaveStatus = "idle" | "saving" | "saved" | "error";
export const AUTO_SAVE_DELAY_MS = 350;

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isSafeUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    return (parsed.protocol === "https:" || (parsed.protocol === "http:" && localHost))
      && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

export function isWritingGoals(value: unknown): value is WritingGoals {
  return isRecord(value)
    && isOneOf(value.audience, ["general", "academic", "professional", "technical", "casual"])
    && isOneOf(value.intent, ["inform", "explain", "persuade", "describe", "story"])
    && isOneOf(value.tone, ["neutral", "confident", "friendly", "professional", "formal", "casual"]);
}

export function isStylePreferences(value: unknown): value is StylePreferences {
  return isRecord(value)
    && isOneOf(value.dialect, ["en-GB", "en-US"])
    && isStringArray(value.personalDictionary)
    && (value.names === undefined || isStringArray(value.names))
    && isStringArray(value.ignoredWords)
    && isStringArray(value.ignoredRuleIds)
    && isStringMap(value.preferredTerminology)
    && typeof value.oxfordComma === "boolean"
    && typeof value.allowContractions === "boolean"
    && isOneOf(value.passiveVoiceSensitivity, ["off", "normal", "strict"])
    && isOneOf(value.preferredSentenceLength, ["short", "balanced", "long"])
    && isStringArray(value.blockedWords);
}

export function isProviderSettings(value: unknown): value is ProviderSettings {
  return isRecord(value)
    && isOneOf(value.provider, ["openai-compatible", "custom"])
    && isSafeUrl(value.baseUrl)
    && typeof value.model === "string"
    && value.model.length > 0
    && value.model.length <= 200
    && typeof value.apiKey === "string"
    && typeof value.temperature === "number"
    && Number.isFinite(value.temperature)
    && value.temperature >= 0
    && value.temperature <= 1
    && typeof value.maxTokens === "number"
    && Number.isFinite(value.maxTokens)
    && value.maxTokens >= 100
    && value.maxTokens <= 4_000
    && typeof value.customHeaders === "string";
}

export function isClassifierSettings(value: unknown): value is ClassifierSettings {
  return isRecord(value)
    && isSafeUrl(value.baseUrl)
    && (value.apiKey === undefined || typeof value.apiKey === "string")
    && (value.timeoutMs === undefined || (typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) && value.timeoutMs >= 1_000 && value.timeoutMs <= 30_000))
    && (value.maxExcerptChars === undefined || (typeof value.maxExcerptChars === "number" && Number.isFinite(value.maxExcerptChars) && value.maxExcerptChars >= 80 && value.maxExcerptChars <= 2_000))
    && (value.uncertainPolicy === undefined || isOneOf(value.uncertainPolicy, ["provider", "local"]));
}

export function isWorkspace(value: unknown): value is DraftwiseWorkspace {
  return isRecord(value)
    && value.version === 2
    && typeof value.title === "string"
    && typeof value.draft === "string"
    && isWritingGoals(value.goals)
    && isStylePreferences(value.style)
    && isProviderSettings(value.provider)
    && (value.classifier === undefined || isClassifierSettings(value.classifier))
    && typeof value.aiEnabled === "boolean"
    && isOneOf(value.theme, ["light", "dark", "system"]);
}

function readSafely(storage: WorkspaceStorage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function parseRecord(value: string | null) {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sanitiseGoals(value: unknown, fallback: WritingGoals): WritingGoals {
  if (!isRecord(value)) return fallback;
  return {
    audience: isOneOf(value.audience, ["general", "academic", "professional", "technical", "casual"]) ? value.audience : fallback.audience,
    intent: isOneOf(value.intent, ["inform", "explain", "persuade", "describe", "story"]) ? value.intent : fallback.intent,
    tone: isOneOf(value.tone, ["neutral", "confident", "friendly", "professional", "formal", "casual"]) ? value.tone : fallback.tone,
  };
}

function sanitiseStyle(value: unknown, fallback: StylePreferences): StylePreferences {
  if (!isRecord(value)) return fallback;
  return {
    dialect: isOneOf(value.dialect, ["en-GB", "en-US"]) ? value.dialect : fallback.dialect,
    personalDictionary: isStringArray(value.personalDictionary) ? value.personalDictionary : fallback.personalDictionary,
    names: isStringArray(value.names) ? value.names : fallback.names,
    ignoredWords: isStringArray(value.ignoredWords) ? value.ignoredWords : fallback.ignoredWords,
    ignoredRuleIds: isStringArray(value.ignoredRuleIds) ? value.ignoredRuleIds : fallback.ignoredRuleIds,
    preferredTerminology: isStringMap(value.preferredTerminology) ? value.preferredTerminology : fallback.preferredTerminology,
    oxfordComma: typeof value.oxfordComma === "boolean" ? value.oxfordComma : fallback.oxfordComma,
    allowContractions: typeof value.allowContractions === "boolean" ? value.allowContractions : fallback.allowContractions,
    passiveVoiceSensitivity: isOneOf(value.passiveVoiceSensitivity, ["off", "normal", "strict"]) ? value.passiveVoiceSensitivity : fallback.passiveVoiceSensitivity,
    preferredSentenceLength: isOneOf(value.preferredSentenceLength, ["short", "balanced", "long"]) ? value.preferredSentenceLength : fallback.preferredSentenceLength,
    blockedWords: isStringArray(value.blockedWords) ? value.blockedWords : fallback.blockedWords,
  };
}

function sanitiseProvider(value: unknown, fallback: ProviderSettings): ProviderSettings {
  if (!isRecord(value)) return fallback;
  return {
    provider: isOneOf(value.provider, ["openai-compatible", "custom"]) ? value.provider : fallback.provider,
    baseUrl: isSafeUrl(value.baseUrl) ? value.baseUrl : fallback.baseUrl,
    model: typeof value.model === "string" && value.model.length > 0 && value.model.length <= 200 ? value.model : fallback.model,
    apiKey: typeof value.apiKey === "string" ? value.apiKey : fallback.apiKey,
    temperature: typeof value.temperature === "number" && Number.isFinite(value.temperature) && value.temperature >= 0 && value.temperature <= 1 ? value.temperature : fallback.temperature,
    maxTokens: typeof value.maxTokens === "number" && Number.isFinite(value.maxTokens) && value.maxTokens >= 100 && value.maxTokens <= 4_000 ? value.maxTokens : fallback.maxTokens,
    customHeaders: typeof value.customHeaders === "string" ? value.customHeaders : fallback.customHeaders,
  };
}

function sanitiseClassifier(value: unknown, fallback: ClassifierSettings | undefined) {
  if (!isRecord(value)) return fallback;
  const safe = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "model"));
  return {
    baseUrl: isSafeUrl(safe.baseUrl) ? safe.baseUrl : fallback?.baseUrl ?? DEFAULT_CLASSIFIER_SETTINGS.baseUrl,
    ...(typeof safe.apiKey === "string" ? { apiKey: safe.apiKey } : fallback?.apiKey !== undefined ? { apiKey: fallback.apiKey } : {}),
    ...(typeof safe.timeoutMs === "number" && Number.isFinite(safe.timeoutMs) && safe.timeoutMs >= 1_000 && safe.timeoutMs <= 30_000 ? { timeoutMs: safe.timeoutMs } : fallback?.timeoutMs !== undefined ? { timeoutMs: fallback.timeoutMs } : {}),
    ...(typeof safe.maxExcerptChars === "number" && Number.isFinite(safe.maxExcerptChars) && safe.maxExcerptChars >= 80 && safe.maxExcerptChars <= 2_000 ? { maxExcerptChars: safe.maxExcerptChars } : fallback?.maxExcerptChars !== undefined ? { maxExcerptChars: fallback.maxExcerptChars } : {}),
    uncertainPolicy: isOneOf(safe.uncertainPolicy, ["provider", "local"]) ? safe.uncertainPolicy : fallback?.uncertainPolicy ?? "provider",
  } satisfies ClassifierSettings;
}

function sanitiseWorkspace(initial: DraftwiseWorkspace, value: Record<string, unknown>): DraftwiseWorkspace {
  const fallbackClassifier = initial.classifier ?? DEFAULT_CLASSIFIER_SETTINGS;
  return {
    version: 2,
    title: typeof value.title === "string" ? value.title : initial.title,
    draft: typeof value.draft === "string" ? value.draft : initial.draft,
    goals: sanitiseGoals(value.goals, initial.goals ?? DEFAULT_GOALS),
    style: sanitiseStyle(value.style, initial.style ?? DEFAULT_STYLE_PREFERENCES),
    provider: sanitiseProvider(value.provider, initial.provider ?? DEFAULT_PROVIDER_SETTINGS),
    classifier: sanitiseClassifier(value.classifier, fallbackClassifier),
    aiEnabled: typeof value.aiEnabled === "boolean" ? value.aiEnabled : initial.aiEnabled,
    theme: isOneOf(value.theme, ["light", "dark", "system"]) ? value.theme : initial.theme,
  };
}

export function readLegacyWorkspace(initial: DraftwiseWorkspace, storage: WorkspaceStorage): DraftwiseWorkspace {
  const draft = readSafely(storage, "draftwise:draft");
  const goals = parseRecord(readSafely(storage, "draftwise:goals"));
  const provider = parseRecord(readSafely(storage, "draftwise:provider"));
  const theme = readSafely(storage, "draftwise:theme");
  const aiEnabled = readSafely(storage, "draftwise:ai-enabled");
  return sanitiseWorkspace(initial, {
    draft: draft ?? initial.draft,
    goals: goals ?? initial.goals,
    provider: provider ?? initial.provider,
    theme: isOneOf(theme, ["light", "dark", "system"]) ? theme : initial.theme,
    aiEnabled: aiEnabled === null ? initial.aiEnabled : aiEnabled === "true",
  });
}

export function readWorkspaceFromStorage(initial: DraftwiseWorkspace, storage: WorkspaceStorage): DraftwiseWorkspace {
  const stored = readSafely(storage, WORKSPACE_STORAGE_KEY);
  if (!stored) return readLegacyWorkspace(initial, storage);
  const parsed = parseRecord(stored);
  return parsed ? sanitiseWorkspace(initial, parsed) : readLegacyWorkspace(initial, storage);
}

export function resolveHydratedWorkspace(current: DraftwiseWorkspace, loaded: DraftwiseWorkspace, dirty: boolean) {
  return dirty ? current : loaded;
}

function storageErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "name" in error && error.name === "QuotaExceededError") return "Local storage is full.";
  if (error instanceof Error && error.message) return error.message;
  return "Could not save this draft locally.";
}

export function writeWorkspaceToStorage(workspace: DraftwiseWorkspace, storage: WorkspaceStorage) {
  try {
    const serialised = JSON.stringify(workspace);
    if (typeof serialised !== "string") throw new Error("Could not serialise this draft.");
    storage.setItem(WORKSPACE_STORAGE_KEY, serialised);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: storageErrorMessage(error) };
  }
}

export function clearWorkspaceStorage(storage: WorkspaceStorage) {
  let firstError: string | null = null;
  for (const key of [WORKSPACE_STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    try {
      storage.removeItem(key);
    } catch (error) {
      firstError ??= storageErrorMessage(error);
    }
  }
  return firstError ? { ok: false as const, error: firstError } : { ok: true as const };
}

export function useDraftPersistence(initial: DraftwiseWorkspace) {
  const [workspace, setWorkspaceState] = useState(initial);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const workspaceRef = useRef(initial);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  const persistCurrent = useCallback(() => {
    const result = writeWorkspaceToStorage(workspaceRef.current, window.localStorage);
    if (result.ok) {
      dirtyRef.current = false;
      setLastSavedAt(Date.now());
      setSaveStatus("saved");
      setSaveError(null);
    } else {
      setSaveStatus("error");
      setSaveError(result.error);
    }
    return result;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let loaded = initial;
      try {
        loaded = readWorkspaceFromStorage(initial, window.localStorage);
      } catch {
        loaded = initial;
      }
      const wasDirty = dirtyRef.current;
      const resolved = resolveHydratedWorkspace(workspaceRef.current, loaded, wasDirty);
      workspaceRef.current = resolved;
      if (!wasDirty) {
        dirtyRef.current = false;
        setWorkspaceState(resolved);
      }
      setHydrated(true);
      setSaveStatus(wasDirty ? "saving" : "idle");
      setSaveError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initial]);

  useEffect(() => {
    if (!hydrated || !dirtyRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    setSaveError(null);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      persistCurrent();
    }, AUTO_SAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [hydrated, persistCurrent, workspace]);

  useEffect(() => {
    if (!hydrated) return;
    const flushPendingSave = () => {
      if (!dirtyRef.current) return;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const result = writeWorkspaceToStorage(workspaceRef.current, window.localStorage);
      if (result.ok) dirtyRef.current = false;
    };
    window.addEventListener("pagehide", flushPendingSave);
    return () => window.removeEventListener("pagehide", flushPendingSave);
  }, [hydrated]);

  const updateWorkspace = useCallback((patch: Partial<DraftwiseWorkspace> | ((current: DraftwiseWorkspace) => DraftwiseWorkspace)) => {
    const current = workspaceRef.current;
    const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
    workspaceRef.current = next;
    dirtyRef.current = true;
    setWorkspaceState(next);
  }, []);

  const replaceWorkspace = useCallback((next: DraftwiseWorkspace | ((current: DraftwiseWorkspace) => DraftwiseWorkspace)) => {
    const value = typeof next === "function" ? next(workspaceRef.current) : next;
    workspaceRef.current = value;
    dirtyRef.current = true;
    setWorkspaceState(value);
  }, []);

  const saveNow = useCallback(() => {
    if (!hydrated) return { ok: false as const, error: "Draft is still loading." };
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setSaveStatus("saving");
    setSaveError(null);
    return persistCurrent();
  }, [hydrated, persistCurrent]);

  const clearLocalData = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const result = clearWorkspaceStorage(window.localStorage);
    workspaceRef.current = initial;
    dirtyRef.current = false;
    setWorkspaceState(initial);
    setLastSavedAt(null);
    if (result.ok) {
      setSaveError(null);
      setSaveStatus("idle");
    } else {
      setSaveStatus("error");
      setSaveError(result.error);
    }
  }, [initial]);

  return {
    workspace,
    setWorkspace: replaceWorkspace,
    updateWorkspace,
    hydrated,
    saveStatus,
    lastSavedAt,
    saveError,
    saveNow,
    clearLocalData,
  };
}
