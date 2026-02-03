import { RefreshCw, FolderOpen } from "lucide-react"
import { ProjectItem } from "./ProjectItem"

interface ProjectListProps {
  projects: Array<{ path: string; name?: string }>
  selectedPath: string | null
  collapsed: boolean
  onSelectProject: (path: string) => void
  onRefresh: () => void
}

export function ProjectList({ 
  projects, 
  selectedPath, 
  collapsed, 
  onSelectProject, 
  onRefresh 
}: ProjectListProps) {
  return (
    <div className="py-1">
      {/* Section header */}
      {!collapsed && (
        <div className="flex items-center justify-between px-2 py-1.5 mb-1">
          <span className="text-[11px] font-medium text-[var(--text-faint)] uppercase tracking-wider">
            Projects
          </span>
          <button
            onClick={onRefresh}
            className="p-1 rounded text-[var(--text-faint)] hover:text-[var(--text-muted)] 
                       hover:bg-[var(--bg-hover)] transition-all"
            aria-label="Refresh projects"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Project list */}
      <div className="space-y-0.5">
        {projects.length === 0 ? (
          <div className={[
            "flex items-center gap-2 px-2 py-3 text-[var(--text-faint)]",
            collapsed ? "justify-center" : ""
          ].join(" ")}>
            <FolderOpen className="h-4 w-4" />
            {!collapsed && <span className="text-xs">No projects</span>}
          </div>
        ) : (
          projects.map((project) => (
            <ProjectItem
              key={project.path}
              project={project}
              isSelected={selectedPath === project.path}
              collapsed={collapsed}
              onSelect={() => onSelectProject(project.path)}
            />
          ))
        )}
      </div>
    </div>
  )
}
