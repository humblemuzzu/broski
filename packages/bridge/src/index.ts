import { createOpencode, type OpencodeClient } from '@opencode-ai/sdk/v2'
import { displayBanner, displayQRCode } from './qr'
import { getLocalIP, getHotspotIP, getTailscaleIP, getTailscaleMagicDNS, isTailscaleConnected } from './network'
import { enableFunnel, disableFunnel } from './funnel'
import { OpenCodeConnector } from './connectors/opencode'
import { createBridgeServer, loadOrCreateAuthToken } from './server'
import { parseCli, printHelp, promptForChoice } from './cli'
import { runDoctor } from './doctor'
import { runSetupTailscale } from './setup-tailscale'
import { spawnSync } from 'node:child_process'

type ManagedOpenCodeServer = {
  url: string
  close: () => Promise<void>
}

type ManualOpenCodeServer = {
  url: string
  managed: false
}

type OpenCodeServer = ManagedOpenCodeServer | ManualOpenCodeServer

type OpenCodeInstance = {
  port: number
  url: string
  projects: Array<{ id: string; worktree: string; time?: { created?: number; updated?: number } }>
  lastActivity: number
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForOpencodeReady(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      // /path is cheap and always available; it also validates instance wiring.
      const res = await fetch(`${url}/path`, { signal: AbortSignal.timeout(750) })
      if (res.ok) return true
    } catch {
      // keep retrying
    }
    await sleep(150)
  }
  return false
}

async function discoverRunningOpencodeInstances(portsToScan: number[], verbose: boolean): Promise<OpenCodeInstance[]> {
  if (verbose) {
    console.log('Scanning for running OpenCode instances...')
  }

  const instances: OpenCodeInstance[] = []

  // Limit concurrency to avoid flooding the system with hundreds of parallel
  // connection attempts (common when scanning large port ranges).
  const queue = portsToScan.slice()
  const concurrency = 32
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const port = queue.shift()
        if (port == null) return
        try {
          // Use 127.0.0.1 (not localhost) to avoid IPv6-only localhost resolution issues.
          const url = `http://127.0.0.1:${port}`
          // /path is cheap and stable across OpenCode versions; it validates that the port is an OpenCode server.
          const ready = await fetch(`${url}/path`, { signal: AbortSignal.timeout(750) })
          if (!ready.ok) continue

          let projects: OpenCodeInstance['projects'] = []
          try {
            // Best-effort: older/newer versions may not expose this endpoint.
            const response = await fetch(`${url}/project`, { signal: AbortSignal.timeout(750) })
            if (response.ok) {
              projects = (await response.json()) as OpenCodeInstance['projects']
            }
          } catch {
            // ignore
          }

          // Find most recent activity across all projects
          let lastActivity = 0
          for (const project of projects) {
            const updated = project.time?.updated ?? project.time?.created ?? 0
            if (updated > lastActivity) {
              lastActivity = updated
            }
          }

          instances.push({ port, url, projects, lastActivity })
        } catch {
          // Port not responding or not OpenCode
        }
      }
    }),
  )

  // Sort by last activity (most recent first)
  instances.sort((a, b) => b.lastActivity - a.lastActivity)
  return instances
}

type OpencodeBootstrap = {
  server: OpenCodeServer
  client?: OpencodeClient
}

// Global server reference for shutdown
let opencodeServer: OpenCodeServer | null = null
let bridgeServer: ReturnType<typeof createBridgeServer> | null = null
let primaryEventStreamController: AbortController | null = null
const extraEventStreamControllers: AbortController[] = []
let healthTimer: Timer | null = null
let opencodeConnector: OpenCodeConnector | null = null
let restartInFlight = false
let managedHostname = '127.0.0.1'
let managedPort = 0
let verboseMode = false
let funnelPort: number | null = null

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

async function subscribeOpenCodeStream(
  opencode: OpenCodeConnector,
  label: string,
  verbose: boolean,
): Promise<AbortController> {
  const controller = await opencode.startEventStream((event) => {
    if (verbose) {
      console.log('[SDK Event]', JSON.stringify(event))
    }
    bridgeServer?.enqueueSdkEvent(event)
  })
  if (verbose) {
    console.log(`✓ Subscribed to OpenCode events (${label}): ${opencode.url}`)
  }
  return controller
}

