import * as React from "react"

import { DEFAULT_BRIDGE_WS_URL } from "@/core/constants"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface AuthFormProps {
  wsUrl: string
  bridgeAuthToken: string | null
  wsState: string
  onWsUrlChange: (url: string) => void
  onBridgeTokenChange: (token: string | null) => void
  onConnect: () => void
  onDisconnect: () => void
}

export const AuthForm = React.memo<AuthFormProps>(({
  wsUrl,
  bridgeAuthToken,
  wsState,
  onWsUrlChange,
  onBridgeTokenChange,
  onConnect,
  onDisconnect,
}) => {
  return (
    <div className="space-y-3">
      <label className="block text-xs text-muted-foreground">
        Bridge WebSocket URL
      </label>
      <Input
        value={wsUrl}
        onChange={(e) => onWsUrlChange(e.target.value)}
        placeholder={DEFAULT_BRIDGE_WS_URL}
      />

      <label className="block text-xs text-muted-foreground">
        Bridge Auth Token
      </label>
      <Input
        value={bridgeAuthToken ?? ""}
        onChange={(e) => onBridgeTokenChange(e.target.value || null)}
        placeholder="broski bridge token"
      />

      <div className="flex items-center gap-2">
        <Button
          onClick={onConnect}
          disabled={wsState === "connecting" || !(bridgeAuthToken && bridgeAuthToken.length > 0)}
        >
          {wsState === "connecting" ? "Connecting…" : "Connect"}
        </Button>
        <Button variant="outline" onClick={onDisconnect}>
          Disconnect
        </Button>
      </div>
      
      <div className="text-xs text-muted-foreground">
        Tip: Get the token from the bridge QR code or `broski show-token`.
      </div>
    </div>
  )
})

AuthForm.displayName = "AuthForm"
