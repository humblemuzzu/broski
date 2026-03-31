import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "We Read Every Line of Claude Code's Source Code | Broski",
  description:
    "Claude Code's entire source code leaked. We read all 50,000+ lines. Here's every hidden feature, secret command, and internal detail that matters — from virtual pets to undercover mode.",
  keywords: [
    "Claude Code source code",
    "Claude Code leaked",
    "Claude Code internals",
    "Claude Code hidden features",
    "KAIROS",
    "Claude Code buddy",
    "Claude Code undercover mode",
    "Claude Code secret commands",
    "Claude Code pricing",
    "Claude Code environment variables",
    "Anthropic internal",
    "AI coding agent",
    "Broski",
  ],
  openGraph: {
    title: "We Read Every Line of Claude Code's Source Code",
    description:
      "50,000+ lines. Virtual pets. Undercover mode. Hidden commands. The full breakdown of what's inside Claude Code.",
    type: "article",
  },
  twitter: {
    card: "summary_large_image",
    title: "We Read Every Line of Claude Code's Source Code",
    description:
      "Claude Code's source leaked. We found virtual pets, undercover mode, hidden commands, secret env vars, and more. The full breakdown.",
  },
};

export default function SourceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
