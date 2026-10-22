/**
 * What changed between two versions of a draft.
 *
 * Version history could list checkpoints and show them side by side, but the
 * question a writer actually has in front of that list is "what is different
 * from what I have now?" Reading two full documents to answer it is work the
 * product should be doing.
 *
 * The comparison is word-granular rather than character-granular on purpose.
 * A character diff of prose is unreadable (every reflowed line looks rewritten)
 * and a line diff is useless for a draft written as a few long paragraphs, which
 * is exactly how people write. Word tokens keep the output legible for both
 * shapes of document.
 *
 * Cost is bounded twice: common prefixes and suffixes are trimmed before the
 * quadratic table is built (the common case for autosaved checkpoints is a
 * paragraph edited in place, so the middles are small), and a document whose
 * middles are still too large is compared by paragraph instead. Anything that
 * cannot be compared precisely says so rather than silently claiming a level of
 * detail it did not compute.
 */

export type DiffKind = "same" | "added" | "removed";

export interface DiffPart {
  kind: DiffKind;
  text: string;
}

export interface DiffSummary {
  /** Words present now that were not in the earlier version. */
  addedWords: number;
  /** Words in the earlier version that are gone now. */
  removedWords: number;
  /** Contiguous runs of change, so "3 changes" is not inflated by every word. */
  changedBlocks: number;
}

export interface TextDiff {
  /** Ordered parts; concatenating `same` + `removed` rebuilds the earlier text. */
  parts: DiffPart[];
  summary: DiffSummary;
  /** False when the word-level comparison was too large and paragraphs were used. */
  precise: boolean;
}

/**
 * Largest LCS table this will build, in cells. One Uint32Array of this size is
 * ~6 MB, which is fine for a one-off comparison and disappears immediately
 * after. Above it the paragraph fallback runs instead of risking a long stall
 * while the writer waits for a preview to open.
 */
const MAX_CELLS = 1_500_000;

/**
 * Tokens are words, single punctuation marks and whitespace runs.
 *
 * Punctuation is kept apart from the word so "cat." and "cat" share the word
 * token and differ only in the full stop. Apostrophes inside a word stay part
 * of it, so "don't" is one token and does not read as "don" + "'" + "t".
 */
const TOKEN_PATTERN = /\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;

export function tokenizeForDiff(text: string): string[] {
  return text.match(TOKEN_PATTERN) ?? [];
}

/**
 * Paragraph-sized units for the fallback comparison.
 *
 * Separators are kept as their own entries so that reassembling the blocks
 * reproduces the exact original text.
 */
export function splitForDiff(text: string): string[] {
  return text.split(/(\n\s*\n)/u).filter((piece) => piece !== "");
}

/**
 * Words, not whitespace-separated runs: a diff part can be a lone comma
 * ("…, revised") and counting that as a word overstates every punctuation
 * change in the summary.
 */
function countWordsIn(text: string) {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

interface Op {
  kind: DiffKind;
  text: string;
}

/** Append to the last part when the kind matches, so runs stay contiguous. */
function push(ops: Op[], kind: DiffKind, text: string) {
  if (!text) return;
  const last = ops[ops.length - 1];
  if (last && last.kind === kind) last.text += text;
  else ops.push({ kind, text });
}

/**
 * Longest-common-subsequence walk over two token arrays.
 *
 * The table is filled from the end so the walk can go forwards from (0, 0),
 * which keeps the emitted order identical to the reading order of the text.
 * Ties prefer removing before adding: a replaced word then reads as the old
 * word struck out followed by the new one, not the other way round.
 */
function diffSequences(before: readonly string[], after: readonly string[]): DiffPart[] {
  const n = before.length;
  const m = after.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ kind: "added", text: after.join("") }];
  if (m === 0) return [{ kind: "removed", text: before.join("") }];

  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = i * width;
    const nextRow = (i + 1) * width;
    for (let j = m - 1; j >= 0; j -= 1) {
      table[row + j] = before[i] === after[j]
        ? table[nextRow + j + 1] + 1
        : Math.max(table[nextRow + j], table[row + j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      push(parts, "same", before[i]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      push(parts, "removed", before[i]);
      i += 1;
    } else {
      push(parts, "added", after[j]);
      j += 1;
    }
  }
  for (; i < n; i += 1) push(parts, "removed", before[i]);
  for (; j < m; j += 1) push(parts, "added", after[j]);
  return parts;
}

function summarize(parts: readonly DiffPart[]): DiffSummary {
  let addedWords = 0;
  let removedWords = 0;
  let changedBlocks = 0;
  let inChange = false;
  for (const part of parts) {
    if (part.kind === "same") {
      inChange = false;
      continue;
    }
    if (part.kind === "added") addedWords += countWordsIn(part.text);
    else removedWords += countWordsIn(part.text);
    if (!inChange) {
      changedBlocks += 1;
      inChange = true;
    }
  }
  return { addedWords, removedWords, changedBlocks };
}

/**
 * Compare two versions of a draft.
 *
 * The returned parts always rebuild their inputs: joining the `same` and
 * `removed` parts gives `before`, joining `same` and `added` gives `after`.
 * `insight-progress` and the UI both lean on that invariant, and the tests
 * assert it directly rather than trusting the walk.
 */
export function diffText(before: string, after: string): TextDiff {
  if (before === after) {
    return {
      parts: before ? [{ kind: "same", text: before }] : [],
      summary: { addedWords: 0, removedWords: 0, changedBlocks: 0 },
      precise: true,
    };
  }

  const beforeTokens = tokenizeForDiff(before);
  const afterTokens = tokenizeForDiff(after);

  // Trim the identical head and tail first: a checkpoint usually differs from
  // the current draft in one place, and the quadratic table only needs to cover
  // the middle between the first and last difference.
  let head = 0;
  const shortest = Math.min(beforeTokens.length, afterTokens.length);
  while (head < shortest && beforeTokens[head] === afterTokens[head]) head += 1;
  let tail = 0;
  while (
    tail < shortest - head
    && beforeTokens[beforeTokens.length - 1 - tail] === afterTokens[afterTokens.length - 1 - tail]
  ) tail += 1;

  const beforeMiddle = beforeTokens.slice(head, beforeTokens.length - tail);
  const afterMiddle = afterTokens.slice(head, afterTokens.length - tail);

  const exact = (beforeMiddle.length + 1) * (afterMiddle.length + 1) <= MAX_CELLS;
  const beforeUnits = exact ? beforeMiddle : splitForDiff(beforeMiddle.join(""));
  const afterUnits = exact ? afterMiddle : splitForDiff(afterMiddle.join(""));

  const parts: DiffPart[] = [];
  push(parts, "same", beforeTokens.slice(0, head).join(""));
  for (const part of diffSequences(beforeUnits, afterUnits)) push(parts, part.kind, part.text);
  push(parts, "same", beforeTokens.slice(beforeTokens.length - tail).join(""));

  return { parts, summary: summarize(parts), precise: exact };
}

/** Plain-language summary, shared by the UI and the tests. */
export function describeDiff(diff: TextDiff): string {
  const { addedWords, removedWords, changedBlocks } = diff.summary;
  if (changedBlocks === 0) return "This version is identical to the current draft.";
  const changes = `${changedBlocks} change${changedBlocks === 1 ? "" : "s"}`;
  const words = [
    addedWords ? `+${addedWords} word${addedWords === 1 ? "" : "s"}` : "",
    removedWords ? `−${removedWords} word${removedWords === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  return words ? `${changes} · ${words}` : changes;
}
