import * as React from "react"
import { Terminal, Plus, Circle } from "lucide-react"

interface TerminalHeaderProps {
  projectPath: string
  connected: boolean
  onNewTerminal: () => void
}

export const TerminalHeader = React.memo<TerminalHeaderProps>(({ 
  projectPath, 
  connected, 
  onNewTerminal 
}) => {
  // Get folder name from path
  const folderName = projectPath.split("/").pop() ?? projectPath

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[var(--panel-header-bg)]">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-[var(--tool-bash-bg)] flex items-center justify-center flex-shrink-0">
          <Terminal className="h-4 w-4 text-[var(--tool-bash)]" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text)]">Terminal</span>
            <Circle 
              className={[
                "h-2 w-2",
                connected ? "fill-[var(--success)] text-[var(--success)]" : "fill-[var(--text-faint)] text-[var(--text-faint)]"
              ].join(" ")} 
            />
          </div>
          <div className="text-[11px] text-[var(--text-muted)] truncate">
            {folderName}
          </div>
        </div>
      </div>
      
      <button
        onClick={onNewTerminal}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                   text-[var(--text-secondary)] hover:text-[var(--text)] 
                   hover:bg-[var(--bg-hover)] transition-all"
      >
        <Plus className="h-3.5 w-3.5" />
        New
      </button>
    </div>
  )
})

TerminalHeader.displayName = "TerminalHeader"
