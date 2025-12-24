import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from '@opencode-ai/sdk'
import { displayBanner, displayQRCode } from './qr'
import { getLocalIP, getTailscaleIP, isTailscaleConnected } from './network'
import { OpenCodeConnector } from './opencode'
import { createBridgeServer } from './server'
import { homedir } from 'os'
import { join } from 'path'

const DEFAULT_PORT = 18274
const DEFAULT_OPENCODE_PORT = 4096

// Managed OpenCode server (spawned by bridge)
type ManagedOpenCodeServer = {
  url: string
  close: () => Promise<void>
}

// Manual OpenCode connection (user-managed)
type ManualOpenCodeServer = {
  url: string
  managed: false
}

type OpenCodeServer = ManagedOpenCodeServer | ManualOpenCodeServer

// OpenCode instance info for discovery
type OpenCodeInstance = {
  port: number
  url: string
  projects: Array<{ id: string; worktree: string; time?: { created?: number; updated?: number } }>
  lastActivity: number
}

// Check if OpenCode is responding on a specific port
async function checkPort(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/project`, { signal: AbortSignal.timeout(500) })
    return response.ok
  } catch {
    return false
  }
}

// Try to discover existing OpenCode server URL
async function discoverExistingOpencode(): Promise<string | null> {
  console.log('Scanning for existing OpenCode instances...')

  // Scan common ports for OpenCode instances
  const portsToScan = [
    4096, // Default port
    ...Array.from({ length: 30 }, (_, i) => 64864 + i), // Dynamic port range
  ]

  const instances: OpenCodeInstance[] = []

  // Check all ports in parallel for speed
  const checks = portsToScan.map(async (port) => {
    try {
      const url = `http://localhost:${port}`
      const response = await fetch(`${url}/project`, { signal: AbortSignal.timeout(200) })
      if (response.ok) {
        const projects = (await response.json()) as OpenCodeInstance['projects']

        // Find most recent activity across all projects
        let lastActivity = 0
        for (const project of projects) {
          const updated = project.time?.updated ?? project.time?.created ?? 0
          if (updated > lastActivity) {
            lastActivity = updated
          }
        }

        return { port, url, projects, lastActivity }
      }
    } catch {
      // Port not responding or not OpenCode
    }
    return null
  })

  const results = await Promise.all(checks)
  for (const result of results) {
    if (result) {
      instances.push(result)
    }
  }

  if (instances.length === 0) {
    console.log('  No existing OpenCode instances found')
    return null
  }

  // Sort by last activity (most recent first)
  instances.sort((a, b) => b.lastActivity - a.lastActivity)

  // Log all found instances
  console.log(`  Found ${instances.length} OpenCode instance(s):`)
  for (const inst of instances) {
    const ago = inst.lastActivity > 0
      ? `${Math.round((Date.now() - inst.lastActivity) / 1000 / 60)}m ago`
      : 'unknown'
    console.log(`    - Port ${inst.port}: ${inst.projects.length} projects, last active ${ago}`)
  }

  // Pick the most recently active instance
  const best = instances[0]
  console.log(`  ✓ Using existing OpenCode on port ${best.port}`)
  return best.url
}

