"use client";

import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

/**
 * Immediate splash screen shown while app loads data.
 * Provides visual feedback and reinforces brand identity.
 *
 * The app-shell keeps the theme/background; Tailwind flex utilities center the
 * brand lockup and tagline both horizontally and vertically in the viewport.
 */
export function SplashScreen() {
  return (
    <div className="app-shell flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <div className="brand-lockup" aria-hidden="true">
        <div className="brand-mark"><span /></div>
        <span className="brand-name">draftwise</span>
        <Badge className="private-badge">
          <ShieldCheck size={12} /> private
        </Badge>
      </div>
      {/* The server-painted heading matches the dashboard's own heading in
          size and text. The dashboard never renders while unhydrated, so no
          wrong library is shown; this is the same honest, static copy the
          writer sees a moment later, painted at first paint instead. */}
      <div className="full-view-heading">
        <div>
          <p className="eyebrow">Your drafts</p>
          <h1>Everything you have written, on this device.</h1>
          <p className="text-sm text-muted-foreground">Your words, your device, your privacy.</p>
        </div>
      </div>
    </div>
  );
}
