import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The 404 page for the deployed site.
 *
 * Previously a bad URL rendered Next.js's default error page: unstyled,
 * unbranded, and offering the reader nothing to do. For an app that lives
 * entirely at one address, a wrong URL is usually a stale bookmark, so the
 * page says what the site is and offers the one route that exists.
 */
export default function NotFound() {
  return (
    <main className="min-h-dvh bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="brand-lockup justify-center">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <span className="brand-name">draftwise</span>
        </div>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Draftwise is a single writing workspace, so there are no other pages to
          find. Your drafts are stored in this browser and are unaffected.
        </p>
        <div className="mt-7 flex justify-center">
          <Button asChild>
            <Link href="/">Go to your drafts</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
