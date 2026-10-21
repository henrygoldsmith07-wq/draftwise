import type { Metadata, Viewport } from "next";
import { THEME_COLORS } from "@/lib/theme-colors";
import "./globals.css";
import { SITE_DESCRIPTION, SITE_NAME, SITE_PATH, SITE_TITLE, siteUrl } from "@/lib/site";

/**
 * The absolute origin of the deployed site.
 *
 * Every absolute URL in the metadata below (the canonical link, the Open Graph
 * image) is resolved against this. Without a base, Next.js emits a relative
 * URL for those, and social platforms resolve them against *their own* host —
 * which is how a share card ends up pointing at a preview deployment, or at
 * nothing at all.
 */
const base = siteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(base),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: SITE_PATH,
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "default",
  },
  /**
   * Open Graph and Twitter cards.
   *
   * The site shipped with a title and a description and nothing else, so a
   * link pasted into a chat or a ticket rendered as a bare URL: no image, no
   * card, no headline formatting. For a product whose main distribution is
   * somebody sharing a link, that is the difference between a link and a
   * preview. The image is generated at build time by `app/opengraph-image.tsx`.
   */
  openGraph: {
    type: "website",
    url: SITE_PATH,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  /**
   * The app is a single page. Declaring it as such keeps crawlers from
   * wandering through query strings that all render the same shell.
   */
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "productivity",
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  /**
   * Declares both schemes so the browser does not paint a white flash before
   * the app's own theme loads, and does not repaint native controls when the
   * writer flips to dark.
   */
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
