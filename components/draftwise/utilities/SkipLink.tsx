"use client";

interface SkipLinkProps {
  targetId?: string;
}

/**
 * Skip to main content link for keyboard users and screen readers.
 * Improves accessibility by allowing quick navigation past repetitive elements.
 */
export function SkipLink({ targetId = "main-content" }: SkipLinkProps) {
  return (
    <a 
      href={`#${targetId}`}
      className="skip-link"
      id="skip-link"
    >
      Skip to main content
    </a>
  );
}
