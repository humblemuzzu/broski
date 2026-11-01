"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const pathTitles: Record<string, string> = {
  docs: "Docs",
  setup: "Quick Start",
  faq: "FAQ",
  bridge: "Bridge",
  configuration: "Configuration",
  "remote-access": "Remote Access",
  "background-service": "Background Service",
  backends: "AI Backends",
  "claude-code": "Claude Code",
  troubleshooting: "Troubleshooting",
  connection: "Connection Issues",
  network: "Network Issues",
  "ai-backends": "AI Backend Issues",
  errors: "Error Reference",
  reference: "Reference",
  cli: "CLI Reference",
  env: "Environment Variables",
  app: "Using the App",
  navigation: "Navigation",
  chat: "Chat Interface",
  sessions: "Sessions",
  files: "File Browser",
  settings: "Settings",
  legal: "Legal",
  privacy: "Privacy Policy",
  terms: "Terms of Service",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length <= 1) return null;

  return (
    <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
      {segments.map((segment, index) => {
        const href = "/" + segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        const title = pathTitles[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);

        return (
          <span key={href} className="flex items-center gap-2">
            {index > 0 && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            {isLast ? (
              <span className="text-foreground font-medium">{title}</span>
            ) : (
              <Link href={href} className="hover:text-foreground transition-colors">
                {title}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
