import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const GA_MEASUREMENT_ID = "G-Y1PVGBFJQW";

export const metadata: Metadata = {
  title: "Broski — Mobile Companion for AI Coding Agents",
  description:
    "The native iOS app for Claude Code, OpenCode, Codex, and Pi. Monitor sessions, review code, and ship — all from your phone.",
  keywords: [
    "AI coding agent",
    "mobile",
    "Claude Code",
    "OpenCode",
    "Codex",
    "Pi",
    "iOS",
    "developer tools",
    "vibe coding",
  ],
  authors: [{ name: "Broski" }],
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "Broski — Mobile Companion for AI Coding Agents",
    description:
      "The native iOS app for Claude Code, OpenCode, Codex, and Pi. Not a terminal wrapper — a real mobile interface.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Broski — Mobile Companion for AI Coding Agents",
    description:
      "The native iOS app for Claude Code, OpenCode, Codex, and Pi.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </head>
      <body
        className={`${inter.variable} ${instrumentSerif.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
