import * as React from "react"

interface ContextCardProps {
  projectPath: string | null
  sessionAgent: string | null
  sessionId: string | null
}

export const ContextCard = React.memo<ContextCardProps>(function ContextCard({
  projectPath,
  sessionAgent,
  sessionId,
}) {
  return (
    <div className="rounded-lg border border-border bg-[var(--panel)] p-3">
      <div className="text-xs font-semibold text-muted-foreground">
        Context
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        project: {projectPath ?? "(none)"}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        session: {sessionAgent ?? "(none)"} ·{" "}
        {sessionId ?? "(none)"}
      </div>
    </div>
  )
})