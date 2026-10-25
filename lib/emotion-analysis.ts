/**
 * Emotion/Sentiment Analysis Engine
 * Detects emotional tone in written text using pattern matching
 */

export interface SentimentAnalysis {
  score: number;           // -1 (negative) to +1 (positive), 0 (neutral)
  label: 'very-negative' | 'negative' | 'neutral' | 'positive' | 'very-positive';
  confidence: number;      // 0-1 probability
}

export interface EmotionDetection {
  primaryEmotion: string;
  secondaryEmotion?: string;
  emotions: Record<string, number>; // emotion -> intensity (0-1)
  intensity: number;       // overall emotional intensity (0-1)
}

export interface TextMoodReport {
  sentiment: SentimentAnalysis;
  emotions: EmotionDetection;
  tone: 'formal' | 'casual' | 'professional' | 'friendly' | 'aggressive' | 'melancholic';
  readability: {
    complexity: 'simple' | 'moderate' | 'complex' | 'academic';
    avgSentenceLength: number;
    avgWordLength: number;
  };
  keywords: Array<{ word: string; relevance: number }>;
}

// Emotion lexicon database
const EMOTION_WORDS = {
  joy: ['happy', 'joyful', 'delighted', 'pleased', 'excited', 'thrilled', 'ecstatic', 
        'cheerful', 'grateful', 'blissful', 'content', 'wonderful', 'amazing', 'great'],
  sadness: ['sad', 'unhappy', 'depressed', 'mournful', 'gloomy', 'sorrowful', 'melancholy',
            'heartbroken', 'devastated', 'disappointed', 'lonely', 'isolated', 'despairing'],
  anger: ['angry', 'furious', 'mad', 'irritated', 'annoyed', 'enraged', 'outraged',
          'resentful', 'hostile', 'vengeful', 'bitter', 'incensed', 'livid'],
  fear: ['afraid', 'scared', 'terrified', 'anxious', 'worried', 'nervous', 'apprehensive',
         'fearful', 'dread', 'panicked', 'unsettled', 'uneasy', 'jittery'],
  surprise: ['surprised', 'shocked', 'amazed', 'astonished', 'stunned', 'startled',
             'taken aback', 'flabbergasted', 'bewildered', 'confused', 'puzzled'],
  disgust: ['disgusted', 'revolted', 'sickened', 'repulsed', 'horror', 'loathe',
            'contemptuous', 'disdainful', 'nauseated', 'offended']
};

// Positive/negative word lists for sentiment
const POSITIVE_WORDS = [
  'love', 'beautiful', 'excellent', 'amazing', 'fantastic', 'wonderful', 'great',
  'brilliant', 'superb', 'outstanding', 'incredible', 'awesome', 'perfect', 'success',
  'achievement', 'accomplish', 'grow', 'improve', 'hope', 'inspire', 'motivate',
  'create', 'build', 'develop', 'progress', 'achieve', 'thrive', 'excel', 'flourish'
];

const NEGATIVE_WORDS = [
  'hate', 'terrible', 'awful', 'horrible', 'worst', 'failure', 'fail', 'bad',
  'poor', 'disaster', 'catastrophic', 'ugly', 'broken', 'destroy', 'ruin', 'lose',
  'loss', 'problem', 'difficulty', 'struggle', 'struggling', 'hard', 'painful',
  'suffer', 'suffering', 'wrong', 'mistake', 'error', 'fault', 'defective'
];

