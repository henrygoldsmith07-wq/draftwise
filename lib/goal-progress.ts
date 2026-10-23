/**
 * Live progress toward the document's length goal ("~600 words").
 *
 * The goal bar lets writers set a target length, but nothing answered "how
 * far along am I" — the target only surfaced as an analysis note after the
 * fact. This feeds the meter under the goal bar: pure and clamped so the UI
 * stays a thin rendering of it.
 */

export interface LengthProgress {
  /** Words in the draft right now. */
  words: number;
  /** The goal, when one is set and positive. */
  target: number | null;
  /** Share of the goal reached, 0–100. Over-goal clamps at 100. */
  percent: number;
  /** Words left to reach the goal; negative when over. */
  remaining: number;
}

export function lengthProgress(words: number, targetLength?: number): LengthProgress {
  const safeWords = Number.isFinite(words) && words > 0 ? Math.floor(words) : 0;
  const target = typeof targetLength === "number" && Number.isFinite(targetLength) && targetLength > 0
    ? Math.floor(targetLength)
    : null;
  if (target === null) return { words: safeWords, target: null, percent: 0, remaining: 0 };
  const percent = Math.min(100, Math.round((safeWords / target) * 100));
  return { words: safeWords, target, percent, remaining: target - safeWords };
}

/**
 * One-line reading of the meter: "412 of 600 words", "88 over 600 words".
 * Over-goal is stated plainly, not as an error — a longer draft is a shape
 * note, not a failure.
 */
export function lengthProgressLabel(progress: LengthProgress): string | null {
  if (progress.target === null) return null;
  const words = progress.words.toLocaleString("en-GB");
  const target = progress.target.toLocaleString("en-GB");
  if (progress.remaining < 0) return `${words} of ${target} words · ${(-progress.remaining).toLocaleString("en-GB")} over`;
  if (progress.remaining === 0) return `${words} of ${target} words · on target`;
  return `${words} of ${target} words · ${progress.remaining.toLocaleString("en-GB")} to go`;
}
