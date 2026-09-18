import type { WritingIssue } from "../../types/src/index.js";

export interface ChangedRange {
  start: number;
  end: number;
  previousEnd: number;
}

export interface AnalysisChunk {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  contentStartOffset: number;
  contentEndOffset: number;
}

export interface ChunkOptions {
  maxChars?: number;
  contextWindow?: number;
  startOffset?: number;
  endOffset?: number;
}

export interface AnalysisState {
  status: "idle" | "local" | "analysing" | "ready" | "error";
  runId: number;
  analysedText: string;
  changedRange: ChangedRange | null;
  error: string | null;
}

const DEFAULT_MAX_CHARS = 8_000;
const DEFAULT_CONTEXT_WINDOW = 320;

export function detectChangedRange(previousText: string, nextText: string): ChangedRange | null {
  if (previousText === nextText) return null;
  let start = 0;
  while (
    start < previousText.length &&
    start < nextText.length &&
    previousText.charCodeAt(start) === nextText.charCodeAt(start)
  ) {
    start += 1;
  }

  let previousEnd = previousText.length;
  let end = nextText.length;
  while (
    previousEnd > start &&
    end > start &&
    previousText.charCodeAt(previousEnd - 1) === nextText.charCodeAt(end - 1)
  ) {
    previousEnd -= 1;
    end -= 1;
  }
  return { start, end, previousEnd };
}

function moveToBoundary(text: string, offset: number, direction: "left" | "right") {
  if (direction === "left") {
    const match = text.slice(0, offset).search(/\s+[^\s]*$/u);
    return match >= 0 ? match : offset;
  }
  const match = text.slice(offset).search(/\s/u);
  return match >= 0 ? offset + match : offset;
}

export function expandRangeToContext(
  text: string,
  range: ChangedRange,
  contextWindow = DEFAULT_CONTEXT_WINDOW,
): ChangedRange {
  const start = Math.max(0, moveToBoundary(text, Math.max(0, range.start - contextWindow), "left"));
  const end = Math.min(text.length, moveToBoundary(text, Math.min(text.length, range.end + contextWindow), "right"));
  return { ...range, start, end };
}

export function createAnalysisChunks(text: string, options: ChunkOptions = {}): AnalysisChunk[] {
  if (!text) return [];
  const maxChars = Math.max(500, options.maxChars ?? DEFAULT_MAX_CHARS);
  const contextWindow = Math.max(0, options.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
  const requestedStart = Math.max(0, Math.min(text.length, options.startOffset ?? 0));
  const requestedEnd = Math.max(requestedStart, Math.min(text.length, options.endOffset ?? text.length));
  const chunks: AnalysisChunk[] = [];
  let contentStart = requestedStart;

  while (contentStart < requestedEnd) {
    let contentEnd = Math.min(requestedEnd, contentStart + maxChars);
    if (contentEnd < requestedEnd) {
      const boundary = moveToBoundary(text, contentEnd, "left");
      if (boundary > contentStart + Math.floor(maxChars * 0.55)) contentEnd = boundary;
    }
    if (contentEnd <= contentStart) contentEnd = Math.min(requestedEnd, contentStart + maxChars);

    const startOffset = Math.max(requestedStart, contentStart - contextWindow);
    const endOffset = Math.min(requestedEnd, contentEnd + contextWindow);
    chunks.push({
      id: `chunk-${contentStart}-${contentEnd}`,
      text: text.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      contentStartOffset: contentStart,
      contentEndOffset: contentEnd,
    });
    contentStart = contentEnd;
  }
  return chunks;
}

export function mapRelativeRange(
  range: Pick<WritingIssue, "start" | "end" | "original">,
  chunk: AnalysisChunk,
  sourceText: string,
) {
  const start = chunk.startOffset + Math.floor(range.start);
  const end = chunk.startOffset + Math.floor(range.end);
  if (start < chunk.startOffset || end > chunk.endOffset || end <= start) return null;
  const original = sourceText.slice(start, end);
  if (!original || original !== range.original) return null;
  return { start, end, original };
}

export function mapChunkIssue(issue: WritingIssue, chunk: AnalysisChunk, sourceText: string): WritingIssue | null {
  const mapped = mapRelativeRange(issue, chunk, sourceText);
  if (!mapped) return null;
  return { ...issue, ...mapped, chunkId: chunk.id };
}

function issueRank(issue: Pick<WritingIssue, "source" | "severity" | "confidence">) {
  const severity = issue.severity === "high" ? 3 : issue.severity === "medium" ? 2 : 1;
  const source = issue.source === "local" ? 0.1 : 0;
  return severity + issue.confidence + source;
}

export function mergeAnalysisIssues(issues: WritingIssue[]): WritingIssue[] {
  const candidates = issues
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
    .filter((item) => item.start >= 0 && item.end > item.start && item.original.length > 0)
    .map((item) => ({ ...item, confidence: Math.max(0, Math.min(1, item.confidence ?? 0.5)) }))
    .sort((a, b) => a.start - b.start || b.end - a.end || issueRank(b) - issueRank(a));

  const deduped: WritingIssue[] = [];
  const keys = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.start}:${candidate.end}:${candidate.original.toLocaleLowerCase()}:${candidate.replacement.toLocaleLowerCase()}`;
    const existingIndex = deduped.findIndex((item) =>
      item.start === candidate.start &&
      item.end === candidate.end &&
      item.original.toLocaleLowerCase() === candidate.original.toLocaleLowerCase(),
    );
    if (existingIndex >= 0) {
      if (issueRank(candidate) > issueRank(deduped[existingIndex])) deduped[existingIndex] = candidate;
      continue;
    }
    if (keys.has(key)) continue;
    const overlapIndex = deduped.findIndex((item) => candidate.start < item.end && candidate.end > item.start);
    if (overlapIndex >= 0) {
      if (issueRank(candidate) > issueRank(deduped[overlapIndex])) deduped[overlapIndex] = candidate;
      continue;
    }
    keys.add(key);
    deduped.push(candidate);
  }
  return deduped.sort((a, b) => a.start - b.start || a.end - b.end);
}

export class LruCache<T> {
  private readonly values = new Map<string, T>();
  private readonly limit: number;

  constructor(limit = 32) {
    this.limit = limit;
  }

  get(key: string) {
    const value = this.values.get(key);
    if (value !== undefined) {
      this.values.delete(key);
      this.values.set(key, value);
    }
    return value;
  }

  set(key: string, value: T) {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.limit) this.values.delete(this.values.keys().next().value as string);
  }

  clear() {
    this.values.clear();
  }

  get size() {
    return this.values.size;
  }
}

export function createAnalysisCacheKey(text: string, settingsKey: string, range: ChangedRange | null) {
  const rangeKey = range ? `${range.start}:${range.end}:${range.previousEnd}` : "full";
  return `${settingsKey}:${rangeKey}:${text}`;
}
