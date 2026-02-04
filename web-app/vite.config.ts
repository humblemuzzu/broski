import fs from "node:fs"
import path from "node:path"
import { homedir } from "node:os"

import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"

/** Read bridge port from config for proxy target. */
function getBridgeTarget(): { port: number; tls: boolean } {
  try {
    const raw = fs.readFileSync(
      path.join(homedir(), ".broski", "config.json"),
      "utf-8"
    )
    const cfg = JSON.parse(raw)
    return {
      port: cfg.network?.port ?? 4321,
      tls: cfg.security?.tls ?? false,
    }
  } catch {
    return { port: 4321, tls: false }
  }
}

const bridge = getBridgeTarget()
const bridgeOrigin = `${bridge.tls ? "https" : "http"}://localhost:${bridge.port}`

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy WebSocket through Vite so the browser doesn't hit
      // the self-signed TLS cert directly.
      "/bridge-ws": {
        target: bridgeOrigin,
        ws: true,
        secure: false, // accept self-signed cert
        changeOrigin: true,
        rewrite: () => "/",
      },
      // Proxy preview reverse-proxy endpoint during dev
      "/proxy": {
        target: bridgeOrigin,
        secure: false,
        changeOrigin: true,
      },
      "/proxy-ws": {
        target: bridgeOrigin,
        ws: true,
        secure: false,
        changeOrigin: true,
      },
    },
  },
})
