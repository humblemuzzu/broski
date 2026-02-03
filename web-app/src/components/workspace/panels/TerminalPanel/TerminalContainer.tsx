import * as React from "react"
import { AlertCircle } from "lucide-react"

interface TerminalContainerProps {
  terminalRef: React.RefObject<HTMLDivElement>
  error?: string | null
}

export const TerminalContainer = React.memo<TerminalContainerProps>(({ 
  terminalRef, 
  error 
}) => {
  return (
    <div className="flex h-full flex-col bg-[var(--panel-bg)]">
      {/* Terminal viewport */}
      <div className="flex-1 overflow-hidden">
        <div 
          ref={terminalRef} 
          className="h-full w-full bg-[var(--bg-surface)]" 
        />
      </div>
      
      {/* Error message if any */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--error-soft)] border-t border-[var(--border-subtle)]">
          <AlertCircle className="h-3.5 w-3.5 text-[var(--error)]" />
          <span className="text-xs text-[var(--error)]">{error}</span>
        </div>
      )}
    </div>
  )
})

TerminalContainer.displayName = "TerminalContainer"
