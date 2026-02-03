import React from "react"
import { Folder, FolderOpen } from "lucide-react"

interface ProjectItemProps {
  project: { path: string; name?: string }
  isSelected: boolean
  collapsed: boolean
  onSelect: () => void
}

export const ProjectItem = React.memo<ProjectItemProps>(({ 
  project, 
  isSelected, 
  collapsed, 
  onSelect 
}) => {
  // Extract just the folder name from path
  const folderName = project.name ?? project.path.split("/").pop() ?? project.path
  
  return (
    <button
      className={[
        "w-full flex items-center gap-2.5 rounded-lg transition-all",
        collapsed ? "p-2 justify-center" : "px-2.5 py-2 text-left",
        isSelected 
          ? "bg-[var(--sidebar-item-selected)] text-[var(--text)]" 
          : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-item-hover)] hover:text-[var(--text)]",
      ].join(" ")}
      onClick={onSelect}
      title={project.path}
    >
      {isSelected ? (
        <FolderOpen className="h-4 w-4 flex-shrink-0 text-[var(--accent)]" />
      ) : (
        <Folder className="h-4 w-4 flex-shrink-0" />
      )}
      
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium truncate">
            {folderName}
          </div>
        </div>
      )}
    </button>
  )
})

ProjectItem.displayName = "ProjectItem"
