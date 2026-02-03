import * as React from "react"
import { GoogleLogin } from "@react-oauth/google"

import { exchangeGoogleIdTokenForSession } from "@/core/convex-auth"
import { useConnectionStore } from "@/stores/connection-store"

interface GoogleSignInSectionProps {
  googleClientId?: string
  onTokenReceived: (token: string) => void
}

export const GoogleSignInSection = React.memo<GoogleSignInSectionProps>(({
  googleClientId,
  onTokenReceived,
}) => {
  const deviceId = useConnectionStore((s) => s.deviceId)
  const wsState = useConnectionStore((s) => s.wsState)
  const authenticateCloud = useConnectionStore((s) => s.authenticateCloud)

  const handleGoogleSuccess = React.useCallback(async (cred: any) => {
    const idToken = cred.credential
    if (!idToken) return
    
    try {
      const result = await exchangeGoogleIdTokenForSession({
        idToken,
        device: {
          platform: "web",
          deviceId,
          appVersion: "web-dashboard-v1",
        },
      })
      
      if (!result.ok) return
      
      onTokenReceived(result.sessionToken)
      
      if (wsState === "open") {
        authenticateCloud()
      }
    } catch (error) {
      console.error("Google sign-in error:", error)
    }
  }, [deviceId, wsState, authenticateCloud, onTokenReceived])

  return (
    <div className="rounded-md border border-border bg-[var(--panel)] p-3 text-xs">
      <div className="font-semibold">Sign in (Google)</div>
      <div className="mt-1 text-muted-foreground">
        If `VITE_GOOGLE_CLIENT_ID` is set, you can sign in here to get a
        Convex session token safely (no manual copy/paste).
      </div>
      <div className="mt-3">
        {googleClientId && googleClientId.trim().length > 0 ? (
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={() => {
              // noop (user can still paste token)
            }}
            useOneTap
          />
        ) : (
          <div className="text-[11px] text-muted-foreground">
            Configure `VITE_GOOGLE_CLIENT_ID` to enable.
          </div>
        )}
      </div>
    </div>
  )
})

GoogleSignInSection.displayName = "GoogleSignInSection"