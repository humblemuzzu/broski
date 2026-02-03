import React from "react"

interface ProjectItemProps {
  project: { path: string; name?: string };
  isSelected: boolean;
  collapsed: boolean;
  onSelect: () => void;
}

export const ProjectItem = React.memo<ProjectItemProps>(({ project, isSelected, collapsed, onSelect }) => {
  return (
    <button
      className={[
        "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
        isSelected
          ? "bg-[var(--sidebar-item-active)]"
          : "hover:bg-[var(--sidebar-item-hover)]",
      ].join(" ")}
      onClick={onSelect}
      title={project.path}
    >
      <div className="truncate">{project.name ?? project.path}</div>
      {!collapsed ? (
        <div className="truncate text-xs text-muted-foreground">
          {project.path}
        </div>
      ) : null}
    </button>
  )
})

ProjectItem.displayName = "ProjectItem"