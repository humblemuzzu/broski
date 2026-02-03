import React from "react"
import { MessageSquare, Sparkles, Cpu, Code2 } from "lucide-react"

interface SessionItemProps {
  session: { id: string; title: string; agentType: string }
  isSelected: boolean
  onSelect: () => void
}

// Agent icon mapping
function AgentIcon({ agent }: { agent: string }) {
  const iconClass = "h-3.5 w-3.5 flex-shrink-0"
  
  switch (agent) {
    case "claude-code":
      return <Sparkles className={iconClass} />
    case "codex":
      return <Cpu className={iconClass} />
    case "opencode":
      return <Code2 className={iconClass} />
    default:
      return <MessageSquare className={iconClass} />
  }
}

// Agent label
function getAgentLabel(agent: string): string {
  switch (agent) {
    case "claude-code":
      return "Claude"
    case "codex":
      return "Codex"
    case "opencode":
      return "OpenCode"
    default:
      return agent
  }
}

export const SessionItem = React.memo<SessionItemProps>(({ 
  session, 
  isSelected, 
  onSelect 
}) => {
  // Truncate title nicely
  const displayTitle = session.title.length > 32 
    ? session.title.slice(0, 32) + "..." 
    : session.title

  return (
    <button
      className={[
        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all",
        isSelected 
          ? "bg-[var(--sidebar-item-selected)] text-[var(--text)]" 
          : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-item-hover)] hover:text-[var(--text)]",
      ].join(" ")}
      onClick={onSelect}
    >
      <AgentIcon agent={session.agentType} />
      
      <div className="min-w-0 flex-1">
        <div className="text-[13px] truncate leading-tight">
          {displayTitle}
        </div>
        <div className="text-[11px] text-[var(--text-faint)] mt-0.5">
          {getAgentLabel(session.agentType)}
        </div>
      </div>
    </button>
  )
})

SessionItem.displayName = "SessionItem"
