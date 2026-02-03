import * as React from "react"
import { ChevronDown, Plus, Smile, Mic, ArrowUp, Flag, FileText, GitPullRequest } from "lucide-react"

import { useProjectsStore } from "@/stores/projects-store"
import { useConnectionStore } from "@/stores/connection-store"

// Codex-style cloud/flower icon
function BroskiIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="1.5"
      className={className}
      style={style}
    >
      <path d="M12 3C8.5 3 6 5.5 6 8.5C4 9 2.5 11 2.5 13.5C2.5 16.5 5 19 8 19H16C19 19 21.5 16.5 21.5 13.5C21.5 11 20 9 18 8.5C18 5.5 15.5 3 12 3Z" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>
      <path d="M9 15.5C9 15.5 10.5 17 12 17C13.5 17 15 15.5 15 15.5" strokeLinecap="round"/>
    </svg>
  )
}

// Suggestion cards like Codex
const suggestions = [
  {
    icon: Flag,
    title: "Build a classic Snake game in this repo.",
    tone: "muted",
  },
  {
    icon: FileText,
    title: "Create a one-page $pdf that summarizes this app.",
    tone: "success",
  },
  {
    icon: GitPullRequest,
    title: "Summarize last week's PRs by teammate and theme.",
    tone: "warning",
  },
] as const

export function DashboardPanel() {
  const [inputValue, setInputValue] = React.useState("")
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const activeAgent = useConnectionStore((s) => s.activeAgent)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Get project name from path
  const projectName = selectedProjectPath?.split("/").pop() ?? "your project"

  // Auto-resize textarea
  React.useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px"
    }
  }, [inputValue])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      // Handle send
    }
  }

  const getAgentLabel = () => {
    switch (activeAgent) {
      case "claude-code": return "Claude"
      case "codex": return "Codex"
      case "opencode": return "OpenCode"
      default: return "Agent"
    }
  }

  return (
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: '#0f0f0f' }}>
      {/* Main content - centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Icon */}
        <div className="mb-6">
          <BroskiIcon className="w-16 h-16" style={{ color: '#808080' }} />
        </div>

        {/* Title */}
        <h1 className="text-3xl font-medium mb-2" style={{ color: '#e8e8e8' }}>
          Let's build
        </h1>

        {/* Project selector */}
        <button 
          className="flex items-center gap-1 text-xl transition-colors hover:opacity-80"
          style={{ color: '#808080' }}
        >
          <span>{projectName}</span>
          <ChevronDown className="w-5 h-5" />
        </button>

        {/* Explore more link */}
        <button 
          className="mt-8 text-sm transition-colors hover:opacity-80"
          style={{ color: '#5c5c5c' }}
        >
          Explore more
        </button>

        {/* Suggestion cards */}
        <div className="mt-6 flex gap-3 max-w-2xl">
          {suggestions.map((suggestion, i) => {
            const Icon = suggestion.icon
            const iconColor =
              suggestion.tone === "success"
                ? '#4ade80'
                : suggestion.tone === "warning"
                  ? '#fbbf24'
                  : '#5c5c5c'
            return (
              <button
                key={i}
                className="flex-1 p-4 rounded-xl transition-all text-left group"
                style={{ 
                  backgroundColor: '#171717',
                  border: '1px solid rgba(255,255,255,0.04)'
                }}
              >
                <Icon 
                  className="w-5 h-5 mb-3"
                  style={{ color: iconColor }}
                />
                <p 
                  className="text-sm leading-relaxed transition-colors"
                  style={{ color: '#a8a8a8' }}
                >
                  {suggestion.title}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Bottom input bar - Codex style */}
      <div className="px-6 pb-6">
        <div className="max-w-3xl mx-auto">
          {/* Input container */}
          <div 
            className="rounded-2xl overflow-hidden"
            style={{ 
              backgroundColor: '#171717',
              border: '1px solid rgba(255,255,255,0.1)'
            }}
          >
            {/* Textarea */}
            <div className="px-4 pt-4">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Broski anything, @ to add files, / for commands"
                rows={1}
                className="w-full bg-transparent resize-none focus:outline-none text-base leading-relaxed"
                style={{ color: '#e8e8e8' }}
              />
            </div>

            {/* Bottom row with actions */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                {/* Add button */}
                <button 
                  className="p-1.5 rounded-lg transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                  style={{ color: '#5c5c5c' }}
                >
                  <Plus className="w-5 h-5" />
                </button>
                
                {/* Agent/model selector */}
                <button 
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                  style={{ color: '#a8a8a8' }}
                >
                  <span className="text-sm font-medium">{getAgentLabel()}</span>
                  <span className="text-sm" style={{ color: '#5c5c5c' }}>Default</span>
                  <ChevronDown className="w-3.5 h-3.5" style={{ color: '#5c5c5c' }} />
                </button>
              </div>

              <div className="flex items-center gap-2">
                {/* Emoji */}
                <button 
                  className="p-1.5 rounded-lg transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                  style={{ color: '#5c5c5c' }}
                >
                  <Smile className="w-5 h-5" />
                </button>
                
                {/* Voice */}
                <button 
                  className="p-1.5 rounded-lg transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                  style={{ color: '#5c5c5c' }}
                >
                  <Mic className="w-5 h-5" />
                </button>

                {/* Send button */}
                <button 
                  className="p-2 rounded-full transition-colors"
                  style={{ 
                    backgroundColor: inputValue.trim() ? '#e8e8e8' : '#212121',
                    color: inputValue.trim() ? '#0f0f0f' : '#5c5c5c'
                  }}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Context row below input */}
          <div className="flex items-center justify-between px-1 mt-3">
            <div className="flex items-center gap-4">
              <button className="text-sm font-medium" style={{ color: '#e8e8e8' }}>Local</button>
              <button 
                className="text-sm transition-colors hover:opacity-80"
                style={{ color: '#5c5c5c' }}
              >
                Worktree
              </button>
            </div>
            <div className="flex items-center gap-2 text-sm" style={{ color: '#5c5c5c' }}>
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
              </svg>
              <span>main</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
