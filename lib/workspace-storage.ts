/**
 * Workspace persistence: storage keys, validators, sanitizers, readers and
 * writers for the versioned Draftwise workspace.
 *
 * Framework-free on purpose. It used to live inside hooks/useDraftPersistence,
 * which meant every consumer — including the clear-all path and the unit
 * tests — imported React transitively. The hook file now only holds the React
 * hook itself and re-exports everything here, so this module can be tested
 * and reused anywhere.
 */

import { cleanPreferredReplacements, cleanTerminologyList } from "./terminology.ts";
import {
  DEFAULT_CLASSIFIER_SETTINGS,
  DEFAULT_GOALS,
  DEFAULT_PROVIDER_SETTINGS,
  DEFAULT_STYLE_PREFERENCES,
  type ClassifierSettings,
  type DraftwiseWorkspace,
  type LearnedPreference,
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
// Bounds for fields that come from an untrusted backup. A shape-valid backup
// can still carry a 15 MB API key or a 100k-entry count map, which would be
// written to storage and then scanned on every writing-profile adjustment.
export const MAX_API_KEY_CHARS = 4096;
export const MAX_DOCUMENT_ID_CHARS = 256;
export const MAX_COUNT_MAP_KEYS = 500;

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

/**
 * Custom headers are a JSON object the user pastes in, and it is persisted
 * verbatim to localStorage. People put tenant tokens in it. Request-time
 * filtering strips the dangerous header names, but nothing bounded how much
 * secret this could park on disk, so keep it to a size a hand-written header
 * set actually needs.
 */
const MAX_CUSTOM_HEADERS_CHARS = 4_000;

/**
 * Bounds for the free-text lists in the style profile and goals. These are
 * learned from files the writer did not author (backups, imported profiles):
 * analysis compiles a regex or scans an array per entry on every keystroke, so
 * a hostile "dictionary" of 50,000 words would freeze the tab after restore.
 * The limits sit far above any real profile so normal data round-trips untouched.
 */
export const MAX_WORD_LIST_ITEMS = 1_000;
export const MAX_WORD_CHARS = 120;
export const MAX_LEARNED_ITEMS = 500;
export const MAX_LEARNED_TEXT_CHARS = 1_000;

/**
 * Single bounded cleaner for every untrusted word list (dictionary, names,
 * ignored/blocked words, rule ids). Normalises whitespace and deduplicates like
 * `cleanTerminologyList` does, but keeps its own limits: a personal dictionary
 * can legitimately hold more than the per-document terminology cap of 50.
 */
function cleanWordList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const words: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const word = item.trim().replace(/\s+/gu, " ");
    if (!word || word.length > MAX_WORD_CHARS) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    words.push(word);
    if (words.length >= MAX_WORD_LIST_ITEMS) break;
  }
  return words;
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
    && isOneOf(value.tone, ["neutral", "confident", "friendly", "professional", "formal", "casual"])
    && (value.documentType === undefined || isOneOf(value.documentType, ["essay", "report", "email", "article", "personal-statement", "technical-explanation", "notes", "general"]))
    && (value.targetLength === undefined || (typeof value.targetLength === "number" && Number.isFinite(value.targetLength) && value.targetLength > 0))
    && (value.requiredTerminology === undefined || isStringArray(value.requiredTerminology))
    && (value.forbiddenTerminology === undefined || isStringArray(value.forbiddenTerminology))
    && (value.preferredReplacements === undefined || isStringMap(value.preferredReplacements));
}

export function isStylePreferences(value: unknown): value is StylePreferences {
  return isRecord(value)
    && isOneOf(value.dialect, ["en-GB", "en-US"])
    && isStringArray(value.personalDictionary)
    && (value.names === undefined || isStringArray(value.names))
    && isStringArray(value.ignoredWords)
    && isStringArray(value.ignoredRuleIds)
    && (value.reducedRuleIds === undefined || isStringArray(value.reducedRuleIds))
    && (value.dismissalCounts === undefined || (isRecord(value.dismissalCounts) && Object.values(value.dismissalCounts).every((count) => typeof count === "number" && Number.isFinite(count))))
    && (value.acceptanceCounts === undefined || (isRecord(value.acceptanceCounts) && Object.values(value.acceptanceCounts).every((count) => typeof count === "number" && Number.isFinite(count))))
    && (value.learned === undefined || Array.isArray(value.learned))
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
    && typeof value.customHeaders === "string"
    && value.customHeaders.length <= MAX_CUSTOM_HEADERS_CHARS;
}

