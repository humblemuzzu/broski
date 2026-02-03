import * as React from "react"

import { useProjectsStore } from "@/stores/projects-store"
import { useUnifiedSessionsForProject } from "@/stores/sessions-store"

import { ProjectStats } from "./ProjectStats"
import { SessionStats } from "./SessionStats"
import { QuickActions } from "./QuickActions"

export function DashboardPanel() {
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const projects = useProjectsStore((s) => s.projects)
  const unifiedSessions = useUnifiedSessionsForProject(selectedProjectPath)

  const handleNewSession = React.useCallback(() => {
    // TODO: Implement new session creation
  }, [])

  return (
    <div className="h-full w-full overflow-auto p-4">
      <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-4">
        <div className="text-sm font-semibold">Dashboard</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {selectedProjectPath
            ? `Selected project: ${selectedProjectPath}`
            : "Pick a project from the sidebar to begin."}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <ProjectStats projectCount={projects.length} />
        <SessionStats 
          sessionCount={unifiedSessions.length} 
          selectedProject={selectedProjectPath}
        />
      </div>

      <div className="mt-4">
        <QuickActions 
          selectedProject={selectedProjectPath}
          onNewSession={handleNewSession}
        />
      </div>
    </div>
  )
}