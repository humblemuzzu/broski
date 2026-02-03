import * as React from "react"
import { Wifi } from "lucide-react"

interface ConnectingScreenProps {
  message?: string
}

export const ConnectingScreen = React.memo<ConnectingScreenProps>(({ 
  message = "Connecting..." 
}) => {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="mx-auto max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-[var(--shadow-panel)]">
        <Wifi className="mx-auto h-6 w-6 animate-pulse text-muted-foreground" />
        <div className="mt-3 text-sm font-semibold">{message}</div>
      </div>
    </div>
  )
})

ConnectingScreen.displayName = "ConnectingScreen"