// Tone indicators
const TONE_INDICATORS = {
  formal: ['therefore', 'however', 'furthermore', 'consequently', 'accordingly',
           'notwithstanding', 'nevertheless', 'thus', 'hence', 'utilize', 'commence'],
  casual: ['gonna', 'wanna', 'kinda', 'uh', 'um', 'like', 'yeah', 'totally',
           'basically', 'literally', 'actually', 'whatever', 'stuff', 'thing'],
  professional: ['per our discussion', 'in accordance with', 'pursuant to', 
                 'in reference to', 'attached please find', 'for your consideration',
                 'regarding the matter', 'at your earliest convenience'],
  aggressive: ['absolutely not', 'never', 'must', 'always', 'clearly obvious',
               'ridiculous', 'pathetic', 'insane', 'crazy', 'unacceptable'],
  melancholic: ['once again', 'nevermind', 'too late', 'past tense', 'memories',
                'remember when', 'long gone', 'slipped away', 'fading', 'empty']
};

// Mood tracking database
let moodHistory: Array<{ timestamp: Date; report: TextMoodReport }> = [];
let dailyAverages: Map<string, TextMoodReport> = new Map();

/**
 * Analyze text for sentiment and emotions
 */
export function analyzeText(text: string): TextMoodReport {
  const lowerText = text.toLowerCase();
  
  // Sentiment analysis
  const sentiment = calculateSentiment(lowerText);
  
  // Emotion detection
  const emotions = detectEmotions(lowerText, text);
  
  // Tone analysis
  const tone = detectTone(lowerText);
  
  // Readability metrics
  const readability = calculateReadability(text);
  
  // Keyword extraction
  const keywords = extractKeywords(lowerText);
  
  const report: TextMoodReport = {
    sentiment,
    emotions,
    tone,
    readability,
    keywords
  };
  
  // Track in history
  trackMood(report);
  
  return report;
}

/**
 * Calculate sentiment score
 */
function calculateSentiment(text: string): SentimentAnalysis {
  const words = text.split(/\s+/).filter(w => w.length > 2);
  
  let positiveCount = 0;
  let negativeCount = 0;
  let totalScore = 0;
  
  // Count positive words
  POSITIVE_WORDS.forEach(word => {
    if (text.includes(word)) {
      positiveCount += 2; // Boost weight
    }
  });
  
  // Count negative words
  NEGATIVE_WORDS.forEach(word => {
    if (text.includes(word)) {
      negativeCount += 2;
    }
  });
  
  // Also count individual word matches
  words.forEach(word => {
    if (POSITIVE_WORDS.includes(word)) {
      positiveCount++;
    } else if (NEGATIVE_WORDS.includes(word)) {
      negativeCount--;
    }
  });
  
  // Calculate ratio
  const totalCount = Math.max(positiveCount + Math.abs(negativeCount), 1);
  const score = (positiveCount - Math.abs(negativeCount)) / totalCount;
  
  // Determine label
  let label: SentimentAnalysis['label'] = 'neutral';
  if (score >= 0.6) label = 'very-positive';
  else if (score >= 0.3) label = 'positive';
  else if (score <= -0.6) label = 'very-negative';
  else if (score <= -0.3) label = 'negative';
  
  // Confidence based on word count
  const confidence = Math.min(words.length / 50, 1);
  
  return {
    score: Math.round(score * 100) / 100,
    label,
    confidence: Math.round(confidence * 100) / 100
  };
}

/**
 * Detect dominant emotions
 */
function detectEmotions(lowerText: string, originalText: string): EmotionDetection {
  const emotions: Record<string, number> = {};
  
  // Count emotion-specific words
  Object.entries(EMOTION_WORDS).forEach(([emotion, words]) => {
    let count = 0;
    
    words.forEach(word => {
      if (lowerText.includes(word)) {
        count++;
        
        // Check for intensifiers
        const precedingWords = lowerText.substring(0, originalText.indexOf(word)).split(' ').slice(-3);
        if (precedingWords.some(w => ['very', 'really', 'extremely', 'so', 'incredibly'].includes(w))) {
          count *= 2;
        }
      }
    });
    
    emotions[emotion] = count;
  });
  
  // Normalize scores to 0-1 range
  const maxScore = Math.max(...Object.values(emotions), 0.1);
  const normalizedScores: Record<string, number> = {};
  
  Object.entries(emotions).forEach(([emotion, score]) => {
    normalizedScores[emotion] = score / maxScore;
  });
  
  // Find primary and secondary emotions
  const sortedEmotions = Object.entries(normalizedScores)
    .sort(([, a], [, b]) => b - a);
  
  const primaryEmotion = sortedEmotions[0]?.[0] || 'neutral';
  const secondaryEmotion = sortedEmotions[1]?.[0];
  
  // Calculate overall intensity
  const intensity = sortedEmotions.reduce((sum, [, score]) => sum + score, 0) / 4;
  
  return {
    primaryEmotion,
    secondaryEmotion,
    emotions: normalizedScores,
    intensity: Math.round(intensity * 100) / 100
  };
}

