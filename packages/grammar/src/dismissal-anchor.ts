/**
 * Fingerprints for persisted dismissal keys.
 *
 * Dismissals are written to localStorage and travel in backup files. Storing
 * the raw matched word and its surrounding sentences there leaves fragments of
 * the writer's draft in a place they never asked to be — the browser extension
 * already fingerprints its dismissal keys for exactly this reason. A fingerprint
 * keeps equality comparisons working without keeping the text.
 *
 * Anchors also need prefix/suffix comparisons so a dismissal survives edits
 * above it. Those are preserved by fingerprinting the exact window the live
 * text will be sliced to, together with its length: the stored fingerprint
 * equals the live fingerprint precisely when the old endsWith/startsWith check
 * would have been true.
 */

/** Normalised form used when recognising the same word regardless of case. */
export function normaliseDismissalText(text: string): string {
  return text.trim().toLocaleLowerCase();
}

/**
 * Deterministic, non-secret 64-bit-ish fingerprint. Two independently seeded
 * 32-bit hashes make an accidental collision vanishingly unlikely for the short
 * strings these keys carry, without pulling in a crypto dependency.
 */
export function fingerprintText(text: string): string {
  let first = 2_166_136_261;
  let second = 374_761_393;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 16_777_619);
    second = Math.imul(second + code, 2_246_822_519);
  }
  return `${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

export interface AnchorFingerprint {
  fingerprint: string;
  length: number;
}

export function fingerprintAnchor(text: string): AnchorFingerprint {
  return { fingerprint: fingerprintText(text), length: text.length };
}

/**
 * Match a live anchor against a stored one. Legacy keys carry the raw string;
 * new keys carry a fingerprint and the exact length of the text it covered.
 */
export function anchorMatches(
  live: string,
  stored: AnchorFingerprint | string,
  side: "before" | "after",
): boolean {
  if (typeof stored === "string") {
    return side === "before" ? live.endsWith(stored) : live.startsWith(stored);
  }
  const { fingerprint, length } = stored;
  if (!Number.isSafeInteger(length) || length < 0 || length > live.length) return false;
  const window = side === "before" ? live.slice(live.length - length) : live.slice(0, length);
  return fingerprintText(window) === fingerprint;
}
