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
