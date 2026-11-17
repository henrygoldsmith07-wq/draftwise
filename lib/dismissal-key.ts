/**
 * Versioned dismissal-key format shared by the issue filter and the suggestion
 * ranking path.
 *
 * Keys are persisted in localStorage and exported in backups. The old format
 * embedded the matched word and up to 48 characters either side of it as raw
 * draft text; version `d2` keeps only fingerprints and lengths. Both formats are
 * accepted so a writer's existing dismissals keep working after an upgrade.
 */

import type { WritingIssue } from "../packages/types/src/index.ts";
import {
  type AnchorFingerprint,
  fingerprintAnchor,
  fingerprintText,
  normaliseDismissalText,
} from "../packages/grammar/src/dismissal-anchor.ts";
export const DISMISSAL_KEY_VERSION = "d2";

/**
 * How much draft text either side of a finding is used to recognise it later.
 * Long enough to be distinctive, short enough that an ordinary edit elsewhere
 * in the paragraph does not break the anchor.
 */
export const DISMISSAL_ANCHOR_CHARS = 48;

export function issueAnchors(text: string, issue: WritingIssue) {
  return {
    before: text.slice(Math.max(0, issue.start - DISMISSAL_ANCHOR_CHARS), issue.start),
    after: text.slice(issue.end, Math.min(text.length, issue.end + DISMISSAL_ANCHOR_CHARS)),
  };
}

export interface ParsedDismissalKey {
  id: string;
  ruleId: string;
  source: string;
  start: number;
  end: number;
  /** Present on legacy keys only. */
  original?: string;
  replacement?: string;
  before?: string | AnchorFingerprint;
  after?: string | AnchorFingerprint;
  /** Fingerprints on d2 keys; absent on legacy keys. */
  originalFingerprint?: string;
  normalisedFingerprint?: string;
  replacementFingerprint?: string;
}

/** Build a persisted dismissal key. No raw draft text is included. */
export function encodeDismissalKey(issue: WritingIssue, text?: string) {
  const anchors = text === undefined ? null : issueAnchors(text, issue);
  return JSON.stringify([
    DISMISSAL_KEY_VERSION,
    issue.id,
    issue.ruleId,
    issue.source,
    issue.start,
    issue.end,
    fingerprintText(issue.original),
    fingerprintText(normaliseDismissalText(issue.original)),
    fingerprintText(issue.replacement),
    anchors ? fingerprintAnchor(anchors.before) : null,
    anchors ? fingerprintAnchor(anchors.after) : null,
  ]);
}

function isAnchor(value: unknown): value is AnchorFingerprint {
  if (!value || typeof value !== "object") return false;
  const anchor = value as Record<string, unknown>;
  return typeof anchor.fingerprint === "string"
    && Number.isSafeInteger(anchor.length)
    && (anchor.length as number) >= 0;
}

/** Parse a legacy or d2 key. Returns null for anything malformed. */
export function decodeDismissalKey(key: string): ParsedDismissalKey | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  if (parsed[0] === DISMISSAL_KEY_VERSION) {
    if (parsed.length !== 11) return null;
    const [, id, ruleId, source, start, end, originalFp, normalisedFp, replacementFp, before, after] = parsed;
    if (typeof id !== "string" || typeof ruleId !== "string" || typeof source !== "string"
      || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || typeof originalFp !== "string" || typeof normalisedFp !== "string"
      || typeof replacementFp !== "string"
      || (before !== null && !isAnchor(before)) || (after !== null && !isAnchor(after))) return null;
    return {
      id, ruleId, source, start: start as number, end: end as number,
      originalFingerprint: originalFp,
      normalisedFingerprint: normalisedFp,
      replacementFingerprint: replacementFp,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    };
  }

  // Legacy format from before fingerprinting.
  if (parsed.length !== 7 && parsed.length !== 9) return null;
  const [id, ruleId, source, start, end, original, replacement, rawBefore, rawAfter] = parsed;
  if (typeof id !== "string" || typeof ruleId !== "string" || typeof source !== "string"
    || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || typeof original !== "string" || typeof replacement !== "string") return null;
  return {
    id, ruleId, source, start: start as number, end: end as number, original, replacement,
    ...(typeof rawBefore === "string" && typeof rawAfter === "string"
      ? { before: rawBefore, after: rawAfter }
      : {}),
  };
}

/** Identity used to suppress a finding after its offsets shift. Fingerprinted. */
export function semanticKeyForIssue(issue: WritingIssue) {
  return JSON.stringify([
    issue.ruleId,
    issue.start,
    issue.end,
    fingerprintText(issue.original),
    fingerprintText(issue.replacement),
  ]);
}

/** Extract the same identity from a stored key, accepting both formats. */
export function semanticKeyFromDismissal(key: string): string | null {
  const parsed = decodeDismissalKey(key);
  if (!parsed) return null;
  const originalFp = parsed.originalFingerprint ?? (parsed.original === undefined ? null : fingerprintText(parsed.original));
  const replacementFp = parsed.replacementFingerprint ?? (parsed.replacement === undefined ? null : fingerprintText(parsed.replacement));
  if (originalFp === null || replacementFp === null) return null;
  return JSON.stringify([parsed.ruleId, parsed.start, parsed.end, originalFp, replacementFp]);
}
