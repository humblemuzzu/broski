import * as React from "react"
import { Wifi, WifiOff } from "lucide-react"
import { GoogleLogin } from "@react-oauth/google"

import { DEFAULT_BRIDGE_WS_URL } from "@/core/constants"
import { exchangeGoogleIdTokenForSession } from "@/core/convex-auth"
import { useConnectionStore } from "@/stores/connection-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * Dev bypass: skip auth gate and auto-connect without tokens.
 * Activate via VITE_DEV_BYPASS=true env var or ?dev=1 URL param.
 */
function isDevBypass(): boolean {
  try {
    const envFlag = (import.meta as any).env?.VITE_DEV_BYPASS
    if (envFlag === "true" || envFlag === "1") return true
    const params = new URLSearchParams(window.location.search)
    if (params.get("dev") === "1") return true
  } catch {
    // ignore
  }
  return false
}

export function ConnectionGate({ children }: { children: React.ReactNode }) {
  const devBypass = React.useMemo(() => isDevBypass(), [])
  const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as
    | string
    | undefined
  const wsUrl = useConnectionStore((s) => s.wsUrl)
  const wsState = useConnectionStore((s) => s.wsState)
  const lastClose = useConnectionStore((s) => s.lastClose)
  const setWsUrl = useConnectionStore((s) => s.setWsUrl)
  const connect = useConnectionStore((s) => s.connect)
  const disconnect = useConnectionStore((s) => s.disconnect)
  const bridgeAuthToken = useConnectionStore((s) => s.bridgeAuthToken)
  const setBridgeAuthToken = useConnectionStore((s) => s.setBridgeAuthToken)
  const bootstrapBridgeToken = useConnectionStore((s) => s.bootstrapBridgeToken)
  const convexSessionToken = useConnectionStore((s) => s.convexSessionToken)
  const setConvexSessionToken = useConnectionStore((s) => s.setConvexSessionToken)
  const registerDevice = useConnectionStore((s) => s.registerDevice)
  const setActiveAgent = useConnectionStore((s) => s.setActiveAgent)
  const activeAgent = useConnectionStore((s) => s.activeAgent)
  const authenticateCloud = useConnectionStore((s) => s.authenticateCloud)
  const cloud = useConnectionStore((s) => s.cloud)
  const send = useConnectionStore((s) => s.send)

  React.useEffect(() => {
    if (devBypass) {
      // Dev mode: use Vite's WebSocket proxy to avoid self-signed TLS issues.
      // Vite proxies ws://localhost:5173/bridge-ws → wss://bridge:PORT
      const viteWsProxy = `ws://${window.location.host}/bridge-ws`
      setWsUrl(viteWsProxy)
      // Fetch token then auto-connect will fire via the other useEffect.
      void bootstrapBridgeToken()
      return
    }
    // Best-effort: fetch bridge auth token from loopback endpoint (works when
    // served by bridge, or via Vite proxy).
    void bootstrapBridgeToken()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devBypass])

  React.useEffect(() => {
    // Auto-connect once we have a bridge token.
    if (wsState !== "idle" && wsState !== "closed") return
    if (!bridgeAuthToken) return
    connect()
  }, [bridgeAuthToken, connect, wsState])

  // Track whether we've already run the "on-open" bootstrap to avoid
  // re-firing when unrelated state changes.
  const didBootstrap = React.useRef(false)

  React.useEffect(() => {
    if (wsState !== "open") {
      // Reset so the next open triggers bootstrap again.
      didBootstrap.current = false
      return
    }
    if (didBootstrap.current) return
    didBootstrap.current = true

    // Cloud auth must happen quickly if entitlement gating is enabled.
    authenticateCloud()
    registerDevice()
    // Notify bridge of the current agent (read once, don't depend on it).
    const currentAgent = useConnectionStore.getState().activeAgent
    useConnectionStore.getState().send({ type: "set_agent", agent: currentAgent })
    // Pull initial data
    send({ type: "list_projects" })
    send({ type: "list_devices" })
    send({ type: "list_pending_permissions" })
    send({ type: "list_pending_questions" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsState])

  if (wsState === "open") return <>{children}</>

  // In dev bypass mode, show a minimal connecting screen instead of the full auth form
  if (devBypass) {
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
          {wsState === "error" || wsState === "closed" ? (
            <>
              <div className="mt-3 text-xs text-destructive">
                {lastClose?.reason || "Connection failed"} (code: {lastClose?.code ?? "?"})
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Make sure the bridge is running on port 4321
              </div>
              <Button size="sm" className="mt-3" onClick={() => connect()}>
                Retry
              </Button>
            </>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full px-6 py-10">
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-panel)]">
        <div className="flex items-center gap-3">
          {wsState === "connecting" ? (
            <Wifi className="h-5 w-5 text-muted-foreground" />
          ) : (
            <WifiOff className="h-5 w-5 text-muted-foreground" />
          )}
          <div>
            <div className="text-lg font-semibold">Connect to Broski Bridge</div>
            <div className="text-sm text-muted-foreground">
              Default is {DEFAULT_BRIDGE_WS_URL}
            </div>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <label className="block text-xs text-muted-foreground">
            Bridge WebSocket URL
          </label>
          <Input
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            placeholder={DEFAULT_BRIDGE_WS_URL}
          />

          <label className="block text-xs text-muted-foreground">
            Bridge Auth Token (auto-fetched on localhost)
          </label>
          <Input
            value={bridgeAuthToken ?? ""}
            onChange={(e) => setBridgeAuthToken(e.target.value || null)}
            placeholder="broski bridge token"
          />

          <label className="block text-xs text-muted-foreground">
            Convex Session Token (for license gating)
          </label>
          <Input
            value={convexSessionToken ?? ""}
            onChange={(e) => setConvexSessionToken(e.target.value || null)}
            placeholder="session token (Bearer)"
          />
          {cloud ? (
            <div className="rounded-md border border-border bg-[var(--panel)] p-3 text-xs">
              <div className="font-semibold">Cloud Auth</div>
              <div className="mt-1 text-muted-foreground">
                appUserId: {cloud.appUserId}
              </div>
              <div className="mt-1 text-muted-foreground">
                entitled: {cloud.entitled ? "true" : "false"}
              </div>
              {cloud.status ? (
                <div className="mt-1 text-muted-foreground">
                  status: {cloud.status}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-md border border-border bg-[var(--panel)] p-3 text-xs">
            <div className="font-semibold">Sign in (Google)</div>
            <div className="mt-1 text-muted-foreground">
              If `VITE_GOOGLE_CLIENT_ID` is set, you can sign in here to get a
              Convex session token safely (no manual copy/paste).
            </div>
            <div className="mt-3">
              {googleClientId && googleClientId.trim().length > 0 ? (
                <GoogleLogin
                  onSuccess={async (cred) => {
                    const idToken = cred.credential
                    if (!idToken) return
                    const result = await exchangeGoogleIdTokenForSession({
                      idToken,
                      device: {
                        platform: "web",
                        deviceId: useConnectionStore.getState().deviceId,
                        appVersion: "web-dashboard-v1",
                      },
                    })
                    if (!result.ok) return
                    setConvexSessionToken(result.sessionToken)
                    if (useConnectionStore.getState().wsState === "open") {
                      useConnectionStore.getState().authenticateCloud()
                    }
                  }}
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

          <div className="flex items-center gap-2">
            <Button
              onClick={() => connect()}
              disabled={wsState === "connecting" || !(bridgeAuthToken && bridgeAuthToken.length > 0)}
            >
              {wsState === "connecting" ? "Connecting…" : "Connect"}
            </Button>
            <Button variant="outline" onClick={disconnect}>
              Disconnect
            </Button>
            <Button
              variant="outline"
              onClick={() => void bootstrapBridgeToken()}
            >
              Fetch Token
            </Button>
            <Button
              variant="outline"
              onClick={() => authenticateCloud()}
              disabled={!convexSessionToken}
            >
              Cloud Auth
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Tip: Start the bridge first. For localhost, token auto-fetch should work.
          </div>

          {lastClose && (lastClose.code || lastClose.reason) ? (
            <div className="mt-3 rounded-md border border-border bg-[var(--panel)] p-3 text-xs text-muted-foreground">
              <div className="font-semibold">Last disconnect</div>
              <div className="mt-1">code: {lastClose.code}</div>
              {lastClose.reason ? (
                <div className="mt-1">reason: {lastClose.reason}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
