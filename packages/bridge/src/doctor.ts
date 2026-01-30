/**
 * Broski Doctor — comprehensive system diagnostics with auto-fix.
 *
 * 30+ checks across 7 categories: system, dependencies, network, security,
 * daemon, agents, connectivity.
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { stat, mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import * as clack from '@clack/prompts'

import {
  IS_MACOS, IS_LINUX, IS_WINDOWS, CURRENT_PLATFORM,
  findBinary, isCompiledBinary, checkPortInUse, getProcessOnPort,
  getDaemonStatus, getDaemonType, getDaemonConfigPath, getBroskiBinaryPath,
  isTailscaleInstalled as platformIsTailscaleInstalled,
  getKillPortHint, getTailscaleInstallHint, getSleepPreventionTip, getTailLogsHint,
} from './platform'
import { getLocalIP, getTailscaleIP, isTailscaleConnected } from './network'
import { isTlsEnabledByEnv, checkCertExpiry, ensureTlsMaterial } from './tls'
import packageMeta from '../package.json'

// ============================================================================
// Types
// ============================================================================

interface CheckResult {
  name: string
  category: 'system' | 'dependencies' | 'network' | 'security' | 'daemon' | 'agents' | 'connectivity'
  status: 'ok' | 'warning' | 'error' | 'info'
  message: string
  fix?: string
  autoFix?: () => Promise<boolean>
}

// ============================================================================
// ANSI Palette (standalone — no dependency on wizard module)
// ============================================================================

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const CYAN = '\x1b[36m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const NC = '\x1b[0m'

// ============================================================================
// Path Helpers
// ============================================================================

const BROSKI_HOME = resolve(homedir(), '.broski')
const BROSKI_BIN = resolve(BROSKI_HOME, 'bin')
const BROSKI_LOGS = resolve(BROSKI_HOME, 'logs')
const BROSKI_TLS = resolve(BROSKI_HOME, 'tls')
const BROSKI_TOKEN_FILE = resolve(BROSKI_HOME, 'token.json')
const BROSKI_LOG_FILE = resolve(BROSKI_LOGS, 'bridge.log')

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

// ============================================================================
// Check Implementations
// ============================================================================

// --- SYSTEM ---

function checkPlatformInfo(): CheckResult {
  const mode = isCompiledBinary() ? 'compiled binary' : 'dev mode (bun)'
  return {
    name: 'platform_info',
    category: 'system',
    status: 'info',
    message: `${CURRENT_PLATFORM} ${process.arch}, ${mode}`,
  }
}

async function checkVersionUpdate(): Promise<CheckResult> {
  const ver = packageMeta.version ?? '0.1.0'
  try {
    const { checkForUpdate } = await import('./updater')
    const result = await checkForUpdate(ver)
    if (result && result.updateAvailable) {
      return {
        name: 'version_check',
        category: 'system',
        status: 'warning',
        message: `v${ver} installed — v${result.latestVersion} available`,
        fix: 'Run `broski update` to install the latest version',
      }
    }
    return {
      name: 'version_check',
      category: 'system',
      status: 'ok',
      message: `v${ver} (up to date)`,
    }
  } catch {
    return {
      name: 'version_check',
      category: 'system',
      status: 'info',
      message: `v${ver} (update check skipped)`,
    }
  }
}

async function checkBroskiHome(): Promise<CheckResult> {
  const exists = await dirExists(BROSKI_HOME)
  if (exists) {
    return { name: 'broski_home', category: 'system', status: 'ok', message: `~/.broski/ exists` }
  }
  return {
    name: 'broski_home',
    category: 'system',
    status: 'error',
    message: '~/.broski/ directory missing',
    fix: 'Will be created automatically',
    autoFix: async () => {
      await mkdir(BROSKI_HOME, { recursive: true })
      return await dirExists(BROSKI_HOME)
    },
  }
}

async function checkDirectoryStructure(): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const dirs = [
    { path: BROSKI_BIN, label: 'bin/' },
    { path: BROSKI_LOGS, label: 'logs/' },
    { path: BROSKI_TLS, label: 'tls/' },
  ]
  for (const { path, label } of dirs) {
    const exists = await dirExists(path)
    if (exists) {
      results.push({
        name: `dir_${label}`,
        category: 'system',
        status: 'ok',
        message: `~/.broski/${label} exists`,
      })
    } else {
      results.push({
        name: `dir_${label}`,
        category: 'system',
        status: 'warning',
        message: `~/.broski/${label} missing`,
        fix: `mkdir -p ~/.broski/${label}`,
        autoFix: async () => {
          await mkdir(path, { recursive: true })
          return await dirExists(path)
        },
      })
    }
  }
  return results
}

function checkPathIncludes(): CheckResult {
  const pathEnv = process.env.PATH ?? ''
  const onPath = pathEnv.split(IS_WINDOWS ? ';' : ':').some((p) => {
    try {
      return resolve(p) === BROSKI_BIN
    } catch {
      return false
    }
  })
  if (onPath) {
    return { name: 'path_check', category: 'system', status: 'ok', message: '~/.broski/bin is on PATH' }
  }
  return {
    name: 'path_check',
    category: 'system',
    status: 'warning',
    message: '~/.broski/bin is not on PATH',
    fix: IS_WINDOWS
      ? 'Add %USERPROFILE%\\.broski\\bin to your PATH environment variable'
      : 'Add export PATH="$HOME/.broski/bin:$PATH" to your shell profile',
  }
}

// --- DEPENDENCIES ---

async function checkOpenCodeBinary(): Promise<CheckResult> {
  const found = findBinary('opencode')
  if (!found) {
    return {
      name: 'opencode',
      category: 'dependencies',
      status: 'warning',
      message: 'OpenCode not found',
      fix: IS_WINDOWS ? 'npm install -g opencode' : 'bun install -g opencode',
    }
  }
  try {
    const proc = Bun.spawnSync(['opencode', '--version'], { stdout: 'pipe', stderr: 'pipe' })
    const version = proc.stdout?.toString()?.trim()
    return {
      name: 'opencode',
      category: 'dependencies',
      status: 'ok',
      message: version ? `OpenCode ${version}` : 'OpenCode found',
    }
  } catch {
    return { name: 'opencode', category: 'dependencies', status: 'ok', message: 'OpenCode found (version check failed)' }
  }
}

async function checkClaudeCodeBinary(): Promise<CheckResult> {
  const found = findBinary('claude')
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY
  const hasSettings = existsSync(resolve(homedir(), '.claude', 'settings.json'))

  if (!found) {
    return {
      name: 'claude_code',
      category: 'dependencies',
      status: 'warning',
      message: 'Claude Code (claude) not found',
      fix: 'npm install -g @anthropic-ai/claude-code',
    }
  }

  const auth = hasApiKey ? 'API key set' : hasSettings ? 'settings.json found' : 'no API key or settings'
  return {
    name: 'claude_code',
    category: 'dependencies',
    status: 'ok',
    message: `Claude Code found (${auth})`,
  }
}

async function checkCodexBinary(): Promise<CheckResult> {
  const found = findBinary('codex')
  if (!found) {
    return {
      name: 'codex',
      category: 'dependencies',
      status: 'warning',
      message: 'Codex not found',
      fix: 'npm install -g @openai/codex',
    }
  }
  return { name: 'codex', category: 'dependencies', status: 'ok', message: 'Codex found' }
}

async function checkAtLeastOneAgent(): Promise<CheckResult> {
  const hasOpencode = !!findBinary('opencode')
  const hasClaude = !!findBinary('claude')
  const hasCodex = !!findBinary('codex')

  if (!hasOpencode && !hasClaude && !hasCodex) {
    return {
      name: 'any_agent',
      category: 'dependencies',
      status: 'error',
      message: 'No AI agents found — install at least one (opencode, claude, or codex)',
      fix: 'Install OpenCode: bun install -g opencode',
    }
  }

  const agents = [
    hasOpencode && 'OpenCode',
    hasClaude && 'Claude Code',
    hasCodex && 'Codex',
  ].filter(Boolean)
  return {
    name: 'any_agent',
    category: 'dependencies',
    status: 'ok',
    message: `Available agents: ${agents.join(', ')}`,
  }
}

// --- NETWORK ---

async function checkLocalIP(): Promise<CheckResult> {
  const ip = getLocalIP()
  if (ip) {
    return { name: 'local_ip', category: 'network', status: 'ok', message: `Local IP: ${ip}` }
  }
  return {
    name: 'local_ip',
    category: 'network',
    status: 'warning',
    message: 'Could not detect local IP',
    fix: 'Check your network connection',
  }
}

async function checkPort(): Promise<CheckResult> {
  const port = 18274
  const inUse = await checkPortInUse(port)
  if (!inUse) {
    return { name: 'port', category: 'network', status: 'ok', message: `Port ${port} available` }
  }
  const proc = await getProcessOnPort(port)
  const who = proc ? ` (${proc.name}, PID ${proc.pid})` : ''
  const isBroski = proc?.name?.toLowerCase().includes('broski')
  if (isBroski) {
    return {
      name: 'port',
      category: 'network',
      status: 'info',
      message: `Port ${port} in use by Broski bridge${who}`,
    }
  }
  return {
    name: 'port',
    category: 'network',
    status: 'warning',
    message: `Port ${port} in use by another process${who}`,
    fix: getKillPortHint(port),
  }
}

async function checkTailscaleInstalled(): Promise<CheckResult> {
  const installed = await platformIsTailscaleInstalled()
  if (installed) {
    return { name: 'ts_installed', category: 'network', status: 'ok', message: 'Tailscale installed' }
  }
  return {
    name: 'ts_installed',
    category: 'network',
    status: 'warning',
    message: 'Tailscale not installed (optional — needed for remote access)',
    fix: getTailscaleInstallHint(),
  }
}

async function checkTailscaleConnected(): Promise<CheckResult> {
  const installed = await platformIsTailscaleInstalled()
  if (!installed) {
    return { name: 'ts_connected', category: 'network', status: 'info', message: 'Tailscale not installed — skipping connection check' }
  }
  const connected = await isTailscaleConnected()
  if (connected) {
    return { name: 'ts_connected', category: 'network', status: 'ok', message: 'Tailscale connected' }
  }
  let fixMsg = 'Connect via Tailscale'
  if (IS_MACOS) fixMsg = 'Click the Tailscale icon in your menu bar to connect'
  else if (IS_LINUX) fixMsg = 'Run: sudo tailscale up'
  else fixMsg = 'Open Tailscale from your system tray to connect'
  return {
    name: 'ts_connected',
    category: 'network',
    status: 'warning',
    message: 'Tailscale installed but not connected',
    fix: fixMsg,
  }
}

async function checkTailscaleIP(): Promise<CheckResult> {
  const ip = await getTailscaleIP()
  if (ip) {
    return { name: 'ts_ip', category: 'network', status: 'info', message: `Tailscale IP: ${ip}` }
  }
  return { name: 'ts_ip', category: 'network', status: 'info', message: 'No Tailscale IP' }
}

// --- SECURITY ---

function checkTlsEnabled(): CheckResult {
  const enabled = isTlsEnabledByEnv()
  if (enabled) {
    return { name: 'tls_enabled', category: 'security', status: 'ok', message: 'TLS enabled' }
  }
  return {
    name: 'tls_enabled',
    category: 'security',
    status: 'warning',
    message: 'TLS disabled (BROSKI_TLS=0)',
    fix: 'Remove BROSKI_TLS=0 from your environment to enable TLS',
  }
}

async function checkTlsCertExists(): Promise<CheckResult> {
  const enabled = isTlsEnabledByEnv()
  if (!enabled) {
    return { name: 'tls_cert', category: 'security', status: 'info', message: 'TLS disabled — cert check skipped' }
  }
  const certPath = resolve(BROSKI_TLS, 'server.cert.pem')
  const keyPath = resolve(BROSKI_TLS, 'server.key.pem')
  const hasCert = await fileExists(certPath)
  const hasKey = await fileExists(keyPath)
  if (hasCert && hasKey) {
    return { name: 'tls_cert', category: 'security', status: 'ok', message: 'TLS certificate and key exist' }
  }
  return {
    name: 'tls_cert',
    category: 'security',
    status: 'error',
    message: 'TLS certificate or key missing',
    fix: 'Will be generated automatically',
    autoFix: async () => {
      try {
        await ensureTlsMaterial()
        return true
      } catch {
        return false
      }
    },
  }
}

async function checkTlsCertExpiry(): Promise<CheckResult> {
  const enabled = isTlsEnabledByEnv()
  if (!enabled) {
    return { name: 'tls_expiry', category: 'security', status: 'info', message: 'TLS disabled — expiry check skipped' }
  }
  const certPath = resolve(BROSKI_TLS, 'server.cert.pem')
  if (!(await fileExists(certPath))) {
    return { name: 'tls_expiry', category: 'security', status: 'info', message: 'No cert to check expiry' }
  }
  const expiry = checkCertExpiry(certPath)
  if (expiry.valid && expiry.daysRemaining >= 7) {
    return {
      name: 'tls_expiry',
      category: 'security',
      status: 'ok',
      message: `TLS cert valid (${expiry.daysRemaining} days remaining)`,
    }
  }
  const reason = !expiry.valid ? 'expired' : `expiring in ${expiry.daysRemaining} day(s)`
  return {
    name: 'tls_expiry',
    category: 'security',
    status: 'error',
    message: `TLS certificate ${reason}`,
    fix: 'Will be regenerated automatically',
    autoFix: async () => {
      try {
        const keyPath = resolve(BROSKI_TLS, 'server.key.pem')
        try { await unlink(certPath) } catch { /* ok */ }
        try { await unlink(keyPath) } catch { /* ok */ }
        await ensureTlsMaterial()
        return true
      } catch {
        return false
      }
    },
  }
}

