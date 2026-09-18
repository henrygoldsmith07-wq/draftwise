export {
  analyzeLocally,
  analyzeLocallyIncremental,
  categoryColors,
  getWritingStats,
  inferTone,
  mergeWritingIssues,
  parseDocument,
  scoreWriting,
  suggestSpelling,
} from "@/packages/grammar/src";

export {
  createAnalysisCacheKey,
  createAnalysisChunks,
  detectChangedRange,
  expandRangeToContext,
  getIncrementalAnalysisRanges,
  LruCache,
  mapChunkIssue,
  mergeAnalysisIssues,
  retainUnaffectedIssues,
} from "@/packages/analysis/src";