// Graceful shutdown handler
async function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`)

  if (healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }

  if (primaryEventStreamController || extraEventStreamControllers.length > 0) {
    console.log('Stopping OpenCode event streams...')
    if (primaryEventStreamController) {
      primaryEventStreamController.abort()
      primaryEventStreamController = null
    }
    while (extraEventStreamControllers.length > 0) {
      extraEventStreamControllers.pop()?.abort()
    }
  }

  if (funnelPort !== null) {
    console.log('Disabling Tailscale Funnel...')
    await disableFunnel(funnelPort)
    funnelPort = null
  }

  if (bridgeServer) {
    console.log('Stopping bridge server...')
    bridgeServer.stop(true)
    bridgeServer = null
  }

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

async function restartManagedOpenCode(): Promise<boolean> {
  if (restartInFlight) return false
  if (!opencodeServer || !('close' in opencodeServer)) return false
  if (!opencodeConnector) return false

  restartInFlight = true
  try {
    console.log('Restarting managed OpenCode...')

    if (primaryEventStreamController) {
      primaryEventStreamController.abort()
      primaryEventStreamController = null
    }

    try {
      await opencodeServer.close()
    } catch {
      // ignore
    }

    const bootstrap = await bootstrapManagedOpenCode(managedHostname, managedPort, verboseMode)
    opencodeServer = bootstrap.server

    opencodeConnector.updateBaseUrl(opencodeServer.url)

    primaryEventStreamController = await subscribeOpenCodeStream(
      opencodeConnector,
      'primary',
      verboseMode,
    )

    bridgeServer?.broadcast({ type: 'status', data: { opencodeRunning: true } })
    console.log('✓ OpenCode restarted')
    return true
  } catch (error) {
    console.error('Failed to restart OpenCode:', error)
    bridgeServer?.broadcast({ type: 'status', data: { opencodeRunning: false } })
    return false
  } finally {
    restartInFlight = false
  }
}

async function bootstrapManagedOpenCode(hostname: string, port: number, verbose: boolean): Promise<OpencodeBootstrap> {
  console.log('Starting OpenCode (managed)...')
  try {
    const { client, server } = await createOpencode({
      hostname,
      port,
      timeout: 10000,
    })

    const ready = await waitForOpencodeReady(server.url, 10000)
    if (!ready) {
      try {
        server.close()
      } catch {
        // ignore
      }
      throw new Error(`OpenCode started but did not become ready at ${server.url}`)
    }

    if (verbose) {
      console.log(`✓ OpenCode ready at ${server.url}`)
    } else {
      console.log('✓ OpenCode ready')
    }

    return {
      client,
      server: {
        url: server.url,
        close: async () => {
          try {
            server.close()
            console.log('  Managed OpenCode server stopped')
          } catch (error) {
            console.error('  Error stopping managed OpenCode server:', error)
          }
        },
      },
    }
  } catch (error) {
    console.error('Failed to start managed OpenCode server:', error)
    console.log('  Ensure OpenCode is installed and on PATH (e.g. `bun install -g opencode`)')
    throw error
  }
}

async function bootstrapManualOpenCode(url: string): Promise<OpencodeBootstrap> {
  console.log(`Attaching to OpenCode (manual): ${url}`)
  const ready = await waitForOpencodeReady(url, 5000)
  if (!ready) {
    console.log('⚠️  OpenCode is not responding at the provided URL.')
  } else {
    console.log('✓ OpenCode is responding')
  }
  return {
    server: { url, managed: false },
  }
}

function defaultAttachPorts(): number[] {
  // We only scan in explicit --attach mode (power users).
  // Default range covers the most common ports observed in practice.
  const ports: number[] = [4096]
  for (let i = 0; i < 256; i++) ports.push(64864 + i)
  for (let i = 0; i < 256; i++) ports.push(49152 + i)
  return ports
}

function discoverListeningPortsFromLsof(verbose: boolean): number[] {
  try {
    const res = spawnSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' })
    const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    if (!out.trim()) return []

    const ports = new Set<number>()
    for (const line of out.split('\n')) {
      const m = line.match(/TCP\s+.*?:(\d+)\s+\(LISTEN\)/)
      if (!m) continue
      const port = Number(m[1])
      if (!Number.isFinite(port) || port <= 0 || port > 65535) continue
      ports.add(port)
    }
    return Array.from(ports)
  } catch (err) {
    if (verbose) {
      console.warn('lsof scan failed (continuing without it):', err)
    }
    return []
  }
}

async function bootstrapAttachOpenCode(verbose: boolean): Promise<OpencodeBootstrap> {
  const lsofPorts = discoverListeningPortsFromLsof(verbose)
  const ports = Array.from(new Set([...defaultAttachPorts(), ...lsofPorts]))
  const instances = await discoverRunningOpencodeInstances(ports, verbose)
  if (instances.length === 0) {
    console.log('No running OpenCode servers found.')
    console.log('  Start one: `opencode serve`')
    console.log('  Or attach explicitly: `broski-bridge --opencode-url http://127.0.0.1:4096`')
    throw new Error('No running OpenCode servers found')
  }

  if (instances.length === 1) {
    const inst = instances[0]
    console.log(`✓ Found OpenCode at ${inst.url}`)
    return { server: { url: inst.url, managed: false } }
  }

  const choices = instances.map((inst) => {
    const ago = inst.lastActivity > 0 ? `${Math.round((Date.now() - inst.lastActivity) / 1000 / 60)}m ago` : 'unknown'
    return `${inst.url} (${inst.projects.length} projects, last active ${ago})`
  })

  const selected = await promptForChoice('Multiple OpenCode servers detected:', choices)
  if (selected == null) {
    throw new Error('Attach cancelled')
  }
  const inst = instances[selected]
  console.log(`✓ Using OpenCode at ${inst.url}`)
  return { server: { url: inst.url, managed: false } }
}

