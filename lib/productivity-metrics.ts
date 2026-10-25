/**
 * Productivity Analytics Dashboard
 * Track writing streaks, goals, achievements, and progress over time
 */

export interface DailyStats {
  date: string;
  wordCount: number;
  characterCount: number;
  sessionDuration: number; // seconds
  paragraphsWritten: number;
  averageWordsPerMinute?: number;
}

export interface WritingGoal {
  id: string;
  title: string;
  target: number; // words per day/week/month
  period: 'daily' | 'weekly' | 'monthly';
  startDate: Date;
  endDate?: Date;
  streakDays: number;
  completedDays: string[]; // ISO date strings
  notificationsEnabled: boolean;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlockedAt?: Date;
  isUnlocked: boolean;
  category: 'writing' | 'consistency' | 'productivity' | 'milestone';
}

export interface ProductivityMetrics {
  currentStreak: number;
  longestStreak: number;
  totalWordsWritten: number;
  totalSessions: number;
  totalTimeSpent: number; // seconds
  averageSessionLength: number;
  recentActivity: DailyStats[];
  weeklyProgress: WeeklyProgress;
  monthlyTrends: MonthlyTrend[];
}

export interface WeeklyProgress {
  weekStart: Date;
  dailyTargets: Array<{
    day: string;
    targetReached: boolean;
    wordCount: number;
  }>;
}

export interface MonthlyTrend {
  month: string;
  totalWords: number;
  sessions: number;
  avgWordsPerDay: number;
}

const GOALS_STORAGE_KEY = 'draftwise_writing_goals';
const STREAKS_STORAGE_KEY = 'draftwise_streaks';
const METRICS_STORAGE_KEY = 'draftwise_productivity_metrics';
const ACHIEVEMENTS_STORAGE_KEY = 'draftwise_achievements';

/**
 * Initialize default goals
 */
export function getDefaultGoals(): WritingGoal[] {
  const today = new Date();
  return [
    {
      id: 'daily-writing',
      title: 'Daily Writing Goal',
      target: 500,
      period: 'daily',
      startDate: today,
      streakDays: 0,
      completedDays: [],
      notificationsEnabled: true
    },
    {
      id: 'weekly-creative',
      title: 'Weekly Creative Writing',
      target: 2000,
      period: 'weekly',
      startDate: today,
      streakDays: 0,
      completedDays: [],
      notificationsEnabled: false
    }
  ];
}

/**
 * Calculate writing streak based on last activity
 */
export function calculateStreak(lastActiveDates: string[]): number {
  if (lastActiveDates.length === 0) return 0;
  
  const sortedDates = [...lastActiveDates].sort().reverse();
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  // Check if user was active yesterday or today
  const mostRecent = sortedDates[0];
  if (mostRecent !== today && mostRecent !== yesterday) {
    return 0;
  }
  
  let streak = 1;
  let expectedDate = mostRecent === today ? yesterday : subtractDays(yesterday, 1);
  
  for (let i = 1; i < sortedDates.length; i++) {
    if (sortedDates[i] === expectedDate) {
      streak++;
      expectedDate = subtractDays(expectedDate, 1);
    } else if (i > 0) {
      break;
    }
  }
  
  return streak;
}

function subtractDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

/**
 * Get all predefined achievements
 */
export function getAllAchievements(): Achievement[] {
  return [
    // Writing milestones
    {
      id: 'first-words',
      name: 'First Steps',
      description: 'Write your first 100 words',
      icon: '🎯',
      isUnlocked: false,
      category: 'writing'
    },
    {
      id: 'centurion',
      name: 'Centurion',
      description: 'Reach 1,000 words written',
      icon: '💪',
      isUnlocked: false,
      category: 'writing'
    },
    {
      id: 'thousand-writer',
      name: 'Thousand Words',
      description: 'Write 10,000 words total',
      icon: '📝',
      isUnlocked: false,
      category: 'writing'
    },
    
    // Consistency badges
    {
      id: 'seven-day-streak',
      name: 'Week of Writing',
      description: 'Maintain a 7-day streak',
      icon: '🔥',
      isUnlocked: false,
      category: 'consistency'
    },
    {
      id: 'thirty-day-warrior',
      name: 'Monthly Warrior',
      description: 'Maintain a 30-day streak',
      icon: '⚡',
      isUnlocked: false,
      category: 'consistency'
    },
    {
      id: 'zen-master',
      name: 'Zen Master',
      description: 'Complete 100 writing sessions',
      icon: '🧘',
      isUnlocked: false,
      category: 'consistency'
    },
    
    // Productivity
    {
      id: 'morning-person',
      name: 'Morning Person',
      description: 'Write before 9 AM on 5 different days',
      icon: '🌅',
      isUnlocked: false,
      category: 'productivity'
    },
    {
      id: 'night-owl',
      name: 'Night Owl',
      description: 'Write after midnight on 5 different days',
      icon: '🦉',
      isUnlocked: false,
      category: 'productivity'
    },
    {
      id: 'speed-demon',
      name: 'Speed Demon',
      description: 'Average 100+ words per minute in one session',
      icon: '🚀',
      isUnlocked: false,
      category: 'productivity'
    },
    
    // Milestones
    {
      id: 'year-one',
      name: 'One Year Writer',
      description: 'Write consistently for one year',
      icon: '🏆',
      isUnlocked: false,
      category: 'milestone'
    },
    {
      id: 'word-voyager',
      name: 'Word Voyager',
      description: 'Write 100,000 words total',
      icon: '🌍',
      isUnlocked: false,
      category: 'milestone'
    }
  ];
}

/**
 * Save daily statistics
 */
