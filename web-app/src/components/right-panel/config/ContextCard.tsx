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
    <div 
      className="rounded-lg p-3"
      style={{ 
        backgroundColor: '#171717', 
        border: '1px solid rgba(255,255,255,0.06)' 
      }}
    >
      <div className="text-xs font-semibold" style={{ color: '#e8e8e8' }}>
        Context
      </div>
      <div className="mt-2 text-xs" style={{ color: '#a8a8a8' }}>
        project: {projectPath ?? "(none)"}
      </div>
      <div className="mt-1 text-xs" style={{ color: '#a8a8a8' }}>
        session: {sessionAgent ?? "(none)"} ·{" "}
        {sessionId ?? "(none)"}
      </div>
    </div>
  )
})