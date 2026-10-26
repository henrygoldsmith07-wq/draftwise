/**
 * Advanced Document Intelligence System
 * Text analysis, similarity detection, content extraction
 */

export interface DocumentAnalysis {
  readabilityScore: number; // 0-100 (Flesch-Kincaid)
  complexityLevel: 'simple' | 'moderate' | 'complex' | 'academic';
  wordCount: number;
  charCount: number;
  sentenceCount: number;
  paragraphCount: number;
  avgSentenceLength: number;
  avgWordLength: number;
  passiveVoicePercentage: number;
  uniqueWordsRatio: number;
  readingTimeMinutes: number;
  speakingTimeMinutes: number;
}

export interface SimilarityResult {
  score: number; // 0-1 normalized
  sharedWords: string[];
  commonThemes: string[];
  differences: Array<{ text: string; type: 'added' | 'removed' }>;
}

export interface ContentSummary {
  headline: string;
  keyPoints: string[];
  executiveSummary: string;
  confidence: number;
}

interface IntelligenceState {
  analyses: Map<string, DocumentAnalysis>;
  documentReferences: Set<string>;
  lastAnalyzed: Date;
}

let state: IntelligenceState = {
  analyses: new Map(),
  documentReferences: new Set(),
  lastAnalyzed: new Date()
};

/**
 * Analyze a document
 */
export function analyzeDocument(text: string, docId?: string): DocumentAnalysis {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  const wordCount = words.length;
  const charCount = text.length;
  const sentenceCount = sentences.length;
  const paragraphCount = paragraphs.length;
  
  const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0;
  const avgWordLength = wordCount > 0 
    ? words.reduce((sum, w) => sum + w.length, 0) / wordCount 
    : 0;
  
  // Calculate readability (Flesch-Kincaid)
  const readabilityScore = calculateReadability(wordCount, sentenceCount, words);
  
  // Determine complexity
  const complexityLevel = determineComplexity(readabilityScore, avgSentenceLength);
  
  // Count passive voice
  const passiveVoicePercentage = countPassiveVoice(text);
  
  // Unique words ratio
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  const uniqueWordsRatio = uniqueWords.size / wordCount;
  
  // Time estimates
  const readingTimeMinutes = Math.ceil(wordCount / 200); // 200 WPM
  const speakingTimeMinutes = Math.ceil(wordCount / 150); // 150 WPM average
  
  const analysis: DocumentAnalysis = {
    readabilityScore,
    complexityLevel,
    wordCount,
    charCount,
    sentenceCount,
    paragraphCount,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    avgWordLength: Math.round(avgWordLength * 100) / 100,
    passiveVoicePercentage: Math.round(passiveVoicePercentage * 100) / 100,
    uniqueWordsRatio: Math.round(uniqueWordsRatio * 1000) / 1000,
    readingTimeMinutes,
    speakingTimeMinutes
  };
  
  if (docId) {
    state.analyses.set(docId, analysis);
    state.documentReferences.add(docId);
    state.lastAnalyzed = new Date();
    
    window.dispatchEvent(new CustomEvent('document-analyzed', { detail: { docId, analysis } }));
  }
  
  return analysis;
}

/**
 * Compare two documents for similarity
 */
export function compareDocuments(text1: string, text2: string): SimilarityResult {
  const words1 = extractWords(text1);
  const words2 = extractWords(text2);
  
  // Find common words using set intersection
  const common = words1.filter(w => words2.includes(w));
  const union = [...new Set([...words1, ...words2])];
  
  // Jaccard similarity
  const score = common.length / union.length;
  
  // Extract common themes (most frequent shared words)
  const themeCounts: Record<string, number> = {};
  common.forEach(word => {
    themeCounts[word] = (themeCounts[word] || 0) + 1;
  });
  
  const sortedThemes = Object.entries(themeCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([word]) => word);
  
  // Find differences
  const added = words2.filter(w => !words1.includes(w)).slice(0, 10);
  const removed = words1.filter(w => !words2.includes(w)).slice(0, 10);
  
  return {
    score: Math.round(score * 1000) / 1000,
    sharedWords: common.slice(0, 20),
    commonThemes: sortedThemes,
    differences: [
      ...added.map(w => ({ text: w, type: 'added' as const })),
      ...removed.map(w => ({ text: w, type: 'removed' as const }))
    ]
  };
}

/**
 * Generate document summary
 */
export function summarizeDocument(text: string, maxSentences: number = 3): ContentSummary {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  if (sentences.length === 0) {
    return {
      headline: 'Untitled',
      keyPoints: [],
      executiveSummary: '',
      confidence: 0
    };
  }
  
  // Extract most important sentences (first and last sentences often key)
  const importantIndices = [
    0, // First sentence
    Math.floor(sentences.length / 2), // Middle
    sentences.length - 1 // Last sentence
  ];
  
  const selectedSentences = importantIndices
    .filter(i => i < sentences.length && i >= 0)
    .slice(0, maxSentences)
    .map(i => sentences[i].trim());
  
  // Generate headline from first sentence
  const headline = sentences[0].substring(0, 60) + (sentences[0].length > 60 ? '...' : '');
  
  // Create executive summary
  const executiveSummary = selectedSentences.join(' ');
  
  return {
    headline: cleanHeadline(headline),
    keyPoints: selectedSentences,
    executiveSummary,
    confidence: Math.min(1, selectedSentences.length / 3)
  };
}

/**
 * Extract entities from text (names, dates, numbers)
 */
