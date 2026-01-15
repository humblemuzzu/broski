"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface TOCItem {
  id: string;
  text: string;
  level: number;
}

// Hook to extract headings
function useHeadings() {
  const [headings, setHeadings] = useState<TOCItem[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const pathname = usePathname();

  useEffect(() => {
    const timer = setTimeout(() => {
      const article = document.querySelector("article");
      if (!article) return;

      const elements = article.querySelectorAll("h2, h3");
      const items: TOCItem[] = [];

      elements.forEach((element) => {
        const id = element.id || element.textContent?.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "";
        if (!element.id) {
          element.id = id;
        }
        items.push({
          id,
          text: element.textContent || "",
          level: element.tagName === "H2" ? 2 : 3,
        });
      });

      setHeadings(items);
      setActiveId("");
    }, 100);

    return () => clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: "-80px 0px -80% 0px" }
    );

    headings.forEach((heading) => {
      const element = document.getElementById(heading.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [headings]);

  return { headings, activeId };
}

// Mobile TOC - Collapsible dropdown at top of content
export function MobileTableOfContents() {
  const { headings, activeId } = useHeadings();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (headings.length === 0) return null;

  const handleClick = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
    });
    setMobileOpen(false);
  };

  return (
    <div className="xl:hidden mb-6 border border-border rounded-lg bg-card/50">
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm"
      >
        <div className="flex items-center gap-2">
          <svg 
            className="w-4 h-4 text-muted-foreground" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M4 6h16M4 10h16M4 14h16M4 18h16" 
            />
          </svg>
          <span className="font-medium text-foreground">On this page</span>
        </div>
        <svg 
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${mobileOpen ? 'rotate-180' : ''}`}
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {/* Collapsible content */}
      <div className={`overflow-hidden transition-all duration-300 ease-out ${mobileOpen ? 'max-h-[60vh]' : 'max-h-0'}`}>
        <div className="px-4 pb-4 border-t border-border">
          <div className="pt-3 space-y-1 max-h-[50vh] overflow-y-auto">
            {headings.map((heading, index) => {
              const isActive = activeId === heading.id;
              const isNested = heading.level === 3;
              
              return (
                <button
                  key={`${heading.id}-${index}`}
                  onClick={() => handleClick(heading.id)}
                  className={`block w-full text-left py-2 px-3 rounded-md transition-colors ${
                    isNested ? "pl-6" : ""
                  } ${
                    isActive
                      ? "text-foreground bg-primary/10 font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                  style={{ fontSize: isNested ? "13px" : "14px" }}
                >
                  {heading.text}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Desktop TOC - Right sidebar (only visible on xl screens)
export function TableOfContents() {
  const { headings, activeId } = useHeadings();

  if (headings.length === 0) return null;

  const handleClick = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
    });
  };

  return (
    <nav className="hidden xl:block w-52 shrink-0 pl-6">
      <div className="sticky top-24">
        {/* Header with icon */}
        <div className="flex items-center gap-2 mb-4">
          <svg 
            className="w-4 h-4 text-muted-foreground" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M4 6h16M4 10h16M4 14h16M4 18h16" 
            />
          </svg>
          <span className="text-[13px] font-medium text-muted-foreground">
            On this page
          </span>
        </div>

        {/* TOC Items with left border */}
        <div className="border-l border-border">
          {headings.map((heading, index) => {
            const isActive = activeId === heading.id;
            const isNested = heading.level === 3;
            
            return (
              <a
                key={`${heading.id}-${index}`}
                href={`#${heading.id}`}
                className={`block py-1.5 transition-colors border-l-2 -ml-px ${
                  isNested ? "pl-5" : "pl-3"
                } ${
                  isActive
                    ? "text-foreground border-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
                style={{ fontSize: isNested ? "12px" : "13px" }}
                onClick={(e) => {
                  e.preventDefault();
                  handleClick(heading.id);
                }}
              >
                {heading.text}
              </a>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
