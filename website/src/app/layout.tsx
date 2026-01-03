import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Broski - Your AI Coding Companion",
  description: "The mobile-first interface for AI-powered coding. Access Claude Code, OpenCode, and more from anywhere.",
  keywords: ["AI", "coding", "mobile", "Claude Code", "OpenCode", "developer tools"],
  authors: [{ name: "Broski" }],
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "Broski - Your AI Coding Companion",
    description: "The mobile-first interface for AI-powered coding. Access Claude Code, OpenCode, and more from anywhere.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Broski - Your AI Coding Companion",
    description: "The mobile-first interface for AI-powered coding.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
