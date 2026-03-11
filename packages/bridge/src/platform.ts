/**
 * Platform abstraction layer for cross-platform Broski bridge.
 *
 * Every OS-specific difference is encapsulated here so that the rest of the
 * codebase can import clean, tested helpers instead of sprinkling
 * `process.platform` checks everywhere.
 *
 * Supports: macOS (darwin), Linux (linux), Windows (win32).
 * Only imports from node: builtins and Bun globals.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { existsSync, chmodSync } from 'node:fs'
import { stat, mkdir, writeFile, unlink } from 'node:fs/promises'

// ============================================================================
// 1. Platform Detection Constants
// ============================================================================

export type Platform = 'darwin' | 'linux' | 'win32'

export const CURRENT_PLATFORM: Platform = process.platform as Platform
export const IS_MACOS: boolean = CURRENT_PLATFORM === 'darwin'
export const IS_LINUX: boolean = CURRENT_PLATFORM === 'linux'
export const IS_WINDOWS: boolean = CURRENT_PLATFORM === 'win32'

// ============================================================================
// Internal: Shell command helper
// ============================================================================

const COMMAND_TIMEOUT_MS = 5000

interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
  status: number | null
}

/**
 * Run a shell command with timeout and error handling.
 * Returns a RunResult; never throws.
 */
function runCommand(cmd: string, args: string[], opts?: {
  timeout?: number
  input?: string
  shell?: boolean
}): RunResult {
  try {
    const result: SpawnSyncReturns<string> = spawnSync(cmd, args, {
      encoding: 'utf-8',
      timeout: opts?.timeout ?? COMMAND_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
      input: opts?.input,
      shell: opts?.shell ?? false,
    })
    return {
      ok: result.status === 0,
      stdout: (result.stdout ?? '').trim(),
      stderr: (result.stderr ?? '').trim(),
      status: result.status,
    }
  } catch {
    return { ok: false, stdout: '', stderr: '', status: null }
  }
}

// ============================================================================
// 2. Binary/Command Discovery
// ============================================================================

/**
 * Find a binary on the system. Cross-platform replacement for `which`.
 */
export function findBinary(name: string): string | null {
  try {
    const found = Bun.which(name)
    if (found) return found
  } catch {
    // Bun.which may throw on some platforms
  }

  if (IS_WINDOWS) {
    // Check common Windows locations
    const ext = name.endsWith('.exe') ? '' : '.exe'
    const candidates = [
      resolve(process.env.USERPROFILE ?? homedir(), '.bun', 'bin', `${name}${ext}`),
      `C:\\Program Files\\${name}\\${name}${ext}`,
      `C:\\Program Files (x86)\\${name}\\${name}${ext}`,
      resolve(process.env.LOCALAPPDATA ?? '', name, `${name}${ext}`),
    ]
    for (const p of candidates) {
      try {
        if (existsSync(p)) return p
      } catch {
        // continue
      }
    }
  }

  return null
}

/**
 * Whether we're running as a compiled binary (bun build --compile) vs dev mode.
 */
export function isCompiledBinary(): boolean {
  // When compiled via `bun build --compile`, process.argv[1] is the same as
  // process.execPath (the binary itself). In dev mode, process.argv[1] is the
  // script path. We also check for the absence of import.meta.main as a hint.
  try {
    return process.execPath === process.argv[1]
  } catch {
    return false
  }
}

/**
 * Get the path to the Broski binary itself.
 * When compiled: process.execPath
 * When dev: bun + script path
 */
export function getBroskiBinaryPath(): string {
  if (isCompiledBinary()) {
    return process.execPath
  }
  // Dev mode: return the script being run
  return process.argv[1] ?? process.execPath
}

/**
 * Get the path to the Bun runtime (for dev mode / daemon config).
 */