export function saveDailyStats(stats: DailyStats): void {
  const existing = getMetrics();
  const existingIndex = existing.recentActivity.findIndex(s => s.date === stats.date);
  
  if (existingIndex >= 0) {
    existing.recentActivity[existingIndex] = stats;
  } else {
    existing.recentActivity.push(stats);
  }
  
  // Update totals
  existing.totalWordsWritten += stats.wordCount;
  existing.totalSessions += 1;
  existing.totalTimeSpent += stats.sessionDuration;
  existing.averageSessionLength = existing.totalTimeSpent / existing.totalSessions;
  
  // Recalculate streak
  const dates = existing.recentActivity.map(s => s.date);
  existing.currentStreak = calculateStreak(dates);
  existing.longestStreak = Math.max(existing.longestStreak, existing.currentStreak);
  
  localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify(existing));
}

/**
 * Get current productivity metrics
 */
export function getMetrics(): ProductivityMetrics {
  const stored = localStorage.getItem(METRICS_STORAGE_KEY);
  
  if (!stored) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      totalWordsWritten: 0,
      totalSessions: 0,
      totalTimeSpent: 0,
      averageSessionLength: 0,
      recentActivity: [],
      weeklyProgress: {
        weekStart: new Date(),
        dailyTargets: []
      },
      monthlyTrends: []
    };
  }
  
  return JSON.parse(stored);
}

/**
 * Update goal completion for today
 */
export function updateGoalCompletion(goalId: string, wordCount: number): void {
  const goals = getGoals();
  const goal = goals.find(g => g.id === goalId);
  
  if (!goal) return;
  
  const today = new Date().toISOString().split('T')[0];
  const alreadyCompleted = goal.completedDays.includes(today);
  
  if (alreadyCompleted) return;
  
  // Check if target reached
  if (wordCount >= goal.target) {
    goal.completedDays.push(today);
    goal.streakDays++;
  }
  
  saveGoals(goals);
  
  // Check for related achievements
  checkAchievementCompletion(wordCount, goal.streakDays);
}

/**
 * Get user's goals
 */
export function getGoals(): WritingGoal[] {
  const stored = localStorage.getItem(GOALS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : getDefaultGoals();
}

/**
 * Save updated goals
 */
export function saveGoals(goals: WritingGoal[]): void {
  localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
}

/**
 * Reset goals (e.g., weekly reset)
 */
export function resetWeeklyGoals(): void {
  const goals = getGoals();
  const resetGoals = goals.map(goal => {
    if (goal.period === 'weekly') {
      return {
        ...goal,
        streakDays: 0,
        completedDays: [],
        startDate: new Date()
      };
    }
    return goal;
  });
  saveGoals(resetGoals);
}

/**
 * Check and unlock achievements based on metrics
 */
function checkAchievementCompletion(totalWords: number, streak: number): void {
  const achievements = getAchievements();
  const unlockedAchievements = achievements.filter(a => a.isUnlocked).map(a => a.id);
  
  // First-time milestones
  if (totalWords >= 100 && !unlockedAchievements.includes('first-words')) {
    unlockAchievement('first-words');
  }
  if (totalWords >= 1000 && !unlockedAchievements.includes('centurion')) {
    unlockAchievement('centurion');
  }
  if (totalWords >= 10000 && !unlockedAchievements.includes('thousand-writer')) {
    unlockAchievement('thousand-writer');
  }
  
  // Streak milestones
  if (streak >= 7 && !unlockedAchievements.includes('seven-day-streak')) {
    unlockAchievement('seven-day-streak');
  }
  if (streak >= 30 && !unlockedAchievements.includes('thirty-day-warrior')) {
    unlockAchievement('thirty-day-warrior');
  }
  
  // Session milestones
  const metrics = getMetrics();
  if (metrics.totalSessions >= 100 && !unlockedAchievements.includes('zen-master')) {
    unlockAchievement('zen-master');
  }
}

/**
 * Unlock specific achievement
 */
function unlockAchievement(id: string): void {
  const achievements = getAchievements();
  const achievement = achievements.find(a => a.id === id);
  
  if (achievement) {
    achievement.isUnlocked = true;
    achievement.isUnlocked = true;
    achievement.unlockedAt = new Date();
    saveAchievements(achievements);
  }
}

/**
 * Get user's achievements
 */
export function getAchievements(): Achievement[] {
  const stored = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : getAllAchievements();
}

/**
 * Save achievements state
 */
export function saveAchievements(achievements: Achievement[]): void {
  localStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(achievements));
}

/**
 * Progress bar percentage for goals
 */
export function getGoalProgress(goal: WritingGoal, currentWords: number): number {
  return Math.min((currentWords / goal.target) * 100, 100);
}

/**
 * Generate weekly report summary
 */
export function generateWeeklyReport(): {
  totalWords: number;
  daysActive: number;
  averageWordsPerDay: number;
  bestDay: DailyStats | null;
  consistencyRate: number;
} {
  const metrics = getMetrics();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  
  const recent = metrics.recentActivity.filter(stat => 
    new Date(stat.date) >= sevenDaysAgo
  );
  
  const totalWords = recent.reduce((sum, stat) => sum + stat.wordCount, 0);
  const daysActive = recent.length;
  const averageWordsPerDay = totalWords / Math.max(daysActive, 1);
  const bestDay = recent.reduce((best, current) => 
    current.wordCount > best.wordCount ? current : best
  , recent[0] || null);
  
  const consistencyRate = (daysActive / 7) * 100;
  
  return {
    totalWords,
    daysActive,
    averageWordsPerDay,
    bestDay,
    consistencyRate
  };
}
