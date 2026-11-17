"use client";

import { FileText, ShieldCheck, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/draftwise/topbar/ThemeToggle";

interface TopBarProps {
  draftTitle: string;
  savedLabel: string;
  saveError?: string | null;
  onSaveTitle: (title: string) => void;
  onOpenSettings: () => void;
  isPrivate?: boolean;
  darkMode: boolean;
  onThemeChange: (dark: boolean) => void;
}

export function TopBar({ 
  draftTitle, 
  savedLabel, 
  saveError,
  onSaveTitle,
  onOpenSettings,
  isPrivate = true,
  darkMode,
  onThemeChange,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <span className="brand-name">draftwise</span>
        {isPrivate && (
          <Badge className="private-badge">
            <ShieldCheck size={12} /> private
          </Badge>
        )}
      </div>
      
      <div className="document-name">
        <FileText size={15} />
        <input 
          aria-label="Document title" 
          value={draftTitle} 
          onChange={(event) => onSaveTitle(event.target.value)}
          onKeyDown={(event) => { 
            if (event.key === "Enter") event.currentTarget.blur(); 
          }} 
        />
        <span 
          className="saved-dot" 
          title={saveError || savedLabel} 
          style={{
            backgroundColor: saveError ? 'var(--destructive)' : undefined
          }}
        />
      </div>
      
      <div className="topbar-actions">
        <div className="privacy-pill">
          <span className="privacy-dot" />
          Local-first, cloud opt-in
        </div>
        <ThemeToggle darkMode={darkMode} onThemeChange={onThemeChange} />
        <Button variant="ghost" size="icon" aria-label="Open settings" onClick={onOpenSettings}>
          <Settings2 size={17} />
        </Button>
      </div>
    </header>
  );
}
