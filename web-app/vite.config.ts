import fs from "node:fs"
import path from "node:path"
import { homedir } from "node:os"

import react from "@vitejs/plugin-react-swc"
import { defineConfig, type Plugin } from "vite"

/**
 * Vite plugin: serves bridge auth token + config during development.
 * Reads from ~/.broski/token.json and ~/.broski/config.json so the
 * web-app can auto-connect without manual token entry.
 */
function broskiDevAuth(): Plugin {
  const broskiDir = path.join(homedir(), ".broski")
  const tokenPath = path.join(broskiDir, "token.json")
  const configPath = path.join(broskiDir, "config.json")

  return {
    name: "broski-dev-auth",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/api/web/token") {
          try {
            const raw = fs.readFileSync(tokenPath, "utf-8")
            const parsed = JSON.parse(raw)
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ token: parsed.token }))
          } catch {
            res.statusCode = 404
            res.end(JSON.stringify({ error: "Token not found" }))
          }
          return
        }
        if (req.url === "/api/web/config") {
          try {
            const raw = fs.readFileSync(configPath, "utf-8")
            const parsed = JSON.parse(raw)
            res.setHeader("Content-Type", "application/json")
            res.end(
              JSON.stringify({
                port: parsed.network?.port ?? 4321,
                tls: parsed.security?.tls ?? false,
              })
            )
          } catch {
            res.statusCode = 404
            res.end(JSON.stringify({ error: "Config not found" }))
          }
          return
        }
        next()
      })
    },
  }
}

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
  plugins: [react(), broskiDevAuth()],
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
    },
  },
})
