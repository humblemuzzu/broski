import { createOpencode, type OpencodeClient } from '@opencode-ai/sdk/v2'
import { displayBanner, displayQRCode } from './qr'
import { getLocalIP, getHotspotIP, getTailscaleIP, getTailscaleMagicDNS, isTailscaleConnected } from './network'
import { enableFunnel, disableFunnel } from './funnel'
import { OpenCodeConnector } from './connectors/opencode'
import { createBridgeServer, loadOrCreateAuthState } from './server'
import { parseCli, printHelp, promptForChoice } from './cli'
import { runDoctor } from './doctor'
import { runSetupTailscale } from './setup-tailscale'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { mkdir, writeFile, unlink, readFile, stat } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

// Daemon (Always On mode) configuration
const LAUNCH_AGENT_LABEL = 'com.broski.bridge'
const LAUNCH_AGENT_PATH = resolve(homedir(), 'Library/LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`)
const BROSKI_LOG_DIR = resolve(homedir(), '.broski', 'logs')
const BROSKI_PID_FILE = resolve(homedir(), '.broski', 'bridge.pid')

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

// ============================================================================
// Daemon Management (Always On Mode)
// ============================================================================

async function getBunPath(): Promise<string> {
  // Try to find bun in common locations
  const bunLocations = [
    Bun.which('bun'),
    '/usr/local/bin/bun',
    resolve(homedir(), '.bun/bin/bun'),
    '/opt/homebrew/bin/bun',
  ]
  
  for (const loc of bunLocations) {
    if (!loc) continue
    try {
      const s = await stat(loc)
      if (s.isFile()) return loc
    } catch {
      // continue
    }
  }
  
  return 'bun' // fallback
}

async function getBridgeScriptPath(): Promise<string> {
  // Get the path to the current script
  const scriptUrl = import.meta.url
  if (scriptUrl.startsWith('file://')) {
    return scriptUrl.replace('file://', '')
  }
  return resolve(dirname(new URL(import.meta.url).pathname), 'index.ts')
}

function generateLaunchAgentPlist(bunPath: string, scriptPath: string, args: string[] = []): string {
  const programArgs = [bunPath, scriptPath, '--daemon', ...args]
  const programArgsXml = programArgs
    .map(arg => `        <string>${arg}</string>`)
    .join('\n')

  // Enhanced LaunchAgent configuration for robust "Always On" mode:
  // - KeepAlive with NetworkState: Only runs when network is available (prevents crash loops when offline)
  // - KeepAlive with SuccessfulExit=false: Restarts on crash but not on clean exit
  // - ThrottleInterval: Prevents rapid restart loops (10 second minimum between restarts)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${programArgsXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>NetworkState</key>
        <true/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>${BROSKI_LOG_DIR}/bridge.log</string>
    <key>StandardErrorPath</key>
    <string>${BROSKI_LOG_DIR}/bridge.error.log</string>
    <key>WorkingDirectory</key>
    <string>${homedir()}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${dirname(bunPath)}:${homedir()}/.opencode/bin:${homedir()}/.local/bin:${homedir()}/.npm-global/bin</string>
        <key>HOME</key>
        <string>${homedir()}</string>
    </dict>
</dict>
</plist>`
}

async function runInstall(): Promise<void> {
  console.log('Installing Broski as background service...\n')

  // Check if already installed
  try {
    await stat(LAUNCH_AGENT_PATH)
    console.log('⚠️  Broski is already installed as a background service.')
    console.log('   Run `broski uninstall` first if you want to reinstall.')
    console.log('   Run `broski status` to check if it\'s running.')
    return
  } catch {
    // Not installed, continue
  }

  // Create log directory
  await mkdir(BROSKI_LOG_DIR, { recursive: true })
  console.log(`✓ Created log directory: ${BROSKI_LOG_DIR}`)

  // Get paths
  const bunPath = await getBunPath()
  const scriptPath = await getBridgeScriptPath()
  console.log(`✓ Bun path: ${bunPath}`)
  console.log(`✓ Bridge script: ${scriptPath}`)

  // Generate and write plist
  const plist = generateLaunchAgentPlist(bunPath, scriptPath, ['--hotspot'])
  await mkdir(dirname(LAUNCH_AGENT_PATH), { recursive: true })
  await writeFile(LAUNCH_AGENT_PATH, plist, { mode: 0o644 })
  console.log(`✓ Created LaunchAgent: ${LAUNCH_AGENT_PATH}`)

  // Load the LaunchAgent
  const loadResult = spawnSync('launchctl', ['load', LAUNCH_AGENT_PATH], { encoding: 'utf-8' })
  if (loadResult.status !== 0) {
    console.error(`❌ Failed to load LaunchAgent: ${loadResult.stderr || loadResult.stdout}`)
    return
  }
  console.log('✓ LaunchAgent loaded')

  // Wait a moment for the service to start
  await sleep(1000)

  // Check if it's running
  const statusResult = spawnSync('launchctl', ['list', LAUNCH_AGENT_LABEL], { encoding: 'utf-8' })
  if (statusResult.status === 0 && statusResult.stdout.includes(LAUNCH_AGENT_LABEL)) {
    console.log('\n✅ Broski bridge installed and running!')
    console.log('\n   The bridge will now:')
    console.log('   • Start automatically when you log in')
    console.log('   • Stay running in the background')
    console.log('   • Restart automatically if it crashes')
    console.log('\n   Commands:')
    console.log('   • broski status    - Check if running')
    console.log('   • broski stop      - Stop the service')
    console.log('   • broski uninstall - Remove the service')
    console.log(`\n   Logs: ${BROSKI_LOG_DIR}/bridge.log`)
    console.log('\n   💡 Want to use Broski with your Mac lid closed?')
    console.log('      Install Amphetamine (free on App Store) and disable')
    console.log('      "Allow system sleep when display is closed"')
  } else {
    console.log('\n⚠️  Service installed but may not be running.')
    console.log('   Check status with: broski status')
    console.log(`   Check logs: tail -f ${BROSKI_LOG_DIR}/bridge.log`)
  }
}

async function runUninstall(): Promise<void> {
  console.log('Uninstalling Broski background service...\n')

  // Check if installed
  try {
    await stat(LAUNCH_AGENT_PATH)
  } catch {
    console.log('ℹ️  Broski is not installed as a background service.')
    return
  }

  // Unload the LaunchAgent
  const unloadResult = spawnSync('launchctl', ['unload', LAUNCH_AGENT_PATH], { encoding: 'utf-8' })
  if (unloadResult.status !== 0) {
    console.warn(`⚠️  Could not unload LaunchAgent (may not be loaded): ${unloadResult.stderr || ''}`)
  } else {
    console.log('✓ LaunchAgent unloaded')
  }

  // Remove the plist file
  try {
    await unlink(LAUNCH_AGENT_PATH)
    console.log('✓ LaunchAgent file removed')
  } catch (err) {
    console.error(`❌ Failed to remove LaunchAgent file: ${err}`)
    return
  }

  console.log('\n✅ Broski background service uninstalled.')
  console.log('   The bridge will no longer start automatically.')
  console.log('   Run `broski` to start it manually when needed.')
}

async function runStatus(): Promise<void> {
  console.log('Broski Bridge Status\n')

  // Check if installed
  let installed = false
  try {
    await stat(LAUNCH_AGENT_PATH)
    installed = true
  } catch {
    // Not installed
  }

  console.log(`Background service: ${installed ? '✓ Installed' : '✗ Not installed'}`)

  if (installed) {
    // Check if running via launchctl
    const listResult = spawnSync('launchctl', ['list', LAUNCH_AGENT_LABEL], { encoding: 'utf-8' })
    const isRunning = listResult.status === 0 && listResult.stdout.includes(LAUNCH_AGENT_LABEL)
    
    // Parse PID from launchctl output
    let pid: string | null = null
    if (isRunning && listResult.stdout) {
      const match = listResult.stdout.match(/^(\d+)\s+/)
      if (match) pid = match[1]
    }

    console.log(`Service status:     ${isRunning ? '✓ Running' : '✗ Not running'}`)
    if (pid && pid !== '-') {
      console.log(`Process ID:         ${pid}`)
    }
  }

  // Check for any broski process
  const psResult = spawnSync('pgrep', ['-f', 'broski.*index.ts'], { encoding: 'utf-8' })
  const pids = psResult.stdout.trim().split('\n').filter(Boolean)
  
  if (pids.length > 0) {
    console.log(`\nActive processes:   ${pids.length} found`)
    for (const p of pids) {
      console.log(`  PID ${p}`)
    }
  }

  // Check if port 18274 is in use
  const lsofResult = spawnSync('lsof', ['-nP', '-iTCP:18274', '-sTCP:LISTEN'], { encoding: 'utf-8' })
  const portInUse = lsofResult.status === 0 && lsofResult.stdout.includes('LISTEN')
  
  console.log(`\nDefault port 18274: ${portInUse ? '✓ In use (bridge is listening)' : '✗ Not in use'}`)

  // Show log file location
  console.log(`\nLog files:          ${BROSKI_LOG_DIR}/`)
  console.log(`  • bridge.log       - Standard output`)
  console.log(`  • bridge.error.log - Error output`)

  if (!installed) {
    console.log('\n💡 Tip: Run `broski install` to enable Always On mode')
  }
}

async function runQR(detectHotspot: boolean): Promise<void> {
  console.log('Generating QR code for phone pairing...\n')

  // Load existing auth token from new token.json format (or fallback to legacy)
  let authToken: string
  let tlsEnabled = false
  let certSha256: string | null = null

  try {
    // Try new format first (token.json)
    const tokenJsonFile = resolve(homedir(), '.broski', 'token.json')
    const raw = await readFile(tokenJsonFile, 'utf-8')
    const parsed = JSON.parse(raw)
    authToken = parsed.token?.trim() ?? ''
    if (!authToken || authToken.length < 16) {
      throw new Error('Invalid token in token.json')
    }
  } catch {
    // Fallback to legacy format
    try {
      const tokenFile = resolve(homedir(), '.broski', 'token')
      const existing = await readFile(tokenFile, 'utf-8')
      authToken = existing.trim()
      if (authToken.length < 16) {
        throw new Error('Invalid token')
      }
    } catch {
      console.log('⚠️  No auth token found. Run `broski` or `broski install` first to start the bridge.')
      return
    }
  }

  // Check for TLS certificate
  try {
    const { ensureTlsMaterial, isTlsEnabledByEnv } = await import('./tls')
    tlsEnabled = isTlsEnabledByEnv()
    if (tlsEnabled) {
      const tlsMaterial = await ensureTlsMaterial()
      certSha256 = tlsMaterial.certSha256
    }
  } catch {
    // TLS not available, continue without it
  }

  // Check if bridge is actually running
  const port = 18274 // Default port
  const lsofResult = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf-8' })
  const bridgeRunning = lsofResult.status === 0 && lsofResult.stdout.includes('LISTEN')

  if (!bridgeRunning) {
    console.log('⚠️  Bridge is not running on port 18274.')
    console.log('   Start it with `broski` or `broski install` first.')
    console.log('')
  }

  // Detect network
  const localIP = getLocalIP()
  const tailscaleIP = await getTailscaleIP()
  const magicDNS = await getTailscaleMagicDNS()
  const hotspotIP = detectHotspot ? getHotspotIP() : null

  // Get version
  const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json()
  const version = packageJson.version ?? '0.1.0'

  displayQRCode({
    localIP,
    tailscaleIP,
    magicDNS,
    funnelURL: null,
    hotspotIP,
    port,
    version,
    authToken,
    tlsEnabled,
    certSha256,
  })

  if (bridgeRunning) {
    console.log('✓ Bridge is running. Scan the QR code with the Broski app.')
  }
}

async function runStop(): Promise<void> {
  console.log('Stopping Broski bridge...\n')

  // Check if installed as service
  let installed = false
  try {
    await stat(LAUNCH_AGENT_PATH)
    installed = true
  } catch {
    // Not installed as service
  }

  if (installed) {
    // Stop via launchctl (it will auto-restart due to KeepAlive, so we unload temporarily)
    const stopResult = spawnSync('launchctl', ['stop', LAUNCH_AGENT_LABEL], { encoding: 'utf-8' })
    if (stopResult.status === 0) {
      console.log('✓ Sent stop signal to background service')
      console.log('\n⚠️  Note: The service will restart automatically (KeepAlive is enabled).')
      console.log('   To stop permanently, run: broski uninstall')
      return
    }
  }

  // Try to kill any running broski processes
  const pkillResult = spawnSync('pkill', ['-f', 'broski.*index.ts'], { encoding: 'utf-8' })
  
  if (pkillResult.status === 0) {
    console.log('✓ Stopped running Broski processes')
  } else {
    // Check if anything was running
    const pgrepResult = spawnSync('pgrep', ['-f', 'broski.*index.ts'], { encoding: 'utf-8' })
    if (pgrepResult.stdout.trim()) {
      console.log('⚠️  Some processes may still be running')
    } else {
      console.log('ℹ️  No running Broski bridge found')
    }
  }
}

async function runRestart(): Promise<void> {
  console.log('Restarting Broski bridge...\n')
  const DEFAULT_PORT = 18274

  // Check if installed as service
  let installed = false
  try {
    await stat(LAUNCH_AGENT_PATH)
    installed = true
  } catch {
    // Not installed as service
  }

  if (!installed) {
    console.log('⚠️  Background service not installed.')
    console.log('   Run: broski install')
    return
  }

  // 1. Unload the service (this stops it and prevents auto-restart)
  console.log('Stopping service...')
  spawnSync('launchctl', ['unload', LAUNCH_AGENT_PATH], { encoding: 'utf-8' })

  // 2. Kill ALL broski/bun processes on the port to ensure clean restart
  for (let i = 0; i < 5; i++) {
    const lsofResult = spawnSync('lsof', ['-nP', `-iTCP:${DEFAULT_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf-8' })
    if (!lsofResult.stdout.trim()) break
    
    // Force kill any process on the port
    const lines = lsofResult.stdout.trim().split('\n')
    for (const line of lines.slice(1)) { // Skip header
      const parts = line.split(/\s+/)
      const pid = parts[1]
      if (pid && /^\d+$/.test(pid)) {
        spawnSync('kill', ['-9', pid], { encoding: 'utf-8' })
      }
    }
    await sleep(300)
  }

  // 3. Also kill any orphaned bun processes running our server
  spawnSync('pkill', ['-9', '-f', 'bun.*broski.*server'], { encoding: 'utf-8' })
  await sleep(500)

  // 4. Final check - wait for port to be truly free
  let portFree = false
  for (let i = 0; i < 6; i++) {
    const lsofResult = spawnSync('lsof', ['-nP', `-iTCP:${DEFAULT_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf-8' })
    if (!lsofResult.stdout.trim()) {
      portFree = true
      break
    }
    await sleep(500)
  }

  if (!portFree) {
    console.log('❌ Failed to free port. Try: kill -9 $(lsof -t -i:18274)')
    return
  }

  console.log('Starting service...')
  
  // 5. Load the service again
  const loadResult = spawnSync('launchctl', ['load', LAUNCH_AGENT_PATH], { encoding: 'utf-8' })
  if (loadResult.status !== 0) {
    console.log('❌ Failed to start service:', loadResult.stderr)
    return
  }

  // 6. Wait for it to be ready (up to 15 seconds - OpenCode takes time to start)
  let ready = false
  process.stdout.write('Waiting for bridge')
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    process.stdout.write('.')
    const checkResult = spawnSync('lsof', ['-nP', `-iTCP:${DEFAULT_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf-8' })
    if (checkResult.stdout.trim()) {
      ready = true
      break
    }
  }
  console.log('')
  
  // 7. Report status
  if (ready) {
    console.log('✓ Bridge restarted successfully')
    console.log(`✓ Listening on port ${DEFAULT_PORT}`)
  } else {
    console.log('⚠️  Service started but port not yet listening')
    console.log('   Check: tail ~/.broski/logs/bridge.error.log')
  }
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
    console.log('  Or attach explicitly: `broski --opencode-url http://127.0.0.1:4096`')
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

  if (cli.subCommand === 'install') {
    await runInstall()
    return
  }

  if (cli.subCommand === 'uninstall') {
    await runUninstall()
    return
  }

  if (cli.subCommand === 'status') {
    await runStatus()
    return
  }

  if (cli.subCommand === 'stop') {
    await runStop()
    return
  }

  if (cli.subCommand === 'restart') {
    await runRestart()
    return
  }

  if (cli.subCommand === 'qr') {
    await runQR(cli.detectHotspot)
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

  if (cli.daemon) console.log('[daemon] Detecting network...')
  const localIP = getLocalIP()
  if (cli.daemon) console.log(`[daemon] localIP: ${localIP}`)
  const tailscaleIP = await getTailscaleIP()
  if (cli.daemon) console.log(`[daemon] tailscaleIP: ${tailscaleIP}`)
  const magicDNS = await getTailscaleMagicDNS()
  if (cli.daemon) console.log(`[daemon] magicDNS: ${magicDNS}`)
  const tailscaleConnected = await isTailscaleConnected()
  if (cli.daemon) console.log(`[daemon] tailscaleConnected: ${tailscaleConnected}`)
  const hotspotIP = cli.detectHotspot ? getHotspotIP() : null
  if (cli.daemon) console.log(`[daemon] hotspotIP: ${hotspotIP}`)

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

  if (cli.daemon) console.log('[daemon] Loading auth token...')
  // Load persistent auth token (same token survives bridge restarts)
  const auth = await loadOrCreateAuthState(cli.newToken)
  if (cli.newToken) {
    console.log('✓ New auth token generated (old QR codes are now invalid)')
  } else {
    console.log('✓ Auth token loaded (persistent across restarts)')
  }

  if (cli.daemon) console.log('[daemon] Creating bridge server...')
  // Create bridge server
  try {
    const willEnableFunnel = cli.enableFunnel && tailscaleConnected
    bridgeServer = await createBridgeServer({
      port,
      opencode,
      version,
      auth,
      enableLoopbackInsecureServer: willEnableFunnel,
      restartOpenCode: restartManagedOpenCode,
      logger: (message) => console.log(message),
    })
  } catch (error: any) {
    if (error?.code === 'EADDRINUSE') {
      console.error(`\n❌ Bridge port ${port} is already in use.`)
      console.error('This usually means another broski process is still running.')
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
    const funnelBackendPort = bridgeServer.funnelBackendPort() ?? bridgePort
    const result = await enableFunnel(funnelBackendPort)
    if (result.success && result.url) {
      funnelURL = result.url
      funnelPort = funnelBackendPort
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

  const tlsInfo = bridgeServer.tls()
  displayQRCode({
    localIP,
    tailscaleIP,
    magicDNS,
    funnelURL,
    hotspotIP,
    port: bridgePort,
    version,
    authToken: bridgeServer.authToken(),
    tlsEnabled: tlsInfo.enabled,
    certSha256: tlsInfo.certSha256,
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