async function checkAuthToken(): Promise<CheckResult> {
  if (!(await fileExists(BROSKI_TOKEN_FILE))) {
    return {
      name: 'auth_token',
      category: 'security',
      status: 'error',
      message: 'Auth token file missing (~/.broski/token.json)',
      fix: 'Start the bridge with `broski` to generate a token',
      autoFix: async () => {
        try {
          const { loadOrCreateAuthState } = await import('./server')
          await loadOrCreateAuthState(true)
          return await fileExists(BROSKI_TOKEN_FILE)
        } catch {
          return false
        }
      },
    }
  }
  return { name: 'auth_token', category: 'security', status: 'ok', message: 'Auth token exists' }
}

async function checkAuthTokenValid(): Promise<CheckResult> {
  if (!(await fileExists(BROSKI_TOKEN_FILE))) {
    return { name: 'auth_token_valid', category: 'security', status: 'info', message: 'No token file to validate' }
  }
  try {
    const raw = await readFile(BROSKI_TOKEN_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed.version !== 1 || typeof parsed.token !== 'string' || parsed.token.length < 16) {
      return {
        name: 'auth_token_valid',
        category: 'security',
        status: 'warning',
        message: 'Auth token format is malformed',
        fix: 'Run `broski --new-token` to regenerate',
      }
    }
    // Check expiry
    const now = Date.now()
    if (parsed.expiresAt && now > parsed.expiresAt) {
      return {
        name: 'auth_token_valid',
        category: 'security',
        status: 'warning',
        message: 'Auth token has expired',
        fix: 'Start the bridge to auto-rotate, or run `broski --new-token`',
      }
    }
    return { name: 'auth_token_valid', category: 'security', status: 'ok', message: 'Auth token valid' }
  } catch {
    return {
      name: 'auth_token_valid',
      category: 'security',
      status: 'warning',
      message: 'Could not parse token.json',
      fix: 'Run `broski --new-token` to regenerate',
    }
  }
}

