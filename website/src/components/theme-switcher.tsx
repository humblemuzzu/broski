"use client";

import { useState, useEffect } from "react";

type Theme = "opencode" | "broski" | "light";

const themeConfig: Record<Theme, { next: Theme }> = {
  opencode: { next: "broski" },
  broski: { next: "light" },
  light: { next: "opencode" },
};

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("opencode");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("broski-theme") as Theme | null;
    if (saved && (saved === "opencode" || saved === "broski" || saved === "light")) {
      setTheme(saved);
      applyTheme(saved);
    }
  }, []);

  const applyTheme = (newTheme: Theme) => {
    const html = document.documentElement;
    html.classList.remove("theme-broski", "theme-light");
    if (newTheme === "broski") {
      html.classList.add("theme-broski");
    } else if (newTheme === "light") {
      html.classList.add("theme-light");
    }
  };

  const cycleTheme = () => {
    const nextTheme = themeConfig[theme].next;
    setTheme(nextTheme);
    applyTheme(nextTheme);
    localStorage.setItem("broski-theme", nextTheme);
  };

  if (!mounted) return null;

  // Small icon buttons like Agentset
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={cycleTheme}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        title="Toggle theme"
      >
        {theme === "light" ? (
          // Sun icon for light mode
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ) : (
          // Moon icon for dark modes
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        )}
      </button>
      <button
        onClick={cycleTheme}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        title="Color scheme"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>
  );
}
