import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Draftwise — private writing assistant",
  description: "A private, local-first writing workspace with optional BYOK AI suggestions and a lightweight browser assistant.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
