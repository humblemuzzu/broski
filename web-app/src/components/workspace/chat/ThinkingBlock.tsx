import * as React from "react"
import { Brain, ChevronDown, ChevronRight } from "lucide-react"

export interface ThinkingBlockProps {
  content: string
  defaultExpanded?: boolean
}

export const ThinkingBlock = React.memo(function ThinkingBlock({
  content,
  defaultExpanded = false,
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded)
  
  // Truncate for preview
  const preview = content.length > 150 ? content.slice(0, 150) + "..." : content
  
  return (
    <div className="rounded-xl bg-[var(--tool-thinking-bg)] border border-[var(--border-subtle)] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-hover)] transition-all"
      >
        <Brain className="h-3.5 w-3.5 text-[var(--tool-thinking)]" />
        <span className="text-xs font-medium text-[var(--tool-thinking)]">
          Thinking
        </span>
        <span className="flex-1" />
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-faint)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-faint)]" />
        )}
      </button>
      
      {/* Content */}
      <div className={[
        "px-3 pb-3 text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap",
        isExpanded ? "" : "line-clamp-2"
      ].join(" ")}>
        {isExpanded ? content : preview}
      </div>
    </div>
  )
})
