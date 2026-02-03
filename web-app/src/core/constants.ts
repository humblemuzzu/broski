export const DEFAULT_BRIDGE_WS_URL = (() => {
  try {
    const isHttps = window.location.protocol === "https:"
    const host = window.location.hostname || "localhost"
    const portFromLocation = window.location.port
    const isLocalHost =
      host === "localhost" || host === "127.0.0.1" || host === "::1"
    const port =
      isLocalHost && portFromLocation && portFromLocation !== "4321"
        ? "4321"
        : portFromLocation || "4321"
    return `${isHttps ? "wss" : "ws"}://${host}:${port}`
  } catch {
    return "ws://localhost:4321"
  }
})()

export const STORAGE_KEYS = {
  bridgeWsUrl: "broski:web:bridgeWsUrl",
  bridgeAuthToken: "broski:web:bridgeAuthToken",
  deviceId: "broski:web:deviceId",
  theme: "broski:web:theme",
  workspaceLayout: "broski:web:workspaceLayout:v1",
  selectedProject: "broski:web:selectedProject",
  selectedSession: "broski:web:selectedSession",
  convexSessionToken: "broski:web:convexSessionToken",
  specByProject: "broski:web:specByProject:v1",
  previewByProject: "broski:web:previewByProject:v1",
  settings: "broski:web:settings:v1",
} as const
