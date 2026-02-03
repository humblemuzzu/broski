import * as React from "react"

import { Button } from "@/components/ui/button"

interface FilesHeaderProps {
  currentPath: string
  onRefresh: () => void
}

export const FilesHeader = React.memo<FilesHeaderProps>(({ currentPath, onRefresh }) => {
  return (
    <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
      <div>
        <div className="text-sm font-semibold">Files</div>
        <div className="mt-1 text-xs text-muted-foreground">{currentPath}</div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Go
        </Button>
      </div>
    </div>
  )
})

FilesHeader.displayName = "FilesHeader"