/**
 * Detect communication tone
 */
function detectTone(text: string): TextMoodReport['tone'] {
  let scores: Record<string, number> = {};
  
  Object.entries(TONE_INDICATORS).forEach(([tone, indicators]) => {
    let score = 0;
    
    indicators.forEach(indicator => {
      if (text.includes(indicator)) {
        score++;
      }
    });
    
    scores[tone] = score;
  });
  
  // Find highest scoring tone
  const sortedTones = Object.entries(scores)
    .sort(([, a], [, b]) => b - a);
  
  return sortedTones[0]?.[0] as TextMoodReport['tone'] || 'casual';
}

/**
 * Calculate readability metrics
 */
function calculateReadability(text: string): TextMoodReport['readability'] {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  
  const avgSentenceLength = sentences.length > 0 
    ? words.length / sentences.length 
    : 0;
  
  const avgWordLength = words.length > 0
    ? words.reduce((sum, w) => sum + w.length, 0) / words.length
    : 0;
  
  // Classify complexity
  let complexity: typeof readability.complexity = 'simple';
  
  if (avgSentenceLength > 20 && avgWordLength > 6) {
    complexity = 'academic';
  } else if (avgSentenceLength > 15 || avgWordLength > 5) {
    complexity = 'complex';
  } else if (avgSentenceLength > 10) {
    complexity = 'moderate';
  } else {
    complexity = 'simple';
  }
  
  return {
    complexity,
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    avgWordLength: Math.round(avgWordLength * 100) / 100
  };
}

/**
 * Extract relevant keywords
 */
function extractKeywords(text: string): Array<{ word: string; relevance: number }> {
  const commonWords = new Set(['the', 'and', 'that', 'have', 'for', 'not', 'you', 'all', 'can',
                               'her', 'was', 'one', 'our', 'out', 'is', 'it', 'his', 'they',
                               'their', 'she', 'with', 'as', 'this', 'but', 'from', 'have']);
  
  const wordCounts: Record<string, number> = {};
  
  // Count word frequencies
  text.split(/\s+/).forEach(word => {
    const cleanWord = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (cleanWord.length > 3 && !commonWords.has(cleanWord)) {
      wordCounts[cleanWord] = (wordCounts[cleanWord] || 0) + 1;
    }
  });
  
  // Sort by frequency
  const sorted = Object.entries(wordCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([word, count]) => ({
      word,
      relevance: Math.min(count / 5, 1)
    }));
  
  return sorted;
}

/**
 * Track mood over time
 */
function trackMood(report: TextMoodReport): void {
  moodHistory.push({
    timestamp: new Date(),
    report
  });
  
  // Update daily average
  const dateKey = new Date().toISOString().split('T')[0];
  
  const existing = dailyAverages.get(dateKey);
  if (existing) {
    // Merge reports
    const merged = mergeReports(existing, report);
    dailyAverages.set(dateKey, merged);
  } else {
    dailyAverages.set(dateKey, report);
  }
}

/**
 * Merge two mood reports (for averaging)
 */