// --- DAEMON ---

function checkDaemonType(): CheckResult {
  const type = getDaemonType()
  const labels: Record<string, string> = {
    launchagent: 'macOS LaunchAgent',
    systemd: 'Linux systemd',
    'task-scheduler': 'Windows Task Scheduler',
    none: 'None',
  }
  return {
    name: 'daemon_type',
    category: 'daemon',
    status: 'info',
    message: `Daemon type: ${labels[type] ?? type}`,
  }
}

async function checkDaemonInstalled(): Promise<CheckResult> {
  const status = await getDaemonStatus()
  if (status.installed) {
    return { name: 'daemon_installed', category: 'daemon', status: 'ok', message: 'Background service installed' }
  }
  return {
    name: 'daemon_installed',
    category: 'daemon',
    status: 'warning',
    message: 'Background service not installed',
    fix: 'Run `broski install` to enable Always On mode',
  }
}

async function checkDaemonRunning(): Promise<CheckResult> {
  const status = await getDaemonStatus()
  if (!status.installed) {
    return { name: 'daemon_running', category: 'daemon', status: 'info', message: 'Daemon not installed — skipping run check' }
  }
  if (status.running) {
    const pidInfo = status.pid ? ` (PID ${status.pid})` : ''
    return { name: 'daemon_running', category: 'daemon', status: 'ok', message: `Daemon running${pidInfo}` }
  }
  return {
    name: 'daemon_running',
    category: 'daemon',
    status: 'warning',
    message: 'Daemon installed but not running',
    fix: 'Run `broski restart` to start it',
  }
}

