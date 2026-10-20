"use client";

import { FileText, PenLine, BarChart3, Puzzle, Settings2, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WritingGoals } from "@/packages/types/src";

export type ViewType = "home" | "write" | "insights" | "extension" | "history";

interface RailNavigationProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  goals: WritingGoals;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
}

export function RailNavigation({ 
  currentView, 
  onViewChange, 
  goals,
  onOpenShortcuts,
  onOpenSettings
}: RailNavigationProps) {
  const { audience, intent, tone } = goals;

  return (
    <aside className="left-rail" aria-label="Draftwise sections">
      {/* Main navigation */}
      <div className="rail-nav">
        <button 
          className={`${currentView === "home" ? "rail-button active" : "rail-button"}`} 
          onClick={() => onViewChange("home")} 
          type="button" 
          aria-label="Documents"
        >
          <FileText size={18} aria-hidden="true" />
          <span>Documents</span>
        </button>
        
        <button 
          className={`${currentView === "write" ? "rail-button active" : "rail-button"}`} 
          onClick={() => onViewChange("write")} 
          type="button" 
          aria-label="Write"
        >
          <PenLine size={18} aria-hidden="true" />
          <span>Write</span>
        </button>
        
        <button 
          className={`${currentView === "insights" ? "rail-button active" : "rail-button"}`} 
          onClick={() => onViewChange("insights")} 
          type="button" 
          aria-label="Insights new"
        >
          <BarChart3 size={18} aria-hidden="true" />
          <span>Insights</span>
          <span className="rail-new" aria-hidden="true"> new</span>
        </button>
        
        <button 
          className={`${currentView === "extension" ? "rail-button active" : "rail-button"}`} 
          onClick={() => onViewChange("extension")} 
          type="button" 
          aria-label="Extension new"
        >
          <Puzzle size={18} aria-hidden="true" />
          <span>Extension</span>
          <span className="rail-new" aria-hidden="true"> new</span>
        </button>
      </div>
      
      {/* Divider */}
      <div className="rail-divider" />
      
      {/* Document goals */}
      <div className="rail-context">
        <span className="rail-eyebrow">Writing goals · this document</span>
        <div className="rail-goal" title={`Audience: ${audience}`}>
          {/* Using target icon here since that's what DraftWise uses */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="22" y1="12" x2="18" y2="12"></line>
            <line x1="6" y1="12" x2="2" y2="12"></line>
            <line x1="12" y1="6" x2="12" y2="2"></line>
            <line x1="12" y1="22" x2="12" y2="18"></line>
          </svg>
          <span>{audience}</span>
        </div>
        <div className="rail-goal" title={`Intent: ${intent}`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>{intent}</span>
        </div>
        <div className="rail-goal" title={`Tone: ${tone}`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 7.27 17 11 19 17 12 22 5 17 7 11 2 7.27 9 8.26 12 2"></polygon>
          </svg>
          <span>{tone}</span>
        </div>
        <button className="rail-edit" onClick={() => onViewChange("write")} type="button">
          Edit goals{" "}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="22" y1="12" x2="18" y2="12"></line>
            <line x1="6" y1="12" x2="2" y2="12"></line>
            <line x1="12" y1="6" x2="12" y2="2"></line>
            <line x1="12" y1="22" x2="12" y2="18"></line>
          </svg>
        </button>
      </div>
      
      {/* Bottom actions */}
      <div className="rail-bottom">
        <Button variant="ghost" className="rail-button" onClick={onOpenSettings} aria-label="Settings">
          <Settings2 size={17} aria-hidden="true" />
          <span>Settings</span>
        </Button>
        <Button variant="ghost" className="rail-button" onClick={onOpenShortcuts} aria-label="Keyboard shortcuts">
          <CircleHelp size={17} aria-hidden="true" />
          <span>Shortcuts</span>
          <kbd aria-hidden="true">?</kbd>
        </Button>
      </div>
    </aside>
  );
}
