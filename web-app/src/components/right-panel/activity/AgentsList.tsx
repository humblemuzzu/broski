import * as React from "react"

interface Agent {
  name: string
}

interface AgentsListProps {
  agents: Agent[]
}

export const AgentsList = React.memo<AgentsListProps>(function AgentsList({
  agents,
}) {
  if (!agents || agents.length === 0) {
    return null
  }

  return (
    <div className="mt-3">
      <div className="text-xs font-semibold text-muted-foreground">
        Agents
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {agents.slice(0, 12).map((a) => (
          <div
            key={a.name}
            className="rounded-md border border-border bg-card px-2 py-1 text-[11px]"
          >
            {a.name}
          </div>
        ))}
      </div>
    </div>
  )
})