"use client";

import { ReactNode, useEffect } from "react";

interface PageLayoutProps {
  children: ReactNode;
  focusMode: boolean;
  onFocusModeChange: (enabled: boolean) => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}

export function PageLayout({ 
  children, 
  focusMode, 
  onFocusModeChange,
  theme,
}: PageLayoutProps) {
  // Portaled dialogs render outside .app-shell. Mirroring the resolved theme
  // onto the document root lets their shared CSS pick up the dark palette
  // without threading a prop through every dialog.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className={`app-shell ${focusMode ? "focus-mode" : ""}`} data-theme={theme}>
      {/* Focus mode toggle would go here - can be implemented in a separate component */}
      <button
        onClick={() => onFocusModeChange(!focusMode)}
        className="focus-mode-toggle hidden"
        aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
      />
      
      {children}
    </div>
  );
}
