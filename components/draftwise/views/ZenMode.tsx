'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ZenModeProps {
  activeText: string;
  onExit: () => void;
}

export function ZenMode({ activeText, onExit }: ZenModeProps) {
  const [showStats, setShowStats] = useState(false);
  const [charCount, setCharCount] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [sentenceCount, setSentenceCount] = useState(0);
  const [startTime] = useState(Date.now());
  const [elapsedTime, setElapsedTime] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Update counts continuously
  useEffect(() => {
    setCharCount(activeText.length);
    setWordCount(activeText.trim().split(/\s+/).filter(w => w.length > 0).length);
    setSentenceCount(activeText.split(/[.!?]+/).filter(s => s.trim().length > 0).length);
  }, [activeText]);
  
  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    
    return () => clearInterval(timer);
  }, [startTime]);
  
  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  
  // Prevent exit without confirmation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
        e.preventDefault();
        if (confirm('Exit Zen mode?')) {
          onExit();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExit]);
  
  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    }
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };
  
  const toggleStats = () => setShowStats(!showStats);
  
  return (
    <div className="fixed inset-0 bg-background z-50 flex items-center justify-center overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-accent/5 animate-gradient" />
      
      {/* Controls */}
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleStats}
        className="absolute top-4 right-4 opacity-20 hover:opacity-100 transition-opacity"
      >
        {showStats ? '✕' : '⚙️'}
      </Button>
      
      <Button
        variant="ghost"
        size="sm"
        onClick={onExit}
        className="absolute bottom-4 right-4 opacity-20 hover:opacity-100 transition-opacity text-xs"
      >
        Press Ctrl+Q to exit
      </Button>
      
      {/* Stats overlay */}
      {showStats && (
        <Card className="absolute top-4 left-4 p-6 space-y-3 max-w-sm animate-fade-in">
          <h3 className="font-semibold text-lg">Writing Statistics</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{wordCount.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Words</div>
            </div>
            
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{charCount.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Characters</div>
            </div>
            
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{formatTime(elapsedTime)}</div>
              <div className="text-xs text-muted-foreground">Session Time</div>
            </div>
            
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-2xl font-bold">{sentenceCount}</div>
              <div className="text-xs text-muted-foreground">Sentences</div>
            </div>
          </div>
          
          {/* Writing pace indicator */}
          {elapsedTime > 0 && (
            <div className="text-center">
              <p className="text-sm">
                Average pace:{' '}
                <Badge variant="outline">
                  {Math.round(wordCount / (elapsedTime / 60))} words/min
                </Badge>
              </p>
            </div>
          )}
        </Card>
      )}
      
      {/* Main content area */}
      <div className="relative w-full h-full flex items-center justify-center px-16">
        <textarea
          ref={textareaRef}
          value={activeText}
          onChange={(e) => {}}
          placeholder="Start writing in pure focus..."
          className="w-full max-w-3xl min-h-[60vh] text-xl leading-relaxed resize-none outline-none bg-transparent placeholder:text-muted-foreground/50"
          spellCheck={false}
        />
        
        {/* Word highlight effect on typing (simulated) */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="inline-block bg-primary/5 border-b-2 border-primary/30 px-1 rounded-sm" />
        </div>
      </div>
    </div>
  );
}
