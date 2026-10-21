/**
 * Where the deployed site lives.
 *
 * Three separate things need this: the `<head>` metadata (so social cards can
 * point at an absolute URL), `robots.txt`, and `sitemap.xml`. They each have
 * their own file, and they used to each have their own idea of the address —
 * the classic way a sitemap ends up advertising one host while the Open Graph
 * card points at another.
 *
 * The order of preference:
 *
 * 1. `NEXT_PUBLIC_SITE_URL` — an explicit override, for a custom domain or a
 *    preview deployment that should not be indexed.
 * 2. `VERCEL_URL` — set by Vercel on every deployment. The production host.
 * 3. A localhost fallback, so a local build produces working (if useless)
 *    absolute URLs instead of a build error.
 */

function normalise(value: string): string {
  return value.replace(/\/+$/u, "");
}

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return normalise(explicit);
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return normalise(vercel.startsWith("http") ? vercel : `https://${vercel}`);
  return "http://localhost:3000";
}

/**
 * The public name, used wherever the site introduces itself.
 *
 * Kept here rather than repeated so the Open Graph card, the manifest and the
 * page title cannot drift apart.
 */
export const SITE_NAME = "Draftwise";

export const SITE_TITLE = "Draftwise — private writing assistant";

export const SITE_DESCRIPTION =
  "A private, local-first writing workspace with optional BYOK AI suggestions and a lightweight browser assistant.";

/**
 * The canonical home page of the deployed site.
 */
export const SITE_PATH = "/";
