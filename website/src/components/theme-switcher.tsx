"use client";

import { useState, useEffect } from "react";

type Theme = "opencode" | "broski";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("opencode");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check for saved preference
    const saved = localStorage.getItem("broski-theme") as Theme | null;
    if (saved && (saved === "opencode" || saved === "broski")) {
      setTheme(saved);
      applyTheme(saved);
    }
  }, []);

  const applyTheme = (newTheme: Theme) => {
    const html = document.documentElement;
    if (newTheme === "broski") {
      html.classList.add("theme-broski");
    } else {
      html.classList.remove("theme-broski");
    }
  };

  const toggleTheme = () => {
    const newTheme = theme === "opencode" ? "broski" : "opencode";
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem("broski-theme", newTheme);
  };

  if (!mounted) return null;

  return (
    <button
      onClick={toggleTheme}
      className="fixed top-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-full bg-card border border-border/50 text-sm font-medium text-foreground hover:bg-muted transition-colors"
      title={`Switch to ${theme === "opencode" ? "Broski" : "OpenCode"} theme`}
    >
      {theme === "opencode" ? (
        <>
          <span className="w-3 h-3 rounded-full bg-[#fab283]" />
          <span className="hidden sm:inline">OpenCode</span>
        </>
      ) : (
        <>
          <span className="w-3 h-3 rounded-full bg-[#D0D0D4]" />
          <span className="hidden sm:inline">Broski</span>
        </>
      )}
      <svg
        className="w-4 h-4 opacity-60"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
        />
      </svg>
    </button>
  );
}
