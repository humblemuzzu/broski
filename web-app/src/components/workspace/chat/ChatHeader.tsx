import * as React from "react"
import { Sparkles, Cpu, Code2, Users, MoreHorizontal } from "lucide-react"

export interface ChatHeaderProps {
  sessionId: string
  agent: string
  onOpenCollab?: () => void
}

// Agent icon mapping
function AgentIcon({ agent }: { agent: string }) {
  const iconClass = "h-4 w-4"
  
  switch (agent) {
    case "claude-code":
      return <Sparkles className={iconClass} />
    case "codex":
      return <Cpu className={iconClass} />
    case "opencode":
      return <Code2 className={iconClass} />
    default:
      return <Code2 className={iconClass} />
  }
}

// Agent display name
function getAgentName(agent: string): string {
  switch (agent) {
    case "claude-code":
      return "Claude Code"
    case "codex":
      return "Codex"
    case "opencode":
      return "OpenCode"
    default:
      return agent
  }
}

export const ChatHeader = React.memo(function ChatHeader({
  sessionId,
  agent,
  onOpenCollab,
}: ChatHeaderProps) {
  // Truncate session ID
  const shortId = sessionId.length > 12 ? sessionId.slice(0, 12) + "..." : sessionId

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[var(--panel-header-bg)]">
      <div className="flex items-center gap-3 min-w-0">
        {/* Agent icon */}
        <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0">
          <AgentIcon agent={agent} />
        </div>
        
        {/* Session info */}
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--text)]">
            {getAgentName(agent)}
          </div>
          <div className="text-[11px] text-[var(--text-muted)] truncate">
            {shortId}
          </div>
        </div>
      </div>
      
      {/* Actions */}
      <div className="flex items-center gap-1">
        {agent === "codex" && onOpenCollab && (
          <button
            onClick={onOpenCollab}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                       text-[var(--text-secondary)] hover:text-[var(--text)] 
                       hover:bg-[var(--bg-hover)] transition-all"
          >
            <Users className="h-3.5 w-3.5" />
            Multi-Agent
          </button>
        )}
        <button
          className="p-1.5 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-muted)] 
                     hover:bg-[var(--bg-hover)] transition-all"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
})
