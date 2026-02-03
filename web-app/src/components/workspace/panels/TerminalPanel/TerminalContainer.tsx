import * as React from "react"

interface TerminalContainerProps {
  terminalRef: React.RefObject<HTMLDivElement>
  error?: string | null
}

export const TerminalContainer = React.memo<TerminalContainerProps>(({ 
  terminalRef, 
  error 
}) => {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden p-3">
        <div className="h-full w-full rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-2 shadow-[var(--shadow-panel)]">
          <div ref={terminalRef} className="h-full w-full" />
        </div>
      </div>
      
      {error && (
        <div className="border-t border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  )
})

TerminalContainer.displayName = "TerminalContainer"