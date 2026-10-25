'use client';

import { useMemo, useState } from 'react';
import { BarChart3, TrendingUp, Calendar, Trophy, Flame, Target, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format, startOfWeek, endOfWeek, startOfMonth, isSameDay, isToday, addDays, parseISO } from 'date-fns';

interface DailyMetric {
  date: string;
  words: number;
  minutes: number;
}

interface WritingMetricsDashboardProps {
  dailyMetrics: DailyMetric[];
  currentStreak: number;
  totalWords: number;
  longestStreak: number;
  weeklyGoal?: { target: number; completed: number };
  onPeriodChange?: (period: 'daily' | 'weekly' | 'monthly') => void;
}

export function WritingMetricsDashboard({
  dailyMetrics,
  currentStreak,
  totalWords,
  longestStreak,
  weeklyGoal,
  onPeriodChange
}: WritingMetricsDashboardProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  
  const chartData = useMemo(() => {
    return dailyMetrics.slice(-7);
  }, [dailyMetrics]);
  
  const maxWords = Math.max(...chartData.map(d => d.words), 100);
  
  const stats = useMemo(() => ({
    totalWords,
    currentStreak,
    longestStreak,
    averageDaily: Math.round(
      chartData.reduce((sum, d) => sum + d.words, 0) / Math.max(chartData.length, 1)
    ),
    productivityScore: calculateProductivityScore(chartData)
  }), [totalWords, currentStreak, longestStreak, chartData]);
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-primary" />
          Writing Analytics
        </h2>
        
        <div className="flex gap-2">
          {(['daily', 'weekly', 'monthly'] as const).map(period => (
            <Button
              key={period}
              variant={selectedPeriod === period ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setSelectedPeriod(period);
                onPeriodChange?.(period);
              }}
            >
              {period.charAt(0).toUpperCase() + period.slice(1)}
            </Button>
          ))}
        </div>
      </div>
      
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Total Words"
          value={formatNumber(totalWords)}
          icon={<Target className="w-5 h-5" />}
          trend="+12%"
          trendUp={true}
        />
        
        <MetricCard
          title="Current Streak"
          value={`${currentStreak} days`}
          icon={<Flame className="w-5 h-5" />}
          subtitle={`Longest: ${longestStreak}`}
          colorClass="text-orange-500"
        />
        
        <MetricCard
          title="Avg/Day"
          value={`${stats.averageDaily} words`}
          icon={<Calendar className="w-5 h-5" />}
          trend="+5%"
          trendUp={true}
        />
        
        <MetricCard
          title="Productivity"
          value={`${stats.productivityScore}/100`}
          icon={<TrendingUp className="w-5 h-5" />}
          colorClass="text-green-500"
        />
      </div>
      
      {/* Weekly Progress & Goals */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Chart Section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Weekly Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart chartData={chartData} maxWords={maxWords} />
            
            {/* Goal Progress if available */}
            {weeklyGoal && (
              <div className="mt-6 p-4 bg-muted rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Weekly Goal</span>
                  <span className="text-sm text-muted-foreground">
                    {weeklyGoal.completed}/{weeklyGoal.target} words
                  </span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.min((weeklyGoal.completed / weeklyGoal.target) * 100, 100)}%` }}
                  />
                </div>
                
                {weeklyGoal.completed >= weeklyGoal.target && (
                  <Badge variant="default" className="mt-3">
                    🎉 Goal Completed!
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Achievement Preview */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              Recent Achievements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {currentStreak >= 7 && (
                <AchievementItem
                  icon="🔥"
                  title="Week of Writing"
                  description="7-day streak maintained"
                  unlocked={true}
                />
              )}
              
              {totalWords >= 1000 && (
                <AchievementItem
                  icon="💪"
                  title="Centurion"
                  description="1,000+ words written"
                  unlocked={true}
                />
              )}
              
              {totalWords >= 10000 && (
                <AchievementItem
                  icon="📝"
                  title="Thousand Words"
                  description="10,000+ words total"
                  unlocked={true}
                />
              )}
              
              {currentStreak > 0 && totalWords < 1000 && (
                <AchievementItem
                  icon="🎯"
                  title="First Steps"
                  description="Start your journey"
                  unlocked={false}
                />
              )}
              
              {totalWords === 0 && (
                <EmptyState />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Helper Components

function MetricCard({
  title,
  value,
  icon,
  trend,
  trendUp,
  subtitle,
  colorClass
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  trend?: string;
  trendUp?: boolean;
  subtitle?: string;
  colorClass?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          
          <div className={`p-2 rounded-lg bg-muted ${colorClass}`}>
            {icon}
          </div>
        </div>
        
        {trend && (
          <div className={`flex items-center gap-1 mt-3 text-xs ${trendUp ? 'text-green-500' : 'text-red-500'}`}>
            <TrendingUp className={`w-3 h-3 ${!trendUp && 'rotate-180'}`} />
            <span>{trend}</span>
            <span className="text-muted-foreground">vs last period</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BarChart({ chartData, maxWords }: { chartData: DailyMetric[]; maxWords: number }) {
  return (
    <div className="space-y-2">
      {chartData.map((day, index) => (
        <div key={index} className="flex items-center gap-3">
          <div className="w-16 text-xs text-muted-foreground">
            {isToday(parseISO(day.date)) ? 'Today' : format(parseISO(day.date), 'MMM d')}
          </div>
          
          <div className="flex-1 h-8 bg-secondary rounded-md relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-primary rounded-md transition-all duration-500"
              style={{ width: `${(day.words / maxWords) * 100}%` }}
            />
            
            {/* Word count label */}
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-white">
              {day.words.toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AchievementItem({
  icon,
  title,
  description,
  unlocked
}: {
  icon: string;
  title: string;
  description: string;
  unlocked: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${
      unlocked 
        ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900'
        : 'bg-gray-50 dark:bg-gray-900/50 border-dashed'
    }`}>
      <div className="text-2xl">{icon}</div>
      
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-sm">{title}</h4>
          {!unlocked && (
            <Badge variant="outline" className="text-xs">Locked</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      
      {unlocked && (
        <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-8">
      <Trophy className="w-12 h-12 mx-auto text-muted-foreground/30 mb-2" />
      <p className="text-sm text-muted-foreground">
        Start writing to unlock achievements!
      </p>
    </div>
  );
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

function calculateProductivityScore(metrics: DailyMetric[]): number {
  if (metrics.length === 0) return 0;
  
  const avgWordsPerDay = metrics.reduce((sum, m) => sum + m.words, 0) / metrics.length;
  const avgMinutesPerDay = metrics.reduce((sum, m) => sum + m.minutes, 0) / metrics.length;
  
  // Score factors:
  // 1. Consistency (days written vs total days)
  const consistency = Math.min((metrics.filter(m => m.words > 0).length / metrics.length) * 100, 100);
  
  // 2. Productivity (words per minute efficiency)
  const efficiency = Math.min((avgWordsPerDay / avgMinutesPerDay) * 10, 50); // Max 50 points
  
  // 3. Volume bonus (up to 30 points for high word counts)
  const volumeBonus = Math.min(avgWordsPerDay / 100, 30);
  
  return Math.min(Math.round(consistency * 0.3 + efficiency * 0.4 + volumeBonus), 100);
}
