import type { ClientMessage, ServerMessage } from "@/core/types"

type Listener = (msg: ServerMessage) => void
type StateListener = (state: WebSocketState) => void
type CloseListener = (info: { code: number; reason: string }) => void

export type WebSocketState = "idle" | "connecting" | "open" | "closed" | "error"

export class WebSocketClient {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private stateListeners = new Set<StateListener>()
  private closeListeners = new Set<CloseListener>()
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private lastUrl: string | null = null
  private lastAuthToken: string | null = null
  private state: WebSocketState = "idle"

  getState() {
    return this.state
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeState(listener: StateListener) {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  subscribeClose(listener: CloseListener) {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  connect(url: string, authToken?: string | null) {
    this.lastUrl = url
    this.lastAuthToken = authToken ?? null
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.setState("connecting")
    try {
      const protocols = authToken ? [`broski-auth.${authToken}`] : undefined
      this.ws = new WebSocket(url, protocols)
      this.ws.onopen = () => {
        this.setState("open")
        this.reconnectAttempt = 0
      }
      this.ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data)) as ServerMessage
          for (const listener of this.listeners) listener(msg)
        } catch {
          // Ignore malformed messages (bridge is trusted, but keep UI resilient)
        }
      }
      this.ws.onclose = (evt) => {
        this.setState("closed")
        for (const listener of this.closeListeners) {
          try {
            listener({
              code: typeof evt?.code === "number" ? evt.code : 0,
              reason: typeof evt?.reason === "string" ? evt.reason : "",
            })
          } catch {
            // ignore
          }
        }
        this.ws = null
        this.scheduleReconnect()
      }
      this.ws.onerror = () => {
        this.setState("error")
      }
    } catch {
      this.setState("error")
      this.scheduleReconnect()
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempt = 0
    this.lastUrl = null
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
    this.setState("closed")
  }

  send(message: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }

  private scheduleReconnect() {
    if (!this.lastUrl) return
    if (this.reconnectTimer) return
    const attempt = this.reconnectAttempt
    const delay = Math.min(15000, 350 * Math.pow(1.6, attempt))
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (!this.lastUrl) return
      this.connect(this.lastUrl, this.lastAuthToken)
    }, delay)
  }

  private setState(state: WebSocketState) {
    this.state = state
    for (const listener of this.stateListeners) listener(state)
  }
}