export function isClassifierSettings(value: unknown): value is ClassifierSettings {
  return isRecord(value)
    // An empty baseUrl means classifier triage is switched off, which is how it
    // ships. Treating that as invalid would make every saved workspace look
    // corrupt and throw away the writer's other preferences with it.
    && (value.baseUrl === "" || isSafeUrl(value.baseUrl))
    && (value.apiKey === undefined || typeof value.apiKey === "string")
    && (value.timeoutMs === undefined || (typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) && value.timeoutMs >= 1_000 && value.timeoutMs <= 30_000))
    && (value.maxExcerptChars === undefined || (typeof value.maxExcerptChars === "number" && Number.isFinite(value.maxExcerptChars) && value.maxExcerptChars >= 80 && value.maxExcerptChars <= 2_000))
    && (value.uncertainPolicy === undefined || isOneOf(value.uncertainPolicy, ["provider", "local"]));
}

export function isWorkspace(value: unknown): value is DraftwiseWorkspace {
  return isRecord(value)
    && value.version === 2
    && isWritingGoals(value.goals)
    && isStylePreferences(value.style)
    && isProviderSettings(value.provider)
    && (value.classifier === undefined || isClassifierSettings(value.classifier))
    && typeof value.aiEnabled === "boolean"
    && isOneOf(value.theme, ["light", "dark", "system"])
    && (value.activeDocumentId === undefined || typeof value.activeDocumentId === "string");
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
  const goals: WritingGoals = {
    audience: isOneOf(value.audience, ["general", "academic", "professional", "technical", "casual"]) ? value.audience : fallback.audience,
    intent: isOneOf(value.intent, ["inform", "explain", "persuade", "describe", "story"]) ? value.intent : fallback.intent,
    tone: isOneOf(value.tone, ["neutral", "confident", "friendly", "professional", "formal", "casual"]) ? value.tone : fallback.tone,
    // Remote's optional-field spreads are handled once by the bounded
    // assignments below (cleanTerminologyList plus a single cleaned
    // preferredReplacements). That preserves the same fields remote spread here,
    // with stricter sanitisation, and avoids reintroducing the duplicate,
    // unbounded swap-map spread from the old shape.
  };
  // Optional keys stay absent when neither the stored value nor the fallback
  // has them, so a normal profile round-trips with exactly the same shape.
  const documentType = value.documentType !== undefined
    ? (isOneOf(value.documentType, ["essay", "report", "email", "article", "personal-statement", "technical-explanation", "notes", "general"]) ? value.documentType : fallback.documentType)
    : fallback.documentType;
  if (documentType !== undefined) goals.documentType = documentType;

  const targetLength = typeof value.targetLength === "number" && Number.isFinite(value.targetLength) && value.targetLength > 0
    ? Math.min(200_000, Math.round(value.targetLength))
    : fallback.targetLength;
  if (targetLength !== undefined) goals.targetLength = targetLength;

  // Analysis builds a regex per term on every keystroke: bound and dedupe the
  // lists rather than adopting a hostile 50,000-term array verbatim.
  if (value.requiredTerminology !== undefined || fallback.requiredTerminology !== undefined) {
    goals.requiredTerminology = cleanTerminologyList(value.requiredTerminology ?? fallback.requiredTerminology);
  }
  if (value.forbiddenTerminology !== undefined || fallback.forbiddenTerminology !== undefined) {
    goals.forbiddenTerminology = cleanTerminologyList(value.forbiddenTerminology ?? fallback.forbiddenTerminology);
  }
  // A valid-but-hostile swap map is cleaned rather than trusted verbatim:
  // the writer keeps their other goals and the prompt never carries an
  // unbounded map from stored data.
  if (value.preferredReplacements !== undefined || fallback.preferredReplacements !== undefined) {
    goals.preferredReplacements = cleanPreferredReplacements(isStringMap(value.preferredReplacements) ? value.preferredReplacements : fallback.preferredReplacements ?? {});
  }
  return goals;
}

