import * as React from "react"
import { Button } from "@/components/ui/button"

interface ClaudeCodePermission {
  sessionId: string
  toolUseId: string
  tool: string
  decisionReason?: string
}

interface ClaudeCodePermissionCardProps {
  permission: ClaudeCodePermission
  onSend: (message: any) => void
  onResolve: (sessionId: string, toolUseId: string) => void
}

export const ClaudeCodePermissionCard = React.memo<ClaudeCodePermissionCardProps>(function ClaudeCodePermissionCard({
  permission,
  onSend,
  onResolve,
}) {
  const handleResponse = (response: "once" | "always" | "reject") => {
    onSend({
      type: "cc_permission_response",
      sessionId: permission.sessionId,
      toolUseId: permission.toolUseId,
      response: response,
    })
    onResolve(permission.sessionId, permission.toolUseId)
  }

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-sm font-semibold">{permission.tool}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        Session: {permission.sessionId}
      </div>
      {permission.decisionReason ? (
        <div className="mt-2 text-xs text-muted-foreground">
          {permission.decisionReason}
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => handleResponse("once")}
        >
          Allow Once
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleResponse("always")}
        >
          Always
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleResponse("reject")}
        >
          Reject
        </Button>
      </div>
    </div>
  )
})