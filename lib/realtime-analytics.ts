/**
 * Real-Time Writing Analytics Dashboard
 * Live metrics during the writing process
 */

export interface LiveMetrics {
  currentWordCount: number;
  currentCharCount: number;
  sentencesCount: number;
  paragraphsCount: number;
  averageWordsPerSentence: number;
  readingTimeMinutes: number;
  writingSpeedWPM: number; // words per minute (current session)
  typingSpeedCPM: number; // characters per minute
  lastUpdateTime: Date;
}

export interface HourlyStats {
  hour: number; // 0-23
  wordsWritten: number;
  sessionsCount: number;
  avgSessionDuration: number;
}

export interface DailyProgress {
  date: string;
  targetReached: boolean;
  targetWords: number;
  actualWords: number;
  percentage: number;
  qualityScore: number; // 0-100
}

export interface WritingPattern {
  mostProductiveHour: number;
  leastProductiveHour: number;
  averageSessionLength: number;
  bestDayOfWeek: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  streakDays: number;
  totalSessions: number;
  totalTimeSpent: number; // seconds
}

interface AnalyticsState {
  liveMetrics: LiveMetrics | null;
  hourlyStats: Record<number, HourlyStats>;
  dailyProgress: DailyProgress[];
  writingPattern: WritingPattern;
  sessionStartTime: Date | null;
  lastText: string;
  wordHistory: number[]; // Last 60 data points
}

let state: AnalyticsState = {
  liveMetrics: null,
  hourlyStats: {},
  dailyProgress: [],
  writingPattern: {
    mostProductiveHour: 14, // Default 2 PM
    leastProductiveHour: 6, // Default 6 AM
    averageSessionLength: 45, // minutes
    bestDayOfWeek: 'Wednesday',
    streakDays: 0,
    totalSessions: 0,
    totalTimeSpent: 0
  },
  sessionStartTime: null,
  lastText: '',
  wordHistory: []
};

const DAILY_TARGET_DEFAULT = 1000;

/**
 * Initialize analytics system
 */
export function initializeAnalytics(): void {
  // Load from localStorage
  const saved = localStorage.getItem('draftwise_analytics');
  
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state = { ...state, ...parsed };
      console.log(`📊 Analytics loaded: ${state.totalSessions} sessions tracked`);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    }
  }
  
  // Start session tracking
  startNewSession();
}

/**
 * Update metrics based on current text
 */
export function updateMetrics(text: string): LiveMetrics {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const chars = text.length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  const avgWordsPerSentence = sentences.length > 0 
    ? words.length / sentences.length 
    : 0;
  
  const readingTime = Math.ceil(words.length / 200); // 200 WPM
  
  // Calculate writing speed
  let wpm = 0;
  let cpm = 0;
  
  if (state.sessionStartTime) {
    const elapsedMinutes = (Date.now() - state.sessionStartTime.getTime()) / 60000;
    if (elapsedMinutes > 0) {
      wpm = Math.round(words.length / elapsedMinutes);
      cpm = Math.round(chars / elapsedMinutes);
    }
  }
  
  const liveMetrics: LiveMetrics = {
    currentWordCount: words.length,
    currentCharCount: chars,
    sentencesCount: sentences.length,
    paragraphsCount: paragraphs.length,
    averageWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
    readingTimeMinutes: readingTime,
    writingSpeedWPM: wpm,
    typingSpeedCPM: cpm,
    lastUpdateTime: new Date()
  };
  
  state.liveMetrics = liveMetrics;
  state.lastText = text;
  
  // Update word history for trends
  state.wordHistory.push(words.length);
  if (state.wordHistory.length > 60) {
    state.wordHistory.shift();
  }
  
  // Update hourly stats
  updateHourlyStats(words.length);
  
  // Save state
  saveState();
  
  window.dispatchEvent(new CustomEvent('metrics-updated', { detail: liveMetrics }));
  
  return liveMetrics;
}

/**
 * Start a new writing session
 */
export function startNewSession(): void {
  state.sessionStartTime = new Date();
  
  state.writingPattern.totalSessions++;
  
  window.dispatchEvent(new CustomEvent('session-started', {
    detail: { startTime: state.sessionStartTime }
  }));
}

/**
 * End current session
 */
