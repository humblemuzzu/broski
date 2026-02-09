"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DocsSidebar, MobileSidebar } from "@/components/docs/docs-sidebar";
import { TableOfContents, MobileTableOfContents } from "@/components/docs/table-of-contents";
import { CopyPageButton } from "@/components/docs/copy-page-button";
import { Breadcrumbs } from "@/components/docs/breadcrumbs";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <main className="min-h-screen bg-background">
      {/* Mobile Sidebar Drawer */}
      <MobileSidebar isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      {/* Full-width flex container */}
      <div className="flex min-h-screen">
        {/* Left Sidebar - Desktop only */}
        <DocsSidebar />

        {/* Right side: header + content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-40">
            <div className="px-4 md:px-8 py-3 flex items-center justify-between">
              {/* Mobile: Hamburger + Logo */}
              <div className="flex items-center gap-3 md:hidden">
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="flex items-center justify-center w-10 h-10 -ml-2 rounded-lg hover:bg-muted/50 transition-colors"
                  aria-label="Open menu"
                >
                  <svg className="w-5 h-5 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <Link href="/" className="flex items-center">
                  <Image
                    src="/broski-logo.png"
                    alt="Broski"
                    width={80}
                    height={25}
                    priority
                  />
                </Link>
              </div>

              {/* Desktop: Nav links */}
              <nav className="hidden md:flex items-center gap-6 text-sm">
                <Link href="/docs" className="font-medium text-foreground">
                  Documentation
                </Link>
                <Link href="/docs/setup" className="text-muted-foreground hover:text-foreground transition-colors">
                  Setup
                </Link>
                <Link href="/docs/bridge" className="text-muted-foreground hover:text-foreground transition-colors">
                  Bridge
                </Link>
                <Link href="/docs/backends" className="text-muted-foreground hover:text-foreground transition-colors">
                  AI Backends
                </Link>
              </nav>

              {/* Mobile: Theme switcher */}
              <div className="md:hidden">
                <ThemeSwitcher />
              </div>
            </div>
          </header>

          {/* Content area - centered with max width */}
          <div className="flex-1 flex justify-center">
            <div className="flex w-full max-w-5xl">
              {/* Main Content - responsive padding */}
              <div className="flex-1 px-4 sm:px-6 md:px-8 lg:px-12 py-6 md:py-10 min-w-0">
                {/* Breadcrumbs */}
                <div className="mb-2 min-w-0">
                  <Breadcrumbs />
                </div>

                {/* Mobile TOC - shows on screens smaller than xl */}
                <MobileTableOfContents />

                {/* Content + Copy Button aligned to H1 line */}
                <div className="relative max-w-2xl sm:pr-32">
                  <div className="absolute right-0 top-0 hidden sm:block">
                    <CopyPageButton />
                  </div>
                  {children}
                </div>

                {/* Footer */}
                <footer className="mt-12 md:mt-16 pt-6 md:pt-8 border-t border-border max-w-2xl">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
                    <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6">
                      <Link href="/legal/privacy" className="hover:text-foreground transition-colors">
                        Privacy Policy
                      </Link>
                      <Link href="/legal/terms" className="hover:text-foreground transition-colors">
                        Terms of Service
                      </Link>
                      <a href="mailto:broskiappp@gmail.com" className="hover:text-foreground transition-colors">
                        Support
                      </a>
                    </div>
                    <p className="text-xs text-muted-foreground/60">
                      &copy; {new Date().getFullYear()} Broski. All rights reserved.
                    </p>
                  </div>
                </footer>
              </div>

              {/* Table of Contents - desktop only (xl screens) */}
              <TableOfContents />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
