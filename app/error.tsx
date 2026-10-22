"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The error boundary for the deployed site.
 *
 * A crash inside the app previously rendered Next.js's default error page —
 * a bare stack-trace heading with no way back. The drafts themselves live in
 * this browser's storage, so a rendering crash is not a data loss, and the
 * page says so rather than leaving the writer thinking their work is gone.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only part of a production error that identifies the
    // failure; the message itself is redacted.
    console.error("Draftwise render error", error.digest ?? error);
  }, [error]);

  return (
    <main className="min-h-dvh bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="brand-lockup justify-center">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <span className="brand-name">draftwise</span>
        </div>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          The editor hit an error and stopped rendering. Your drafts are stored
          in this browser, so nothing has been lost — try again, and if it keeps
          happening, reload the page.
        </p>
        {error.digest ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Reference: <code className="font-mono">{error.digest}</code>
          </p>
        ) : null}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/">Go to your drafts</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
