import { useProjectsStore } from "@/stores/projects-store"
import { useUnifiedSessionsForProject } from "@/stores/sessions-store"

export function DashboardPanel() {
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const projects = useProjectsStore((s) => s.projects)
  const unifiedSessions = useUnifiedSessionsForProject(selectedProjectPath)

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
        <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-4">
          <div className="text-xs font-semibold text-muted-foreground">
            Projects
          </div>
          <div className="mt-2 text-2xl font-semibold">{projects.length}</div>
        </div>
        <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] p-4">
          <div className="text-xs font-semibold text-muted-foreground">
            Sessions (selected)
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {unifiedSessions.length}
          </div>
        </div>
      </div>
    </div>
  )
}

