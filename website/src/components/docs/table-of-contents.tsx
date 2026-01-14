"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface TOCItem {
  id: string;
  text: string;
  level: number;
}

export function TableOfContents() {
  const [headings, setHeadings] = useState<TOCItem[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const pathname = usePathname();

  useEffect(() => {
    // Small delay to ensure page content is rendered
    const timer = setTimeout(() => {
      // Extract headings from the page
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
      setActiveId(""); // Reset active heading on route change
    }, 100);

    return () => clearTimeout(timer);
  }, [pathname]); // Re-run when pathname changes

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

  if (headings.length === 0) return null;

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
                  document.getElementById(heading.id)?.scrollIntoView({
                    behavior: "smooth",
                  });
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
