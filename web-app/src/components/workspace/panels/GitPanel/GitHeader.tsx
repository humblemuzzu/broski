import * as React from "react"
import { GitBranch, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"

interface GitHeaderProps {
  projectPath: string
  onRefresh: () => void
}

export const GitHeader = React.memo<GitHeaderProps>(({ projectPath, onRefresh }) => {
  return (
    <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className="text-sm font-semibold">Git</div>
          <div className="mt-1 text-xs text-muted-foreground">{projectPath}</div>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
    </div>
  )
})

GitHeader.displayName = "GitHeader"