function mergeReports(a: TextMoodReport, b: TextMoodReport): TextMoodReport {
  // Average sentiment scores
  const averagedSentiment: SentimentAnalysis = {
    score: (a.sentiment.score + b.sentiment.score) / 2,
    label: a.sentiment.label,
    confidence: (a.sentiment.confidence + b.sentiment.confidence) / 2
  };
  
  // Average emotion intensities
  const averagedEmotions: EmotionDetection = {
    primaryEmotion: a.emotions.primaryEmotion,
    secondaryEmotion: a.emotions.secondaryEmotion,
    emotions: {},
    intensity: (a.emotions.intensity + b.emotions.intensity) / 2
  };
  
  // Merge emotion scores
  const allEmotions = new Set([...Object.keys(a.emotions.emotions), ...Object.keys(b.emotions.emotions)]);
  allEmotions.forEach(emotion => {
    averagedEmotions.emotions[emotion] = (
      (a.emotions.emotions[emotion] || 0) + 
      (b.emotions.emotions[emotion] || 0)
    ) / 2;
  });
  
  return {
    sentiment: averagedSentiment,
    emotions: averagedEmotions,
    tone: a.tone,
    readability: {
      complexity: a.readability.complexity,
      avgSentenceLength: (a.readability.avgSentenceLength + b.readability.avgSentenceLength) / 2,
      avgWordLength: (a.readability.avgWordLength + b.readability.avgWordLength) / 2
    },
    keywords: [...new Set([...a.keywords.map(k => k.word), ...b.keywords.map(k => k.word)])]
      .slice(0, 10)
      .map(word => ({ word, relevance: 0.5 }))
  };
}

/**
 * Get mood history
 */
export function getMoodHistory(): Array<{ date: string; sentiment: string; emotion: string }> {
  return moodHistory.map(entry => ({
    date: entry.timestamp.toLocaleDateString(),
    sentiment: entry.report.sentiment.label,
    emotion: entry.report.emotions.primaryEmotion
  }));
}

/**
 * Get today's mood summary
 */
export function getTodayMoodSummary(): TextMoodReport | null {
  const dateKey = new Date().toISOString().split('T')[0];
  return dailyAverages.get(dateKey) || null;
}

/**
 * Clear mood tracking
 */
export function clearMoodHistory(): void {
  moodHistory = [];
  dailyAverages.clear();
}

/**
 * Generate mood chart data for visualization
 */
export function getMoodChartData(days: number = 7): Array<{
  date: string;
  sentiment: number;
  emotion: string;
}> {
  const result: Array<{ date: string; sentiment: number; emotion: string }> = [];
  const today = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];
    
    const dayData = dailyAverages.get(dateKey);
    
    result.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      sentiment: dayData?.sentiment.score ?? 0,
      emotion: dayData?.emotions.primaryEmotion ?? 'neutral'
    });
  }
  
  return result;
}

/**
 * Analyze writing progress impact
 */
export function getWritingImpact(text: string): {
  improvementSuggestion?: string;
  energyLevel: 'low' | 'medium' | 'high';
  focusClarity: 'unclear' | 'moderate' | 'clear';
} {
  const analysis = analyzeText(text);
  
  const energyLevel: 'low' | 'medium' | 'high' = 
    analysis.emotions.intensity > 0.7 ? 'high' :
    analysis.emotions.intensity > 0.4 ? 'medium' : 'low';
  
  const clarity = analysis.readability.complexity === 'simple' ? 'clear' :
                  analysis.readability.complexity === 'moderate' ? 'moderate' : 'unclear';
  
  // Suggest improvements
  let improvementSuggestion: string | undefined;
  
  if (analysis.sentiment.label === 'very-negative') {
    improvementSuggestion = 'Consider reframing negative thoughts with more balanced perspective';
  } else if (clarity === 'unclear') {
    improvementSuggestion = 'Break down complex ideas into simpler sentences for better clarity';
  } else if (energyLevel === 'low') {
    improvementSuggestion = 'Try adding more active verbs and dynamic language';
  }
  
  return {
    improvementSuggestion,
    energyLevel,
    focusClarity: clarity
  };
}
