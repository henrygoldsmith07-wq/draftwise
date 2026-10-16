import type { LearnedPreference, StylePreferences } from "../packages/types/src/index.ts";

/**
 * Style-profile portability: export and import the writer's personal
 * language data as a versioned JSON file.
 *
 * Draftwise learns on-device — dictionary words, terminology, dismissed and
 * accepted patterns — and a writer who switches browsers currently loses all
 * of it with no path back. Competitors sync this to an account; here it is a
 * file the writer owns, moved by hand like any other document.
 *
 * Only personal language data travels. Provider settings, API keys, custom
 * headers, classifier credentials, and AI toggles never appear in an export:
 * importing a profile must be incapable of leaking or overwriting secrets,
 * even if the file is hostile. Import merges additively (nothing already
 * present is removed) and reports exactly what changed, so the writer stays
 * in control of the merge.
 */

export const PROFILE_EXPORT_VERSION = 1;

/** Upper bounds so a hostile file cannot park megabytes in the profile. */
const MAX_WORDS = 2_000;
const MAX_WORD_CHARS = 80;
const MAX_TERMS = 500;
const MAX_LEARNED = 200;

export interface ProfileExport {
  kind: "draftwise-profile";
  version: 1;
  exportedAt: string;
  profile: {
    dialect: StylePreferences["dialect"];
    personalDictionary: string[];
    names: string[];
    ignoredWords: string[];
    blockedWords: string[];
    preferredTerminology: Record<string, string>;
    learned: LearnedPreference[];
  };
}

export interface ProfileImportResult {
  ok: boolean;
  /** Human-readable outcome, shown verbatim in settings. */
  message: string;
  /** The merged profile when ok, so the caller can apply it in one patch. */
  merged?: StylePreferences;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanWordList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const word = entry.trim().slice(0, MAX_WORD_CHARS);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    if (seen.size >= MAX_WORDS) break;
  }
  return [...seen];
}

function cleanTerminology(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const terms: Record<string, string> = {};
  for (const [key, replacement] of Object.entries(value)) {
    if (typeof replacement !== "string") continue;
    const from = key.trim().slice(0, MAX_WORD_CHARS);
    const to = replacement.trim().slice(0, MAX_WORD_CHARS);
    if (!from || !to || from in terms) continue;
    terms[from] = to;
    if (Object.keys(terms).length >= MAX_TERMS) break;
  }
  return terms;
}

const LEARNED_KINDS = new Set(["dismissal-pattern", "reduced-family", "disabled-family", "accepted-pattern"]);

function cleanLearned(value: unknown): LearnedPreference[] {
  if (!Array.isArray(value)) return [];
  const entries: LearnedPreference[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { id, kind, label, detail, family, createdAt, source } = entry;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    if (typeof kind !== "string" || !LEARNED_KINDS.has(kind)) continue;
    if (typeof label !== "string" || typeof family !== "string" || !family) continue;
    seen.add(id);
    entries.push({
      id: id.slice(0, 200),
      kind: kind as LearnedPreference["kind"],
      label: label.slice(0, 200),
      detail: typeof detail === "string" ? detail.slice(0, 500) : "",
      family: family.slice(0, 200),
      createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : Date.now(),
      source: source === "manual" ? "manual" : "learned",
    });
    if (entries.length >= MAX_LEARNED) break;
  }
  return entries;
}

function mergeWords(current: string[], incoming: string[]): { merged: string[]; added: number } {
  const seen = new Set(current);
  const merged = [...current];
  let added = 0;
  for (const word of incoming) {
    if (seen.has(word)) continue;
    seen.add(word);
    merged.push(word);
    added += 1;
  }
  return { merged, added };
}

/** The portable slice of a style profile. Secrets never enter this shape. */
export function exportProfile(style: StylePreferences): ProfileExport {
  return {
    kind: "draftwise-profile",
    version: PROFILE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profile: {
      dialect: style.dialect,
      personalDictionary: [...style.personalDictionary],
      names: [...(style.names ?? [])],
      ignoredWords: [...style.ignoredWords],
      blockedWords: [...style.blockedWords],
      preferredTerminology: { ...style.preferredTerminology },
      learned: (style.learned ?? []).map((entry) => ({ ...entry })),
    },
  };
}

/**
 * Merge an exported file into the current profile. Additive only: existing
 * words, terms, and learned entries are never removed or overwritten, and a
 * learned entry already present keeps its local record. Malformed files and
 * malformed entries are refused or dropped with a plain message, never
 * trusted.
 */
export function importProfile(current: StylePreferences, fileText: string): ProfileImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    return { ok: false, message: "That file is not a Draftwise profile (it could not be read as JSON)." };
  }
  if (!isRecord(parsed) || parsed.kind !== "draftwise-profile" || !isRecord(parsed.profile)) {
    return { ok: false, message: "That file is not a Draftwise profile export." };
  }
  if (parsed.version !== PROFILE_EXPORT_VERSION) {
    return { ok: false, message: "That profile was exported by a newer Draftwise and cannot be imported here." };
  }
  const incoming = parsed.profile;
  const dialect = incoming.dialect === "en-GB" || incoming.dialect === "en-US" ? incoming.dialect : null;
  if (!dialect) {
    return { ok: false, message: "That profile is missing its language setting, so it was not imported." };
  }

  const dictionary = mergeWords(current.personalDictionary, cleanWordList(incoming.personalDictionary));
  const names = mergeWords(current.names ?? [], cleanWordList(incoming.names));
  const ignored = mergeWords(current.ignoredWords, cleanWordList(incoming.ignoredWords));
  const blocked = mergeWords(current.blockedWords, cleanWordList(incoming.blockedWords));

  const terms = cleanTerminology(incoming.preferredTerminology);
  const terminology = { ...current.preferredTerminology };
  let termsAdded = 0;
  for (const [from, to] of Object.entries(terms)) {
    if (from in terminology) continue;
    terminology[from] = to;
    termsAdded += 1;
  }

  const learned = cleanLearned(incoming.learned);
  const knownIds = new Set((current.learned ?? []).map((entry) => entry.id));
  const newLearned = learned.filter((entry) => !knownIds.has(entry.id));

  const added = dictionary.added + names.added + ignored.added + blocked.added + termsAdded + newLearned.length;
  if (added === 0) {
    return { ok: false, message: "Nothing new to import — everything in that file is already in your profile." };
  }
  return {
    ok: true,
    message: `Imported ${added} item${added === 1 ? "" : "s"}: ${dictionary.added} dictionary word${dictionary.added === 1 ? "" : "s"}, ${termsAdded} terminology ${termsAdded === 1 ? "rule" : "rules"}, ${newLearned.length} learned preference${newLearned.length === 1 ? "" : "s"}${names.added + ignored.added + blocked.added > 0 ? `, ${names.added + ignored.added + blocked.added} other` : ""}. Nothing already here was changed.`,
    merged: {
      ...current,
      dialect,
      personalDictionary: dictionary.merged,
      names: names.merged,
      ignoredWords: ignored.merged,
      blockedWords: blocked.merged,
      preferredTerminology: terminology,
      learned: [...(current.learned ?? []), ...newLearned],
    },
  };
}