async function checkLogDirWritable(): Promise<CheckResult> {
  const exists = await dirExists(BROSKI_LOGS)
  if (!exists) {
    return {
      name: 'log_dir',
      category: 'daemon',
      status: 'error',
      message: 'Log directory missing (~/.broski/logs/)',
      fix: 'Will be created automatically',
      autoFix: async () => {
        await mkdir(BROSKI_LOGS, { recursive: true })
        return await dirExists(BROSKI_LOGS)
      },
    }
  }
  // Test write
  const testFile = resolve(BROSKI_LOGS, '.doctor-write-test')
  try {
    await writeFile(testFile, 'test', 'utf-8')
    await unlink(testFile)
    return { name: 'log_dir', category: 'daemon', status: 'ok', message: 'Log directory writable' }
  } catch {
    return {
      name: 'log_dir',
      category: 'daemon',
      status: 'error',
      message: 'Log directory not writable',
      fix: `Check permissions on ${BROSKI_LOGS}`,
    }
  }
}

async function checkDaemonConfigUpToDate(): Promise<CheckResult> {
  const status = await getDaemonStatus()
  if (!status.installed || !status.configPath) {
    return { name: 'daemon_config', category: 'daemon', status: 'info', message: 'Daemon not installed — config check skipped' }
  }
  // On macOS/Linux we can read the config and check if the binary path matches
  try {
    const content = await readFile(status.configPath, 'utf-8')
    const currentBinary = getBroskiBinaryPath()
    if (content.includes(currentBinary)) {
      return { name: 'daemon_config', category: 'daemon', status: 'ok', message: 'Daemon config matches current binary' }
    }
    return {
      name: 'daemon_config',
      category: 'daemon',
      status: 'warning',
      message: 'Daemon config may reference a different binary path',
      fix: 'Run `broski uninstall && broski install` to update',
    }
  } catch {
    return { name: 'daemon_config', category: 'daemon', status: 'info', message: 'Could not read daemon config' }
  }
}