export async function getBunPath(): Promise<string> {
  // Try Bun.which first
  try {
    const found = Bun.which('bun')
    if (found) {
      try {
        const s = await stat(found)
        if (s.isFile()) return found
      } catch { /* continue */ }
    }
  } catch { /* continue */ }

  let candidates: string[]

  if (IS_MACOS) {
    candidates = [
      '/usr/local/bin/bun',
      resolve(homedir(), '.bun/bin/bun'),
      '/opt/homebrew/bin/bun',
    ]
  } else if (IS_LINUX) {
    candidates = [
      '/usr/local/bin/bun',
      resolve(homedir(), '.bun/bin/bun'),
      '/usr/bin/bun',
      '/snap/bin/bun',
      resolve(homedir(), '.local/bin/bun'),
    ]
  } else {
    // Windows
    const userProfile = process.env.USERPROFILE ?? homedir()
    const localAppData = process.env.LOCALAPPDATA ?? resolve(userProfile, 'AppData', 'Local')
    candidates = [
      resolve(userProfile, '.bun', 'bin', 'bun.exe'),
      'C:\\Program Files\\Bun\\bun.exe',
      resolve(localAppData, 'bun', 'bun.exe'),
    ]
  }

  for (const loc of candidates) {
    try {
      const s = await stat(loc)
      if (s.isFile()) return loc
    } catch {
      // continue
    }
  }

  return 'bun' // fallback — relies on PATH
}

// ============================================================================
// 3. Process Management
// ============================================================================

/**
 * Check if a TCP port is in use.
 */
export async function checkPortInUse(port: number): Promise<boolean> {
  if (IS_WINDOWS) {
    const res = runCommand('netstat', ['-ano'], { timeout: COMMAND_TIMEOUT_MS })
    if (!res.ok) return false
    // Match lines with LISTENING state on the target port
    const lines = res.stdout.split('\n')
    for (const line of lines) {
      if (line.includes(`:${port}`) && /LISTENING/i.test(line)) return true
    }
    return false
  }

  // macOS/Linux: try lsof first
  const lsof = runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
  if (lsof.ok && lsof.stdout.includes('LISTEN')) return true

  // Linux fallback: ss
  if (IS_LINUX) {
    const ss = runCommand('ss', ['-tlnp', `sport`, `=`, `:${port}`])
    if (ss.ok && ss.stdout.includes(`:${port}`)) return true
  }

  return false
}

/**
 * Get info about which process is using a port.
 */
export async function getProcessOnPort(port: number): Promise<{ pid: number; name: string } | null> {
  if (IS_WINDOWS) {
    const res = runCommand('netstat', ['-ano'], { timeout: COMMAND_TIMEOUT_MS })
    if (!res.ok) return null

    for (const line of res.stdout.split('\n')) {
      if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
        const parts = line.trim().split(/\s+/)
        const pidStr = parts[parts.length - 1]
        const pid = Number(pidStr)
        if (!Number.isFinite(pid) || pid <= 0) continue

        // Get process name via tasklist
        const tl = runCommand('tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'])
        let name = `PID ${pid}`
        if (tl.ok && tl.stdout) {
          const match = tl.stdout.match(/"([^"]+)"/)
          if (match) name = match[1]
        }
        return { pid, name }
      }
    }
    return null
  }

  // macOS/Linux: lsof
  const lsof = runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
  if (lsof.ok && lsof.stdout) {
    const lines = lsof.stdout.split('\n')
    for (const line of lines.slice(1)) { // skip header
      const parts = line.split(/\s+/)
      if (parts.length >= 2) {
        const name = parts[0]
        const pid = Number(parts[1])
        if (Number.isFinite(pid) && pid > 0) return { pid, name }
      }
    }
  }

  // Linux fallback: ss
  if (IS_LINUX) {
    const ss = runCommand('ss', ['-tlnp', 'sport', '=', `:${port}`])
    if (ss.ok && ss.stdout) {
      // ss output format includes pid=NNNN
      const pidMatch = ss.stdout.match(/pid=(\d+)/)
      if (pidMatch) {
        const pid = Number(pidMatch[1])
        return { pid, name: `PID ${pid}` }
      }
    }
  }

  return null
}

