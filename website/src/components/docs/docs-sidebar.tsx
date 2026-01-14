"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SearchDialog } from "./search-dialog";
import { ThemeSwitcher } from "@/components/theme-switcher";

interface NavItem {
  title: string;
  href?: string;
  items?: NavItem[];
}

const navigation: NavItem[] = [
  {
    title: "Get Started",
    items: [
      { title: "Introduction", href: "/docs" },
      { title: "Quick Start", href: "/docs/setup" },
      { title: "FAQ", href: "/docs/faq" },
    ],
  },
  {
    title: "Bridge",
    items: [
      { title: "Installation", href: "/docs/bridge" },
      { title: "Configuration", href: "/docs/bridge/configuration" },
      { title: "Remote Access", href: "/docs/bridge/remote-access" },
      { title: "Background Service", href: "/docs/bridge/background-service" },
    ],
  },
  {
    title: "AI Backends",
    items: [
      { title: "Overview", href: "/docs/backends" },
      { title: "Claude Code", href: "/docs/backends/claude-code" },
      { title: "OpenCode", href: "/docs/backends/opencode" },
      { title: "Codex", href: "/docs/backends/codex" },
    ],
  },
  {
    title: "Troubleshooting",
    items: [
      { title: "Common Issues", href: "/docs/troubleshooting" },
      { title: "Connection", href: "/docs/troubleshooting/connection" },
      { title: "Network", href: "/docs/troubleshooting/network" },
      { title: "AI Backends", href: "/docs/troubleshooting/ai-backends" },
      { title: "Errors", href: "/docs/troubleshooting/errors" },
    ],
  },
];

function NavSection({ item }: { item: NavItem }) {
  const pathname = usePathname();

  return (
    <div className="mb-6">
      {/* Section Header */}
      <p className="text-[13px] font-semibold text-foreground mb-2">
        {item.title}
      </p>
      
      {/* Nav Items */}
      {item.items && (
        <ul className="space-y-0.5">
          {item.items.map((child) => {
            const isActive = pathname === child.href;
            return (
              <li key={child.href}>
                <Link
                  href={child.href || "#"}
                  className={`block py-1.5 pl-3 text-[13px] transition-colors border-l-2 ${
                    isActive
                      ? "text-foreground font-medium border-foreground"
                      : "text-muted-foreground hover:text-foreground border-transparent hover:border-border"
                  }`}
                >
                  {child.title}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function DocsSidebar() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <SearchDialog isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-border bg-background sticky top-0 h-screen">
        {/* Logo + Theme Switcher */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <Link href="/" className="flex items-center">
            <Image
              src="/broski-logo.png"
              alt="Broski"
              width={90}
              height={28}
              priority
            />
          </Link>
          <ThemeSwitcher />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Search */}
          <div className="mb-6">
            <button 
              onClick={() => setSearchOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-muted-foreground bg-muted/50 border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <svg className="w-4 h-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>Search...</span>
              <kbd className="ml-auto text-[10px] text-muted-foreground bg-background px-1.5 py-0.5 rounded border border-border">
                /
              </kbd>
            </button>
          </div>

          {/* Navigation */}
          <nav>
            {navigation.map((item) => (
              <NavSection key={item.title} item={item} />
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
}