export function endSession(): void {
  if (!state.sessionStartTime || !state.liveMetrics) {
    return;
  }
  
  const sessionDuration = (Date.now() - state.sessionStartTime.getTime()) / 1000 / 60; // minutes
  
  state.writingPattern.totalTimeSpent += sessionDuration;
  state.writingPattern.averageSessionLength = 
    (state.writingPattern.totalTimeSpent / state.writingPattern.totalSessions);
  
  // Update daily progress
  const today = new Date().toISOString().split('T')[0];
  const todayProgress = state.dailyProgress.find(d => d.date === today);
  
  if (todayProgress) {
    todayProgress.actualWords = state.liveMetrics.currentWordCount;
    todayProgress.percentage = (state.liveMetrics.currentWordCount / todayProgress.targetWords) * 100;
    todayProgress.targetReached = todayProgress.percentage >= 100;
    
    // Calculate quality score
    todayProgress.qualityScore = calculateQualityScore(state.lastText);
  } else {
    state.dailyProgress.push({
      date: today,
      targetReached: false,
      targetWords: DAILY_TARGET_DEFAULT,
      actualWords: state.liveMetrics.currentWordCount,
      percentage: (state.liveMetrics.currentWordCount / DAILY_TARGET_DEFAULT) * 100,
      qualityScore: 0
    });
  }
  
  state.sessionStartTime = null;
  saveState();
  
  window.dispatchEvent(new CustomEvent('session-ended', {
    detail: { duration: sessionDuration }
  }));
}

/**
 * Get current live metrics
 */
export function getLiveMetrics(): LiveMetrics | null {
  return state.liveMetrics ? { ...state.liveMetrics } : null;
}

/**
 * Get hourly statistics
 */
export function getHourlyStats(): Array<{ hour: number; words: number; label: string }> {
  return Object.entries(state.hourlyStats)
    .map(([hour, stats]) => ({
      hour: parseInt(hour),
      words: stats.wordsWritten,
      label: `${String(stats.hour).padStart(2, '0')}:00`
    }))
    .sort((a, b) => a.hour - b.hour);
}

/**
 * Get daily progress history
 */
export function getDailyProgress(days: number = 7): DailyProgress[] {
  return state.dailyProgress.slice(-days);
}

/**
 * Get writing patterns analysis
 */
export function getWritingPatterns(): WritingPattern {
  return { ...state.writingPattern };
}

/**
 * Export all analytics as JSON
 */
export function exportAnalytics(): string {
  return JSON.stringify({
    liveMetrics: state.liveMetrics,
    hourlyStats: state.hourlyStats,
    dailyProgress: state.dailyProgress,
    writingPattern: state.writingPattern,
    exportedAt: new Date().toISOString()
  }, null, 2);
}

/**
 * Import analytics from JSON
 */
export function importAnalytics(json: string): void {
  try {
    const imported = JSON.parse(json);
    state = { ...state, ...imported };
    saveState();
    console.log('✅ Analytics imported successfully');
  } catch (error) {
    console.error('Failed to import analytics:', error);
  }
}

/**
 * Clear all analytics data
 */
export function clearAllData(): void {
  localStorage.removeItem('draftwise_analytics');
  state = {
    liveMetrics: null,
    hourlyStats: {},
    dailyProgress: [],
    writingPattern: {
      mostProductiveHour: 14,
      leastProductiveHour: 6,
      averageSessionLength: 45,
      bestDayOfWeek: 'Wednesday',
      streakDays: 0,
      totalSessions: 0,
      totalTimeSpent: 0
    },
    sessionStartTime: null,
    lastText: '',
    wordHistory: []
  };
  console.log('🧹 All analytics cleared');
}

// Helper Functions

function updateHourlyStats(wordsAdded: number): void {
  const hour = new Date().getHours();
  
  if (!state.hourlyStats[hour]) {
    state.hourlyStats[hour] = {
      hour,
      wordsWritten: 0,
      sessionsCount: 0,
      avgSessionDuration: 0
    };
  }
  
  state.hourlyStats[hour].wordsWritten += wordsAdded;
  state.hourlyStats[hour].sessionsCount++;
  
  // Recalculate productive hours
  recalculateProductiveHours();
}