/**
 * Kill a process by PID.
 */
export function killProcess(pid: number): boolean {
  if (IS_WINDOWS) {
    const res = runCommand('taskkill', ['/F', '/PID', String(pid)])
    return res.ok
  }

  const res = runCommand('kill', ['-9', String(pid)])
  return res.ok
}

/**
 * Find processes matching a pattern.
 */
export function findProcessByPattern(pattern: string): number[] {
  if (IS_WINDOWS) {
    const res = runCommand('tasklist', ['/FO', 'CSV', '/NH'])
    if (!res.ok) return []

    const pids: number[] = []
    for (const line of res.stdout.split('\n')) {
      if (!line.trim()) continue
      // CSV format: "name.exe","PID","Session Name","Session#","Mem Usage"
      const match = line.match(/"([^"]+)","(\d+)"/)
      if (match) {
        const name = match[1]
        const pid = Number(match[2])
        if (name.toLowerCase().includes(pattern.toLowerCase()) && Number.isFinite(pid) && pid > 0) {
          pids.push(pid)
        }
      }
    }
    return pids
  }

  // macOS/Linux: pgrep
  const res = runCommand('pgrep', ['-f', pattern])
  if (!res.ok || !res.stdout) return []

  return res.stdout
    .split('\n')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0 && n !== process.pid)
}

/**
 * Open a URL in the default browser.
 */
export function openUrl(url: string): void {
  if (IS_MACOS) {
    runCommand('open', [url])
  } else if (IS_LINUX) {
    // Try xdg-open, then sensible-browser, then fallback to printing
    const xdg = runCommand('xdg-open', [url])
    if (!xdg.ok) {
      const sb = runCommand('sensible-browser', [url])
      if (!sb.ok) {
        console.log(`Open this URL in your browser: ${url}`)
      }
    }
  } else {
    // Windows: start needs empty title string when URL contains special chars
    runCommand('cmd', ['/c', 'start', '""', url], { shell: true })
  }
}

// ============================================================================
// 4. Daemon/Service Management
// ============================================================================

export type DaemonType = 'launchagent' | 'systemd' | 'task-scheduler' | 'none'

export interface DaemonConfig {
  /** Path to the broski binary */
  binaryPath: string
  /** Extra CLI args to pass (e.g. ['--daemon', '--hotspot']) */
  args: string[]
  /** Log directory */
  logDir: string
  /** Working directory (typically homedir) */
  workDir: string
}

export interface DaemonStatus {
  installed: boolean
  running: boolean
  type: DaemonType
  /** Path to the service config file */
  configPath: string | null
  /** PID if running */
  pid: number | null
}

// Daemon identifiers
const MACOS_LABEL = 'com.broski.bridge'
const LINUX_SERVICE = 'broski-bridge'
const WINDOWS_TASK = 'BroskiBridge'

/**
 * Get the daemon type for the current platform.
 */
export function getDaemonType(): DaemonType {
  if (IS_MACOS) return 'launchagent'
  if (IS_LINUX) return 'systemd'
  if (IS_WINDOWS) return 'task-scheduler'
  return 'none'
}

/**
 * Get the path where the daemon config file lives.
 */
export function getDaemonConfigPath(): string {
  if (IS_MACOS) {
    return resolve(homedir(), 'Library/LaunchAgents', `${MACOS_LABEL}.plist`)
  }
  if (IS_LINUX) {
    return resolve(homedir(), '.config/systemd/user', `${LINUX_SERVICE}.service`)
  }
  // Windows: no file, return a label
  return WINDOWS_TASK
}

/**
 * Generate the daemon config content.
 * macOS: plist XML, Linux: systemd unit, Windows: null (uses schtasks).
 */
