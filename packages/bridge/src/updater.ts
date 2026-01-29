/**
 * Version check and self-update module for Broski bridge.
 *
 * Responsibilities:
 * 1. Check for new versions on startup and periodically (every 24h for daemons)
 * 2. Notify connected phone clients when an update is available
 * 3. Execute self-update: download new binary, replace, restart daemon
 *
 * The update manifest lives at: https://broskiapp.com/download/latest.json
 * Format: { version: "0.2.0", binaries: { "darwin-arm64": { url, sha256 }, ... } }
 */

import { homedir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { rename, chmod, unlink, writeFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { CURRENT_PLATFORM, isCompiledBinary, restartDaemon, getDaemonStatus } from './platform'

// ============================================================================
// Constants
// ============================================================================

const MANIFEST_URL = 'https://broskiapp.com/download/latest.json'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const CHECK_TIMEOUT_MS = 10_000 // 10s timeout for HTTP requests
const BROSKI_DIR = resolve(homedir(), '.broski')
const LAST_CHECK_FILE = resolve(BROSKI_DIR, 'last-update-check.json')

// ============================================================================
// Types
// ============================================================================

export type BinaryInfo = {
  url: string
  sha256: string
  size?: number
}

export type UpdateManifest = {
  version: string
  releasedAt?: string
  releaseNotes?: string
  binaries: Record<string, BinaryInfo>
}

export type UpdateCheckResult = {
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string
  releaseNotes?: string
  binaryInfo?: BinaryInfo
}

// ============================================================================
// Version Comparison
// ============================================================================

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b, 0 if equal, 1 if a > b
 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va < vb) return -1
    if (va > vb) return 1
  }
  return 0
}

/**
 * Get the platform key for this machine (matches build script naming).
 * E.g. "darwin-arm64", "linux-x64", "windows-x64"
 */
function getPlatformKey(): string {
  const os = CURRENT_PLATFORM === 'win32' ? 'windows' : CURRENT_PLATFORM
  const arch = process.arch === 'x64' ? 'x64' : process.arch // arm64 stays arm64
  return `${os}-${arch}`
}

// ============================================================================
// Manifest Fetch
// ============================================================================

async function fetchManifest(): Promise<UpdateManifest | null> {
  try {
    const res = await fetch(MANIFEST_URL, {
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: { 'User-Agent': 'broski-bridge' },
    })
    if (!res.ok) return null
    const data = await res.json() as UpdateManifest
    if (!data.version || !data.binaries) return null
    return data
  } catch {
    return null
  }
}

// ============================================================================
// Check for Updates
// ============================================================================

/**
 * Check if a newer version is available.
 * Returns null if the check failed (network error, etc.).
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateCheckResult | null> {
  const manifest = await fetchManifest()
  if (!manifest) return null

  const platformKey = getPlatformKey()
  const binaryInfo = manifest.binaries[platformKey]

  const updateAvailable = compareSemver(currentVersion, manifest.version) < 0

  // Persist last check time
  try {
    await mkdir(BROSKI_DIR, { recursive: true })
    await writeFile(LAST_CHECK_FILE, JSON.stringify({
      checkedAt: new Date().toISOString(),
      currentVersion,
      latestVersion: manifest.version,
      updateAvailable,
    }))
  } catch {
    // Non-critical, ignore
  }

  return {
    updateAvailable,
    currentVersion,
    latestVersion: manifest.version,
    releaseNotes: manifest.releaseNotes,
    binaryInfo: binaryInfo ?? undefined,
  }
}

/**
 * Read the last cached update check (for `broski status` display).
 */
