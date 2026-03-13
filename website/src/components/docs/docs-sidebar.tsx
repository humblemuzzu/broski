"use client";

import { useState, useEffect } from "react";
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
      { title: "iOS Setup", href: "/docs/setup/ios" },
      { title: "FAQ", href: "/docs/faq" },
    ],
  },
  {
    title: "Guides",
    items: [
      { title: "Your First Session", href: "/docs/guides/first-session" },
      { title: "Approving Commands", href: "/docs/guides/approve-commands" },
      { title: "Remote Coding", href: "/docs/guides/remote-coding" },
    ],
  },
  {
    title: "Mobile App",
    items: [
      { title: "Overview", href: "/docs/app" },
      { title: "Sessions", href: "/docs/app/sessions" },
      { title: "Chat Interface", href: "/docs/app/chat" },
      { title: "File Browser", href: "/docs/app/files" },
      { title: "Settings", href: "/docs/app/settings" },
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
      { title: "Pi", href: "/docs/backends/pi" },
    ],
  },
  {
    title: "Troubleshooting",
    items: [
      { title: "Overview", href: "/docs/troubleshooting" },
      { title: "Connection", href: "/docs/troubleshooting/connection" },
      { title: "Network", href: "/docs/troubleshooting/network" },
      { title: "AI Backends", href: "/docs/troubleshooting/ai-backends" },
      { title: "Error Reference", href: "/docs/troubleshooting/errors" },
    ],
  },
  {
    title: "Security & Privacy",
    items: [
      { title: "Overview", href: "/docs/security" },
    ],
  },
  {
    title: "Reference",
    items: [
      { title: "CLI Commands", href: "/docs/reference/cli" },
      { title: "Environment Variables", href: "/docs/reference/env" },
    ],
  },
];

function NavSection({ item, onLinkClick }: { item: NavItem; onLinkClick?: () => void }) {
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
                  onClick={onLinkClick}
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

// Shared sidebar content
function SidebarContent({ onLinkClick, searchOpen, setSearchOpen }: { 
  onLinkClick?: () => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}) {
  return (
    <>
      <SearchDialog isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
      
      {/* Search */}
      <div className="mb-6">
        <button 
          onClick={() => setSearchOpen(true)}
          className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-muted-foreground bg-muted/50 border border-border rounded-lg hover:bg-muted transition-colors"
        >
          <svg className="w-4 h-4 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span>Search...</span>
          <kbd className="ml-auto text-[10px] text-muted-foreground bg-background px-1.5 py-0.5 rounded border border-border hidden sm:inline">
            /
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav>
        {navigation.map((item) => (
          <NavSection key={item.title} item={item} onLinkClick={onLinkClick} />
        ))}
      </nav>
    </>
  );
}

// Mobile sidebar drawer
export function MobileSidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [searchOpen, setSearchOpen] = useState(false);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-background/80 backdrop-blur-sm z-[90] transition-opacity duration-300 md:hidden ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 left-0 bottom-0 w-[280px] max-w-[85vw] bg-background border-r border-border z-[95] transform transition-transform duration-300 ease-out md:hidden ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header with close button */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <Link href="/" className="flex items-center" onClick={onClose}>
            <Image
              src="/broski-logo.png"
              alt="Broski"
              width={90}
              height={28}
              priority
            />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <button
              onClick={onClose}
              className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted/50 transition-colors"
              aria-label="Close menu"
            >
              <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-4 py-5 h-[calc(100vh-65px)]">
          <SidebarContent 
            onLinkClick={onClose} 
            searchOpen={searchOpen}
            setSearchOpen={setSearchOpen}
          />
        </div>
      </aside>
    </>
  );
}

// Desktop sidebar (original)
export function DocsSidebar() {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
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
        <SidebarContent 
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
        />
      </div>
    </aside>
  );
}
