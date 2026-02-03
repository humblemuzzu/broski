import * as React from "react"
import { Wifi, WifiOff } from "lucide-react"

import { DEFAULT_BRIDGE_WS_URL } from "@/core/constants"
import { bootstrapInitialData } from "@/core/bootstrap"
import { useConnectionStore } from "@/stores/connection-store"
import { useProjectsStore } from "@/stores/projects-store"

import { DevBypassScreen } from "./DevBypassScreen"
import { AuthForm } from "./AuthForm"
import { GoogleSignInSection } from "./GoogleSignInSection"
import { CloudAuthStatus } from "./CloudAuthStatus"

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
    // Pull initial data from ALL 3 backends (OpenCode, Claude Code, Codex)
    // Also load sessions for any previously selected project
    const selectedProject = useProjectsStore.getState().selectedProjectPath
    bootstrapInitialData(send, selectedProject)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsState])

  if (wsState === "open") return <>{children}</>

  // In dev bypass mode, show a minimal connecting screen instead of the full auth form
  if (devBypass) {
    return (
      <DevBypassScreen
        bridgeAuthToken={bridgeAuthToken}
        wsState={wsState}
        lastClose={lastClose}
        onRetry={connect}
      />
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
          <AuthForm
            wsUrl={wsUrl}
            bridgeAuthToken={bridgeAuthToken}
            convexSessionToken={convexSessionToken}
            wsState={wsState}
            onWsUrlChange={setWsUrl}
            onBridgeTokenChange={setBridgeAuthToken}
            onConvexTokenChange={setConvexSessionToken}
            onConnect={connect}
            onDisconnect={disconnect}
            onFetchToken={() => void bootstrapBridgeToken()}
            onCloudAuth={authenticateCloud}
          />

          <GoogleSignInSection
            googleClientId={googleClientId}
            onTokenReceived={setConvexSessionToken}
          />

          <CloudAuthStatus
            cloud={cloud}
            lastClose={lastClose}
          />
        </div>
      </div>
    </div>
  )
}