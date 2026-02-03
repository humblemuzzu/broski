import type { Config } from "tailwindcss"
import typography from "@tailwindcss/typography"

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Map CSS variables to Tailwind colors - MUST MATCH globals.css exactly
        border: "var(--border)",
        input: "var(--bg-input)",
        ring: "var(--accent)",
        background: "var(--background)",
        foreground: "var(--text)",
        primary: {
          DEFAULT: "var(--accent)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--bg-elevated)",
          foreground: "var(--text)",
        },
        destructive: {
          DEFAULT: "var(--error)",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "var(--bg-overlay)",
          foreground: "var(--text-muted)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--text)",
        },
        popover: {
          DEFAULT: "var(--bg-elevated)",
          foreground: "var(--text)",
        },
        card: {
          DEFAULT: "var(--background-panel)",
          foreground: "var(--text)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar-bg)",
          foreground: "var(--text)",
          border: "var(--border-subtle)",
          accent: "var(--accent)",
          ring: "var(--accent)",
        },
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
        xl: "var(--radius-xl)",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["SF Mono", "Fira Code", "JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [typography],
} satisfies Config
