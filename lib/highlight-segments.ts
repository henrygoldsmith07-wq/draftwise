/**
 * Pure segment construction for the editor's highlight mirror layer.
 *
 * The mirror layer behind the transparent textarea paints every range by first
 * cutting the draft at each range boundary and then styling the resulting runs.
 * A naive implementation pairs every cut point with a linear scan of the issue
 * list (`issues.find(...)`). With a few hundred findings on a long draft that
 * is hundreds of thousands of comparisons on every keystroke.
 *
 * This helper builds the same runs in linear time after the sort. The key
 * observation is that because every issue start and end is a boundary, an issue
 * covers the run beginning at a point `p` exactly when `start <= p < end`. The
 * issue `find` would return is therefore the first issue in (start, end) order
 * whose `end` is still past `p`. A single advancing pointer skips issues once
 * they end, so each segment is resolved in O(1) amortised time.
 *
 * Kept free of React and of aliased imports so it can be exercised directly by
 * `node --test --experimental-strip-types`, which cannot parse JSX.
 */

/** A `[start, end)` range in draft offsets. */
export interface HighlightRange {
  start: number;
  end: number;
}

/** The minimum an issue must expose to take part in highlight segmentation. */
export interface HighlightSpan extends HighlightRange {
  id: string;
}

/** One run the mirror layer renders, carrying everything the JSX needs. */
export interface HighlightSegment<T extends HighlightSpan> {
  start: number;
  end: number;
  /** The draft substring for this run: `text.slice(start, end)`. */
  text: string;
  /**
   * The issue that colours this run, or null for plain/spoken text. When
   * several issues overlap, this is the first in (start, end) order, matching
   * the previous `safeIssues.find(...)`.
   */
  issue: T | null;
  /** Whether the run falls entirely inside the current spoken passage. */
  isSpoken: boolean;
  /** Whether the covering issue is the one currently selected for review. */
  isActive: boolean;
}

/**
 * Split `text` into highlight runs.
 *
 * @param text Draft text.
 * @param issues Findings; they are filtered for validity and sorted by start
 *   then end here so callers need not preprocess them, preserving the exact
 *   behaviour of the original inline logic.
 * @param spokenRange Optional passage being read aloud; it adds boundaries and
 *   marks the runs it contains.
 * @param activeIssueId Optional id of the selected finding; drives `isActive`.
 */
export function buildHighlightSegments<T extends HighlightSpan>(
  text: string,
  issues: readonly T[],
  spokenRange?: HighlightRange | null,
  activeIssueId?: string | null,
): HighlightSegment<T>[] {
  const length = text.length;

  const safeIssues = issues
    .filter((item) => item.start >= 0 && item.end <= length && item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const spoken = spokenRange && spokenRange.start >= 0 && spokenRange.end <= length && spokenRange.end > spokenRange.start
    ? spokenRange
    : null;

  const boundaries = new Set<number>([0, length]);
  for (const item of safeIssues) {
    boundaries.add(item.start);
    boundaries.add(item.end);
  }
  if (spoken) {
    boundaries.add(spoken.start);
    boundaries.add(spoken.end);
  }
  const points = [...boundaries].sort((left, right) => left - right);

  const segments: HighlightSegment<T>[] = [];

  // First issue in sorted order whose `end` is still past the current point.
  // Issues before it have already ended and can never cover a later run, so
  // each one is skipped once for the whole sweep.
  let firstActive = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end <= start) continue;

    while (firstActive < safeIssues.length && safeIssues[firstActive].end <= start) {
      firstActive += 1;
    }

    // Sorted by start, so a candidate with start <= the point has begun; one
    // with start > the point means no later issue has begun either.
    const issue = firstActive < safeIssues.length && safeIssues[firstActive].start <= start
      ? safeIssues[firstActive]
      : null;
    const isSpoken = spoken ? start >= spoken.start && end <= spoken.end : false;

    segments.push({
      start,
      end,
      text: text.slice(start, end),
      issue,
      isSpoken,
      isActive: issue ? activeIssueId === issue.id : false,
    });
  }

  return segments;
}
