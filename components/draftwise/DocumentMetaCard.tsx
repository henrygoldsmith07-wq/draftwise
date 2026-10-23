"use client";

import { FileText, Clock, Tag, Target, Sparkles } from "lucide-react";
import { countWords } from "@/lib/writing-activity";
import type { WritingGoals, Dialect } from "@/packages/types/src";

interface DocumentMetaCardProps {
  title: string;
  wordCount: number;
  goals?: WritingGoals | null;
  dialect?: Dialect | null;
  updatedAt?: Date;
}

export function DocumentMetaCard({ 
  title, 
  wordCount, 
  goals,
  dialect,
  updatedAt
}: DocumentMetaCardProps) {
  const getWordCountColor = (count: number) => {
    if (count === 0) return 'text-muted';
    if (count < 100) return 'text-primary';
    if (count < 500) return 'text-warning';
    if (count < 1000) return 'text-destructive';
    return 'text-success';
  };
  
  const getWordCountLabel = (count: number) => {
    if (count === 0) return "Blank";
    if (count < 50) return "Quick thought";
    if (count < 200) return "Short piece";
    if (count < 500) return "Medium length";
    if (count < 1000) return "Long form";
    return "Essay or article";
  };
  
  const formatDate = (date?: Date) => {
    if (!date) return "Never";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  };
  
  const formatDialect = (dialect?: Dialect) => {
    if (!dialect) return null;
    return dialect === "en-GB" ? "British English" : "American English";
  };

  return (
    <div className="bg-card border rounded-lg p-4">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <FileText size={16} />
        Document Info
      </h3>
      
      <div className="space-y-3">
        {/* Title */}
        <div className="flex items-start gap-2">
          <span className="text-muted-foreground text-xs mt-1">Title:</span>
          <span className={`font-medium truncate ${!title ? "italic text-muted" : ""}`}>
            {title || "Untitled"}
          </span>
        </div>
        
        {/* Word Count */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="text-muted-foreground" size={14} />
            <div>
              <p className={`text-lg font-bold ${getWordCountColor(wordCount)}`}>
                {wordCount.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">{getWordCountLabel(wordCount)}</p>
            </div>
          </div>
          
          {/* Progress indicator */}
          <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all ${
                wordCount < 100 ? 'bg-primary' : 
                wordCount < 500 ? 'bg-warning' : 
                wordCount < 1000 ? 'bg-destructive' : 'bg-success'
              }`}
              style={{ width: `${Math.min((wordCount / 1000) * 100, 100)}%` }}
            />
          </div>
        </div>
        
        {/* Last Updated */}
        <div className="flex items-center gap-2">
          <Clock className="text-muted-foreground" size={14} />
          <span className="text-xs text-muted-foreground">
            Updated: {formatDate(updatedAt)}
          </span>
        </div>
        
        {/* Writing Goals */}
        {(goals?.audience || goals?.intent || goals?.tone) && (
          <div className="pt-2 border-t space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <Target className="text-muted-foreground" size={14} />
              <span className="font-medium">Writing Goals:</span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 pl-4">
              {goals.audience && (
                <div className="flex items-start gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                  <span className="text-xs">
                    <strong>For:</strong> {goals.audience}
                  </span>
                </div>
              )}
              
              {goals.intent && (
                <div className="flex items-start gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                  <span className="text-xs">
                    <strong>Purpose:</strong> {goals.intent}
                  </span>
                </div>
              )}
              
              {goals.tone && (
                <div className="flex items-start gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />
                  <span className="text-xs col-span-2">
                    <strong>Tone:</strong> {goals.tone}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Dialect */}
        {dialect && (
          <div className="pt-2 border-t flex items-center gap-2 text-xs">
            <Sparkles className="text-muted-foreground" size={14} />
            <span>Dialect: <strong>{formatDialect(dialect)}</strong></span>
          </div>
        )}
      </div>
    </div>
  );
}
