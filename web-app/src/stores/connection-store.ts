import { create } from "zustand"
import { persist } from "zustand/middleware"

import { DEFAULT_BRIDGE_WS_URL, STORAGE_KEYS } from "@/core/constants"
import { getOrCreateDeviceId } from "@/core/id"
import type { AgentType, DeviceInfo, StatusPayload } from "@/core/types"
import { routeServerMessage } from "@/core/message-router"
import { WebSocketClient, type WebSocketState } from "@/core/ws-client"

type ConnectionMetrics = {
  rttMs: number
  lastPongAt: number
  connectionType?: string
}

type ConnectionState = {
  wsUrl: string
  bridgeAuthToken: string | null
  wsState: WebSocketState
  lastClose: null | { code: number; reason: string }
  devices: DeviceInfo[]
  deviceId: string
  deviceName: string
  activeAgent: AgentType
  statusPayload: StatusPayload | null
  metrics: ConnectionMetrics | null
  client: WebSocketClient

  setWsUrl: (wsUrl: string) => void
  setBridgeAuthToken: (token: string | null) => void
  connect: () => void
  disconnect: () => void
  send: WebSocketClient["send"]
  registerDevice: () => void
  setActiveAgent: (agent: AgentType) => void

  setDevices: (devices: DeviceInfo[]) => void
  upsertDevice: (device: DeviceInfo) => void
  removeDevice: (deviceId: string) => void
  setStatusPayload: (payload: StatusPayload) => void
  setConnectionMetrics: (metrics: ConnectionMetrics) => void
}

const client = new WebSocketClient()

client.subscribe((msg) => routeServerMessage(msg))
client.subscribeState((wsState) => useConnectionStore.setState({ wsState }))
client.subscribeClose((info) => useConnectionStore.setState({ lastClose: info }))

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      wsUrl: DEFAULT_BRIDGE_WS_URL,
      bridgeAuthToken: null,
      wsState: "idle",
      lastClose: null,
      devices: [],
      deviceId: getOrCreateDeviceId(STORAGE_KEYS.deviceId),
      deviceName: "Web Dashboard",
      activeAgent: "claude-code",
      statusPayload: null,
      metrics: null,
      client,

      setWsUrl: (wsUrl) => set({ wsUrl }),
      setBridgeAuthToken: (token) => set({ bridgeAuthToken: token }),
      connect: () => {
        const { wsUrl, bridgeAuthToken } = get()
        set({ wsState: "connecting" })
        client.connect(wsUrl, bridgeAuthToken)
      },
      disconnect: () => {
        client.disconnect()
      },
      send: (msg) => client.send(msg),
      registerDevice: () => {
        const { deviceId, deviceName } = get()
        get().send({
          type: "register_device",
          deviceId,
          deviceName,
          platform: "web",
          protocolVersion: "web-dashboard-v1",
        })
      },
      setActiveAgent: (agent) => {
        set({ activeAgent: agent })
        get().send({ type: "set_agent", agent })
      },

      setDevices: (devices) => set({ devices }),
      upsertDevice: (device) =>
        set((s) => ({
          devices: [
            device,
            ...s.devices.filter((d) => d.deviceId !== device.deviceId),
          ],
        })),
      removeDevice: (deviceId) =>
        set((s) => ({
          devices: s.devices.filter((d) => d.deviceId !== deviceId),
        })),
      setStatusPayload: (payload) => set({ statusPayload: payload }),
      setConnectionMetrics: (metrics) => set({ metrics }),
    }),
    {
      name: STORAGE_KEYS.bridgeWsUrl,
      partialize: (s) => ({
        wsUrl: s.wsUrl,
        deviceName: s.deviceName,
        activeAgent: s.activeAgent,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<ConnectionState> | undefined
        return {
          ...current,
          wsUrl: p?.wsUrl ?? current.wsUrl,
          deviceName: p?.deviceName ?? current.deviceName,
          activeAgent: p?.activeAgent ?? current.activeAgent,
        }
      },
    }
  )
)