function recalculateProductiveHours(): void {
  const hours = Object.values(state.hourlyStats);
  
  if (hours.length === 0) return;
  
  const maxWords = Math.max(...hours.map(h => h.wordsWritten));
  const minWords = Math.min(...hours.map(h => h.wordsWritten));
  
  const maxIndex = hours.findIndex(h => h.wordsWritten === maxWords);
  const minIndex = hours.findIndex(h => h.wordsWritten === minWords);
  
  if (maxIndex !== -1 && minIndex !== -1) {
    state.writingPattern.mostProductiveHour = hours[maxIndex].hour;
    state.writingPattern.leastProductiveHour = hours[minIndex].hour;
  }
}

function calculateQualityScore(text: string): number {
  // Simplified quality calculation
  const readabilityScore = calculateReadability(text);
  const grammarScore = estimateGrammarScore(text);
  const structureScore = estimateStructureScore(text);
  
  return Math.round((readabilityScore * 0.4 + grammarScore * 0.3 + structureScore * 0.3));
}

function calculateReadability(text: string): number {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  
  if (sentences.length === 0) return 0;
  
  const avgSentenceLength = words.length / sentences.length;
  
  // Simple scoring: optimal is 15-20 words per sentence
  if (avgSentenceLength >= 10 && avgSentenceLength <= 25) {
    return 80;
  } else if (avgSentenceLength < 10) {
    return Math.max(40, 80 - (10 - avgSentenceLength) * 4);
  } else {
    return Math.max(40, 80 - (avgSentenceLength - 25) * 2);
  }
}

function estimateGrammarScore(text: string): number {
  // Basic heuristic: check for common issues
  let issues = 0;
  
  // Double spaces
  if (/\s{2,}/.test(text)) issues++;
  
  // Missing space after punctuation
  if (/[.!?][a-z]/.test(text)) issues++;
  
  // Excessive capitalization
  const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
  if (capsRatio > 0.3) issues++;
  
  // Return score (fewer issues = higher score)
  return Math.max(50, 100 - issues * 15);
}

function estimateStructureScore(text: string): number {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  // Penalize single paragraph too long
  if (paragraphs.length === 1 && paragraphs[0].length > 2000) {
    return 50;
  }
  
  // Reward multiple paragraphs
  if (paragraphs.length >= 3) {
    return 90;
  }
  
  return Math.min(100, paragraphs.length * 40);
}

function saveState(): void {
  try {
    localStorage.setItem('draftwise_analytics', JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save analytics:', error);
  }
}

/**
 * Set daily target
 */
export function setDailyTarget(target: number): void {
  const today = new Date().toISOString().split('T')[0];
  const todayProgress = state.dailyProgress.find(d => d.date === today);
  
  if (todayProgress) {
    todayProgress.targetWords = target;
  } else {
    state.dailyProgress.push({
      date: today,
      targetWords: target,
      actualWords: 0,
      targetReached: false,
      percentage: 0,
      qualityScore: 0
    });
  }
  
  saveState();
}

/**
 * Get achievement status
 */
export function getAchievements(): Array<{
  id: string;
  name: string;
  unlocked: boolean;
  description: string;
}> {
  const achievements: Array<{
    id: string;
    name: string;
    unlocked: boolean;
    description: string;
  }> = [
    {
      id: 'first-words',
      name: 'First Steps',
      unlocked: state.liveMetrics?.currentWordCount >= 100 || false,
      description: 'Write your first 100 words'
    },
    {
      id: 'centurion',
      name: 'Centurion',
      unlocked: state.writingPattern.totalTimeSpent >= 1000,
      description: 'Write 1,000+ words in one session'
    },
    {
      id: 'speed-demon',
      name: 'Speed Demon',
      unlocked: state.liveMetrics?.writingSpeedWPM >= 100 || false,
      description: 'Type at 100+ WPM'
    },
    {
      id: 'consistent',
      name: 'Consistent Writer',
      unlocked: state.dailyProgress.filter(d => d.targetReached).length >= 7,
      description: 'Meet your goal for 7 consecutive days'
    },
    {
      id: 'marathon',
      name: 'Marathon Writer',
      unlocked: state.writingPattern.totalSessions >= 100,
      description: 'Complete 100 writing sessions'
    }
  ];
  
  return achievements;
}
