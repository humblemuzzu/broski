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
              <div className="flex items-center gap-4">
                <a
                  href="https://github.com/humblemuzzu/broski"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                  </svg>
                </a>
              </div>
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
