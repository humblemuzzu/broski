import * as React from "react"

interface CloudAuthStatusProps {
  cloud?: {
    appUserId?: string
    entitled?: boolean
    status?: string
  } | null
  lastClose?: { code?: number; reason?: string } | null
}

export const CloudAuthStatus = React.memo<CloudAuthStatusProps>(({ 
  cloud, 
  lastClose 
}) => {
  return (
    <div className="space-y-3">
      {cloud && (
        <div className="rounded-md border border-border bg-[var(--panel)] p-3 text-xs">
          <div className="font-semibold">Cloud Auth</div>
          <div className="mt-1 text-muted-foreground">
            appUserId: {cloud.appUserId}
          </div>
          <div className="mt-1 text-muted-foreground">
            entitled: {cloud.entitled ? "true" : "false"}
          </div>
          {cloud.status && (
            <div className="mt-1 text-muted-foreground">
              status: {cloud.status}
            </div>
          )}
        </div>
      )}

      {lastClose && (lastClose.code || lastClose.reason) && (
        <div className="rounded-md border border-border bg-[var(--panel)] p-3 text-xs text-muted-foreground">
          <div className="font-semibold">Last disconnect</div>
          <div className="mt-1">code: {lastClose.code}</div>
          {lastClose.reason && (
            <div className="mt-1">reason: {lastClose.reason}</div>
          )}
        </div>
      )}
    </div>
  )
})

CloudAuthStatus.displayName = "CloudAuthStatus"