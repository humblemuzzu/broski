import Link from "next/link";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { TableOfContents } from "@/components/docs/table-of-contents";
import { CopyPageButton } from "@/components/docs/copy-page-button";
import { Breadcrumbs } from "@/components/docs/breadcrumbs";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background">
      {/* Full-width flex container */}
      <div className="flex min-h-screen">
        {/* Left Sidebar - flush to left edge */}
        <DocsSidebar />

        {/* Right side: header + content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header - nav links */}
          <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-40">
            <div className="px-8 py-3 flex items-center justify-between">
              <nav className="flex items-center gap-6 text-sm">
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
            </div>
          </header>

          {/* Content area - centered with max width */}
          <div className="flex-1 flex justify-center">
            <div className="flex w-full max-w-5xl">
              {/* Main Content - centered */}
              <div className="flex-1 px-12 py-10 min-w-0">
                {/* Breadcrumbs + Copy Button */}
                <div className="flex items-start justify-between mb-2">
                  <Breadcrumbs />
                  <CopyPageButton />
                </div>
                
                {/* Content */}
                <div className="max-w-2xl">
                  {children}
                </div>

                {/* Footer */}
                <footer className="mt-16 pt-8 border-t border-border max-w-2xl">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-6">
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

              {/* Table of Contents - right side */}
              <TableOfContents />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
