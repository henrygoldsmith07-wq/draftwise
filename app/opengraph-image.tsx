import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TITLE } from "@/lib/site";

/**
 * The social card for the deployed site.
 *
 * Generated at build time rather than shipped as a bitmap, so it can never be
 * a stale screenshot of an old design, and so it costs nothing in the bundle.
 * The alternative — a checked-in PNG — drifts the moment the wordmark or the
 * tagline changes, and the drift is invisible until somebody notices the card
 * in a chat window.
 *
 * Only flexbox and a small subset of CSS are supported by satori, so this is
 * deliberately plain: no grid, no gradients, no external fonts.
 */

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export const alt = `${SITE_TITLE} — a private, local-first writing workspace`;

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#10221f",
          padding: "72px",
          color: "#f5f8f6",
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        }}
      >
        {/* The brand mark: a mint square with the initial, matching the
            favicon and the app's own topbar lockup. */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "#d8f26b",
              color: "#10221f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 44,
              fontWeight: 700,
            }}
          >
            D
          </div>
          <div
            style={{
              marginLeft: 24,
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 74,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              maxWidth: 940,
            }}
          >
            Your writing, improved without leaving your machine.
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 34,
              color: "#9fb5ad",
              maxWidth: 900,
            }}
          >
            A local-first writing workspace. Optional AI, your own key, nothing
            sent unless you ask.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
