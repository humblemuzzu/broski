import * as React from "react"
import { Wifi } from "lucide-react"

import { Button } from "@/components/ui/button"

interface DevBypassScreenProps {
  bridgeAuthToken?: string | null
  wsState: string
  lastClose?: { reason?: string; code?: number } | null
  onRetry: () => void
}

export const DevBypassScreen = React.memo<DevBypassScreenProps>(({
  bridgeAuthToken,
  wsState,
  lastClose,
  onRetry,
}) => {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="mx-auto max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-[var(--shadow-panel)]">
        <Wifi className="mx-auto h-6 w-6 animate-pulse text-muted-foreground" />
        <div className="mt-3 text-sm font-semibold">Dev Mode</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {bridgeAuthToken
            ? `Connecting to bridge via proxy...`
            : `Fetching token...`}
        </div>
        {(wsState === "error" || wsState === "closed") && (
          <>
            <div className="mt-3 text-xs text-destructive">
              {lastClose?.reason || "Connection failed"} (code: {lastClose?.code ?? "?"})
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Make sure the bridge is running on port 4321
            </div>
            <Button size="sm" className="mt-3" onClick={onRetry}>
              Retry
            </Button>
          </>
        )}
      </div>
    </div>
  )
})

DevBypassScreen.displayName = "DevBypassScreen"