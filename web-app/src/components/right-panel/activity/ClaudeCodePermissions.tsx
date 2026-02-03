import * as React from "react"
import { ClaudeCodePermissionCard } from "./ClaudeCodePermissionCard"

interface ClaudeCodePermissionsProps {
  permissions: Array<{
    sessionId: string
    toolUseId: string
    tool: string
    decisionReason?: string
  }>
  onSend: (message: any) => void
  onResolveRequest: (sessionId: string, toolUseId: string) => void
}

export const ClaudeCodePermissions = React.memo<ClaudeCodePermissionsProps>(function ClaudeCodePermissions({
  permissions,
  onSend,
  onResolveRequest,
}) {
  if (!permissions || permissions.length === 0) {
    return null
  }

  return (
    <div className="mb-3 rounded-lg border border-border bg-[var(--panel)] p-3">
      <div className="text-xs font-semibold text-muted-foreground">
        Needs Attention ({permissions.length})
      </div>
      <div className="mt-3 space-y-2">
        {permissions.slice(0, 20).map((p) => (
          <ClaudeCodePermissionCard
            key={`${p.sessionId}:${p.toolUseId}`}
            permission={p}
            onSend={onSend}
            onResolve={onResolveRequest}
          />
        ))}
      </div>
    </div>
  )
})