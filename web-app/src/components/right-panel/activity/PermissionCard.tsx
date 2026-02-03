import * as React from "react"
import { Button } from "@/components/ui/button"

interface Permission {
  permission?: string
  tool?: string
  requestID?: string
  requestId?: string
  id?: string
}

interface PermissionCardProps {
  permission: Permission
  sessionId: string
  onSend: (message: any) => void
}

export const PermissionCard = React.memo<PermissionCardProps>(function PermissionCard({
  permission,
  sessionId,
  onSend,
}) {
  const requestId =
    (typeof permission?.requestID === "string" && permission.requestID) ||
    (typeof permission?.requestId === "string" && permission.requestId) ||
    (typeof permission?.id === "string" && permission.id) ||
    ""

  const handleResponse = (response: "once" | "always" | "reject") => {
    if (!requestId) return
    onSend({
      type: "permission_response",
      sessionId: sessionId,
      permissionId: requestId,
      response: response,
    })
  }

  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-xs font-semibold">
        {permission?.permission ?? permission?.tool ?? "permission"}
      </div>
      {requestId ? (
        <div className="mt-1 text-[11px] text-muted-foreground">
          id: {requestId}
        </div>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">
          Details
        </summary>
        <pre className="mt-2 max-h-[180px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
          {JSON.stringify(permission, null, 2)}
        </pre>
      </details>
      {requestId ? (
        <div className="mt-2 flex items-center gap-2">
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
      ) : null}
    </div>
  )
})