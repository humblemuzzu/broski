"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

interface CopyPageButtonProps {
  title?: string;
}

function cleanText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function escapeMarkdown(text: string) {
  return text.replace(/([`*_#[\]()])/g, "\\$1");
}

function getLanguageFromCodeElement(code: HTMLElement) {
  const className = code.className || "";
  const match = className.match(/language-([\w-]+)/);
  return match?.[1] ?? "text";
}

function tableToMarkdown(table: HTMLTableElement) {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (rows.length === 0) return "";

  const rowCells = rows.map((row) =>
    Array.from(row.querySelectorAll("th, td")).map((cell) => cleanText(cell.textContent ?? "")),
  );

  const maxCols = Math.max(...rowCells.map((r) => r.length), 0);
  if (maxCols === 0) return "";

  const padded = rowCells.map((r) => [...r, ...Array.from({ length: maxCols - r.length }, () => "")]);
  const header = padded[0];
  const separator = Array.from({ length: maxCols }, () => "---");
  const body = padded.slice(1);

  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];

  return `${lines.join("\n")}\n\n`;
}

function nodeToMarkdown(node: Node, listDepth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeMarkdown(cleanText(node.textContent ?? ""));
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === "script" || tag === "style" || tag === "button") return "";

  if (tag === "pre") {
    const code = el.querySelector("code") as HTMLElement | null;
    const codeText = cleanText(code?.textContent ?? el.textContent ?? "");
    const language = code ? getLanguageFromCodeElement(code) : "text";
    return `\n\n\
\`\`\`${language}\n${codeText}\n\`\`\`\n\n`;
  }

  if (tag === "code") {
    return `\`${cleanText(el.textContent ?? "")}\``;
  }

  if (tag === "table") {
    return tableToMarkdown(el as HTMLTableElement);
  }

  const childMarkdown = Array.from(el.childNodes)
    .map((child) => nodeToMarkdown(child, listDepth + (tag === "ul" || tag === "ol" ? 1 : 0)))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  switch (tag) {
    case "h1":
      return `# ${cleanText(el.textContent ?? childMarkdown)}\n\n`;
    case "h2":
      return `## ${cleanText(el.textContent ?? childMarkdown)}\n\n`;
    case "h3":
      return `### ${cleanText(el.textContent ?? childMarkdown)}\n\n`;
    case "h4":
      return `#### ${cleanText(el.textContent ?? childMarkdown)}\n\n`;
    case "p":
      return `${childMarkdown || cleanText(el.textContent ?? "")}\n\n`;
    case "blockquote":
      return `${(childMarkdown || cleanText(el.textContent ?? ""))
        .split("\n")
        .filter(Boolean)
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    case "ul":
      return `${Array.from(el.children)
        .map((li) => nodeToMarkdown(li, listDepth + 1))
        .join("")}\n`;
    case "ol":
      return `${Array.from(el.children)
        .map((li, index) => {
          const liText = cleanText(li.textContent ?? "");
          return `${"  ".repeat(Math.max(listDepth - 1, 0))}${index + 1}. ${liText}\n`;
        })
        .join("")}\n`;
    case "li": {
      const liText = cleanText(el.textContent ?? childMarkdown);
      return `${"  ".repeat(Math.max(listDepth - 1, 0))}- ${liText}\n`;
    }
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const text = cleanText(el.textContent ?? "Link");
      if (!href) return text;
      return `[${text}](${href})`;
    }
    case "article":
    case "section":
    case "div":
      return `${childMarkdown}\n\n`;
    default:
      return childMarkdown ? `${childMarkdown}\n` : cleanText(el.textContent ?? "");
  }
}

export function CopyPageButton({ title }: CopyPageButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getPageMarkdown = () => {
    const article = document.querySelector("article");
    if (!article) return "";

    const pageTitle = title || document.title.replace(/\s*-\s*Broski\s*$/i, "").trim();
    const body = nodeToMarkdown(article)
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return `# ${pageTitle}\n\nSource: ${window.location.href}\n\n${body}`;
  };

  const getAiPrompt = () => {
    const markdown = getPageMarkdown();
    const compact = markdown.length > 7000 ? `${markdown.slice(0, 7000)}\n\n[truncated]` : markdown;

    return `You are helping me understand a Broski docs page.\n\nPlease:\n1) Summarize the key points in 6 bullets.\n2) Give a practical setup/checklist from this page.\n3) Call out common mistakes to avoid.\n4) Provide 3 follow-up questions I should ask next.\n\n--- PAGE CONTENT (Markdown) ---\n${compact}`;
  };

  const handleCopy = async () => {
    const content = getPageMarkdown();
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      setIsOpen(false);
    }, 1400);
  };

  const openInModel = (provider: "chatgpt" | "claude") => {
    const prompt = encodeURIComponent(getAiPrompt());
    const url =
      provider === "chatgpt"
        ? `https://chatgpt.com/?q=${prompt}`
        : `https://claude.ai/new?q=${prompt}`;

    window.open(url, "_blank", "noopener,noreferrer");
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="inline-flex items-stretch">
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-2 rounded-l-lg border border-r-0 border-border/70 bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted/40 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
          <span>{copied ? "Copied" : "Copy page"}</span>
        </button>

        <button
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Open AI options"
          className="inline-flex items-center rounded-r-lg border border-border/70 bg-background px-2.5 py-1.5 text-foreground hover:bg-muted/40 transition-colors"
        >
          <svg
            className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border/70 bg-card p-1.5 shadow-xl">
          <button
            onClick={() => openInModel("chatgpt")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors"
          >
            <Image src="/logos/openai.svg" alt="OpenAI" width={18} height={18} className="shrink-0" />
            <div>
              <p className="font-medium">Open in ChatGPT</p>
              <p className="text-xs text-muted-foreground">Open with a prefilled page prompt</p>
            </div>
          </button>

          <button
            onClick={() => openInModel("claude")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors"
          >
            <Image src="/logos/anthropic.svg" alt="Anthropic Claude" width={18} height={18} className="shrink-0" />
            <div>
              <p className="font-medium">Open in Claude</p>
              <p className="text-xs text-muted-foreground">Open with a prefilled page prompt</p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
