import * as React from "react"

interface SessionStatsProps {
  sessionCount: number
  selectedProject?: string | null
}

export const SessionStats = React.memo<SessionStatsProps>(({ 
  sessionCount, 
  selectedProject 
}) => {
  return (
    <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-4">
      <div className="text-xs font-semibold text-muted-foreground">
        Sessions{selectedProject ? " (selected)" : ""}
      </div>
      <div className="mt-2 text-2xl font-semibold">{sessionCount}</div>
    </div>
  )
})

SessionStats.displayName = "SessionStats"