export function generateDaemonConfig(config: DaemonConfig): string | null {
  if (IS_MACOS) {
    return generateMacOsPlist(config)
  }
  if (IS_LINUX) {
    return generateSystemdUnit(config)
  }
  // Windows uses schtasks commands, not a config file
  return null
}

function generateMacOsPlist(config: DaemonConfig): string {
  const allArgs = [config.binaryPath, ...config.args]
  const programArgsXml = allArgs
    .map(arg => `        <string>${escapeXml(arg)}</string>`)
    .join('\n')

  const home = homedir()
  const bunDir = dirname(config.binaryPath)

  // Build a comprehensive PATH that covers common binary locations
  const pathValue = [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/opt/homebrew/bin',
    bunDir,
    `${home}/.opencode/bin`,
    `${home}/.local/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.bun/bin`,
  ].join(':')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${MACOS_LABEL}</string>
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
    <string>${escapeXml(config.logDir)}/bridge.log</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(config.logDir)}/bridge.error.log</string>
    <key>WorkingDirectory</key>
    <string>${escapeXml(config.workDir)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${escapeXml(pathValue)}</string>
        <key>HOME</key>
        <string>${escapeXml(home)}</string>
    </dict>
</dict>
</plist>`
}

function generateSystemdUnit(config: DaemonConfig): string {
  const execStart = [config.binaryPath, ...config.args].join(' ')

  return `[Unit]
Description=Broski Bridge Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=on-failure
RestartSec=10
Environment=HOME=%h
Environment=PATH=/usr/local/bin:/usr/bin:/bin:%h/.local/bin:%h/.bun/bin:%h/.opencode/bin

StandardOutput=append:%h/.broski/logs/bridge.log
StandardError=append:%h/.broski/logs/bridge.error.log

[Install]
WantedBy=default.target`
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Install the daemon.
 */
export async function installDaemon(config: DaemonConfig): Promise<void> {
  // Ensure log directory exists
  await mkdir(config.logDir, { recursive: true })

  if (IS_MACOS) {
    await installMacOsDaemon(config)
  } else if (IS_LINUX) {
    await installLinuxDaemon(config)
  } else if (IS_WINDOWS) {
    await installWindowsDaemon(config)
  }
}

async function installMacOsDaemon(config: DaemonConfig): Promise<void> {
  const plistPath = getDaemonConfigPath()
  const content = generateDaemonConfig(config)
  if (!content) throw new Error('Failed to generate plist')

  // Ensure parent directory
  await mkdir(dirname(plistPath), { recursive: true })

  // Write plist
  await writeFile(plistPath, content, { mode: 0o644 })

  // Load the LaunchAgent
  const res = runCommand('launchctl', ['load', plistPath])
  if (!res.ok) {
    throw new Error(`Failed to load LaunchAgent: ${res.stderr || res.stdout}`)
  }
}

async function installLinuxDaemon(config: DaemonConfig): Promise<void> {
  const unitPath = getDaemonConfigPath()
  const content = generateDaemonConfig(config)
  if (!content) throw new Error('Failed to generate systemd unit')

  // Ensure parent directory
  await mkdir(dirname(unitPath), { recursive: true })

  // Write unit file
  await writeFile(unitPath, content, { mode: 0o644 })

  // Reload systemd user daemon
  runCommand('systemctl', ['--user', 'daemon-reload'])

  // Enable and start the service
  const res = runCommand('systemctl', ['--user', 'enable', '--now', LINUX_SERVICE])
  if (!res.ok) {
    throw new Error(`Failed to enable systemd service: ${res.stderr || res.stdout}`)
  }

  // Check if loginctl enable-linger is needed (keeps user services running after logout)
  const lingerCheck = runCommand('loginctl', ['show-user', process.env.USER ?? '', '-p', 'Linger'])
  if (lingerCheck.ok && lingerCheck.stdout.includes('Linger=no')) {
    console.log('Hint: Run `loginctl enable-linger` to keep the service running after logout')
  }
}

async function installWindowsDaemon(config: DaemonConfig): Promise<void> {
  const execStr = [config.binaryPath, ...config.args].join(' ')

  const res = runCommand('schtasks', [
    '/create',
    '/tn', WINDOWS_TASK,
    '/tr', execStr,
    '/sc', 'onlogon',
    '/rl', 'LIMITED',
    '/f',
  ])

  if (!res.ok) {
    throw new Error(`Failed to create scheduled task: ${res.stderr || res.stdout}`)
  }

  // Start the task immediately too
  runCommand('schtasks', ['/run', '/tn', WINDOWS_TASK])
}

/**
 * Uninstall the daemon.
 */
export async function uninstallDaemon(): Promise<void> {
  if (IS_MACOS) {
    await uninstallMacOsDaemon()
  } else if (IS_LINUX) {
    await uninstallLinuxDaemon()
  } else if (IS_WINDOWS) {
    await uninstallWindowsDaemon()
  }
}

async function uninstallMacOsDaemon(): Promise<void> {
  const plistPath = getDaemonConfigPath()

  // Unload first (ignore errors — may not be loaded)
  runCommand('launchctl', ['unload', plistPath])

  // Delete plist file
  try {
    await unlink(plistPath)
  } catch {
    // File may not exist
  }
}

async function uninstallLinuxDaemon(): Promise<void> {
  const unitPath = getDaemonConfigPath()

  // Disable and stop
  runCommand('systemctl', ['--user', 'disable', '--now', LINUX_SERVICE])

  // Delete unit file
  try {
    await unlink(unitPath)
  } catch {
    // File may not exist
  }

  // Reload
  runCommand('systemctl', ['--user', 'daemon-reload'])
}

async function uninstallWindowsDaemon(): Promise<void> {
  // End the running task first
  runCommand('schtasks', ['/end', '/tn', WINDOWS_TASK])

  // Delete the task
  const res = runCommand('schtasks', ['/delete', '/tn', WINDOWS_TASK, '/f'])
  if (!res.ok) {
    // Not an error if it didn't exist
  }
}

/**
 * Get daemon status.
 */
export async function getDaemonStatus(): Promise<DaemonStatus> {
  const type = getDaemonType()
  const configPath = getDaemonConfigPath()

  if (IS_MACOS) return getMacOsDaemonStatus(type, configPath)
  if (IS_LINUX) return getLinuxDaemonStatus(type, configPath)
  if (IS_WINDOWS) return getWindowsDaemonStatus(type, configPath)

  return { installed: false, running: false, type: 'none', configPath: null, pid: null }
}

async function getMacOsDaemonStatus(type: DaemonType, configPath: string): Promise<DaemonStatus> {
  // Check if plist file exists
  let installed = false
  try {
    const s = await stat(configPath)
    installed = s.isFile()
  } catch {
    // not installed
  }

  if (!installed) {
    return { installed: false, running: false, type, configPath, pid: null }
  }

  // Check launchctl for running status
  const res = runCommand('launchctl', ['list', MACOS_LABEL])
  const running = res.ok && res.stdout.includes(MACOS_LABEL)

  let pid: number | null = null
  if (running && res.stdout) {
    // launchctl list output first column is PID (or "-" if not running)
    const match = res.stdout.match(/^(\d+)\s+/)
    if (match) {
      const p = Number(match[1])
      if (Number.isFinite(p) && p > 0) pid = p
    }
  }

  return { installed, running, type, configPath, pid }
}

async function getLinuxDaemonStatus(type: DaemonType, configPath: string): Promise<DaemonStatus> {
  // Check if unit file exists
  let installed = false
  try {
    const s = await stat(configPath)
    installed = s.isFile()
  } catch {
    // not installed
  }

  if (!installed) {
    return { installed: false, running: false, type, configPath, pid: null }
  }

  // Check if service is active
  const res = runCommand('systemctl', ['--user', 'is-active', LINUX_SERVICE])
  const running = res.ok && res.stdout.trim() === 'active'

  let pid: number | null = null
  if (running) {
    const showRes = runCommand('systemctl', ['--user', 'show', LINUX_SERVICE, '-p', 'MainPID'])
    if (showRes.ok) {
      const match = showRes.stdout.match(/MainPID=(\d+)/)
      if (match) {
        const p = Number(match[1])
        if (Number.isFinite(p) && p > 0) pid = p
      }
    }
  }

  return { installed, running, type, configPath, pid }
}

async function getWindowsDaemonStatus(type: DaemonType, configPath: string): Promise<DaemonStatus> {
  const res = runCommand('schtasks', ['/query', '/tn', WINDOWS_TASK, '/fo', 'csv', '/nh'])
  if (!res.ok || !res.stdout.trim()) {
    return { installed: false, running: false, type, configPath, pid: null }
  }

  const installed = true
  const running = /Running/i.test(res.stdout)

  // Windows Task Scheduler doesn't directly expose PID in query output.
  // Attempt to find the process via pattern match.
  let pid: number | null = null
  if (running) {
    const pids = findProcessByPattern('broski')
    if (pids.length > 0) pid = pids[0]
  }

  return { installed, running, type, configPath, pid }
}

/**
 * Stop the daemon.
 */
export async function stopDaemon(): Promise<void> {
  if (IS_MACOS) {
    runCommand('launchctl', ['stop', MACOS_LABEL])
  } else if (IS_LINUX) {
    runCommand('systemctl', ['--user', 'stop', LINUX_SERVICE])
  } else if (IS_WINDOWS) {
    runCommand('schtasks', ['/end', '/tn', WINDOWS_TASK])
  }
}

/**
 * Restart the daemon.
 */
export async function restartDaemon(): Promise<void> {
  if (IS_MACOS) {
    const configPath = getDaemonConfigPath()
    // Stop first (may already be stopped)
    runCommand('launchctl', ['stop', MACOS_LABEL])
    await new Promise(r => setTimeout(r, 500))
    // Unload then reload to force a clean restart.
    // KeepAlive.SuccessfulExit=false means launchd won't auto-restart
    // after a clean shutdown (exit 0), so we must explicitly reload.
    runCommand('launchctl', ['unload', configPath])
    await new Promise(r => setTimeout(r, 500))
    runCommand('launchctl', ['load', configPath])
  } else if (IS_LINUX) {
    runCommand('systemctl', ['--user', 'restart', LINUX_SERVICE])
  } else if (IS_WINDOWS) {
    runCommand('schtasks', ['/end', '/tn', WINDOWS_TASK])
    await new Promise(r => setTimeout(r, 1000))
    runCommand('schtasks', ['/run', '/tn', WINDOWS_TASK])
  }
}

// ============================================================================
// 5. TLS Certificate Generation
// ============================================================================

export interface CertificateResult {
  keyPem: string
  certPem: string
}

/**
 * Generate a self-signed TLS certificate.
 *
 * - macOS/Linux: shells out to openssl (always available on these platforms).
 * - Windows: uses PowerShell's New-SelfSignedCertificate, then exports to PEM.
 *   Falls back to openssl if available on Windows PATH.
 */
export async function generateSelfSignedCertificate(opts: {
  commonName?: string
  validityDays?: number
  keyPath: string
  certPath: string
}): Promise<void> {
  const cn = opts.commonName ?? 'broski'
  const days = opts.validityDays ?? 365

  // Ensure parent directories exist
  await mkdir(dirname(opts.keyPath), { recursive: true })
  await mkdir(dirname(opts.certPath), { recursive: true })

  if (IS_MACOS || IS_LINUX) {
    await generateCertOpenssl(cn, days, opts.keyPath, opts.certPath)
  } else {
    // Windows: try openssl first, fall back to PowerShell
    const openssl = findBinary('openssl')
    if (openssl) {
      await generateCertOpenssl(cn, days, opts.keyPath, opts.certPath)
    } else {
      await generateCertPowerShell(cn, days, opts.keyPath, opts.certPath)
    }
  }
}

async function generateCertOpenssl(
  cn: string,
  days: number,
  keyPath: string,
  certPath: string,
): Promise<void> {
  const openssl = findBinary('openssl') ?? 'openssl'

  const res = runCommand(openssl, [
    'req', '-x509',
    '-newkey', 'rsa:2048',
    '-nodes',
    '-subj', `/CN=${cn}`,
    '-days', String(days),
    '-keyout', keyPath,
    '-out', certPath,
  ], { timeout: 15000 })

  if (!res.ok) {
    throw new Error(`Failed to generate TLS cert via OpenSSL: ${res.stderr || res.stdout || 'unknown error'}`)
  }

  // Tighten key permissions (best-effort)
  try { chmodSync(keyPath, 0o600) } catch { /* ignore */ }
  try { chmodSync(certPath, 0o644) } catch { /* ignore */ }
}

async function generateCertPowerShell(
  cn: string,
  days: number,
  keyPath: string,
  certPath: string,
): Promise<void> {
  // Build PowerShell script to create a self-signed certificate and export to PEM.
  // We use string concatenation to avoid backtick/dollar conflicts with JS template literals.
  const certPathEscaped = certPath.replace(/\\/g, '\\\\')
  const keyPathEscaped = keyPath.replace(/\\/g, '\\\\')
  const crlf = '`r`n' // PowerShell escape for \r\n
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '$cert = New-SelfSignedCertificate -Subject "CN=' + cn + '" -CertStoreLocation "Cert:\\CurrentUser\\My" -NotAfter (Get-Date).AddDays(' + days + ') -KeyExportPolicy Exportable -KeySpec Signature -KeyLength 2048 -Type SSLServerAuthentication',
    '$thumbprint = $cert.Thumbprint',
    '',
    '$certBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)',
    '$certPem = "-----BEGIN CERTIFICATE-----' + crlf + '"',
    '$certPem += [Convert]::ToBase64String($certBytes, [Base64FormattingOptions]::InsertLineBreaks)',
    '$certPem += "' + crlf + '-----END CERTIFICATE-----"',
    '[System.IO.File]::WriteAllText("' + certPathEscaped + '", $certPem)',
    '',
    '$key = $cert.PrivateKey',
    '$keyBytes = $key.ExportRSAPrivateKey()',
    '$keyPem = "-----BEGIN RSA PRIVATE KEY-----' + crlf + '"',
    '$keyPem += [Convert]::ToBase64String($keyBytes, [Base64FormattingOptions]::InsertLineBreaks)',
    '$keyPem += "' + crlf + '-----END RSA PRIVATE KEY-----"',
    '[System.IO.File]::WriteAllText("' + keyPathEscaped + '", $keyPem)',
    '',
    'Remove-Item "Cert:\\CurrentUser\\My\\$thumbprint" -ErrorAction SilentlyContinue',
  ]
  const psScript = lines.join('\n')

  const res = runCommand('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
    timeout: 30000,
  })

  if (!res.ok) {
    throw new Error(`Failed to generate TLS cert via PowerShell: ${res.stderr || res.stdout || 'unknown error'}`)
  }
}

// ============================================================================
// 6. Network Helpers
// ============================================================================

/**
 * Get preferred network interface names for the current platform.
 */
export function getPreferredInterfaceNames(): string[] {
  if (IS_MACOS) return ['en0']
  if (IS_LINUX) return ['eth0', 'enp0s3', 'enp0s25', 'ens33', 'ens160', 'wlan0', 'wlp2s0']
  // Windows
  return ['Ethernet', 'Wi-Fi', 'vEthernet']
}

/**
 * Get hotspot interface patterns for the current platform.
 */
export function getHotspotInterfacePatterns(): string[] {
  if (IS_MACOS) return ['en1', 'en2', 'bridge100', 'bridge', 'utun', 'apd']
  if (IS_LINUX) return ['usb0', 'rndis0', 'wlan0', 'wlp', 'enp0s20u']
  // Windows
  return ['Mobile Hotspot', 'Local Area Connection', 'Ethernet 2']
}

/**
 * Get the Tailscale CLI binary path.
 */
export function getTailscaleBinaryPath(): string {
  if (IS_MACOS) return '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
  if (IS_WINDOWS) {
    // Try PATH first
    const found = findBinary('tailscale')
    if (found) return found
    // Common install location
    return 'C:\\Program Files\\Tailscale\\tailscale.exe'
  }
  // Linux: on PATH
  return 'tailscale'
}

/**
 * Check if Tailscale is installed.
 */
export async function isTailscaleInstalled(): Promise<boolean> {
  if (IS_MACOS) {
    try {
      const s = await stat('/Applications/Tailscale.app')
      return s.isDirectory()
    } catch {
      return false
    }
  }

  if (IS_LINUX) {
    return findBinary('tailscale') !== null
  }

  // Windows
  if (findBinary('tailscale') !== null) return true
  try {
    const s = await stat('C:\\Program Files\\Tailscale\\tailscale.exe')
    return s.isFile()
  } catch {
    return false
  }
}

// ============================================================================
// 7. Shell & Path Helpers
// ============================================================================

/**
 * Get the null device path.
 */
export function getNullDevice(): string {
  return IS_WINDOWS ? 'NUL' : '/dev/null'
}

/**
 * Get temp directory.
 */
export function getTmpDir(): string {
  return tmpdir()
}

/**
 * Get safe default allowed base paths for file operations.
 */
export function getDefaultAllowedPaths(): string[] {
  if (IS_WINDOWS) {
    return [homedir(), tmpdir()]
  }
  return [homedir(), '/tmp', '/var/tmp']
}

// ============================================================================
// 8. User-Facing Messages (Platform-Appropriate)
// ============================================================================

/**
 * Get the command string to kill a process on a port (for error messages).
 */
export function getKillPortHint(port: number): string {
  if (IS_MACOS) {
    return `kill -9 $(lsof -t -i:${port})`
  }
  if (IS_LINUX) {
    return `kill -9 $(lsof -t -i:${port})  # or: fuser -k ${port}/tcp`
  }
  // Windows
  return `netstat -ano | findstr :${port}\ntaskkill /F /PID <pid>`
}

