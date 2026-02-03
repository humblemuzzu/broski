import * as React from "react"
import { Button } from "@/components/ui/button"

export interface ChatHeaderProps {
  sessionId: string
  agent: string
  onOpenCollab?: () => void
}

export const ChatHeader = React.memo(function ChatHeader({
  sessionId,
  agent,
  onOpenCollab,
}: ChatHeaderProps) {
  return (
    <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Chat</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            Session: {sessionId} · Agent: {agent}
          </div>
        </div>
        {agent === "codex" && onOpenCollab ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenCollab}
          >
            Multi-Agent
          </Button>
        ) : null}
      </div>
    </div>
  )
})