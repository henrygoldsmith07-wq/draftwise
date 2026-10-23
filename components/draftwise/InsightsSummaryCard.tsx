"use client";

import { Brain, Target, MessageSquare, FileCheck } from "lucide-react";
import { countWords } from "@/lib/writing-activity";
import type { DocumentReview } from "@/lib/documents";

interface InsightsSummaryCardProps {
  wordCount: number;
  review?: DocumentReview | null;
  className?: string;
}

export function InsightsSummaryCard({ 
  wordCount, 
  review,
  className = "" 
}: InsightsSummaryCardProps) {
  const suggestionsCount = review?.worthMaking || 0;
  const criticalIssues = review?.fixFirst || 0;
  
  const getWordStatus = () => {
    if (wordCount === 0) return { text: "Blank canvas", color: "text-muted" };
    if (wordCount < 100) return { text: "Getting started", color: "text-primary" };
    if (wordCount < 500) return { text: "Building momentum", color: "text-success" };
    if (wordCount < 1000) return { text: "On fire!", color: "text-destructive" };
    return { text: "Pro writer", color: "text-primary" };
  };
  
  const status = getWordStatus();
  
  return (
    <div className={`bg-card rounded-lg border p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Writing Insights</h3>
        <Brain className="text-muted-foreground" size={16} />
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        {/* Word Count */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileCheck size={14} />
            <span className="text-xs">Words</span>
          </div>
          <p className="text-xl font-bold">{wordCount.toLocaleString()}</p>
          <p className={`text-xs ${status.color}`} title={status.text}>
            {status.text}
          </p>
        </div>
        
        {/* Suggestions */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MessageSquare size={14} />
            <span className="text-xs">Suggestions</span>
          </div>
          <p className={`text-xl font-bold ${suggestionsCount > 0 ? 'text-warning' : 'text-success'}`}>
            {suggestionsCount}
          </p>
          <p className="text-xs text-muted-foreground">
            {suggestionsCount === 0 ? "Looking good!" : `${suggestionsCount} to refine`}
          </p>
        </div>
        
        {/* Critical Issues */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Target size={14} />
            <span className="text-xs">Priority</span>
          </div>
          <p className={`text-xl font-bold ${criticalIssues > 0 ? 'text-destructive' : 'text-success'}`}>
            {criticalIssues}
          </p>
          <p className="text-xs text-muted-foreground">
            {criticalIssues === 0 ? "No priorities" : `Action needed`}
          </p>
        </div>
        
        {/* Writing Goals */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <FileCheck size={14} />
            <span className="text-xs">Focus</span>
          </div>
          <p className="text-lg font-semibold truncate">
            {wordCount > 0 ? "Active" : "Ready"}
          </p>
          <p className="text-xs text-muted-foreground">
            {wordCount > 0 ? "Document open" : "Start writing"}
          </p>
        </div>
      </div>
      
      {/* Quick Stats Bar */}
      {wordCount > 0 && (
        <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
          <span>AI Analysis Ready</span>
          <span className="inline-flex items-center gap-1">
            <Brain size={10} />
            Smart insights
          </span>
        </div>
      )}
    </div>
  );
}
