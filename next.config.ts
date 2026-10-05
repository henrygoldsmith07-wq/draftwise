import type { NextConfig } from "next";
import path from "node:path";

const securityHeaders = [
  { key: "Content-Security-Policy", value: "base-uri 'self'; frame-ancestors 'none'; object-src 'none'" },
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
