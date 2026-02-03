import * as React from "react"
import { GitBranch, RefreshCw } from "lucide-react"

interface GitHeaderProps {
  projectPath: string
  onRefresh: () => void
}

export const GitHeader = React.memo<GitHeaderProps>(({ projectPath, onRefresh }) => {
  // Get folder name from path
  const folderName = projectPath.split("/").pop() ?? projectPath

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[var(--panel-header-bg)]">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-[var(--success-soft)] flex items-center justify-center flex-shrink-0">
          <GitBranch className="h-4 w-4 text-[var(--success)]" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--text)]">Git</div>
          <div className="text-[11px] text-[var(--text-muted)] truncate">
            {folderName}
          </div>
        </div>
      </div>
      
      <button
        onClick={onRefresh}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                   text-[var(--text-secondary)] hover:text-[var(--text)] 
                   hover:bg-[var(--bg-hover)] transition-all"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh
      </button>
    </div>
  )
})

GitHeader.displayName = "GitHeader"
