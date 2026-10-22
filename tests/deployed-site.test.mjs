import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The deployed site.
 *
 * These assert the things a deployment needs and that no unit test elsewhere
 * would notice: that the site describes itself in a way a social platform can
 * use, that the crawler-facing files exist, that a wrong URL lands on a page
 * that belongs to the product, and that the security headers the deployment
 * sends are the ones that were reviewed.
 *
 * The browser suite (e2e/deployment-headers.spec.mjs) proves the CSP does not
 * break the app. These prove the policy and the metadata are the intended
 * ones in the first place.
 */

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const vercel = JSON.parse(read("vercel.json"));

function headerValue(key) {
  for (const rule of vercel.headers ?? []) {
    for (const header of rule.headers ?? []) {
      if (header.key.toLowerCase() === key.toLowerCase()) return header.value;
    }
  }
  return null;
}

test("the layout describes the site with a base, a canonical link and a card", () => {
  const layout = read("app/layout.tsx");

  // Without a base, Next.js emits relative URLs for the canonical link and
  // the Open Graph image, and a social platform resolves them against its own
  // host. The card then points at nothing.
  assert.match(layout, /metadataBase/u);
  assert.match(layout, /alternates:\s*\{[\s\S]*?canonical/u);
  assert.match(layout, /openGraph:\s*\{/u);
  assert.match(layout, /twitter:\s*\{/u);
  // A summary card is a plain link preview. The large image is the point.
  assert.match(layout, /card:\s*"summary_large_image"/u);
});

test("the deployed site generates a social card instead of shipping a stale one", () => {
  const image = read("app/opengraph-image.tsx");
  assert.match(image, /from "next\/og"/u);
  assert.match(image, /export const size = \{[\s\S]*?width:\s*1200,[\s\S]*?height:\s*630/u);
  // A generated card cannot silently fall out of date with the design.
  assert.match(image, /export const contentType = "image\/png"/u);
});

test("the crawler-facing files exist and point at one host", () => {
  const robots = read("app/robots.ts");
  const sitemap = read("app/sitemap.ts");
  assert.match(robots, /MetadataRoute\.Robots/u);
  assert.match(sitemap, /MetadataRoute\.Sitemap/u);
  // Both resolve the host through the shared helper, so the sitemap cannot
  // advertise a different host than the Open Graph card.
  assert.match(robots, /siteUrl\(\)/u);
  assert.match(sitemap, /siteUrl\(\)/u);
  assert.match(read("lib/site.ts"), /NEXT_PUBLIC_SITE_URL/u);
  assert.match(read("lib/site.ts"), /VERCEL_URL/u);
});

test("a wrong URL lands on a page that belongs to the product", () => {
  const notFound = read("app/not-found.tsx");
  // The default Next.js 404 is unstyled and unbranded; a writer who follows
  // a stale bookmark should still land inside the product.
  assert.match(notFound, /draftwise/u);
  assert.match(notFound, /href="\/"/u);
  assert.match(notFound, /<h1/u);
});

test("a crash inside the app offers a way back and says the drafts survive", () => {
  const errorPage = read("app/error.tsx");
  // Drafts live in the writer's own browser, so a render crash is not a data
  // loss — and the page must not leave the writer believing otherwise.
  assert.match(errorPage, /<h1/u);
  assert.match(errorPage, /reset/u);
  assert.match(errorPage, /your drafts are stored\s+in this browser/iu);
});

test("the deployment sends a policy that actually constrains scripts", () => {
  const csp = headerValue("Content-Security-Policy");
  assert.ok(csp, "the deployment must send a Content-Security-Policy");
  // The policy that shipped named base-uri, object-src and connect-src but
  // never script-src, so with no default-src either, scripts were never
  // constrained at all.
  assert.match(csp, /default-src 'self'/u);
  assert.match(csp, /script-src 'self'/u);
  assert.match(csp, /object-src 'none'/u);
  assert.match(csp, /frame-ancestors 'none'/u);
  assert.match(csp, /base-uri 'self'/u);
  assert.match(csp, /form-action 'self'/u);
});

test("the deployment sends the standard security headers", () => {
  assert.equal(headerValue("X-Content-Type-Options"), "nosniff");
  assert.equal(headerValue("X-Frame-Options"), "DENY");
  assert.equal(headerValue("Referrer-Policy"), "no-referrer");
  assert.match(headerValue("Permissions-Policy"), /camera=\(\)/u);
  // The site is served over HTTPS, and says so.
  assert.match(headerValue("Strict-Transport-Security"), /max-age=\d+/u);
});

test("the policy keeps the local provider endpoints working", () => {
  const csp = headerValue("Content-Security-Policy");
  // The app accepts `http://localhost` provider URLs on purpose so a writer
  // can point it at a model on their own machine. Dropping the exceptions
  // breaks that setup silently, at request time.
  assert.match(csp, /http:\/\/localhost:\*/u);
  assert.match(csp, /http:\/\/127\.0\.0\.1:\*/u);
  // The dev server's hot-reload channel is a WebSocket on localhost — the
  // same trust boundary as the http exceptions above.
  assert.match(csp, /ws:\/\/localhost:\*/u);
  // Upgrading insecure requests would rewrite those calls to https and break
  // the same setup in a different way.
  assert.doesNotMatch(csp, /upgrade-insecure-requests/u);
});

test("the app still ships the files the manifest and the layout reference", () => {
  for (const asset of ["favicon.svg", "apple-touch-icon.png", "manifest.webmanifest", "icon-192.png", "icon-512.png"]) {
    assert.ok(read(`public/${asset}`).length > 0, `public/${asset} must exist`);
  }
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) {
    const path = icon.src.replace(/^\//u, "");
    assert.ok(read(`public/${path}`).length > 0, `${icon.src} must exist`);
  }
});
