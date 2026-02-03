import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ProjectItem } from "./ProjectItem"

interface ProjectListProps {
  projects: Array<{ path: string; name?: string }>;
  selectedPath: string | null;
  collapsed: boolean;
  onSelectProject: (path: string) => void;
  onRefresh: () => void;
}

export function ProjectList({ projects, selectedPath, collapsed, onSelectProject, onRefresh }: ProjectListProps) {
  return (
    <div className="px-1 py-2">
      {!collapsed ? (
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-semibold text-muted-foreground">
            Projects
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRefresh}
            aria-label="Refresh projects"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      <div className="space-y-1">
        {projects.map((project) => (
          <ProjectItem
            key={project.path}
            project={project}
            isSelected={selectedPath === project.path}
            collapsed={collapsed}
            onSelect={() => onSelectProject(project.path)}
          />
        ))}
      </div>
    </div>
  )
}