// Ensure OpenCode server is running (spawn if needed)
async function ensureOpencodeServer(): Promise<OpenCodeServer> {
  // PRIORITY 1: OPENCODE_BASE_URL env var (manual mode - user controls lifecycle)
  if (process.env.OPENCODE_BASE_URL) {
    console.log(`Using OPENCODE_BASE_URL: ${process.env.OPENCODE_BASE_URL}`)
    return {
      url: process.env.OPENCODE_BASE_URL,
      managed: false,
    }
  }

  // PRIORITY 2: Check if OpenCode is already running on default port
  const defaultPortRunning = await checkPort(DEFAULT_OPENCODE_PORT)
  if (defaultPortRunning) {
    const url = `http://localhost:${DEFAULT_OPENCODE_PORT}`
    console.log(`Found existing OpenCode on port ${DEFAULT_OPENCODE_PORT}`)
    console.log('  (Bridge will connect to this instance, but will NOT stop it on shutdown)')
    console.log('  (To manage OpenCode lifecycle with bridge, stop the existing instance)')
    return {
      url,
      managed: false,
    }
  }

  // PRIORITY 3: Discover any other running instances
  const discoveredUrl = await discoverExistingOpencode()
  if (discoveredUrl) {
    console.log('  (Bridge will connect to this instance, but will NOT stop it on shutdown)')
    console.log('  (To manage OpenCode lifecycle with bridge, stop the existing instance)')
    return {
      url: discoveredUrl,
      managed: false,
    }
  }

  // PRIORITY 4: Spawn managed OpenCode server using SDK
  console.log('No existing OpenCode found. Spawning managed server...')
  try {
    const server = await createOpencodeServer({
      port: DEFAULT_OPENCODE_PORT,
      timeout: 10000, // Wait up to 10s for server to start
    })

    console.log(`✓ Managed OpenCode server started on port ${DEFAULT_OPENCODE_PORT}`)
    console.log('  (Bridge will manage this server lifecycle - will stop on shutdown)')

    return {
      url: server.url,
      close: async () => {
        try {
          await server.close()
          console.log('  Managed OpenCode server stopped')
        } catch (error) {
          console.error('  Error stopping managed OpenCode server:', error)
        }
      },
    }
  } catch (error) {
    console.error('Failed to spawn managed OpenCode server:', error)
    console.log('  Falling back to connecting to default port...')
    console.log('  Please ensure OpenCode is installed and available')
    return {
      url: `http://localhost:${DEFAULT_OPENCODE_PORT}`,
      managed: false,
    }
  }
}

// Global server reference for shutdown
let opencodeServer: OpenCodeServer | null = null
let bridgeServer: ReturnType<typeof createBridgeServer> | null = null

// Graceful shutdown handler
async function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`)

  // Stop bridge server first (disconnects clients)
  if (bridgeServer) {
    console.log('Stopping bridge server...')
    bridgeServer.stop(true)
    bridgeServer = null
  }

  // Stop managed OpenCode server (if we spawned it)
  if (opencodeServer && 'close' in opencodeServer) {
    console.log('Stopping managed OpenCode server...')
    await opencodeServer.close()
    opencodeServer = null
  } else if (opencodeServer) {
    console.log('OpenCode server is external - leaving it running')
  }

  console.log('Shutdown complete. Goodbye!')
  process.exit(0)
}

async function main() {
  const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json()
  const version = packageJson.version ?? '0.1.0'

  displayBanner()

  const port = Number(process.env.BROSKI_PORT ?? DEFAULT_PORT)

  // Ensure OpenCode server is running (spawn if needed)
  opencodeServer = await ensureOpencodeServer()

  // Create OpenCode connector with the server URL
  const opencode = new OpenCodeConnector({ baseUrl: opencodeServer.url })

  console.log(`Using OpenCode at: ${opencodeServer.url}`)

  // Verify OpenCode is responding
  const opencodeRunning = await opencode.isRunning()
  if (!opencodeRunning) {
    console.log('⚠️  Warning: OpenCode is not responding. You may need to:')
    console.log('  1. Install OpenCode: npm i -g @anthropic-ai/opencode')
    console.log('  2. Start it manually: opencode serve')
    console.log('  3. Or let the bridge manage it (ensure no existing instances running)')
  } else {
    console.log('✓ OpenCode is responding')
  }

  const localIP = getLocalIP()
  const tailscaleIP = await getTailscaleIP()
  const tailscaleConnected = await isTailscaleConnected()

  if (!tailscaleConnected) {
    console.log('ℹ️  Tailscale not connected. Local network access only.')
  }

  // Create bridge server
  bridgeServer = createBridgeServer({
    port,
    opencode,
    version,
    logger: (message) => console.log(message),
  })

  // Subscribe to OpenCode events and forward to clients
  await opencode.startEventStream((event) => {
    console.log('[SDK Event]', JSON.stringify(event, null, 2))
    bridgeServer?.broadcast({ type: 'sdk_event', data: event })
  })

  // Display QR code for phone connection
  displayQRCode({
    localIP,
    tailscaleIP,
    port,
    version,
  })

  console.log(`\n✓ Bridge listening on port ${port}`)
  console.log('  Press Ctrl+C to shutdown (will stop managed OpenCode server if spawned)')

  // Setup graceful shutdown handlers
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

void main()
