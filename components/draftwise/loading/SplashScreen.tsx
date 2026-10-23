"use client";

import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

/**
 * Immediate splash screen shown while app loads data.
 * Provides visual feedback and reinforces brand identity.
 */
export function SplashScreen() {
  return (
    <div className="app-shell center-view">
      <div className="brand-lockup" aria-hidden="true">
        <div className="brand-mark"><span /></div>
        <span className="brand-name">draftwise</span>
        <Badge className="private-badge">
          <ShieldCheck size={12} /> private
        </Badge>
      </div>
      <p>Your words, your device, your privacy.</p>
    </div>
  );
}
