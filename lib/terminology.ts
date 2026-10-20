/**
 * Per-document terminology helpers.
 *
 * WritingGoals already carries required/forbidden terminology per document and
 * the local rules already enforce it — but until now there was no editor for
 * it, so the only way to set it was editing stored JSON. These pure helpers
 * are the single parsing/formatting rule shared by the goal-bar editor and
 * the tests: comma-separated text in, cleaned term lists out.
 *
 * Bounds keep a hostile or accidental paste from pinning the tab: analysis
 * maps over these lists with a regex per term, so unbounded input is a
 * performance hazard, not just clutter.
 */

export const MAX_TERMS_PER_LIST = 50;
export const MAX_TERM_CHARS = 80;

/**
 * Bounds for per-document word swaps. Same rationale as the term lists:
 * analysis builds a regex per entry, so an unbounded map pasted from a
 * style guide is a performance hazard, not just clutter.
 */
export const MAX_SWAPS_PER_DOCUMENT = 50;
export const MAX_SWAP_CHARS = 80;

/** Split free text on commas/newlines into cleaned, deduplicated terms. */
export function parseTerminologyList(input: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const piece of String(input ?? "").split(/[,\n]/u)) {
    const term = piece.trim().replace(/\s+/gu, " ");
    if (!term || term.length > MAX_TERM_CHARS) continue;
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_TERMS_PER_LIST) break;
  }
  return terms;
}

/** Format a stored term list for the editor: one comma-separated line. */
export function formatTerminologyList(terms: string[] | undefined): string {
  return (terms ?? []).join(", ");
}

/**
 * Parse free text into a from -> to swap map.
 *
 * One swap per comma or newline, written as "login -> sign in". The arrow
 * may also be "=>" or "="; both sides are trimmed, inner whitespace is
 * collapsed, and duplicates match case-insensitively on the "from" side so
 * "Login -> sign in" and "login -> log in" cannot both survive. Entries
 * without a separator, with an empty side, or identical on both sides are
 * dropped — a swap that changes nothing must never become a suggestion.
 */
export function parsePreferredReplacements(input: string): Record<string, string> {
  const swaps: Record<string, string> = {};
  const seen = new Set<string>();
  for (const piece of String(input ?? "").split(/[,\n]/u)) {
    const match = /^(.*?)(?:=>|->|=)(.*)$/u.exec(piece);
    if (!match) continue;
    const from = match[1].trim().replace(/\s+/gu, " ");
    const to = match[2].trim().replace(/\s+/gu, " ");
    if (!from || !to || from.length > MAX_SWAP_CHARS || to.length > MAX_SWAP_CHARS) continue;
    if (from.toLocaleLowerCase() === to.toLocaleLowerCase()) continue;
    const key = from.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    swaps[from] = to;
    if (Object.keys(swaps).length >= MAX_SWAPS_PER_DOCUMENT) break;
  }
  return swaps;
}

/** Format a stored swap map for the editor: one comma-separated line. */
export function formatPreferredReplacements(swaps: Record<string, string> | undefined): string {
  return Object.entries(swaps ?? {}).map(([from, to]) => `${from} -> ${to}`).join(", ");
}

/** Clean an unknown stored value into a swap map; untrusted input is dropped. */
export function cleanPreferredReplacements(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const swaps: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [rawFrom, rawTo] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawTo !== "string") continue;
    const from = String(rawFrom ?? "").trim().replace(/\s+/gu, " ");
    const to = rawTo.trim().replace(/\s+/gu, " ");
    if (!from || !to || from.length > MAX_SWAP_CHARS || to.length > MAX_SWAP_CHARS) continue;
    if (from.toLocaleLowerCase() === to.toLocaleLowerCase()) continue;
    const key = from.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    swaps[from] = to;
    if (Object.keys(swaps).length >= MAX_SWAPS_PER_DOCUMENT) break;
  }
  return swaps;
}

/**
 * Merge the global style-guide map with a document's own swaps.
 *
 * The document wins: a global "login -> log in" is replaced by the
 * document's "login -> sign in" rather than firing alongside it, so the
 * writer never sees two competing suggestions for one word. Matching is
 * case-insensitive on the "from" side, mirroring the case-insensitive
 * regex the rule itself uses.
 */
export function resolvePreferredTerminology(
  global: Record<string, string> | undefined,
  document: Record<string, string> | undefined,
): { merged: Record<string, string>; documentFroms: Set<string> } {
  const merged: Record<string, string> = {};
  const claimed = new Set<string>();
  const cleanedDocument = cleanPreferredReplacements(document ?? {});
  for (const [from, to] of Object.entries(cleanedDocument)) {
    merged[from] = to;
    claimed.add(from.toLocaleLowerCase());
  }
  const documentFroms = new Set(claimed);
  for (const [from, to] of Object.entries(global ?? {})) {
    if (typeof to !== "string") continue;
    if (!from || !to) continue;
    if (claimed.has(from.toLocaleLowerCase())) continue;
    merged[from] = to;
    claimed.add(from.toLocaleLowerCase());
  }
  return { merged, documentFroms };
}

/** Clean an unknown stored value into a term list; untrusted input is dropped. */
export function cleanTerminologyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const term = item.trim().replace(/\s+/gu, " ");
    if (!term || term.length > MAX_TERM_CHARS) continue;
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_TERMS_PER_LIST) break;
  }
  return terms;
}
