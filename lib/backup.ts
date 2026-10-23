import { sanitiseStoredDocument, type StoredDocument } from "./documents.ts";
import { isWorkspace } from "./workspace-storage.ts";
import { emptyLog, sanitiseActivityLog, type ActivityLog } from "./writing-activity.ts";
import type { DraftwiseWorkspace } from "../packages/types/src/index.ts";

/**
 * Full backup and restore: every document plus the workspace settings and the
 * writing-activity log as one versioned JSON file the writer owns.
 *
 * Draftwise is local-first with no account and no sync, so a cleared browser
 * profile or an evicted storage tier is total data loss with no path back.
 * The style-profile export covers learned language data only; documents,
 * goals, version snapshots, settings and streaks had no way out. This file
 * is that way out — and the way back in.
 *
 * Unlike the profile export, a backup necessarily contains secrets: provider
 * and classifier API keys live in the workspace settings, and a backup that
 * silently dropped them would restore an app that looks whole but cannot
 * reach its provider. The settings UI says so plainly at both ends, and the
 * privacy model records the handling rules.
 */

export const BACKUP_KIND = "draftwise-backup";
export const BACKUP_VERSION = 1;

/**
 * Bounds so a hostile file cannot park gigabytes in memory. The byte bound is
 * checked before reading (File.size), the character bound after decoding.
 */
export const MAX_BACKUP_BYTES = 25_000_000;
export const MAX_BACKUP_CHARS = 20_000_000;
/** Far above any plausible library; stops a hostile array from pinning the tab. */
export const MAX_BACKUP_DOCUMENTS = 2_000;

export interface BackupFile {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  documents: StoredDocument[];
  workspace: DraftwiseWorkspace;
  activity: ActivityLog;
}

export interface RestorableBackup {
  documents: StoredDocument[];
  workspace: DraftwiseWorkspace;
  activity: ActivityLog;
  /** When the backup was made, for the restore confirmation. */
  exportedAt: string;
  /** Entries that failed validation and will not be restored. */
  skippedDocuments: number;
  /** True when the file carried activity data but none of it was readable. */
  activityDropped: boolean;
}

export type ParseBackupResult =
  | { ok: true; backup: RestorableBackup; warnings: string[] }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildBackup(input: {
  documents: StoredDocument[];
  workspace: DraftwiseWorkspace;
  activity: ActivityLog;
  exportedAt?: string;
}): BackupFile {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    documents: input.documents,
    workspace: input.workspace,
    activity: input.activity,
  };
}

/**
 * A backup that is safe to store anywhere: identical to the full backup
 * except provider/classifier secrets are blanked. Restoring it keeps every
 * document, goal, and setting — the writer just re-enters two keys.
 */
export function stripBackupSecrets(workspace: DraftwiseWorkspace): DraftwiseWorkspace {
  return {
    ...workspace,
    provider: { ...workspace.provider, apiKey: "", customHeaders: "" },
    classifier: workspace.classifier ? { ...workspace.classifier, apiKey: "" } : workspace.classifier,
  };
}

export function buildSecretsFreeBackup(input: {
  documents: StoredDocument[];
  workspace: DraftwiseWorkspace;
  activity: ActivityLog;
  exportedAt?: string;
}): BackupFile {
  return buildBackup({ ...input, workspace: stripBackupSecrets(input.workspace) });
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup);
}

/**
 * Read the raw activity log for a backup export. Anything unreadable becomes
 * an empty log: the backup stays valid and the documents and settings — the
 * parts that cannot be recreated — are never held hostage by advisory stats.
 */
export function readRawActivityLog(raw: string | null): ActivityLog {
  if (!raw) return emptyLog();
  try {
    return sanitiseActivityLog(JSON.parse(raw));
  } catch {
    return emptyLog();
  }
}

/**
 * Refuse an oversized file before its contents are read into memory.
 * Mirrors the import path: File.text() materialises everything first.
 */
export function oversizedBackupFile(file: { size: number }): string | null {
  if (file.size > MAX_BACKUP_BYTES) {
    return "That file is too large to be a Draftwise backup (over 25 MB).";
  }
  return null;
}

export function parseBackup(text: string): ParseBackupResult {
  if (text.length > MAX_BACKUP_CHARS) {
    return { ok: false, error: "That file is too large to be a Draftwise backup." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not a Draftwise backup." };
  }
  if (!isRecord(parsed) || parsed.kind !== BACKUP_KIND) {
    return { ok: false, error: "That file is not a Draftwise backup." };
  }
  if (parsed.version !== BACKUP_VERSION) {
    return { ok: false, error: "That backup was made by a newer Draftwise and cannot be restored here." };
  }
  if (!Array.isArray(parsed.documents) || parsed.documents.length > MAX_BACKUP_DOCUMENTS) {
    return { ok: false, error: "That backup's document list is unreadable." };
  }
  let skippedDocuments = 0;
  const documents = parsed.documents.flatMap((entry): StoredDocument[] => {
    const document = sanitiseStoredDocument(entry);
    if (!document) {
      skippedDocuments += 1;
      return [];
    }
    return [document];
  });
  if (documents.length === 0) {
    return { ok: false, error: "That backup holds no readable documents, so there is nothing to restore." };
  }
  // The workspace is adopted wholesale on restore, so it must validate as a
  // whole: a half-valid settings object (bad provider URL, unknown shape) is
  // refused rather than merged. Dismissal lists are re-bounded by the normal
  // workspace load path after the restore reloads the app.
  if (!isWorkspace(parsed.workspace)) {
    return { ok: false, error: "That backup's settings are unreadable, so nothing was changed." };
  }
  const warnings: string[] = [];
  if (skippedDocuments > 0) {
    warnings.push(`${skippedDocuments} unreadable ${skippedDocuments === 1 ? "entry was" : "entries were"} skipped.`);
  }
  let activity = emptyLog();
  let activityDropped = false;
  if (parsed.activity !== undefined) {
    const before = isRecord(parsed.activity) && Array.isArray(parsed.activity.days)
      ? parsed.activity.days.length
      : 0;
    activity = sanitiseActivityLog(parsed.activity);
    activityDropped = before > 0 && activity.days.length === 0;
    if (activityDropped) warnings.push("The backup's activity history was unreadable and was skipped.");
  }
  return {
    ok: true,
    backup: {
      documents,
      workspace: parsed.workspace,
      activity,
      exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : "unknown date",
      skippedDocuments,
      activityDropped,
    },
    warnings,
  };
}