function sanitiseStyle(value: unknown, fallback: StylePreferences): StylePreferences {
  if (!isRecord(value)) return fallback;
  // Required fields are always present. Every untrusted word list goes through
  // one bounded cleaner so a hostile backup cannot restore a 15MB dictionary.
  const style: StylePreferences = {
    dialect: isOneOf(value.dialect, ["en-GB", "en-US"]) ? value.dialect : fallback.dialect,
    personalDictionary: cleanWordList(value.personalDictionary, fallback.personalDictionary),
    ignoredWords: cleanWordList(value.ignoredWords, fallback.ignoredWords),
    ignoredRuleIds: cleanWordList(value.ignoredRuleIds, fallback.ignoredRuleIds),
    reducedRuleIds: cleanWordList(value.reducedRuleIds, fallback.reducedRuleIds),
    blockedWords: cleanWordList(value.blockedWords, fallback.blockedWords),
    // The global swap map feeds the same regex compilation as per-document
    // swaps, so clean it at the boundary too rather than trusting it verbatim.
    preferredTerminology: cleanPreferredReplacements(isStringMap(value.preferredTerminology) ? value.preferredTerminology : fallback.preferredTerminology ?? {}),
    oxfordComma: typeof value.oxfordComma === "boolean" ? value.oxfordComma : fallback.oxfordComma,
    allowContractions: typeof value.allowContractions === "boolean" ? value.allowContractions : fallback.allowContractions,
    passiveVoiceSensitivity: isOneOf(value.passiveVoiceSensitivity, ["off", "normal", "strict"]) ? value.passiveVoiceSensitivity : fallback.passiveVoiceSensitivity,
    preferredSentenceLength: isOneOf(value.preferredSentenceLength, ["short", "balanced", "long"]) ? value.preferredSentenceLength : fallback.preferredSentenceLength,
  };
  // Optional keys keep their shape: absent stays absent unless the fallback
  // supplies one, so a normal profile round-trips unchanged.
  if (value.names !== undefined || fallback.names !== undefined) {
    style.names = cleanWordList(value.names, fallback.names ?? []);
  }
  if (isRecord(value.dismissalCounts)) {
    style.dismissalCounts = Object.fromEntries(Object.entries(value.dismissalCounts).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])).slice(0, MAX_COUNT_MAP_KEYS));
  } else if (fallback.dismissalCounts !== undefined) {
    style.dismissalCounts = fallback.dismissalCounts;
  }
  if (isRecord(value.acceptanceCounts)) {
    style.acceptanceCounts = Object.fromEntries(Object.entries(value.acceptanceCounts).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])).slice(0, MAX_COUNT_MAP_KEYS));
  } else if (fallback.acceptanceCounts !== undefined) {
    style.acceptanceCounts = fallback.acceptanceCounts;
  }
  if (Array.isArray(value.learned)) {
    style.learned = value.learned
      .slice(0, MAX_LEARNED_ITEMS)
      .flatMap((entry): LearnedPreference[] => (isRecord(entry) && typeof entry.id === "string" && typeof entry.family === "string" && typeof entry.label === "string"
        ? [{
            id: entry.id.slice(0, MAX_LEARNED_TEXT_CHARS),
            // Every kind has to be listed. An unrecognised one falls back to
            // "dismissal-pattern", so omitting "accepted-pattern" silently
            // relabelled accepted advice as dampened on the next reload and
            // offered the writer "Forget this" for something they had endorsed.
            kind: entry.kind === "reduced-family" || entry.kind === "disabled-family" || entry.kind === "accepted-pattern" ? entry.kind : "dismissal-pattern",
            label: entry.label.slice(0, MAX_LEARNED_TEXT_CHARS),
            detail: (typeof entry.detail === "string" ? entry.detail : "").slice(0, MAX_LEARNED_TEXT_CHARS),
            family: entry.family.slice(0, MAX_LEARNED_TEXT_CHARS),
            createdAt: typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
            source: entry.source === "manual" ? "manual" : "learned",
          }]
        : []));
  } else if (fallback.learned !== undefined) {
    style.learned = fallback.learned;
  }
  return style;
}

function sanitiseProvider(value: unknown, fallback: ProviderSettings): ProviderSettings {
  if (!isRecord(value)) return fallback;
  return {
    provider: isOneOf(value.provider, ["openai-compatible", "custom"]) ? value.provider : fallback.provider,
    baseUrl: isSafeUrl(value.baseUrl) ? value.baseUrl : fallback.baseUrl,
    model: typeof value.model === "string" && value.model.length > 0 && value.model.length <= 200 ? value.model : fallback.model,
    apiKey: typeof value.apiKey === "string" && value.apiKey.length <= MAX_API_KEY_CHARS ? value.apiKey : fallback.apiKey,
    temperature: typeof value.temperature === "number" && Number.isFinite(value.temperature) && value.temperature >= 0 && value.temperature <= 1 ? value.temperature : fallback.temperature,
    maxTokens: typeof value.maxTokens === "number" && Number.isFinite(value.maxTokens) && value.maxTokens >= 100 && value.maxTokens <= 4_000 ? value.maxTokens : fallback.maxTokens,
    customHeaders: typeof value.customHeaders === "string" && value.customHeaders.length <= MAX_CUSTOM_HEADERS_CHARS ? value.customHeaders : fallback.customHeaders,
  };
}

