"use client";

import { ReactNode, useEffect } from "react";

interface PageLayoutProps {
  children: ReactNode;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  /** Drives the focus-mode CSS that hides the editor chrome. */
  focusMode?: boolean;
}

export function PageLayout({ 
  children, 
  theme,
  // Remote hardening made focusMode optional with an explicit default; this
  // matches the auto-merged interface/return below. Our dataset.theme effect
  // (shared by both sides) is preserved unchanged.
  focusMode = false,
}: PageLayoutProps) {
  // Portaled dialogs render outside .app-shell. Mirroring the resolved theme
  // onto the document root lets their shared CSS pick up the dark palette
  // without threading a prop through every dialog.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className={`app-shell${focusMode ? " focus-mode" : ""}`} data-theme={theme}>
      {children}
    </div>
  );
}
