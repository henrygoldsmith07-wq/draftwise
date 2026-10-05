import type { NextConfig } from "next";
import path from "node:path";

// connect-src is the load-bearing part of this header for a privacy-first tool.
// Without it the whole promise rests on "we never call innerHTML", and any
// future script injection could ship drafts and the stored API key to any host
// over any scheme.
//
// It permits exactly what the provider layer already requires: HTTPS anywhere
// (validateProviderUrl insists on HTTPS outside localhost, so the user's own
// provider still works) plus localhost, which is the documented escape hatch
// for local models. Plain-HTTP exfiltration to any other host is blocked.
//
// script-src/style-src are deliberately left out rather than guessed at: Next
// emits inline bootstrap scripts, and a wrong 'unsafe-inline' here breaks a
// deployed app in ways no unit test would catch.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
] as const;

const nextConfig: NextConfig = {
  // Next.js otherwise walks up looking for a lockfile and, when the checkout
  // sits inside another repository, traces file dependencies against the wrong
  // root. Pinning it to this package keeps build output self-contained, which
  // is what a deployment needs.
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  async headers() {
    return [{
      source: "/:path*",
      headers: [...securityHeaders],
    }];
  },
};

export default nextConfig;
