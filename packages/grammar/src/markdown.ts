/**
 * Lightweight Markdown awareness.
 *
 * Draftwise writes prose, not markup. Code fences, inline code and URLs are
 * machine text: grammar and spelling rules must leave them alone, and list
 * items are not sentence fragments. This module computes those structural
 * spans once per analysis pass so every rule respects them.
 */

export interface ProtectedSpan {
  start: number;
  end: number;
  kind: "code-fence" | "inline-code" | "url";
}

const CODE_FENCE = /^(?:`{3,}|~{3,})/mu;
const INLINE_CODE = /`[^`\n]+`/gu;
const URL_PATTERN = /\bhttps?:\/\/[^\s>)\]]+/gu;

/** Spans the prose rules must not touch: code and literal URLs. */
export function findProtectedSpans(text: string): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];

  const lines = text.split("\n");
  let offset = 0;
  let fenceStart: number | null = null;
  let fenceMarker = "";
  for (const line of lines) {
    const fence = line.match(CODE_FENCE);
    if (fence) {
      const marker = fence[0][0] === "`" ? "`" : "~";
      if (fenceStart === null) {
        fenceStart = offset;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        spans.push({ start: fenceStart, end: offset + line.length, kind: "code-fence" });
        fenceStart = null;
      }
    }
    offset += line.length + 1;
  }
  if (fenceStart !== null) spans.push({ start: fenceStart, end: text.length, kind: "code-fence" });

  for (const match of text.matchAll(INLINE_CODE)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length, kind: "inline-code" });
  }
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length, kind: "url" });
  }

  // Overlaps are possible (an inline code span inside a URL is nonsense but
  // cheap to merge), so collapse them into a minimal set.
  spans.sort((left, right) => left.start - right.start);
  const merged: ProtectedSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

export function isInsideProtectedSpan(spans: ProtectedSpan[], start: number, end: number) {
  return spans.some((span) => start < span.end && end > span.start);
}

/**
 * True when a position sits inside a list item or blockquote line. Those are
 * structured content: a three-word bullet is a fragment only in the
 * grammatical sense, not something to nag about.
 */
export function isStructuredLineStart(text: string, position: number) {
  const lineStart = text.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  return /^\s*(?:[-*+]|\d+[.)]|>)\s/u.test(text.slice(lineStart, lineStart + 12));
}
