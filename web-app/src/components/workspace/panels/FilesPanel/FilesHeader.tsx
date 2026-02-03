import * as React from "react"
import { FolderTree, RefreshCw, ExternalLink } from "lucide-react"

interface FilesHeaderProps {
  currentPath: string
  onRefresh: () => void
}

export const FilesHeader = React.memo<FilesHeaderProps>(({ currentPath, onRefresh }) => {
  // Get folder name from path
  const folderName = currentPath.split("/").pop() ?? currentPath

  const handleOpenInIDE = () => {
    // Open in system default (could be VS Code, Cursor, etc.)
    window.open(`vscode://file${currentPath}`, "_blank")
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[var(--panel-header-bg)]">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center flex-shrink-0">
          <FolderTree className="h-4 w-4 text-[var(--accent)]" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--text)]">Files</div>
          <div className="text-[11px] text-[var(--text-muted)] truncate">
            {folderName}
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-1">
        <button
          onClick={onRefresh}
          className="p-1.5 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-muted)] 
                     hover:bg-[var(--bg-hover)] transition-all"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleOpenInIDE}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
                     text-[var(--text-secondary)] hover:text-[var(--text)] 
                     hover:bg-[var(--bg-hover)] transition-all"
          title="Open in IDE"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </button>
      </div>
    </div>
  )
})

FilesHeader.displayName = "FilesHeader"
