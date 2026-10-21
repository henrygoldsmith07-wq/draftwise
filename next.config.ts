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
// script-src and style-src were previously left out rather than guessed at,
// because Next emits inline bootstrap scripts and a wrong 'unsafe-inline'
// there breaks a deployed app in ways no unit test would catch.
//
// That reason is now answered rather than ignored. e2e/deployment-headers.spec.mjs
// takes this exact policy out of this file, attaches it to a real page, drives
// the app through it, and fails on any refusal the browser reports — so a
// wrong guess here is a failing test, not a blank page in production.
//
// 'unsafe-inline' is still a narrowing, not a loosening: with no script-src
// and no default-src (the previous state) a script could be loaded from ANY
// origin. Now scripts are same-origin or inline, and everything else falls
// back to 'self'.
//
// The ws://localhost exceptions exist for the dev server's hot-reload channel,
// which is the same machine and the same trust boundary as the http://localhost
// exceptions the app already needs for local models. The deployed app opens no
// WebSocket at all — there is no WebSocket or EventSource anywhere in the
// source.
//
// This policy is duplicated verbatim in vercel.json, and a test compares the
// two, because two copies of a security policy otherwise drift silently.
const securityHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; frame-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; manifest-src 'self'; worker-src 'self' blob:; connect-src 'self' https: ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
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
