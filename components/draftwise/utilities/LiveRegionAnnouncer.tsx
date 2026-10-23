"use client";

interface LiveRegionAnnouncerProps {
  message: string;
}

/**
 * Live region for screen reader announcements.
 * Provides accessibility feedback for dynamic content changes.
 */
export function LiveRegionAnnouncer({ message }: LiveRegionAnnouncerProps) {
  return (
    <div 
      role="status" 
      aria-live="polite" 
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}
