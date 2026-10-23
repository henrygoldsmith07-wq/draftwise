"use client";

import { FilePlus2, BookOpen, MessageSquare, Target } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyDocumentStateProps {
  onNewDocument: () => void;
  onLoadSample: () => void;
}

export function EmptyDocumentState({ onNewDocument, onLoadSample }: EmptyDocumentStateProps) {
  return (
    <div className="empty-state animate-fade-in-scale">
      <div className="empty-state-icon" aria-hidden="true">
        <BookOpen size={48} />
      </div>
      <h3>Start writing your story</h3>
      <p>Create a blank document or explore sample text to see how Draftwise helps you write with confidence.</p>
      <div className="flex gap-3 justify-center flex-wrap mt-6">
        <Button onClick={onNewDocument}>
          <FilePlus2 size={14} className="mr-2" />
          New Document
        </Button>
        <Button variant="outline" onClick={onLoadSample}>
          <BookOpen size={14} className="mr-2" />
          Try Sample
        </Button>
      </div>
      
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-xl mx-auto">
        <div className="text-center p-4 bg-secondary/50 rounded-lg">
          <MessageSquare className="mx-auto mb-2 text-muted-foreground" size={20} />
          <p className="text-sm font-medium">Real-time feedback</p>
          <p className="text-xs text-muted-foreground">Get suggestions as you type</p>
        </div>
        <div className="text-center p-4 bg-secondary/50 rounded-lg">
          <Target className="mx-auto mb-2 text-muted-foreground" size={20} />
          <p className="text-sm font-medium">Writing goals</p>
          <p className="text-xs text-muted-foreground">Tailored to your audience</p>
        </div>
        <div className="text-center p-4 bg-secondary/50 rounded-lg">
          <BookOpen className="mx-auto mb-2 text-muted-foreground" size={20} />
          <p className="text-sm font-medium">Privacy-first</p>
          <p className="text-xs text-muted-foreground">Your words stay yours</p>
        </div>
      </div>
    </div>
  );
}

interface NoDocumentsStateProps {
  onNewDocument: () => void;
}

export function NoDocumentsState({ onNewDocument }: NoDocumentsStateProps) {
  return (
    <div className="empty-state animate-fade-in-scale">
      <div className="empty-state-icon" aria-hidden="true">
        <FilePlus2 size={48} />
      </div>
      <h3>No documents yet</h3>
      <p>Your drafts are stored locally on this device. Start creating to build your personal writing collection.</p>
      <Button onClick={onNewDocument} className="mt-4">
        <FilePlus2 size={14} className="mr-2" />
        Create Your First Document
      </Button>
    </div>
  );
}

interface SearchingNoResultsProps {
  query: string;
}

export function SearchingNoResults({ query }: SearchingNoResultsProps) {
  return (
    <div className="empty-state animate-slide-up">
      <div className="empty-state-icon" aria-hidden="true">
        <BookOpen size={48} />
      </div>
      <h3>No matches found</h3>
      <p>We couldn't find any documents matching "{query}"</p>
      <p className="text-sm mt-2">Try searching for different terms or create a new document.</p>
    </div>
  );
}

interface AnalysisLoadingStateProps {
  isAnalyzing: boolean;
}

export function AnalysisLoadingState({ isAnalyzing }: AnalysisLoadingStateProps) {
  if (!isAnalyzing) return null;
  
  return (
    <div className="analysis-loading-state text-center py-8 animate-gentle-pulse">
      <div className="inline-flex items-center gap-2 text-muted-foreground">
        <div className="loading-pulse w-4 h-4 rounded-full" />
        <span>Analyzing your draft...</span>
      </div>
    </div>
  );
}