// --- AGENTS ---

async function checkClaudeCodeProjectsDir(): Promise<CheckResult> {
  const dir = resolve(homedir(), '.claude', 'projects')
  const exists = await dirExists(dir)
  return {
    name: 'cc_projects',
    category: 'agents',
    status: 'info',
    message: exists ? 'Claude Code projects directory exists' : 'No Claude Code projects directory',
  }
}

async function checkCodexHome(): Promise<CheckResult> {
  // Codex uses ~/.codex or similar
  const candidates = [
    resolve(homedir(), '.codex'),
    resolve(homedir(), '.openai'),
  ]
  for (const dir of candidates) {
    if (await dirExists(dir)) {
      return { name: 'codex_home', category: 'agents', status: 'info', message: `Codex config directory found: ${dir}` }
    }
  }
  return { name: 'codex_home', category: 'agents', status: 'info', message: 'No Codex config directory found' }
}

async function checkOpenCodeReachable(): Promise<CheckResult> {
  // Best-effort: check if an OpenCode server is responding on common ports
  try {
    const res = await fetch('http://127.0.0.1:4096/path', { signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      return { name: 'oc_reachable', category: 'agents', status: 'ok', message: 'OpenCode server responding on :4096' }
    }
  } catch {
    // not running
  }
  return { name: 'oc_reachable', category: 'agents', status: 'info', message: 'No OpenCode server detected (starts when bridge runs)' }
}

// --- CONNECTIVITY ---

async function checkInternet(): Promise<CheckResult> {
  try {
    const res = await fetch('https://broskiapp.com/download/latest.json', {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'broski-doctor' },
    })
    if (res.ok) {
      return { name: 'internet', category: 'connectivity', status: 'ok', message: 'Internet reachable (broskiapp.com)' }
    }
    return { name: 'internet', category: 'connectivity', status: 'warning', message: `Internet check returned HTTP ${res.status}` }
  } catch {
    return {
      name: 'internet',
      category: 'connectivity',
      status: 'warning',
      message: 'Cannot reach broskiapp.com',
      fix: 'Check your internet connection',
    }
  }
}

