import * as React from "react"
import { TerminalSquare } from "lucide-react"

import { Button } from "@/components/ui/button"

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
  return (
    <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
      <div className="flex items-center gap-2">
        <TerminalSquare className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className="text-sm font-semibold">Terminal</div>
          <div className="text-xs text-muted-foreground">{projectPath}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onNewTerminal}>
          New
        </Button>
      </div>
    </div>
  )
})

TerminalHeader.displayName = "TerminalHeader"