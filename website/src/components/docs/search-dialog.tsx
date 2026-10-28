"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SearchDialogProps {
  isOpen?: boolean;
  onClose?: () => void;
}

interface SearchResult {
  title: string;
  href: string;
  section: string;
  content: string;
  category: string;
}

// Search index - all docs content
const searchIndex: SearchResult[] = [
  // Getting Started
  { title: "Introduction", href: "/docs", section: "What is Broski?", content: "Broski is a mobile companion app for AI coding agents. Control Claude Code, OpenCode, Codex, or Pi from your phone.", category: "Get Started" },
  { title: "Quick Start", href: "/docs/setup", section: "Prerequisites", content: "Mac running macOS 12+, Node.js 18+ or Bun, iPhone or iPad running iOS 15+", category: "Get Started" },
  { title: "Quick Start", href: "/docs/setup", section: "Install the Bridge", content: "bunx broski or npx broski to start the bridge server", category: "Get Started" },
  { title: "Quick Start", href: "/docs/setup", section: "Scan QR Code", content: "Open Broski app and scan the QR code displayed in terminal", category: "Get Started" },
  { title: "Quick Start", href: "/docs/setup", section: "broski doctor", content: "Run diagnostics to verify installation, check dependencies and network", category: "Get Started" },
  
  // Mobile App
  { title: "Mobile App Overview", href: "/docs/app", section: "Navigation", content: "Projects Browse Sessions Settings tabs, bottom navigation bar", category: "Mobile App" },
  { title: "Mobile App Overview", href: "/docs/app", section: "Gestures", content: "Tap long press swipe left pull down pinch zoom gestures", category: "Mobile App" },
  { title: "Mobile App Overview", href: "/docs/app", section: "Connection Status", content: "Signal bars green yellow red offline mode cached data", category: "Mobile App" },
  { title: "Sessions", href: "/docs/app/sessions", section: "Sessions List", content: "Active sessions highlighted sessions forked badge background tasks", category: "Mobile App" },
  { title: "Sessions", href: "/docs/app/sessions", section: "Session Actions", content: "Tap to open swipe to delete long press highlight rename fork", category: "Mobile App" },
  { title: "Sessions", href: "/docs/app/sessions", section: "Session States", content: "Idle active retry highlighted pulsing indicator status dot", category: "Mobile App" },
  { title: "Chat Interface", href: "/docs/app/chat", section: "Messages", content: "User assistant system messages markdown code blocks streaming", category: "Mobile App" },
  { title: "Chat Interface", href: "/docs/app/chat", section: "Tool Calls", content: "Read Edit Write Bash Search Task Thinking tool cards icons", category: "Mobile App" },
  { title: "Chat Interface", href: "/docs/app/chat", section: "File Diffs", content: "Diff preview full screen viewer red green lines undo button", category: "Mobile App" },
  { title: "Chat Interface", href: "/docs/app/chat", section: "Permission Requests", content: "Approve deny permission prompt dangerous operations file edits bash", category: "Mobile App" },
  { title: "Chat Interface", href: "/docs/app/chat", section: "Input Bar", content: "Text field attachment send button @ mentions slash commands", category: "Mobile App" },
  { title: "Chat Interface", href: "/docs/app/chat", section: "Slash Commands", content: "/undo /redo /compact /fork /share /new /help commands", category: "Mobile App" },
  { title: "File Browser", href: "/docs/app/files", section: "Navigation", content: "Breadcrumbs path display back button project root folder", category: "Mobile App" },
  { title: "File Browser", href: "/docs/app/files", section: "Git Status", content: "M modified A added D deleted R renamed ? untracked badges", category: "Mobile App" },
  { title: "File Browser", href: "/docs/app/files", section: "Search", content: "File search text search symbol search functions classes", category: "Mobile App" },
  { title: "File Browser", href: "/docs/app/files", section: "File Viewer", content: "Syntax highlighting line numbers copy button images pinch zoom", category: "Mobile App" },
  { title: "Settings", href: "/docs/app/settings", section: "Connection", content: "Paired computers status local network relay device manager forget switch", category: "Mobile App" },
  { title: "Settings", href: "/docs/app/settings", section: "Appearance", content: "27 themes icon packs input bar style navigation style customization", category: "Mobile App" },
  { title: "Settings", href: "/docs/app/settings", section: "AI Backend", content: "OpenCode Claude Code Codex Pi switch backend providers models API keys", category: "Mobile App" },
  { title: "Settings", href: "/docs/app/settings", section: "OpenCode Settings", content: "Terminal sessions skills commands agents plugins MCP tools permissions", category: "Mobile App" },
  { title: "Settings", href: "/docs/app/settings", section: "Claude Code Settings", content: "Subagents custom tools plugins hooks MCP commands skills", category: "Mobile App" },
  { title: "Settings", href: "/docs/app/settings", section: "About", content: "Replay onboarding clear cache version support legal privacy terms", category: "Mobile App" },
  
  { title: "iOS Setup", href: "/docs/setup/ios", section: "Requirements", content: "iOS 15.0+, iPhone 8 or newer, iPad 6th generation or newer", category: "Get Started" },
  { title: "iOS Setup", href: "/docs/setup/ios", section: "Permissions", content: "Camera for QR scanning, Local Network for direct connection, Notifications optional", category: "Get Started" },
  { title: "iOS Setup", href: "/docs/setup/ios", section: "Remote Access", content: "Reach your Mac from anywhere with a relay, no VPN needed", category: "Get Started" },
  
  // Bridge
  { title: "Bridge Installation", href: "/docs/bridge", section: "Installation", content: "bunx broski, npx broski, bun install -g broski, npm install -g broski", category: "Bridge" },
  { title: "Bridge Commands", href: "/docs/bridge", section: "Commands", content: "broski install, broski-link pair, broski --port, broski --help, broski --version", category: "Bridge" },
  { title: "Configuration", href: "/docs/bridge/configuration", section: "CLI Options", content: "--port --verbose --new-token --tls --managed --manual --opencode-url", category: "Bridge" },
  { title: "Configuration", href: "/docs/bridge/configuration", section: "Environment Variables", content: "BROSKI_PORT BROSKI_VERBOSE BROSKI_TLS ANTHROPIC_API_KEY", category: "Bridge" },
  { title: "Configuration", href: "/docs/bridge/configuration", section: "OpenCode Modes", content: "--managed --manual connect to OpenCode server", category: "Bridge" },
  { title: "Remote Access", href: "/docs/bridge/remote-access", section: "Setup", content: "broski install, broski-link pair, scan the QR code with the Broski app", category: "Bridge" },
  { title: "Remote Access", href: "/docs/bridge/remote-access", section: "Using a Relay", content: "relay in ~/.broski/link/config.json, end-to-end encrypted, access from anywhere", category: "Bridge" },
  { title: "Background Service", href: "/docs/bridge/background-service", section: "LaunchAgent", content: "Run broski-link as a macOS service that starts automatically on login", category: "Bridge" },
  { title: "Background Service", href: "/docs/bridge/background-service", section: "systemd", content: "Linux systemd user service for persistent bridge", category: "Bridge" },
  
  // AI Backends
  { title: "AI Backends Overview", href: "/docs/backends", section: "Comparison", content: "Compare OpenCode, Claude Code, Codex, and Pi backends, choose the right one", category: "AI Backends" },
  { title: "Claude Code", href: "/docs/backends/claude-code", section: "Setup", content: "npm install -g @anthropic-ai/claude-code, Anthropic official SDK", category: "AI Backends" },
  { title: "Claude Code", href: "/docs/backends/claude-code", section: "Features", content: "Extended thinking, subagents, file checkpointing, plugins", category: "AI Backends" },
  { title: "Claude Code", href: "/docs/backends/claude-code", section: "Authentication", content: "ANTHROPIC_API_KEY or claude login for OAuth", category: "AI Backends" },
  { title: "OpenCode", href: "/docs/backends/opencode", section: "Setup", content: "npm install -g opencode, multi-provider support, open source", category: "AI Backends" },
  { title: "OpenCode", href: "/docs/backends/opencode", section: "Providers", content: "Anthropic, OpenAI, Google Gemini, Amazon Bedrock, Azure, Mistral, Groq", category: "AI Backends" },
  { title: "OpenCode", href: "/docs/backends/opencode", section: "MCP Integration", content: "Full Model Context Protocol support for custom tools", category: "AI Backends" },
  { title: "Codex", href: "/docs/backends/codex", section: "Setup", content: "OpenAI official CLI agent with sandbox and own tooling", category: "AI Backends" },
  { title: "Codex", href: "/docs/backends/codex", section: "Models", content: "GPT-4 Turbo, GPT-4, GPT-3.5 Turbo, o1 models", category: "AI Backends" },
  { title: "Pi", href: "/docs/backends/pi", section: "Setup", content: "npm install -g @earendil-works/pi-coding-agent, multi-provider, extension system, open source", category: "AI Backends" },
  { title: "Pi", href: "/docs/backends/pi", section: "Features", content: "Multi-provider support, extensions, skills, auto-compaction, session tree, fork, HTML export", category: "AI Backends" },
  { title: "Pi", href: "/docs/backends/pi", section: "Providers", content: "Anthropic, OpenAI, Google Gemini, Groq, Mistral, Ollama, any OpenAI-compatible provider", category: "AI Backends" },
  
  // Troubleshooting
  { title: "Common Issues", href: "/docs/troubleshooting", section: "Quick Diagnostics", content: "broski doctor command, check system requirements, verify installation", category: "Troubleshooting" },
  { title: "Connection Issues", href: "/docs/troubleshooting/connection", section: "Cannot Connect", content: "Bridge not running, wrong network, firewall blocking, token mismatch", category: "Troubleshooting" },
  { title: "Connection Issues", href: "/docs/troubleshooting/connection", section: "Port Already in Use", content: "lsof -nP -iTCP:18274 -sTCP:LISTEN, kill process, use different port", category: "Troubleshooting" },
  { title: "Network Issues", href: "/docs/troubleshooting/network", section: "Firewall", content: "macOS firewall settings, allow broski-link port 18275, socketfilterfw", category: "Troubleshooting" },
  { title: "Network Issues", href: "/docs/troubleshooting/network", section: "WiFi Issues", content: "Same network requirement, client isolation, connection drops", category: "Troubleshooting" },
  { title: "Network Issues", href: "/docs/troubleshooting/network", section: "Relay Issues", content: "Relay not connected, relay URL, machine asleep, broski-link status", category: "Troubleshooting" },
  { title: "AI Backend Issues", href: "/docs/troubleshooting/ai-backends", section: "OpenCode", content: "OpenCode not starting, provider errors, tool failures", category: "Troubleshooting" },
  { title: "AI Backend Issues", href: "/docs/troubleshooting/ai-backends", section: "Claude Code", content: "Authentication failures, rate limiting, permission issues", category: "Troubleshooting" },
  { title: "Error Reference", href: "/docs/troubleshooting/errors", section: "Startup Errors", content: "Port in use, OpenCode not found, managed server failed", category: "Troubleshooting" },
  { title: "Error Reference", href: "/docs/troubleshooting/errors", section: "Connection Errors", content: "Machine did not answer, no address, pairing not confirmed, offline, asleep", category: "Troubleshooting" },
  { title: "Error Reference", href: "/docs/troubleshooting/errors", section: "HTTP Codes", content: "400 401 403 404 429 500 502 error codes explained", category: "Troubleshooting" },
  
  // Reference
  { title: "CLI Reference", href: "/docs/reference/cli", section: "Commands", content: "broski, broski install, broski doctor, broski-link pair status devices revoke subcommands", category: "Reference" },
  { title: "CLI Reference", href: "/docs/reference/cli", section: "Options", content: "--port --verbose --new-token --tls --managed --manual", category: "Reference" },
  { title: "Environment Variables", href: "/docs/reference/env", section: "Bridge Variables", content: "BROSKI_PORT BROSKI_VERBOSE BROSKI_TLS", category: "Reference" },
  { title: "Environment Variables", href: "/docs/reference/env", section: "API Keys", content: "ANTHROPIC_API_KEY OPENAI_API_KEY GOOGLE_API_KEY", category: "Reference" },
  { title: "Privacy & Security", href: "/docs/reference/privacy", section: "Data Flow", content: "What stays local, what goes to AI providers, no telemetry", category: "Reference" },
  { title: "Privacy & Security", href: "/docs/reference/privacy", section: "Authentication", content: "One-time pairing secret, Noise encryption, device revocation", category: "Reference" },
  
  // FAQ
  { title: "FAQ", href: "/docs/faq", section: "What is Broski?", content: "Mobile companion app for AI coding agents, remote control for OpenCode, Claude Code, Codex, and Pi", category: "FAQ" },
  { title: "FAQ", href: "/docs/faq", section: "Is Broski free?", content: "Yes, completely free. You need your own AI provider subscription.", category: "FAQ" },
  { title: "FAQ", href: "/docs/faq", section: "Platforms supported", content: "iOS 15+, Android 8+, macOS 12+, Linux", category: "FAQ" },
  { title: "FAQ", href: "/docs/faq", section: "OpenCode vs Claude Code", content: "OpenCode supports multiple providers, Claude Code is Anthropic official", category: "FAQ" },
  { title: "FAQ", href: "/docs/faq", section: "Multiple phones", content: "Can multiple phones connect to same bridge simultaneously, all see same sessions", category: "FAQ" },
  { title: "FAQ", href: "/docs/faq", section: "Cellular data", content: "Use Broski over cellular through a relay for remote access", category: "FAQ" },
  { title: "FAQ", href: "/docs/faq", section: "Custom port", content: "broski --port 8080 or BROSKI_PORT environment variable", category: "FAQ" },
  { title: "FAQ", href: "/docs/faq", section: "Background service", content: "Run broski-link as a service with launchd on macOS or systemd on Linux", category: "FAQ" },
  { title: "FAQ", href: "/docs/faq", section: "Session sharing", content: "Sessions stored per-computer, not shared between backends or machines", category: "FAQ" },
  { title: "FAQ", href: "/docs/faq", section: "Local models", content: "Use Ollama with OpenCode for free local AI models", category: "FAQ" },
  
  // Guides
  { title: "Your First Session", href: "/docs/guides/first-session", section: "Before You Start", content: "Bridge running phone connected AI backend configured prerequisites", category: "Guides" },
  { title: "Your First Session", href: "/docs/guides/first-session", section: "Open a Project", content: "Projects tab find your project tap to open new session", category: "Guides" },
  { title: "Your First Session", href: "/docs/guides/first-session", section: "Send Your First Message", content: "Input field type message tap send watch response stream", category: "Guides" },
  { title: "Your First Session", href: "/docs/guides/first-session", section: "Understanding Tool Calls", content: "Read Edit Write Bash Search Task tools AI uses to work", category: "Guides" },
  { title: "Your First Session", href: "/docs/guides/first-session", section: "Approve a Command", content: "Permission required approve deny dangerous operations", category: "Guides" },
  { title: "Your First Session", href: "/docs/guides/first-session", section: "View the Results", content: "Diff preview full screen diff undo changes red green lines", category: "Guides" },
  { title: "Approving Commands", href: "/docs/guides/approve-commands", section: "Why Approvals Exist", content: "Safety control awareness AI mistakes dangerous operations", category: "Guides" },
  { title: "Approving Commands", href: "/docs/guides/approve-commands", section: "What Needs Approval", content: "Bash commands file edits git operations package installs destructive", category: "Guides" },
  { title: "Approving Commands", href: "/docs/guides/approve-commands", section: "The Approval Card", content: "Permission required diff preview approve deny buttons", category: "Guides" },
  { title: "Approving Commands", href: "/docs/guides/approve-commands", section: "Always Allow", content: "Auto-approve permission modes default plan auto-edit allowAll", category: "Guides" },
  { title: "Approving Commands", href: "/docs/guides/approve-commands", section: "Security Best Practices", content: "Review bash commands check diffs use git deny suspicious", category: "Guides" },
  { title: "Remote Coding", href: "/docs/guides/remote-coding", section: "The Problem", content: "Leave house lose connection travel need to check work remote", category: "Guides" },
  { title: "Remote Coding", href: "/docs/guides/remote-coding", section: "Relay Solution", content: "End-to-end encrypted relay, no VPN needed, works anywhere", category: "Guides" },
  { title: "Remote Coding", href: "/docs/guides/remote-coding", section: "Quick Setup", content: "broski install, relay in config.json, broski-link pair", category: "Guides" },
  { title: "Remote Coding", href: "/docs/guides/remote-coding", section: "Tips", content: "Check route with broski-link status, revoke a lost phone", category: "Guides" },
  { title: "Remote Coding", href: "/docs/guides/remote-coding", section: "Summary", content: "Local network is fastest, relay works from anywhere", category: "Guides" },
  { title: "Remote Coding", href: "/docs/guides/remote-coding", section: "Workflow Tips", content: "Keep Mac awake background service caffeinate connection quality", category: "Guides" },
  
  // Legal
  { title: "Privacy Policy", href: "/legal/privacy", section: "Data Collection", content: "Broski does not collect any personal data, peer-to-peer connection", category: "Legal" },
  { title: "Terms of Service", href: "/legal/terms", section: "Usage", content: "Terms and conditions for using Broski", category: "Legal" },
];