async function checkBridgePortListening(): Promise<CheckResult> {
  const status = await getDaemonStatus()
  if (!status.installed) {
    return { name: 'bridge_port', category: 'connectivity', status: 'info', message: 'Daemon not installed — skipping port check' }
  }
  const port = 18274
  const inUse = await checkPortInUse(port)
  if (inUse) {
    return { name: 'bridge_port', category: 'connectivity', status: 'ok', message: `Bridge listening on port ${port}` }
  }
  return {
    name: 'bridge_port',
    category: 'connectivity',
    status: 'warning',
    message: `Bridge not listening on port ${port}`,
    fix: 'Run `broski restart` or `broski` to start',
  }
}

async function checkQRDataIntegrity(): Promise<CheckResult> {
  // Verify token file exists and config port match
  if (!(await fileExists(BROSKI_TOKEN_FILE))) {
    return { name: 'qr_data', category: 'connectivity', status: 'warning', message: 'No token file — QR code will not work until bridge starts' }
  }
  try {
    const raw = await readFile(BROSKI_TOKEN_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed.token || parsed.token.length < 16) {
      return { name: 'qr_data', category: 'connectivity', status: 'warning', message: 'Token in token.json is too short' }
    }
    return { name: 'qr_data', category: 'connectivity', status: 'ok', message: 'QR data looks valid (token present)' }
  } catch {
    return { name: 'qr_data', category: 'connectivity', status: 'warning', message: 'Could not parse token.json' }
  }
}

// ============================================================================
// Runner
// ============================================================================

function printResult(result: CheckResult): void {
  let icon: string
  switch (result.status) {
    case 'ok':
      icon = `${GREEN}\u2713${NC}`
      break
    case 'warning':
      icon = `${YELLOW}!${NC}`
      break
    case 'error':
      icon = `${RED}\u2717${NC}`
      break
    case 'info':
      icon = `${DIM}\u2139${NC}`
      break
  }

  console.log(`  ${icon} ${result.message}`)

  if (result.fix) {
    console.log(`    ${CYAN}Fix:${NC} ${result.fix}`)
  }
}

function printCategoryHeader(title: string): void {
  console.log(`\n${BOLD}${title}${NC}`)
  console.log('\u2500'.repeat(50))
}

/**
 * Check if we're running in an interactive terminal.
 */
function isInteractive(): boolean {
  try {
    return process.stdin.isTTY === true
  } catch {
    return false
  }
}