export function extractEntities(text: string): Array<{
  type: 'name' | 'date' | 'number' | 'email' | 'url';
  value: string;
  start: number;
  end: number;
}> {
  const entities: Array<{ type: string; value: string; start: number; end: number }> = [];
  
  // Email addresses
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let match;
  while ((match = emailRegex.exec(text)) !== null) {
    entities.push({
      type: 'email',
      value: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  // URLs
  const urlRegex = /https?:\/\/[^\s]+/g;
  while ((match = urlRegex.exec(text)) !== null) {
    entities.push({
      type: 'url',
      value: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  // Dates (various formats)
  const dateRegex = /\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}|\w+ \d{1,2},? \d{4}/g;
  while ((match = dateRegex.exec(text)) !== null) {
    entities.push({
      type: 'date',
      value: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  // Numbers (large numbers specifically)
  const numberRegex = /\b\d{4,}\b/g;
  while ((match = numberRegex.exec(text)) !== null) {
    entities.push({
      type: 'number',
      value: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  return entities;
}

/**
 * Detect language of text
 */
export function detectLanguage(text: string): { lang: string; confidence: number } {
  const commonWords = [
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'is', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do',
    'at', 'this', 'but', 'his', 'by', 'from'
  ];
  
  const lowerText = text.toLowerCase();
  const matches = commonWords.filter(word => lowerText.includes(word));
  
  const confidence = Math.min(matches.length / 10, 1);
  
  return {
    lang: 'English',
    confidence: Math.round(confidence * 100) / 100
  };
}

/**
 * Get all analyses
 */
export function getAllAnalyses(): Array<{ docId: string; analysis: DocumentAnalysis }> {
  return Array.from(state.analyses.entries()).map(([docId, analysis]) => ({ docId, analysis }));
}

/**
 * Clear all analyses
 */
export function clearAllAnalyses(): void {
  state.analyses.clear();
  state.documentReferences.clear();
  console.log('🧹 All document analyses cleared');
}

// Helper Functions

function calculateReadability(wordCount: number, sentenceCount: number, words: string[]): number {
  if (sentenceCount === 0) return 0;
  
  // Count syllables in words
  const totalSyllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  const avgSyllablesPerWord = totalSyllables / wordCount;
  
  // Flesch Reading Ease formula
  const score = 206.835 - (1.015 * (wordCount / sentenceCount)) - (84.6 * avgSyllablesPerWord);
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

function determineComplexity(readabilityScore: number, avgSentenceLength: number): 
  'simple' | 'moderate' | 'complex' | 'academic' {
  if (readabilityScore >= 60 && avgSentenceLength <= 20) {
    return 'simple';
  } else if (readabilityScore >= 40 && avgSentenceLength <= 30) {
    return 'moderate';
  } else if (readabilityScore >= 20) {
    return 'complex';
  } else {
    return 'academic';
  }
}

function countPassiveVoice(text: string): number {
  const passivePatterns = [
    /was\s+\w+v?ed\b/gi,
    /were\s+\w+v?ed\b/gi,
    /is\s+\w+v?ed\b/gi,
    /are\s+\w+v?ed\b/gi,
    /been\s+\w+v?ed\b/gi,
    /being\s+\w+v?ed\b/gi,
    /by\s+\w+\s+verb/gi // "by [agent]" pattern
  ];
  
  let count = 0;
  passivePatterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  });
  
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.length > 0 ? count / sentences.length : 0;
}

function extractWords(text: string): string[] {
  return text.toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z]/g, ''))
    .filter(w => w.length > 0);
}

function countSyllables(word: string): number {
  word = word.toLowerCase();
  if (word.length <= 3) return 1;
  
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

function cleanHeadline(headline: string): string {
  return headline.charAt(0).toUpperCase() + headline.slice(1);
}

/**
 * Get writing quality score
 */
export function getWritingQuality(text: string): {
  overall: number;
  readability: number;
  structure: number;
  variety: number;
  recommendations: string[];
} {
  const analysis = analyzeDocument(text);
  
  const readabilityScore = analysis.readabilityScore;
  
  // Structure score based on paragraph diversity
  const structureScore = Math.min(100, analysis.paragraphCount * 20);
  
  // Variety score based on sentence length variation
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const lengths = sentences.map(s => s.split(/\s+/).length);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / lengths.length;
  const varietyScore = Math.min(100, Math.sqrt(variance) * 10);
  
  const overall = Math.round((readabilityScore * 0.4 + structureScore * 0.3 + varietyScore * 0.3));
  
  const recommendations: string[] = [];
  
  if (analysis.avgSentenceLength > 30) {
    recommendations.push('Consider breaking up long sentences for better readability');
  }
  
  if (analysis.passiveVoicePercentage > 20) {
    recommendations.push('Reduce passive voice usage for more direct writing');
  }
  
  if (analysis.paragraphCount < 3 && text.length > 500) {
    recommendations.push('Add paragraph breaks to improve document structure');
  }
  
  if (analysis.uniqueWordsRatio < 0.5) {
    recommendations.push('Consider using more varied vocabulary');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('Great writing! No major improvements needed.');
  }
  
  return {
    overall,
    readability: readabilityScore,
    structure: structureScore,
    variety: Math.round(varietyScore),
    recommendations
  };
}

/**
 * Export analysis report
 */
export function exportReport(): string {
  const reports = Array.from(state.analyses.entries()).map(([docId, analysis]) => ({
    documentId: docId,
    analysis,
    timestamp: state.lastAnalyzed.toISOString()
  }));
  
  return JSON.stringify({
    reports,
    totalDocuments: state.documentReferences.size,
    exportedAt: new Date().toISOString()
  }, null, 2);
}