/**
 * Get the command to tail logs (for error messages).
 */
export function getTailLogsHint(): string {
  const logPath = resolve(homedir(), '.broski', 'logs', 'bridge.log')
  if (IS_WINDOWS) {
    return `Get-Content -Wait "${logPath}"`
  }
  return `tail -f ${logPath}`
}

/**
 * Get the sleep prevention tip for daemon mode.
 */
export function getSleepPreventionTip(): string {
  if (IS_MACOS) {
    return 'Install Amphetamine (free on App Store) and disable "Allow system sleep when display is closed"'
  }
  if (IS_LINUX) {
    return 'Adjust sleep settings: sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target'
  }
  // Windows
  return 'Adjust power settings: powercfg /change standby-timeout-ac 0'
}

/**
 * Get Tailscale install instructions for the current platform.
 */
export function getTailscaleInstallHint(): string {
  if (IS_MACOS) {
    return 'Install from App Store or run: brew install tailscale'
  }
  if (IS_LINUX) {
    return 'curl -fsSL https://tailscale.com/install.sh | sh'
  }
  // Windows
  return 'winget install tailscale  # or download from https://tailscale.com/download/windows'
}

/**
 * Get the Tailscale App Store/download URL for the current platform.
 */
export function getTailscaleDownloadUrl(): string {
  if (IS_MACOS) {
    return 'macappstore://apps.apple.com/app/tailscale/id1475387142'
  }
  if (IS_LINUX) {
    return 'https://tailscale.com/download/linux'
  }
  // Windows
  return 'https://tailscale.com/download/windows'
}
