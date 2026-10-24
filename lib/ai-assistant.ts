/**
 * AI Writing Assistant - Context-aware real-time suggestions
 * Uses local LLM simulation (can integrate actual API later)
 */

export interface AISuggestion {
  id: string;
  type: 'grammar' | 'style' | 'clarity' | 'tone' | 'vocabulary';
  start: number;
  end: number;
  message: string;
  original: string;
  replacement?: string;
  priority: 'high' | 'medium' | 'low';
}

export interface WritingContext {
  text: string;
  cursorPosition: number;
  selectedText?: string;
  previousSentences: string[];
  nextSentences: string[];
  paragraphs: string[];
  currentParagraphIndex: number;
}

export interface AICongiguration {
  grammarCheck: boolean;
  styleImprovements: boolean;
  clarityEnhancements: boolean;
  toneAnalysis: boolean;
  vocabularySuggestions: boolean;
  minConfidence: number; // 0-1 threshold
}

const DEFAULT_CONFIG: AIConfiguration = {
  grammarCheck: true,
  styleImprovements: true,
  clarityEnhancements: true,
  toneAnalysis: true,
  vocabularySuggestions: true,
  minConfidence: 0.6
};

/**
 * Simple regex-based grammar checking patterns
 */
const GRAMMAR_PATTERNS = [
  {
    pattern: /\b(a|an)\b\s+\w+e\b/gi,
    message: "Consider using 'a' before consonant sounds",
    fix: (match: string) => match.replace(/an\b/i, 'a')
  },
  {
    pattern: /\btheir\'s\b/gi,
    message: "'Their's' is incorrect. Use 'theirs' or 'their'",
    fix: () => 'theirs'
  },
  {
    pattern: /\'re you\b/gi,
    message: "Consider using 'are you' in formal writing",
    fix: (match) => match.replace(/\'re\b/i, 'are')
  }
];

/**
 * Style improvement patterns
 */
const STYLE_PATTERNS = [
  {
    pattern: /\bvery\b\s+(\w+)/gi,
    message: "Consider removing 'very' - be specific instead",
    hint: (match: string, fullMatch: string) => `Use a stronger word than "$1"`
  },
  {
    pattern: /\breally\b\s+(\w+)/gi,
    message: "Replace 'really' with a more precise adjective",
    hint: (word: string) => `Instead of "really ${word}", try something like "${strongWords[word] || 'more specific'}"`
  },
  {
    pattern: /\bso\b(?=\s+\w)/g,
    message: "Remove 'so' unless used as adverb",
    fix: (match) => ''
  }
];

/**
 * Vocabulary enhancement database
 */
const STRONG_WORDS: Record<string, string[]> = {
  good: ['excellent', 'outstanding', 'exceptional'],
  bad: ['poor', 'terrible', 'subpar'],
  big: ['enormous', 'massive', 'substantial'],
  small: ['tiny', 'minimal', 'concise'],
  fast: ['rapid', 'swift', 'efficient'],
  slow: ['gradual', 'methodical', 'deliberate']
};

/**
 * Detect grammar issues in text
 */
function detectGrammarIssues(text: string): AISuggestion[] {
  const issues: AISuggestion[] = [];
  
  GRAMMAR_PATTERNS.forEach((patternObj, index) => {
    const matches = text.match(patternObj.pattern);
    if (matches) {
      const startIndex = text.search(patternObj.pattern);
      
      issues.push({
        id: `gram-${index}-${Date.now()}`,
        type: 'grammar',
        start: startIndex,
        end: startIndex + matches[0].length,
        message: patternObj.message,
        original: matches[0],
        replacement: patternObj.fix(matches[0]),
        priority: 'high'
      });
    }
  });
  
  return issues;
}

/**
 * Detect style improvements
 */
function detectStyleIssues(text: string): AISuggestion[] {
  const issues: AISentence[] = [];
  
  STYLE_PATTERNS.forEach((patternObj, index) => {
    const matches = text.match(patternObj.pattern);
    if (matches) {
      const startIndex = text.search(patternObj.pattern);
      
      issues.push({
        id: `style-${index}-${Date.now()}`,
        type: 'style',
        start: startIndex,
        end: startIndex + matches[0].length,
        message: patternObj.message,
        original: matches[0],
        replacement: null, // Would need more complex logic
        priority: 'medium'
      });
    }
  });
  
  return issues;
}

/**
 * Analyze tone of the text
 */
function analyzeTone(text: string): {
  primaryTone: 'formal' | 'casual' | 'professional' | 'conversational';
  confidence: number;
  suggestions: string[];
} {
  const markers = {
    formal: ['therefore', 'however', 'furthermore', 'consequently'],
    casual: ['gonna', 'wanna', 'kinda', 'um', 'like'],
    professional: ['per our discussion', 'in accordance', 'pursuant'],
    conversational: ['you know', 'I mean', 'sort of', 'right?']
  };
  
  let scores = { formal: 0, casual: 0, professional: 0, conversational: 0 };
  
  Object.entries(markers).forEach(([tone, words]) => {
    words.forEach(word => {
      const count = (text.toLowerCase().match(new RegExp(word, 'g')) || []).length;
      scores[tone as keyof typeof scores] += count;
    });
  });
  
  const maxScore = Math.max(...Object.values(scores));
  const primaryTone = Object.keys(scores).reduce((a, b) => 
    scores[a] > scores[b] ? a : b
  ) as 'formal' | 'casual' | 'professional' | 'conversational';
  
  const confidence = maxScore > 0 ? Math.min(maxScore / 5, 1) : 0;
  
  return {
    primaryTone,
    confidence,
    suggestions: confidence < 0.5 ? ['Consider establishing a clearer tone'] : []
  };
}

/**
 * Main AI suggestion engine
 */
export function generateAISuggestions(
  text: string,
  config: AIConfiguration = DEFAULT_CONFIG
): AISuggestion[] {
  const suggestions: AISentence[] = [];
  
  if (config.grammarCheck) {
    suggestions.push(...detectGrammarIssues(text));
  }
  
  if (config.styleImprovements) {
    suggestions.push(...detectStyleIssues(text));
  }
  
  if (config.toneAnalysis) {
    const toneAnalysis = analyzeTone(text);
    if (toneAnalysis.confidence < 0.7 && suggestions.length === 0) {
      suggestions.push({
        id: `tone-${Date.now()}`,
        type: 'tone',
        start: 0,
        end: text.length,
        message: `Writing tone detected as: ${toneAnalysis.primaryTone}`,
        original: '',
        priority: 'low'
      });
    }
  }
  
  // Filter by confidence threshold
  return suggestions.filter(s => {
    const confidence = calculateConfidence(s);
    return confidence >= (config.minConfidence || 0.6);
  });
}

/**
 * Calculate confidence score for a suggestion
 */
function calculateConfidence(suggestion: AISuggestion): number {
  const baseScores = {
    high: 0.9,
    medium: 0.7,
    low: 0.5
  };
  
  return baseScores[suggestion.priority];
}

/**
 * Apply a suggestion to text
 */
export function applySuggestion(text: string, suggestion: AISuggestion): string {
  if (!suggestion.replacement) {
    return text;
  }
  
  return text.slice(0, suggestion.start) + 
         suggestion.replacement + 
         text.slice(suggestion.end);
}

/**
 * Get contextual help for the current position
 */
export function getContextualHelp(context: WritingContext): string[] {
  const hints: string[] = [];
  
  // Check if at end of paragraph
  if (context.currentParagraphIndex === context.paragraphs.length - 1) {
    hints.push('You\'ve reached the end of your document');
  }
  
  // Check for short paragraphs
  const avgLength = context.paragraphs.reduce((sum, p) => sum + p.length, 0) / 
                    context.paragraphs.length;
  if (avgLength < 50) {
    hints.push('Consider expanding your paragraphs for better flow');
  }
  
  // Check for sentence variety
  const sentenceLengths = context.text.split('.')
    .map(s => s.trim().split(' ').length)
    .filter(len => len > 0);
  
  const variance = calculateVariance(sentenceLengths);
  if (variance < 10) {
    hints.push('Try varying your sentence lengths for better rhythm');
  }
  
  return hints;
}

function calculateVariance(numbers: number[]): number {
  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / numbers.length;
}
