import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface PathNavigatorProps {
  pathInput: string
  onPathChange: (path: string) => void
  onRootClick: () => void
  cwdPath?: string | null
}

export const PathNavigator = React.memo<PathNavigatorProps>(({ 
  pathInput, 
  onPathChange, 
  onRootClick,
  cwdPath
}) => {
  return (
    <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] p-3">
      <div className="flex items-center gap-2">
        <Input
          value={pathInput}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder={pathInput}
        />
        <Button variant="ghost" size="sm" onClick={onRootClick}>
          Root
        </Button>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        Browsing: {cwdPath ?? "(loading…)"}
      </div>
    </div>
  )
})

PathNavigator.displayName = "PathNavigator"