export async function runDoctor(): Promise<void> {
  console.log(`
${CYAN}\u2554${'═'.repeat(58)}\u2557
\u2551${' '.repeat(58)}\u2551
\u2551   Broski Doctor${' '.repeat(43)}\u2551
\u2551${' '.repeat(58)}\u2551
\u255a${'═'.repeat(58)}\u255d${NC}
`)

  const allResults: CheckResult[] = []

  // --- SYSTEM ---
  printCategoryHeader('SYSTEM')
  const systemChecks: CheckResult[] = [
    checkPlatformInfo(),
    await checkVersionUpdate(),
    await checkBroskiHome(),
    ...(await checkDirectoryStructure()),
    checkPathIncludes(),
  ]
  for (const r of systemChecks) {
    printResult(r)
    allResults.push(r)
  }

  // --- DEPENDENCIES ---
  printCategoryHeader('DEPENDENCIES')
  const depChecks: CheckResult[] = [
    await checkOpenCodeBinary(),
    await checkClaudeCodeBinary(),
    await checkCodexBinary(),
    await checkAtLeastOneAgent(),
  ]
  for (const r of depChecks) {
    printResult(r)
    allResults.push(r)
  }

  // --- NETWORK ---
  printCategoryHeader('NETWORK')
  const netChecks: CheckResult[] = [
    await checkLocalIP(),
    await checkPort(),
    await checkTailscaleInstalled(),
    await checkTailscaleConnected(),
    await checkTailscaleIP(),
  ]
  for (const r of netChecks) {
    printResult(r)
    allResults.push(r)
  }

  // --- SECURITY ---
  printCategoryHeader('SECURITY')
  const secChecks: CheckResult[] = [
    checkTlsEnabled(),
    await checkTlsCertExists(),
    await checkTlsCertExpiry(),
    await checkAuthToken(),
    await checkAuthTokenValid(),
  ]
  for (const r of secChecks) {
    printResult(r)
    allResults.push(r)
  }

  // --- DAEMON ---
  printCategoryHeader('DAEMON')
  const daemonChecks: CheckResult[] = [
    checkDaemonType(),
    await checkDaemonInstalled(),
    await checkDaemonRunning(),
    await checkLogDirWritable(),
    await checkDaemonConfigUpToDate(),
  ]
  for (const r of daemonChecks) {
    printResult(r)
    allResults.push(r)
  }

  // --- AGENTS ---
  printCategoryHeader('AGENTS')
  const agentChecks: CheckResult[] = [
    await checkOpenCodeReachable(),
    await checkClaudeCodeProjectsDir(),
    await checkCodexHome(),
  ]
  for (const r of agentChecks) {
    printResult(r)
    allResults.push(r)
  }

  // --- CONNECTIVITY ---
  printCategoryHeader('CONNECTIVITY')
  const connChecks: CheckResult[] = [
    await checkInternet(),
    await checkBridgePortListening(),
    await checkQRDataIntegrity(),
  ]
  for (const r of connChecks) {
    printResult(r)
    allResults.push(r)
  }

  // --- SUMMARY ---
  console.log('')
  console.log('\u2500'.repeat(50))

  const okCount = allResults.filter((r) => r.status === 'ok').length
  const warnCount = allResults.filter((r) => r.status === 'warning').length
  const errCount = allResults.filter((r) => r.status === 'error').length
  const infoCount = allResults.filter((r) => r.status === 'info').length

  console.log(
    `  ${GREEN}${okCount} passed${NC}  ${YELLOW}${warnCount} warning(s)${NC}  ${RED}${errCount} error(s)${NC}  ${DIM}${infoCount} info${NC}`,
  )

  if (errCount === 0 && warnCount === 0) {
    console.log(`\n${GREEN}${BOLD}\u2713 All checks passed!${NC}`)
    console.log('Run `broski` to start.')
  } else if (errCount > 0) {
    console.log(`\n${RED}${BOLD}\u2717 ${errCount} error(s) need attention${NC}`)
  } else {
    console.log(`\n${YELLOW}${BOLD}! ${warnCount} warning(s) — bridge should still work${NC}`)
  }

  // --- AUTO-FIX ---
  const fixable = allResults.filter((r) => r.autoFix && (r.status === 'error' || r.status === 'warning'))
  if (fixable.length > 0) {
    console.log('')

    let shouldFix = false
    if (isInteractive()) {
      try {
        const answer = await clack.confirm({
          message: `Fix ${fixable.length} issue(s) automatically?`,
          initialValue: true,
        })
        shouldFix = !clack.isCancel(answer) && answer === true
      } catch {
        // Not interactive or cancelled
        shouldFix = false
      }
    } else {
      // Non-interactive: just show the suggestions
      console.log(`  ${DIM}${fixable.length} issue(s) can be auto-fixed. Run interactively to fix.${NC}`)
    }

    if (shouldFix) {
      console.log('')
      for (const fix of fixable) {
        process.stdout.write(`  Fixing: ${fix.message}...`)
        try {
          const ok = await fix.autoFix!()
          if (ok) {
            console.log(` ${GREEN}\u2713${NC}`)
          } else {
            console.log(` ${RED}\u2717${NC}`)
          }
        } catch (err) {
          console.log(` ${RED}\u2717${NC} ${err}`)
        }
      }
      console.log(`\n  Run \`broski doctor\` again to verify.`)
    }
  }

  console.log('')
}