export async function getLastUpdateCheck(): Promise<{
  checkedAt: string
  latestVersion: string
  updateAvailable: boolean
} | null> {
  try {
    const raw = await readFile(LAST_CHECK_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ============================================================================
// Startup Check (non-blocking)
// ============================================================================

/**
 * Run a non-blocking update check on startup. Logs if an update is available.
 * Returns the result so the caller can notify phone clients.
 */
export async function startupUpdateCheck(
  currentVersion: string,
  logger: (msg: string) => void,
): Promise<UpdateCheckResult | null> {
  try {
    const result = await checkForUpdate(currentVersion)
    if (!result) return null

    if (result.updateAvailable) {
      logger('')
      logger(`  Update available: v${result.latestVersion} (current: v${result.currentVersion})`)
      if (result.releaseNotes) {
        logger(`  ${result.releaseNotes}`)
      }
      logger(`  Run \`broski update\` to install the latest version.`)
      logger('')
    }

    return result
  } catch {
    // Startup check is best-effort
    return null
  }
}

// ============================================================================
// Periodic Check (for daemon mode)
// ============================================================================

let periodicTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start periodic update checks (every 24h). Designed for daemon mode.
 * Calls `onUpdateAvailable` when a new version is found.
 */
export function startPeriodicUpdateCheck(
  currentVersion: string,
  onUpdateAvailable: (result: UpdateCheckResult) => void,
  logger: (msg: string) => void,
): void {
  if (periodicTimer) return // Already running

  periodicTimer = setInterval(async () => {
    try {
      const result = await checkForUpdate(currentVersion)
      if (result?.updateAvailable) {
        logger(`[update] New version available: v${result.latestVersion}`)
        onUpdateAvailable(result)
      }
    } catch {
      // Periodic check is best-effort
    }
  }, CHECK_INTERVAL_MS)

  // Don't prevent process exit
  if (periodicTimer && typeof periodicTimer === 'object' && 'unref' in periodicTimer) {
    (periodicTimer as any).unref()
  }
}

/**
 * Stop periodic update checks.
 */
export function stopPeriodicUpdateCheck(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer)
    periodicTimer = null
  }
}

// ============================================================================
// Self-Update (broski update)
// ============================================================================

/**
 * Download, verify, and replace the current binary with the new version.
 * If running as a daemon, restarts the daemon afterward.
 *
 * Returns true on success.
 */
export async function performUpdate(
  currentVersion: string,
  logger: (msg: string) => void,
): Promise<boolean> {
  // Step 1: Check for update
  logger('Checking for updates...')
  const result = await checkForUpdate(currentVersion)

  if (!result) {
    logger('  Could not reach update server. Check your internet connection.')
    return false
  }

  if (!result.updateAvailable) {
    logger(`  Already on the latest version (v${currentVersion}).`)
    return false
  }

  logger(`  New version available: v${result.latestVersion} (current: v${result.currentVersion})`)

  if (!result.binaryInfo) {
    const key = getPlatformKey()
    logger(`  No binary available for your platform (${key}).`)
    logger(`  Visit https://broskiapp.com/download for manual installation.`)
    return false
  }

  // Step 2: Only compiled binaries can self-update
  if (!isCompiledBinary()) {
    logger('  Self-update is only available for compiled binaries.')
    logger('  In dev mode, pull the latest code and rebuild.')
    return false
  }

  const currentBinaryPath = process.execPath
  const binaryDir = dirname(currentBinaryPath)
  const tempPath = resolve(binaryDir, `.broski-update-${Date.now()}`)
  const backupPath = resolve(binaryDir, `.broski-backup-${Date.now()}`)

  try {
    // Step 3: Download new binary
    logger(`  Downloading v${result.latestVersion}...`)
    const downloadRes = await fetch(result.binaryInfo.url, {
      signal: AbortSignal.timeout(120_000), // 2 min timeout for large binaries
      headers: { 'User-Agent': 'broski-bridge' },
    })

    if (!downloadRes.ok || !downloadRes.body) {
      logger(`  Download failed: HTTP ${downloadRes.status}`)
      return false
    }

    // Stream to temp file
    const chunks: Uint8Array[] = []
    let downloaded = 0
    const reader = downloadRes.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      downloaded += value.length
      // Progress indicator every 10MB
      if (downloaded % (10 * 1024 * 1024) < value.length) {
        const mb = Math.round(downloaded / 1024 / 1024)
        logger(`  Downloaded ${mb} MB...`)
      }
    }

    const binary = Buffer.concat(chunks)
    logger(`  Downloaded ${Math.round(binary.length / 1024 / 1024)} MB`)

    // Step 4: Verify SHA-256 checksum
    if (result.binaryInfo.sha256) {
      logger('  Verifying checksum...')
      const hash = createHash('sha256').update(binary).digest('hex')
      if (hash !== result.binaryInfo.sha256) {
        logger(`  Checksum mismatch! Expected ${result.binaryInfo.sha256}, got ${hash}`)
        logger('  Update aborted for safety. Please try again or download manually.')
        return false
      }
      logger('  Checksum verified.')
    }

    // Step 5: Write temp file
    await writeFile(tempPath, binary)
    await chmod(tempPath, 0o755)

    // Step 6: Atomic swap — backup current, rename new
    logger('  Installing...')
    await rename(currentBinaryPath, backupPath)
    try {
      await rename(tempPath, currentBinaryPath)
    } catch (err) {
      // Rollback: restore backup
      logger('  Failed to install new binary. Rolling back...')
      await rename(backupPath, currentBinaryPath)
      throw err
    }

    // Step 7: Clean up backup (best-effort)
    try {
      await unlink(backupPath)
    } catch {
      // Old binary may still be in use on some OSes
    }

    logger(`  Updated to v${result.latestVersion}!`)

    // Step 8: Restart daemon if running as a service
    const status = await getDaemonStatus()
    if (status.installed && status.running) {
      logger('  Restarting daemon...')
      try {
        await restartDaemon()
        logger('  Daemon restarted with new version.')
      } catch {
        logger('  Could not restart daemon automatically.')
        logger('  Run `broski restart` to apply the update.')
      }
    } else if (status.installed) {
      logger('  Daemon is installed but not running.')
      logger('  The new version will be used next time it starts.')
    } else {
      logger('  Restart the bridge to use the new version.')
    }

    return true
  } catch (err) {
    logger(`  Update failed: ${err}`)

    // Clean up temp file if it exists
    try {
      if (existsSync(tempPath)) await unlink(tempPath)
    } catch {
      // ignore
    }

    return false
  }
}
