"use client";

import { useEffect, useState } from "react";
import { Timer, Play, Pause, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WritingFocusTimerProps {
  autoStart?: boolean;
  initialDuration?: number; // in minutes
}

export function WritingFocusTimer({ 
  autoStart = false,
  initialDuration = 25
}: WritingFocusTimerProps) {
  const [timeLeft, setTimeLeft] = useState(initialDuration * 60);
  const [isActive, setIsActive] = useState(autoStart);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(initialDuration);

  useEffect(() => {
    if (!isActive || isPaused) return;
    
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setIsActive(false);
          setIsPaused(true);
          clearInterval(interval);
          // Optional: Play notification sound
          new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm1IBgAAAAEA").play();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [isActive, isPaused]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getProgress = () => {
    const total = duration * 60;
    return ((total - timeLeft) / total) * 100;
  };

  const resetTimer = () => {
    setTimeLeft(duration * 60);
    setIsActive(false);
    setIsPaused(false);
  };

  const toggleTimer = () => {
    if (isPaused) {
      setIsPaused(false);
      setIsActive(true);
    } else {
      setIsActive(!isActive);
    }
  };

  const changeDuration = (mins: number) => {
    setDuration(mins);
    setTimeLeft(mins * 60);
    setIsActive(false);
    setIsPaused(false);
  };

  const getTimeColor = () => {
    if (timeLeft <= 30) return 'text-destructive';
    if (timeLeft <= 120) return 'text-warning';
    return 'text-primary';
  };

  return (
    <div className="bg-card border rounded-lg p-4 max-w-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Timer className="text-muted-foreground" size={18} />
          <h3 className="font-semibold text-sm">Focus Timer</h3>
        </div>
        
        {isActive && !isPaused && (
          <span className="inline-flex items-center gap-1 text-xs text-success animate-pulse">
            <Sparkles size={10} />
            Focus mode
          </span>
        )}
      </div>
      
      {/* Timer Display */}
      <div className="relative flex items-center justify-center mb-4">
        <div className={`text-4xl font-bold ${getTimeColor()}`}>
          {formatTime(timeLeft)}
        </div>
        
        {/* Progress Ring (simple CSS version) */}
        <div className="absolute inset-0 pointer-events-none">
          <div 
            className="w-full h-full rounded-full border-4 border-secondary transition-all duration-1000"
            style={{ 
              transform: `rotate(${getProgress() * 3.6 - 90}deg)`,
              transformOrigin: 'center',
              opacity: 0.3
            }}
          />
        </div>
      </div>
      
      {/* Duration Presets */}
      <div className="flex gap-2 mb-4">
        {[15, 25, 45].map((mins) => (
          <button
            key={mins}
            onClick={() => changeDuration(mins)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              duration === mins 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {mins}m
          </button>
        ))}
      </div>
      
      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        <Button
          onClick={toggleTimer}
          size="icon"
          variant="outline"
          aria-label={isActive ? "Pause timer" : "Start timer"}
        >
          {isActive ? <Pause size={16} /> : <Play size={16} />}
        </Button>
        
        <Button
          onClick={resetTimer}
          size="icon"
          variant="ghost"
          aria-label="Reset timer"
          disabled={!isActive && !isPaused}
        >
          <RotateCcw size={14} />
        </Button>
      </div>
      
      {/* Status Message */}
      <p className="text-center text-xs text-muted-foreground mt-3">
        {isPaused 
          ? "Timer paused" 
          : isActive 
            ? "Keep writing! Time ticking..." 
            : "Ready to focus"}
      </p>
    </div>
  );
}
