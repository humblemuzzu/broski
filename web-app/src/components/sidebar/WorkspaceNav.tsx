interface WorkspaceNavProps {
  projectPath: string;
  onOpenPanel: (panelId: string) => void;
}

export function WorkspaceNav({ projectPath, onOpenPanel }: WorkspaceNavProps) {
  return (
    <div className="px-1 py-2">
      <div className="mb-2 text-xs font-semibold text-muted-foreground">
        Workspace
      </div>
      <div className="space-y-1">
        <button
          className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
          onClick={() => onOpenPanel(`terminal:${projectPath}`)}
        >
          Terminal
        </button>
        <button
          className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
          onClick={() => onOpenPanel(`files:${projectPath}`)}
        >
          Files
        </button>
        <button
          className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
          onClick={() => onOpenPanel(`git:${projectPath}`)}
        >
          Git
        </button>
        <button
          className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
          onClick={() => onOpenPanel(`browser:${projectPath}`)}
        >
          Preview
        </button>
        <button
          className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
          onClick={() => onOpenPanel(`spec:${projectPath}`)}
        >
          Spec
        </button>
        <button
          className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
          onClick={() => onOpenPanel(`automation:${projectPath}`)}
        >
          Automation
        </button>
        <button
          className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-[var(--sidebar-item-hover)]"
          onClick={() => onOpenPanel(`integrations:${projectPath}`)}
        >
          Integrations
        </button>
      </div>
    </div>
  )
}