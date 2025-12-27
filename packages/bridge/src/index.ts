import { createOpencode, type OpencodeClient } from '@opencode-ai/sdk'
import { displayBanner, displayQRCode } from './qr'
import { getLocalIP, getTailscaleIP, getTailscaleMagicDNS, isTailscaleConnected } from './network'
import { enableFunnel, disableFunnel } from './funnel'
import { OpenCodeConnector } from './opencode'
import { createBridgeServer } from './server'
import { parseCli, printHelp, promptForChoice } from './cli'
import { runDoctor } from './doctor'
import { runSetupTailscale } from './setup-tailscale'

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

  const checks = portsToScan.map(async (port) => {
    try {
      const url = `http://localhost:${port}`
      const response = await fetch(`${url}/project`, { signal: AbortSignal.timeout(750) })
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
let eventStreamController: AbortController | null = null
let healthTimer: Timer | null = null
let opencodeConnector: OpenCodeConnector | null = null
let restartInFlight = false
let managedHostname = '127.0.0.1'
let managedPort = 0
let verboseMode = false
let funnelPort: number | null = null

// Graceful shutdown handler
async function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`)

  if (healthTimer) {
    clearInterval(healthTimer)
    healthTimer = null
  }

  if (eventStreamController) {
    console.log('Stopping OpenCode event stream...')
    eventStreamController.abort()
    eventStreamController = null
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

    if (eventStreamController) {
      eventStreamController.abort()
      eventStreamController = null
    }

    try {
      await opencodeServer.close()
    } catch {
      // ignore
    }

    const bootstrap = await bootstrapManagedOpenCode(managedHostname, managedPort, verboseMode)
    opencodeServer = bootstrap.server

    opencodeConnector.updateBaseUrl(opencodeServer.url)

    eventStreamController = await opencodeConnector.startEventStream((event) => {
      if (verboseMode) {
        console.log('[SDK Event]', JSON.stringify(event))
      }
      bridgeServer?.enqueueSdkEvent(event)
    })

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

async function bootstrapAttachOpenCode(verbose: boolean): Promise<OpencodeBootstrap> {
  const instances = await discoverRunningOpencodeInstances(defaultAttachPorts(), verbose)
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

  if (!tailscaleConnected) {
    console.log('ℹ️  Tailscale not connected. Local network access only.')
    if (cli.enableFunnel) {
      console.log('⚠️  --funnel requires Tailscale. Skipping Funnel setup.')
    }
  }

  // Create bridge server
  try {
    bridgeServer = createBridgeServer({
      port,
      opencode,
      version,
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

  // Subscribe to OpenCode events and forward to clients
  eventStreamController = await opencode.startEventStream((event) => {
    if (cli.verbose) {
      console.log('[SDK Event]', JSON.stringify(event))
    }
    bridgeServer?.enqueueSdkEvent(event)
  })

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
