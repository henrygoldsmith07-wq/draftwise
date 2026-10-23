/**
 * Privacy-respecting usage tracking.
 * All data stored locally, never sent anywhere.
 * Helps understand usage patterns without compromising privacy.
 */

const STORAGE_KEY = "draftwise_usage_stats";

export interface UsageStats {
  documentCount: number;
  totalWordsWritten: number;
  lastActiveDate: string;
  suggestionsAccepted: number;
  suggestionsDismissed: number;
  documentsExported: number;
  writingSessions: number;
  currentSessionStart?: string;
}

export const DEFAULT_STATS: UsageStats = {
  documentCount: 0,
  totalWordsWritten: 0,
  lastActiveDate: new Date().toISOString(),
  suggestionsAccepted: 0,
  suggestionsDismissed: 0,
  documentsExported: 0,
  writingSessions: 0,
};

export function getUsageStats(): UsageStats {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_STATS, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.warn("Failed to read usage stats:", error);
  }
  return DEFAULT_STATS;
}

export function updateUsageStats(updates: Partial<UsageStats>): UsageStats {
  const current = getUsageStats();
  const updated = { ...current, ...updates };
  
  // Track session duration
  if (updates.writingSessions) {
    updated.currentSessionStart = new Date().toISOString();
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export function getSessionDuration(): number | null {
  const stats = getUsageStats();
  if (!stats.currentSessionStart) return null;
  
  const start = new Date(stats.currentSessionStart).getTime();
  const now = Date.now();
  const minutes = Math.floor((now - start) / 60000);
  
  return minutes > 0 ? minutes : null;
}

export function resetUsageStats(): void {
  localStorage.removeItem(STORAGE_KEY);
}
