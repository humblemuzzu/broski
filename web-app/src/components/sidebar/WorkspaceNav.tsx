import { 
  Terminal, 
  FolderTree, 
  GitBranch, 
  Globe, 
  FileText, 
  Zap, 
  Plug 
} from "lucide-react"

interface WorkspaceNavProps {
  projectPath: string
  onOpenPanel: (panelId: string) => void
}

const navItems = [
  { id: "terminal", icon: Terminal, label: "Terminal" },
  { id: "files", icon: FolderTree, label: "Files" },
  { id: "git", icon: GitBranch, label: "Git" },
  { id: "browser", icon: Globe, label: "Preview" },
  { id: "spec", icon: FileText, label: "Spec" },
  { id: "automation", icon: Zap, label: "Automation" },
  { id: "integrations", icon: Plug, label: "Integrations" },
]

export function WorkspaceNav({ projectPath, onOpenPanel }: WorkspaceNavProps) {
  return (
    <div className="py-1 mt-2">
      {/* Section header */}
      <div className="px-2 py-1.5 mb-1">
        <span className="text-[11px] font-medium text-[var(--text-faint)] uppercase tracking-wider">
          Workspace
        </span>
      </div>

      {/* Nav items */}
      <div className="space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left
                         text-[var(--text-secondary)] hover:bg-[var(--sidebar-item-hover)] 
                         hover:text-[var(--text)] transition-all"
              onClick={() => onOpenPanel(`${item.id}:${projectPath}`)}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="text-[13px]">{item.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
