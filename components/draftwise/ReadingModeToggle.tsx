"use client";

import { BookOpen, Sun, Moon, ListFilter, Type, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

interface ReadingModeToggleProps {
  className?: string;
}

export function ReadingModeToggle({ className = "" }: ReadingModeToggleProps) {
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">("medium");
  const [theme, setTheme] = useState<"light" | "sepia" | "dark">("light");

  useEffect(() => {
    // Load saved preferences
    const savedFont = localStorage.getItem("draftwise_font_size") as "small" | "medium" | "large" | null;
    const savedTheme = localStorage.getItem("draftwise_reading_theme") as "light" | "sepia" | "dark" | null;
    
    if (savedFont) setFontSize(savedFont);
    if (savedTheme) setTheme(savedTheme);
  }, []);

  const handleFontSizeChange = (size: "small" | "medium" | "large") => {
    setFontSize(size);
    localStorage.setItem("draftwise_font_size", size);
  };

  const handleThemeChange = (newTheme: "light" | "sepia" | "dark") => {
    setTheme(newTheme);
    localStorage.setItem("draftwise_reading_theme", newTheme);
  };

  const getFontSizeClass = () => {
    switch (fontSize) {
      case "small": return "text-sm leading-relaxed";
      case "large": return "text-xl leading-loose";
      default: return "text-base leading-normal";
    }
  };

  const getThemeClass = () => {
    switch (theme) {
      case "sepia": return "bg-[#f5ede0] text-[#5b4636]";
      case "dark": return "bg-gray-900 text-gray-100";
      default: return "bg-white text-gray-900";
    }
  };

  return (
    <div className={`bg-card border rounded-lg p-4 ${className}`}>
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <BookOpen size={16} />
        Reading Preferences
      </h3>
      
      {/* Reading Mode Toggle */}
      <div className="mb-4">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm font-medium">Reading Mode</span>
          <div className="relative">
            <input
              type="checkbox"
              checked={isReadingMode}
              onChange={(e) => setIsReadingMode(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-secondary peer-checked:bg-primary rounded-full peer peer-focus:ring peer-focus:ring-offset transition-colors"></div>
            <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${isReadingMode ? 'translate-x-5' : ''}`}></div>
          </div>
        </label>
      </div>
      
      {/* Font Size */}
      <div className="mb-4">
        <span className="text-xs text-muted-foreground block mb-2">Font Size</span>
        <div className="flex gap-2">
          <Button
            size="icon"
            variant={fontSize === "small" ? "default" : "outline"}
            onClick={() => handleFontSizeChange("small")}
          >
            <Type size={14} />
          </Button>
          <Button
            size="icon"
            variant={fontSize === "medium" ? "default" : "outline"}
            onClick={() => handleFontSizeChange("medium")}
          >
            <Type size={16} />
          </Button>
          <Button
            size="icon"
            variant={fontSize === "large" ? "default" : "outline"}
            onClick={() => handleFontSizeChange("large")}
          >
            <Type size={18} />
          </Button>
        </div>
      </div>
      
      {/* Theme Selector */}
      <div className="mb-4">
        <span className="text-xs text-muted-foreground block mb-2">Reading Theme</span>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => handleThemeChange("light")}
            className={`p-2 rounded-lg border-2 transition-all ${
              theme === "light" 
                ? "border-primary bg-primary/10" 
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <div className="bg-white h-8 rounded border border-gray-200 shadow-sm">
              <Sun size={14} className="mx-auto mt-2 text-amber-500" />
            </div>
          </button>
          
          <button
            onClick={() => handleThemeChange("sepia")}
            className={`p-2 rounded-lg border-2 transition-all ${
              theme === "sepia" 
                ? "border-primary bg-primary/10" 
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <div className="bg-[#f5ede0] h-8 rounded border border-amber-200 shadow-sm">
              <Moon size={14} className="mx-auto mt-2 text-amber-700" />
            </div>
          </button>
          
          <button
            onClick={() => handleThemeChange("dark")}
            className={`p-2 rounded-lg border-2 transition-all ${
              theme === "dark" 
                ? "border-primary bg-primary/10" 
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <div className="bg-gray-900 h-8 rounded border border-gray-700 shadow-sm">
              <Moon size={14} className="mx-auto mt-2 text-gray-300" />
            </div>
          </button>
        </div>
      </div>
      
      {/* Instructions */}
      {isReadingMode && (
        <div className="pt-3 border-t text-xs text-muted-foreground">
          <ListFilter size={12} className="inline mr-1" />
          Reading mode enhances focus with optimized typography and spacing
        </div>
      )}
      
      {/* Preview Area */}
      <div className={`mt-3 p-3 rounded-md transition-colors ${getThemeClass()} ${getFontSizeClass()}`}>
        <p className="opacity-75">
          This is how your document will appear in reading mode. 
          Adjust settings to find your optimal reading experience.
        </p>
      </div>
    </div>
  );
}