export function SearchDialog({ isOpen: controlledOpen, onClose }: SearchDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Search function
  const search = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }

    const lowerQuery = q.toLowerCase();
    const filtered = searchIndex.filter(
      (item) =>
        item.title.toLowerCase().includes(lowerQuery) ||
        item.section.toLowerCase().includes(lowerQuery) ||
        item.content.toLowerCase().includes(lowerQuery) ||
        item.category.toLowerCase().includes(lowerQuery)
    );

    // Sort by relevance (title matches first)
    filtered.sort((a, b) => {
      const aTitle = a.title.toLowerCase().includes(lowerQuery);
      const bTitle = b.title.toLowerCase().includes(lowerQuery);
      if (aTitle && !bTitle) return -1;
      if (!aTitle && bTitle) return 1;
      return 0;
    });

    setResults(filtered.slice(0, 10));
    setSelectedIndex(0);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Open on / or Cmd+K (only if not controlled)
      if (controlledOpen === undefined) {
        if (
          (e.key === "/" && !isOpen && document.activeElement?.tagName !== "INPUT") ||
          (e.key === "k" && (e.metaKey || e.ctrlKey))
        ) {
          e.preventDefault();
          setInternalOpen(true);
        }
      }

      // Close on Escape
      if (e.key === "Escape" && isOpen) {
        if (onClose) {
          onClose();
        } else {
          setInternalOpen(false);
        }
        setQuery("");
        setResults([]);
      }

      // Navigate results
      if (isOpen && results.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % results.length);
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const selected = results[selectedIndex];
          if (selected) {
            router.push(selected.href);
            if (onClose) {
              onClose();
            } else {
              setInternalOpen(false);
            }
            setQuery("");
            setResults([]);
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, results, selectedIndex, router, controlledOpen, onClose]);

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Prevent body scroll when open on mobile
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Update search on query change
  useEffect(() => {
    search(query);
  }, [query, search]);

  // Handle result click
  const handleResultClick = (href: string) => {
    router.push(href);
    if (onClose) {
      onClose();
    } else {
      setInternalOpen(false);
    }
    setQuery("");
    setResults([]);
  };

  // Handle close
  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      setInternalOpen(false);
    }
    setQuery("");
    setResults([]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Dialog - Full screen on mobile, centered modal on desktop */}
      <div className="relative h-full md:h-auto md:max-w-2xl md:mx-auto md:mt-[10vh] md:px-4">
        <div className="bg-card border-0 md:border border-border md:rounded-xl shadow-2xl overflow-hidden h-full md:h-auto flex flex-col">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-border shrink-0">
            {/* Back button on mobile */}
            <button
              onClick={handleClose}
              className="md:hidden flex items-center justify-center w-8 h-8 -ml-1 rounded-lg hover:bg-muted/50 active:bg-muted transition-colors"
              aria-label="Close search"
            >
              <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <svg className="w-5 h-5 text-muted-foreground shrink-0 hidden md:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documentation..."
              className="flex-1 py-4 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-base"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-muted/50 active:bg-muted transition-colors md:hidden"
                aria-label="Clear search"
              >
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <kbd className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded hidden md:inline">ESC</kbd>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto md:max-h-[60vh]">
            {results.length > 0 ? (
              <div className="py-2">
                {results.map((result, index) => (
                  <button
                    key={`${result.href}-${result.section}`}
                    onClick={() => handleResultClick(result.href)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                      index === selectedIndex ? "bg-primary/10" : "hover:bg-muted/50 active:bg-muted"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">{result.title}</span>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          {result.category}
                        </span>
                      </div>
                      <p className="text-sm text-primary mt-0.5">{result.section}</p>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2 md:line-clamp-1">
                        {result.content}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ) : query ? (
              <div className="py-12 text-center text-muted-foreground">
                <p>No results found for &quot;{query}&quot;</p>
                <p className="text-sm mt-2">Try different keywords</p>
              </div>
            ) : (
              <div className="py-8 px-4">
                <p className="text-sm text-muted-foreground mb-4">Quick links</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { title: "Quick Start", href: "/docs/setup" },
                    { title: "Troubleshooting", href: "/docs/troubleshooting" },
                    { title: "FAQ", href: "/docs/faq" },
                    { title: "Bridge Setup", href: "/docs/bridge" },
                  ].map((link) => (
                    <button
                      key={link.href}
                      onClick={() => handleResultClick(link.href)}
                      className="flex items-center gap-2 px-3 py-3 sm:py-2 text-sm text-left rounded-lg hover:bg-muted/50 active:bg-muted transition-colors"
                    >
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                      {link.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer - Desktop only */}
          <div className="hidden md:flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground shrink-0">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-muted rounded">↑</kbd>
                <kbd className="px-1.5 py-0.5 bg-muted rounded">↓</kbd>
                to navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-muted rounded">↵</kbd>
                to select
              </span>
            </div>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted rounded">esc</kbd>
              to close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Export the trigger button separately
export function SearchButton() {
  const [, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "/" && document.activeElement?.tagName !== "INPUT") ||
        (e.key === "k" && (e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault();
        setIsOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null; // The SearchDialog handles everything
}
