/**
 * AI-Powered Writing Assistant (Advanced)
 * Real-time suggestions, grammar improvement, style enhancement
 */

export interface AISuggestion {
  id: string;
  type: 'grammar' | 'style' | 'clarity' | 'tone' | 'vocabulary' | 'punctuation';
  start: number;
  end: number;
  original: string;
  suggestion: string;
  description: string;
  severity: 'minor' | 'moderate' | 'major';
  category?: string;
  confidence: number; // 0-1
}

export interface AITextAnalysis {
  suggestions: AISuggestion[];
  readabilityScore: number; // 0-100
  wordCount: number;
  sentenceCount: number;
  avgSentenceLength: number;
  passiveVoiceCount: number;
  complexWords: number;
  readingTimeMinutes: number;
  tone: 'formal' | 'casual' | 'professional' | 'persuasive' | 'academic';
}

interface KnowledgeBase {
  commonErrors: Array<{ pattern: RegExp; explanation: string; correction: string }>;
  styleImprovements: Array<{ pattern: RegExp; tip: string; example: string }>;
  vocabularyEnhancements: Record<string, string[]>;
}

// Built-in knowledge base
const KNOWLEDGE_BASE: KnowledgeBase = {
  commonErrors: [
    {
      pattern: /\b(their|there|they're)\b/gi,
      explanation: "Confusion between similar-sounding words",
      correction: 'Use "their" for possession, "there" for location, "they\'re" for "they are"'
    },
    {
      pattern: /it\'s (is|are)\b/gi,
      explanation: "Incorrect use of contraction",
      correction: '$1 should be "its" (possessive) or "it is"'
    },
    {
      pattern: /\b(Your|You\'re)\b/gi,
      explanation: "Confusion between possessive and contraction",
      correction: 'Use "your" for possession, "you\'re" for "you are"'
    }
  ],
  
  styleImprovements: [
    {
      pattern: /\bvery\b\s+(\w+)/gi,
      tip: 'Consider removing "very" - be more specific',
      example: '"very good" -> "excellent", "very big" -> "enormous"'
    },
    {
      pattern: /\breally\b\s+(\w+)/gi,
      tip: 'Replace "really" with a stronger adjective',
      example: '"really fast" -> "rapidly", "really beautiful" -> "stunning"'
    }
  ],
  
  vocabularyEnhancements: {
    'good': ['excellent', 'outstanding', 'exceptional', 'superb'],
    'bad': ['poor', 'subpar', 'inadequate', 'unsatisfactory'],
    'big': ['enormous', 'substantial', 'immense', 'massive'],
    'small': ['tiny', 'minimal', 'concise', 'compact'],
    'fast': ['rapid', 'swift', 'efficient', 'quickest'],
    'slow': ['gradual', 'leisurely', 'deliberate', 'methodical']
  }
};

let currentAnalysis: AITextAnalysis | null = null;

/**
 * Analyze text for AI improvements
 */
export function analyzeText(text: string): AITextAnalysis {
  const lowerText = text.toLowerCase();
  
  // Basic statistics
  const words = lowerText.split(/\s+/).filter(w => w.length > 0);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const wordCount = words.length;
  const sentenceCount = sentences.length;
  const avgSentenceLength = wordCount / Math.max(sentenceCount, 1);
  
  // Count passive voice constructions
  const passiveVoiceMatches = lowerText.match(/was|were|is|are|been|being|by\b/g) || [];
  const passiveVoiceCount = passiveVoiceMatches.filter(match => 
    isPassiveConstruction(lowerText, match)
  ).length;
  
  // Count complex words (3+ syllables)
  const complexWords = countComplexWords(words);
  
  // Estimate reading time
  const readingTimeMinutes = Math.ceil(wordCount / 200); // Average 200 WPM
  
  // Calculate readability score (simplified Flesch-Kincaid)
  const readabilityScore = calculateReadabilityScore(wordCount, sentenceCount, complexWords);
  
  // Detect tone
  const tone = detectTone(lowerText);
  
  // Generate suggestions
  const suggestions = generateSuggestions(text, wordCount, complexityCheck(text));
  
  currentAnalysis = {
    suggestions,
    readabilityScore,
    wordCount,
    sentenceCount,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    passiveVoiceCount,
    complexWords,
    readingTimeMinutes,
    tone
  };
  
  return currentAnalysis;
}

/**
 * Generate real-time suggestions
 */
function generateSuggestions(
  text: string,
  wordCount: number,
  complexity: 'simple' | 'moderate' | 'complex'
): AISuggestion[] {
  const suggestions: AISuggestion[] = [];
  const lowerText = text.toLowerCase();
  const timestamp = Date.now();
  
  // Check for common errors
  KNOWN_GRAMMAR_ERRORS.forEach(error => {
    const matches = text.match(error.pattern) || [];
    
    matches.forEach(match => {
      const index = text.indexOf(match);
      
      suggestions.push({
        id: `error-${timestamp}-${suggestions.length}`,
        type: 'grammar',
        start: index,
        end: index + match.length,
        original: match,
        suggestion: error.correction,
        description: error.explanation,
        severity: 'moderate',
        confidence: 0.85
      });
    });
  });
  
  // Style suggestions
  if (wordCount > 50) {
    // Look for overuse of intensifiers
    const veryMatches = [...text.matchAll(/\bvery\b/gi)];
    if (veryMatches.length > Math.floor(wordCount / 20)) {
      suggestions.push({
        id: `style-intensifier-${timestamp}`,
        type: 'style',
        start: text.indexOf('very'),
        end: text.indexOf('very') + 4,
        original: 'very',
        suggestion: 'remove or replace',
        description: 'Overuse of "very" can weaken your writing',
        severity: 'minor',
        confidence: 0.7
      });
    }
  }
  
  // Vocabulary enhancements
  const enhancedVocab = suggestBetterVocabulary(text);
  enhancedVocab.forEach(vocabSuggestion => {
    suggestions.push(vocabSuggestion);
  });
  
  // Clarity improvements for long sentences
  if (complexity === 'complex') {
    const longSentences = findLongSentences(text);
    longSentences.slice(0, 3).forEach(sentence => {
      suggestions.push({
        id: `clarity-${timestamp}-${Math.random()}`,
        type: 'clarity',
        start: text.indexOf(sentence),
        end: text.indexOf(sentence) + sentence.length,
        original: sentence.substring(0, 50) + '...',
        suggestion: 'Consider breaking into shorter sentences',
        description: 'Long sentences reduce readability',
        severity: 'moderate',
        confidence: 0.75
      });
    });
  }
  
  // Punctuation checks
  const punctuationIssues = findPunctuationIssues(text);
  punctuationIssues.forEach(issue => {
    suggestions.push({
      id: `punct-${timestamp}-${Math.random()}`,
      type: 'punctuation',
      start: issue.start,
      end: issue.end,
      original: issue.text,
      suggestion: issue.fix,
      description: issue.description,
      severity: 'moderate',
      confidence: 0.9
    });
  });
  
  // Sort by severity and confidence
  return suggestions.sort((a, b) => {
    const severityOrder = { major: 0, moderate: 1, minor: 2 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return b.confidence - a.confidence;
  });
}

/**
 * Accept suggestion and apply change
 */
export function acceptSuggestion(text: string, suggestion: AISuggestion): string {
  return (
    text.substring(0, suggestion.start) +
    suggestion.suggestion +
    text.substring(suggestion.end)
  );
}

/**
 * Dismiss suggestion (user acknowledged)
 */
export function dismissSuggestion(suggestionId: string): void {
  console.log(`❌ Suggestion dismissed: ${suggestionId}`);
  // In production, would track dismissed suggestions for learning
}

/**
 * Get analysis summary
 */
export function getAnalysisSummary(): AITextAnalysis | null {
  return currentAnalysis;
}

/**
 * Clear analysis cache
 */
export function clearAnalysis(): void {
  currentAnalysis = null;
}

// Helper Functions

function isPassiveConstruction(text: string, verb: string): boolean {
  const contextBefore = text.substring(Math.max(0, text.indexOf(verb) - 10), text.indexOf(verb));
  const contextAfter = text.substring(text.indexOf(verb), text.indexOf(verb) + 10);
  
  const passiveMarkers = ['by ', 'was ', 'were ', 'is ', 'are ', 'been ', 'being '];
  return passiveMarkers.some(marker => contextAfter.includes(marker));
}

function countComplexWords(words: string[]): number {
  return words.filter(word => {
    const syllableCount = countSyllables(word);
    return syllableCount >= 3 && word.length > 6;
  }).length;
}

function countSyllables(word: string): number {
  word = word.toLowerCase();
  if (word.length <= 3) return 1;
  
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

function calculateReadabilityScore(
  wordCount: number,
  sentenceCount: number,
  complexWords: number
): number {
  if (sentenceCount === 0) return 0;
  
  const avgWordsPerSentence = wordCount / sentenceCount;
  const avgSyllablesPerWord = (complexWords * 3) / Math.max(wordCount, 1);
  
  // Simplified Flesch Reading Ease
  const score = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
  
  return Math.max(0, Math.min(100, Math.round(score)));
}

function detectTone(text: string): AITextAnalysis['tone'] {
  const formalIndicators = ['therefore', 'however', 'furthermore', 'consequently', 'notwithstanding'];
  const casualIndicators = ['gonna', 'wanna', 'kinda', 'uh', 'um', 'yeah', 'totally'];
  const professionalIndicators = ['per our discussion', 'in accordance', 'attached please find'];
  const persuasiveIndicators = ['must', 'should', 'need to', 'important', 'critical'];
  
  let scores = { formal: 0, casual: 0, professional: 0, persuasive: 0 };
  
  formalIndicators.forEach(indicator => {
    if (text.includes(indicator)) scores.formal++;
  });
  
  casualIndicators.forEach(indicator => {
    if (text.includes(indicator)) scores.casual++;
  });
  
  professionalIndicators.forEach(indicator => {
    if (text.includes(indicator)) scores.professional++;
  });
  
  persuasiveIndicators.forEach(indicator => {
    if (text.includes(indicator)) scores.persuasive++;
  });
  
  // Find dominant tone
  const tones = Object.entries(scores)
    .sort(([, a], [, b]) => b - a);
  
  return tones[0]?.[0] as AITextAnalysis['tone'] || 'casual';
}

function complexityCheck(text: string): 'simple' | 'moderate' | 'complex' {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  
  const avgSentenceLength = words.length / Math.max(sentences.length, 1);
  const hasComplexStructure = /;\s*|\s*(?:although|because|if|when|while)\s+/i.test(text);
  
  if (avgSentenceLength > 25 || (sentences.length < 5 && hasComplexStructure)) {
    return 'complex';
  } else if (avgSentenceLength > 15) {
    return 'moderate';
  } else {
    return 'simple';
  }
}

function findLongSentences(text: string, maxLength: number = 50): string[] {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  return sentences.filter(s => s.trim().split(/\s+/).length > maxLength);
}

function findPunctuationIssues(text: string): Array<{
  start: number;
  end: number;
  text: string;
  fix: string;
  description: string;
}> {
  const issues: Array<{ start: number; end: number; text: string; fix: string; description: string }> = [];
  
  // Double spaces
  const doubleSpaces = [...text.matchAll(/\s{2,}/g)];
  doubleSpaces.forEach(match => {
    issues.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      fix: ' ',
      description: 'Remove extra whitespace'
    });
  });
  
  // Missing space after punctuation
  const missingSpace = [...text.matchAll(/([.!?])([^\s])/g)];
  missingSpace.forEach(match => {
    issues.push({
      start: match.index + match[1].length,
      end: match.index + match[1].length + 1,
      text: '',
      fix: ' ',
      description: 'Add space after punctuation'
    });
  });
  
  return issues;
}

function suggestBetterVocabulary(text: string): AISuggestion[] {
  const suggestions: AISuggestion[] = [];
  const timestamp = Date.now();
  
  Object.entries(KNOWLEDGE_BASE.vocabularyEnhancements).forEach(([oldWord, newWords]) => {
    const regex = new RegExp(`\\b${oldWord}\\b`, 'gi');
    const matches = [...text.matchAll(regex)];
    
    if (matches.length > 0) {
      matches.forEach((match, idx) => {
        const betterWord = newWords[Math.min(idx % newWords.length, newWords.length - 1)];
        
        suggestions.push({
          id: `vocab-${timestamp}-${idx}`,
          type: 'vocabulary',
          start: match.index,
          end: match.index + match[0].length,
          original: match[0],
          suggestion: betterWord,
          description: `Consider using "${betterWord}" for more precision`,
          severity: 'minor',
          confidence: 0.75
        });
      });
    }
  });
  
  return suggestions;
}

// Grammar patterns to check
const KNOWN_GRAMMAR_ERRORS: Array<{
  pattern: RegExp;
  explanation: string;
  correction: string;
}> = [
  {
    pattern: /\b(i am|i'm)\b/gi,
    explanation: 'Capitalization in first person references',
    correction: 'Ensure proper capitalization: "I am" or "I\'m"'
  },
  {
    pattern: /\b(a|an)\b\s+[aeiou]/gi,
    explanation: 'Article usage before vowels',
    correction: 'Use "an" before vowel sounds: "an apple", not "a apple"'
  },
  {
    pattern: /\brefering\b/gi,
    explanation: 'Spelling error',
    correction: 'Referencing requires double consonant: "referring"'
  },
  {
    pattern: /\boccured\b/gi,
    explanation: 'Spelling error',
    correction: 'Correct spelling: "occurred" with double r'
  }
];

/**
 * Export analysis report as JSON
 */
export function exportAnalysisReport(format: 'json' | 'markdown' = 'json'): string {
  if (!currentAnalysis) {
    return JSON.stringify({ error: 'No analysis available' });
  }
  
  if (format === 'markdown') {
    return `# Writing Analysis Report

## Summary
- **Word Count:** ${currentAnalysis.wordCount.toLocaleString()}
- **Sentence Count:** ${currentAnalysis.sentenceCount}
- **Average Sentence Length:** ${currentAnalysis.avgSentenceLength} words
- **Reading Time:** ~${currentAnalysis.readingTimeMinutes} minutes

## Quality Metrics
- **Readability Score:** ${currentAnalysis.readabilityScore}/100
- **Passive Voice Instances:** ${currentAnalysis.passiveVoiceCount}
- **Complex Words:** ${currentAnalysis.complexWords}
- **Dominant Tone:** ${currentAnalysis.tone}

## Suggestions Found: ${currentAnalysis.suggestions.length}
${currentAnalysis.suggestions.slice(0, 10).map((s, i) => `- **${i + 1}.** [${s.type.toUpperCase()}] ${s.description}`).join('\n')}
`;
  }
  
  return JSON.stringify(currentAnalysis, null, 2);
}

/**
 * Import analysis from saved state
 */
export function importAnalysis(json: string): void {
  try {
    const imported = JSON.parse(json);
    currentAnalysis = imported;
    console.log('✅ Analysis imported successfully');
  } catch (error) {
    console.error('Failed to import analysis:', error);
  }
}
