"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ThemeToggleProps {
  darkMode: boolean;
  onThemeChange: (dark: boolean) => void;
}

export function ThemeToggle({ darkMode, onThemeChange }: ThemeToggleProps) {
  return (
    <Button 
      variant="ghost" 
      size="icon" 
      aria-label={darkMode ? "Use light theme" : "Use dark theme"}
      onClick={() => onThemeChange(!darkMode)}
    >
      {darkMode ? <Sun size={17} /> : <Moon size={17} />}
    </Button>
  );
}