async function discoverLocalOpencodeUrls(verbose: boolean): Promise<string[]> {
  const ports = discoverListeningPortsFromLsof(verbose)
  if (ports.length === 0) return []
  const instances = await discoverRunningOpencodeInstances(ports, false)
  return instances.map((i) => i.url)
}

async function main() {
  const cli = parseCli(process.argv, process.env)
  if (cli.help) {
    printHelp()
    return
  }

  if (cli.subCommand === 'doctor') {
    await runDoctor()
    return
  }

  if (cli.subCommand === 'setup-tailscale') {
    await runSetupTailscale()
    return
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGTSTP', () => void shutdown('SIGTSTP'))
  verboseMode = cli.verbose
  managedHostname = cli.opencodeHostname
  managedPort = cli.opencodePort

  const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json()
  const version = packageJson.version ?? '0.1.0'

  displayBanner()

  const port = cli.bridgePort

  let bootstrap: OpencodeBootstrap
  if (cli.opencodeMode === 'manual') {
    if (!cli.opencodeUrl) {
      console.log('Manual mode requires --opencode-url or OPENCODE_BASE_URL')
      printHelp()
      return
    }
    bootstrap = await bootstrapManualOpenCode(cli.opencodeUrl)
  } else if (cli.opencodeMode === 'attach') {
    bootstrap = await bootstrapAttachOpenCode(cli.verbose)
  } else {
    bootstrap = await bootstrapManagedOpenCode(cli.opencodeHostname, cli.opencodePort, cli.verbose)
  }

  opencodeServer = bootstrap.server

  const opencode = new OpenCodeConnector({
    baseUrl: opencodeServer.url,
    client: bootstrap.client,
  })
  opencodeConnector = opencode

  const localIP = getLocalIP()
  const tailscaleIP = await getTailscaleIP()
  const magicDNS = await getTailscaleMagicDNS()
  const tailscaleConnected = await isTailscaleConnected()
  const hotspotIP = cli.detectHotspot ? getHotspotIP() : null

  if (cli.detectHotspot) {
    if (hotspotIP) {
      console.log(`✓ Hotspot IP detected: ${hotspotIP}`)
    } else {
      console.log('ℹ️  Hotspot detection enabled but no hotspot IP found')
      console.log('   Ensure your device is connected to a mobile hotspot')
    }
  }

  if (!tailscaleConnected) {
    console.log('ℹ️  Tailscale not connected. Local network access only.')
    if (cli.enableFunnel) {
      console.log('⚠️  --funnel requires Tailscale. Skipping Funnel setup.')
    }
  }

  // Load persistent auth token (same token survives bridge restarts)
  const authToken = await loadOrCreateAuthToken(cli.newToken)
  if (cli.newToken) {
    console.log('✓ New auth token generated (old QR codes are now invalid)')
  } else {
    console.log('✓ Auth token loaded (persistent across restarts)')
  }

  // Create bridge server
  try {
    bridgeServer = createBridgeServer({
      port,
      opencode,
      version,
      authToken,
      restartOpenCode: restartManagedOpenCode,
      logger: (message) => console.log(message),
    })
  } catch (error: any) {
    if (error?.code === 'EADDRINUSE') {
      console.error(`\n❌ Bridge port ${port} is already in use.`)
      console.error('This usually means another broski-bridge process is still running.')
      console.error('If you stopped it with Ctrl+Z, it was suspended (not terminated) and will keep the port open.')
      console.error('Fix options:')
      console.error('  - If it is a suspended job: return to that terminal, run `fg`, then press Ctrl+C.')
      console.error(`  - Or find and stop the process holding the port:`)
      console.error(`      lsof -nP -iTCP:${port} -sTCP:LISTEN`)
      console.error(`      kill <PID>`)
      console.error(`  - Dev fallback: run the bridge on a different port: --port 0 (random free port)\n`)

      // Best-effort: print the owning PID to make this frictionless.
      try {
        const proc = Bun.spawnSync({
          cmd: ['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'],
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const out = (proc.stdout?.toString() ?? '').trim()
        if (out) {
          console.error('Port owner:')
          console.error(out)
          console.error('')
        }
      } catch {
        // ignore - lsof may not be available
      }
    } else {
      console.error('\n❌ Failed to start bridge server:', error)
    }

    // If we started OpenCode in managed mode, stop it to avoid orphan processes.
    if (opencodeServer && 'close' in opencodeServer) {
      try {
        await opencodeServer.close()
      } catch {
        // ignore
      }
    }
    process.exit(1)
  }
  const bridgePort = bridgeServer.port()

  let funnelURL: string | null = null
  if (cli.enableFunnel && tailscaleConnected) {
    console.log('Enabling Tailscale Funnel...')
    const result = await enableFunnel(bridgePort)
    if (result.success && result.url) {
      funnelURL = result.url
      funnelPort = bridgePort
      console.log(`✓ Funnel enabled: ${funnelURL}`)
    } else {
      console.log(`⚠️  Funnel setup failed: ${result.error ?? 'unknown error'}`)
    }
  }

  // Subscribe to OpenCode events and forward to clients.
  // Also subscribe to any other local OpenCode servers so a TUI using a
  // different instance still drives real-time updates in the app.
  primaryEventStreamController = await subscribeOpenCodeStream(opencode, 'primary', cli.verbose)

  try {
    const primaryUrl = normalizeBaseUrl(opencode.url)
    const extraUrls = (await discoverLocalOpencodeUrls(cli.verbose))
      .map(normalizeBaseUrl)
      .filter((u) => u !== primaryUrl)

    const seen = new Set<string>()
    for (const u of extraUrls) {
      if (seen.has(u)) continue
      seen.add(u)
      const extra = new OpenCodeConnector({ baseUrl: u })
      const ctrl = await subscribeOpenCodeStream(extra, 'extra', cli.verbose)
      extraEventStreamControllers.push(ctrl)
    }
  } catch (err) {
    if (cli.verbose) {
      console.warn('⚠️  Failed to subscribe to extra local OpenCode servers:', err)
    }
  }

  // Managed mode: keep OpenCode alive. If it dies, restart it (bridge URL stays the same).
  if (opencodeServer && 'close' in opencodeServer) {
    healthTimer = setInterval(() => {
      void (async () => {
        if (!opencodeConnector) return
        if (restartInFlight) return
        const ok = await opencodeConnector.isRunning()
        if (!ok) {
          bridgeServer?.broadcast({ type: 'status', data: { opencodeRunning: false } })
          await restartManagedOpenCode()
        }
      })()
    }, 5000)
  }

  displayQRCode({
    localIP,
    tailscaleIP,
    magicDNS,
    funnelURL,
    hotspotIP,
    port: bridgePort,
    version,
    authToken: bridgeServer.authToken(),
  })

  console.log(`\n✓ Bridge listening on port ${bridgePort}`)
  console.log('  Press Ctrl+C to shutdown')
  if (opencodeServer && 'close' in opencodeServer) {
    console.log('  (OpenCode is managed by the bridge and will stop on shutdown)')
  } else {
    console.log('  (OpenCode is external and will be left running)')
  }

}

void main()
