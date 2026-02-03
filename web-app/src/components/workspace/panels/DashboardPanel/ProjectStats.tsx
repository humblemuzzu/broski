import * as React from "react"

interface ProjectStatsProps {
  projectCount: number
}

export const ProjectStats = React.memo<ProjectStatsProps>(({ projectCount }) => {
  return (
    <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-4">
      <div className="text-xs font-semibold text-muted-foreground">
        Projects
      </div>
      <div className="mt-2 text-2xl font-semibold">{projectCount}</div>
    </div>
  )
})

ProjectStats.displayName = "ProjectStats"