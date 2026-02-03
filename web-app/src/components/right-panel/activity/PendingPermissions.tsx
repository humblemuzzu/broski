import * as React from "react"
import { PermissionCard } from "./PermissionCard"

interface PendingPermissionsProps {
  permissions: any[]
  sessionId: string
  sessionAgent: string
  onSend: (message: any) => void
}

export const PendingPermissions = React.memo<PendingPermissionsProps>(function PendingPermissions({
  permissions,
  sessionId,
  sessionAgent,
  onSend,
}) {
  if (!permissions || permissions.length === 0) {
    return null
  }

  // Only show for OpenCode sessions
  if (sessionAgent !== "opencode") {
    return null
  }

  return (
    <div className="mb-3 rounded-lg border border-border bg-[var(--panel)] p-3">
      <div className="text-xs font-semibold text-muted-foreground">
        Pending Permissions ({permissions.length})
      </div>
      <div className="mt-3 space-y-2">
        {permissions.slice(0, 10).map((p: any, idx: number) => {
          const requestId =
            (typeof p?.requestID === "string" && p.requestID) ||
            (typeof p?.requestId === "string" && p.requestId) ||
            (typeof p?.id === "string" && p.id) ||
            ""
          return (
            <PermissionCard
              key={`${requestId || "perm"}:${idx}`}
              permission={p}
              sessionId={sessionId}
              onSend={onSend}
            />
          )
        })}
      </div>
    </div>
  )
})