import { Sparkles, Cpu, Code2, ChevronDown } from "lucide-react"

interface AgentSelectorProps {
  value: "claude-code" | "codex" | "opencode"
  onChange: (agent: "claude-code" | "codex" | "opencode") => void
}

const agents = [
  { value: "claude-code" as const, label: "Claude Code", icon: Sparkles },
  { value: "codex" as const, label: "Codex", icon: Cpu },
  { value: "opencode" as const, label: "OpenCode", icon: Code2 },
]

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  const selected = agents.find(a => a.value === value) ?? agents[0]
  const SelectedIcon = selected.icon

  return (
    <div className="px-3 py-3 mt-auto">
      <div className="relative">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-hover)] 
                        border border-[var(--border-subtle)]">
          <SelectedIcon className="h-4 w-4 text-[var(--text-muted)]" />
          <select
            className="flex-1 bg-transparent border-0 text-[13px] text-[var(--text)] 
                       cursor-pointer appearance-none focus:outline-none focus:ring-0"
            value={value}
            onChange={(e) => onChange(e.target.value as typeof value)}
          >
            {agents.map((agent) => (
              <option key={agent.value} value={agent.value}>
                {agent.label}
              </option>
            ))}
          </select>
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-faint)]" />
        </div>
        
        <div className="mt-1.5 px-1">
          <span className="text-[10px] text-[var(--text-faint)]">
            New sessions will use this agent
          </span>
        </div>
      </div>
    </div>
  )
}
