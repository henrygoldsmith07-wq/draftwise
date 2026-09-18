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

export interface IncrementalAnalysisRanges {
  previous: { start: number; end: number };
  next: { start: number; end: number };
  delta: number;
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

function expandToSafeBoundary(text: string, start: number, end: number, contextWindow: number) {
  const roughStart = Math.max(0, start - contextWindow);
  const roughEnd = Math.min(text.length, end + contextWindow);
  const leftMatches = [...text.slice(0, roughStart).matchAll(/(?:[.!?…]\s+|\n\s*)/gu)];
  const left = leftMatches[leftMatches.length - 1];
  const safeStart = left && left.index !== undefined ? left.index + left[0].length : roughStart;
  const rightMatch = text.slice(roughEnd).match(/[.!?…](?:\s|$)|\n\s*/u);
  const safeEnd = rightMatch?.index !== undefined
    ? Math.min(text.length, roughEnd + rightMatch.index + rightMatch[0].length)
    : roughEnd;
  return { start: Math.min(safeStart, start), end: Math.max(safeEnd, end) };
}

export function getIncrementalAnalysisRanges(
  previousText: string,
  nextText: string,
  changedRange: ChangedRange,
  contextWindow = DEFAULT_CONTEXT_WINDOW,
): IncrementalAnalysisRanges {
  const previous = expandToSafeBoundary(previousText, changedRange.start, changedRange.previousEnd, contextWindow);
  const next = expandToSafeBoundary(nextText, changedRange.start, changedRange.end, contextWindow);
  return { previous, next, delta: nextText.length - previousText.length };
}

export function retainUnaffectedIssues(
  previousIssues: WritingIssue[],
  ranges: IncrementalAnalysisRanges,
  nextText: string,
) {
  return previousIssues.flatMap((issue) => {
    if (issue.start < ranges.previous.end && issue.end > ranges.previous.start) return [];
    const shift = issue.start >= ranges.previous.end ? ranges.delta : 0;
    const start = issue.start + shift;
    const end = issue.end + shift;
    if (start < 0 || end > nextText.length || nextText.slice(start, end) !== issue.original) return [];
    return [{ ...issue, start, end }];
  });
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
  const confidence = Number.isFinite(issue.confidence) ? issue.confidence : 0.5;
  return severity + confidence + source;
}

interface RankedIssueEntry {
  issue: WritingIssue;
  rank: number;
  active: boolean;
  removed: boolean;
  sequence: number;
}

interface IntervalTreeNode {
  entry: RankedIssueEntry;
  priority: number;
  maxEnd: number;
  left: IntervalTreeNode | null;
  right: IntervalTreeNode | null;
}

function intervalKeyComesBefore(left: RankedIssueEntry, right: RankedIssueEntry) {
  return left.issue.start < right.issue.start
    || (left.issue.start === right.issue.start && (left.issue.end < right.issue.end
      || (left.issue.end === right.issue.end && left.sequence < right.sequence)));
}

function intervalPriority(sequence: number) {
  let value = (sequence + 1) | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function intervalMaxEnd(node: IntervalTreeNode | null) {
  return node?.maxEnd ?? Number.NEGATIVE_INFINITY;
}

function refreshIntervalNode(node: IntervalTreeNode) {
  node.maxEnd = Math.max(node.entry.issue.end, intervalMaxEnd(node.left), intervalMaxEnd(node.right));
}

function rotateIntervalRight(node: IntervalTreeNode) {
  const next = node.left;
  if (!next) return node;
  node.left = next.right;
  next.right = node;
  refreshIntervalNode(node);
  refreshIntervalNode(next);
  return next;
}

function rotateIntervalLeft(node: IntervalTreeNode) {
  const next = node.right;
  if (!next) return node;
  node.right = next.left;
  next.left = node;
  refreshIntervalNode(node);
  refreshIntervalNode(next);
  return next;
}

function insertIntervalNode(root: IntervalTreeNode | null, node: IntervalTreeNode): IntervalTreeNode {
  if (!root) return node;
  if (intervalKeyComesBefore(node.entry, root.entry)) {
    root.left = insertIntervalNode(root.left, node);
    if (root.left.priority < root.priority) return rotateIntervalRight(root);
  } else {
    root.right = insertIntervalNode(root.right, node);
    if (root.right.priority < root.priority) return rotateIntervalLeft(root);
  }
  refreshIntervalNode(root);
  return root;
}

function collectOverlappingIntervals(node: IntervalTreeNode | null, start: number, end: number, output: RankedIssueEntry[]) {
  if (!node || node.maxEnd <= start) return;
  if (node.left) collectOverlappingIntervals(node.left, start, end, output);
  if (node.entry.issue.start < end && node.entry.issue.end > start && node.entry.active && !node.entry.removed) output.push(node.entry);
  if (node.entry.issue.start < end) collectOverlappingIntervals(node.right, start, end, output);
}

export function mergeAnalysisIssues(issues: WritingIssue[]): WritingIssue[] {
  const candidates = issues
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
    .filter((item) => item.start >= 0 && item.end > item.start && item.original.length > 0)
    .map((item) => ({ ...item, confidence: Math.max(0, Math.min(1, item.confidence ?? 0.5)) }))
    .sort((a, b) => a.start - b.start || b.end - a.end || issueRank(b) - issueRank(a));

  const entries: RankedIssueEntry[] = [];
  const exact = new Map<string, RankedIssueEntry>();
  let intervalTree: IntervalTreeNode | null = null;
  const isLive = (entry: RankedIssueEntry) => entry.active && !entry.removed;
  const deactivate = (entry: RankedIssueEntry, remove: boolean) => {
    entry.active = false;
    entry.removed ||= remove;
    const key = `${entry.issue.start}:${entry.issue.end}:${entry.issue.original.toLocaleLowerCase()}`;
    if (exact.get(key) === entry && remove) exact.delete(key);
  };

  for (const [sequence, candidate] of candidates.entries()) {
    const overlapping: RankedIssueEntry[] = [];
    collectOverlappingIntervals(intervalTree, candidate.start, candidate.end, overlapping);
    const key = `${candidate.start}:${candidate.end}:${candidate.original.toLocaleLowerCase()}`;
    const existingExact = exact.get(key);
    if (existingExact && isLive(existingExact)) {
      if (issueRank(candidate) > existingExact.rank) {
        deactivate(existingExact, true);
      } else {
        continue;
      }
    }
    const liveOverlapping = overlapping.filter(isLive);
    const bestOverlap = liveOverlapping.reduce<RankedIssueEntry | null>((best, entry) => !best || entry.rank > best.rank ? entry : best, null);
    if (bestOverlap) {
      if (issueRank(candidate) <= bestOverlap.rank) continue;
      for (const entry of liveOverlapping) deactivate(entry, true);
    }
    const entry: RankedIssueEntry = { issue: candidate, rank: issueRank(candidate), active: true, removed: false, sequence };
    entries.push(entry);
    exact.set(key, entry);
    intervalTree = insertIntervalNode(intervalTree, { entry, priority: intervalPriority(sequence), maxEnd: candidate.end, left: null, right: null });
  }
  return entries
    .filter((entry) => !entry.removed)
    .map((entry) => entry.issue)
    .sort((a, b) => a.start - b.start || a.end - b.end);
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