function sanitiseClassifier(value: unknown, fallback: ClassifierSettings | undefined) {
  if (!isRecord(value)) return fallback;
  const safe = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "model"));
  // A stored empty URL means "switched off" and must survive the round trip.
  // Falling back to a default here would silently re-enable triage on reload.
  const baseUrl = safe.baseUrl === ""
    ? ""
    : isSafeUrl(safe.baseUrl) ? safe.baseUrl : fallback?.baseUrl ?? DEFAULT_CLASSIFIER_SETTINGS.baseUrl;
  return {
    baseUrl,
    ...(typeof safe.apiKey === "string" && safe.apiKey.length <= MAX_API_KEY_CHARS ? { apiKey: safe.apiKey } : fallback?.apiKey !== undefined ? { apiKey: fallback.apiKey } : {}),
    ...(typeof safe.timeoutMs === "number" && Number.isFinite(safe.timeoutMs) && safe.timeoutMs >= 1_000 && safe.timeoutMs <= 30_000 ? { timeoutMs: safe.timeoutMs } : fallback?.timeoutMs !== undefined ? { timeoutMs: fallback.timeoutMs } : {}),
    ...(typeof safe.maxExcerptChars === "number" && Number.isFinite(safe.maxExcerptChars) && safe.maxExcerptChars >= 80 && safe.maxExcerptChars <= 2_000 ? { maxExcerptChars: safe.maxExcerptChars } : fallback?.maxExcerptChars !== undefined ? { maxExcerptChars: fallback.maxExcerptChars } : {}),
    uncertainPolicy: isOneOf(safe.uncertainPolicy, ["provider", "local"]) ? safe.uncertainPolicy : fallback?.uncertainPolicy ?? "provider",
  } satisfies ClassifierSettings;
}

function sanitiseTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function sanitiseWorkspace(initial: DraftwiseWorkspace, input: unknown): DraftwiseWorkspace {
  const value: Record<string, unknown> = isRecord(input) ? input : {};
  const fallbackClassifier = initial.classifier ?? DEFAULT_CLASSIFIER_SETTINGS;
  const workspace: DraftwiseWorkspace = {
    version: 2,
    goals: sanitiseGoals(value.goals, initial.goals ?? DEFAULT_GOALS),
    style: sanitiseStyle(value.style, initial.style ?? DEFAULT_STYLE_PREFERENCES),
    provider: sanitiseProvider(value.provider, initial.provider ?? DEFAULT_PROVIDER_SETTINGS),
    classifier: sanitiseClassifier(value.classifier, fallbackClassifier),
    aiEnabled: typeof value.aiEnabled === "boolean" ? value.aiEnabled : initial.aiEnabled,
    theme: isOneOf(value.theme, ["light", "dark", "system"]) ? value.theme : initial.theme,
    // Legacy `title`/`draft` fields are deliberately ignored: document content
    // lives in the document store. `activeDocumentId` is metadata only.
    activeDocumentId: typeof value.activeDocumentId === "string" && value.activeDocumentId && value.activeDocumentId.length <= MAX_DOCUMENT_ID_CHARS ? value.activeDocumentId : initial.activeDocumentId,
    // Dismissals are decisions, not session state. Malformed entries are dropped
    // rather than trusted, and the list is bounded because it grows with use: a
    // writer who dismisses hundreds of findings must not grow storage without
    // limit. The newest keys are the ones worth keeping.
    dismissedIssueKeys: sanitiseDismissedKeys(value.dismissedIssueKeys, initial.dismissedIssueKeys ?? []),
  };
  // Backup-reminder bookkeeping must survive reloads or the nudge returns
  // every visit. Malformed values are dropped, and the keys stay absent
  // (rather than present-but-undefined) so stored workspaces keep their shape.
  const lastBackupAt = sanitiseTimestamp(value.lastBackupAt);
  if (lastBackupAt !== undefined) workspace.lastBackupAt = lastBackupAt;
  const snoozedAt = sanitiseTimestamp(value.backupReminderSnoozedAt);
  if (snoozedAt !== undefined) workspace.backupReminderSnoozedAt = snoozedAt;
  // Rail "new" badges, same shape as the reminder bookkeeping above.
  const seenInsightsAt = sanitiseTimestamp(value.seenInsightsAt);
  if (seenInsightsAt !== undefined) workspace.seenInsightsAt = seenInsightsAt;
  const seenExtensionAt = sanitiseTimestamp(value.seenExtensionAt);
  if (seenExtensionAt !== undefined) workspace.seenExtensionAt = seenExtensionAt;
  return workspace;
}

const MAX_PERSISTED_DISMISSALS = 500;

function sanitiseDismissedKeys(value: unknown, initial: string[]): string[] {
  if (!Array.isArray(value)) return initial;
  const keys = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return [...new Set(keys)].slice(-MAX_PERSISTED_DISMISSALS);
}

export function readLegacyWorkspace(initial: DraftwiseWorkspace, storage: WorkspaceStorage): DraftwiseWorkspace {
  const goals = parseRecord(readSafely(storage, "draftwise:goals"));
  const provider = parseRecord(readSafely(storage, "draftwise:provider"));
  const theme = readSafely(storage, "draftwise:theme");
  const aiEnabled = readSafely(storage, "draftwise:ai-enabled");
  return sanitiseWorkspace(initial, {
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
