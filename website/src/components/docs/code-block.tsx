"use client";

import { useState, useEffect } from "react";
import { codeToHtml } from "shiki";

interface CodeBlockProps {
  children: string;
  language?: string;
  filename?: string;
  showHeader?: boolean;
}

export function CodeBlock({ children, language = "text", filename, showHeader = true }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");
  const code = children.trim();

  // Detect if content is ASCII art (contains box-drawing characters)
  const isAsciiArt = /[┌┐└┘│─├┤┬┴┼═║╔╗╚╝╠╣╦╩╬█▀▄▌▐░▒▓]/.test(code);
  const isPlainOutput = language?.toLowerCase() === "terminal" || language?.toLowerCase() === "output" || isAsciiArt;

  useEffect(() => {
    // Skip syntax highlighting for ASCII art / terminal output
    if (isPlainOutput) {
      setHighlightedHtml(`<pre><code>${escapeHtml(code)}</code></pre>`);
      return;
    }

    const highlight = async () => {
      try {
        // Map common language aliases
        const langMap: Record<string, string> = {
          "sh": "bash",
          "shell": "bash",
          "zsh": "bash",
          "console": "bash",
          "js": "javascript",
          "ts": "typescript",
          "tsx": "tsx",
          "jsx": "jsx",
          "yml": "yaml",
          "plist": "xml",
          "env": "bash",
          "conf": "ini",
          "config": "ini",
        };

        const lang = langMap[language?.toLowerCase() || ""] || language?.toLowerCase() || "text";

        const html = await codeToHtml(code, {
          lang: lang,
          themes: {
            light: "github-light",
            dark: "github-dark",
          },
          defaultColor: false,
        });
        setHighlightedHtml(html);
      } catch (e) {
        // Fallback for unknown languages
        console.warn(`Shiki: Unknown language "${language}", falling back to plaintext`);
        const html = await codeToHtml(code, {
          lang: "text",
          themes: {
            light: "github-light",
            dark: "github-dark",
          },
          defaultColor: false,
        });
        setHighlightedHtml(html);
      }
    };

    highlight();
  }, [code, language, isPlainOutput]);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLabel = filename || language;

  return (
    <div className="code-block group relative my-5 rounded-xl border bg-[--code-bg] overflow-hidden">
      {/* Header - Agentset style with tab indicator */}
      {showHeader && (
        <div className="flex items-center justify-between px-4 pt-3 pb-0">
          <div className="flex items-center gap-4">
            {displayLabel && (
              <span className="code-block-label text-[13px] font-medium pb-2.5 border-b-2">
                {displayLabel}
              </span>
            )}
          </div>
          <button
            onClick={copyToClipboard}
            className="code-block-copy p-1.5 -mr-1 rounded-md transition-all"
            title={copied ? "Copied!" : "Copy code"}
          >
            {copied ? (
              <CheckIcon className="w-4 h-4" />
            ) : (
              <CopyIcon className="w-4 h-4" />
            )}
          </button>
        </div>
      )}
      
      {/* Code - use tighter line-height for ASCII art, normal for code */}
      <div 
        className={`shiki-wrapper overflow-x-auto text-[13px] [&_pre]:!bg-transparent [&_pre]:!py-4 [&_pre]:!px-4 [&_pre]:!m-0 [&_code]:!bg-transparent font-mono ${
          isPlainOutput ? "leading-[1.2]" : "leading-[1.7]"
        }`}
        dangerouslySetInnerHTML={{ __html: highlightedHtml || `<pre><code>${escapeHtml(code)}</code></pre>` }}
      />
    </div>
  );
}

// Helper to escape HTML for fallback
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Inline code component
export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded-md bg-black/[0.05] dark:bg-white/[0.08] text-[13px] font-mono text-foreground">
      {children}
    </code>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
