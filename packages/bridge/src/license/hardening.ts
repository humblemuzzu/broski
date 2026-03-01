/**
 * Runtime hardening for compiled binaries.
 *
 * Three layers:
 * 1. Environment sanitization — strip env vars that could weaken security
 * 2. Library injection detection — DYLD_INSERT_LIBRARIES, LD_PRELOAD
 * 3. Debugger detection — TracerPid (Linux), ptrace indicators (macOS)
 *
 * None of these are unbypassable. The goal is to raise the cost of casual
 * tampering. Real protection comes from server-side license validation
 * and the native Rust sidecar being harder to patch than TypeScript.
 *
 * Design: detection does NOT crash the process. Crashing reveals the
 * detection point. Instead, flags are returned so the caller can
 * silently degrade (e.g., make license checks fail "naturally").
 */

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isCompiledBinary } from '../platform'

// ============================================================================
// ENVIRONMENT SANITIZATION
// ============================================================================

/**
 * Env vars that, if set, could weaken compiled-binary security.
 * Deleted unconditionally before any other module reads them.
 */
const DANGEROUS_ENV_KEYS = [
  // Auth weakening
  'BROSKI_ALLOW_TOKEN_IN_URL',
  // License bypass
  'BROSKI_REQUIRE_ENTITLEMENT',
  'BROSKI_SKIP_SIG_CHECK',
  'BROSKI_SKIP_INTEGRITY',
  'BROSKI_SKIP_LICENSE',
  // TLS bypass
  'BROSKI_DISABLE_TLS',
  // Filesystem escape
  'BROSKI_ALLOWED_BASE_PATHS',
  // Node/Bun debugger injection
  'NODE_OPTIONS',
]

/**
 * Remove env vars that could bypass security in compiled binaries.
 * Call this BEFORE any other module reads process.env.
 * No-op in dev mode.
 */
export function sanitizeEnvironment(): void {
  if (!isCompiledBinary()) return

  for (const key of DANGEROUS_ENV_KEYS) {
    delete process.env[key]
  }

  // Strip all BROSKI_DEBUG_* vars in production
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('BROSKI_DEBUG')) {
      delete process.env[key]
    }
  }
}

// ============================================================================
// INJECTION DETECTION
// ============================================================================

/**
 * Check for dynamic library injection. These env vars are used by
 * Frida, LIEF, and other instrumentation tools to hook functions.
 */
export function detectLibraryInjection(): boolean {
  if (process.env.DYLD_INSERT_LIBRARIES) return true
  if (process.env.LD_PRELOAD) return true
  // Bun JSC debug hooks
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('BUN_JSC_')) return true
  }
  return false
}

// ============================================================================
// DEBUGGER DETECTION
// ============================================================================

/**
 * Best-effort debugger detection. Not foolproof — a skilled attacker
 * can bypass all of these. Catches casual attachment.
 */
export function detectDebugger(): boolean {
  // Linux: /proc/self/status TracerPid
  if (process.platform === 'linux') {
    try {
      const status = readFileSync('/proc/self/status', 'utf-8')
      const match = status.match(/TracerPid:\s+(\d+)/)
      if (match && Number(match[1]) > 0) return true
    } catch {
      // /proc not available — not conclusive
    }
  }

  // macOS: check for P_TRACED via sysctl
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync(
        '/usr/sbin/sysctl', ['-n', `kern.proc.pid.${process.pid}`],
        { encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 },
      )
      // P_TRACED flag is 0x00000800 in the kinfo_proc p_flag field.
      // The struct layout varies, but if the raw output contains the flag,
      // we're being debugged. Check bytes 32-35 (p_flag offset on arm64/x86_64).
      if (out.length >= 36) {
        const pFlag = out.readUInt32LE(32)
        if (pFlag & 0x00000800) return true
      }
    } catch {
      // sysctl failed — not conclusive
    }
  }

  return false
}

// ============================================================================
// COMBINED CHECK
// ============================================================================

export type HardeningFlags = {
  injectionDetected: boolean
  debuggerDetected: boolean
}

/**
 * Initialize runtime hardening. Call as early as possible.
 *
 * Returns flags indicating detected threats. The caller decides
 * how to respond — typically by silently marking internal state
 * so license checks fail "naturally" later, making the connection
 * between debugger and failure non-obvious to an attacker.
 */
export function initRuntimeHardening(): HardeningFlags {
  const flags: HardeningFlags = {
    injectionDetected: false,
    debuggerDetected: false,
  }

  if (!isCompiledBinary()) return flags

  sanitizeEnvironment()

  flags.injectionDetected = detectLibraryInjection()
  flags.debuggerDetected = detectDebugger()

  // Clean injection env vars so they can't be re-read downstream
  if (flags.injectionDetected) {
    delete process.env.DYLD_INSERT_LIBRARIES
    delete process.env.LD_PRELOAD
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('BUN_JSC_')) delete process.env[key]
    }
  }

  return flags
}

// ============================================================================
// PERIODIC MONITORING
// ============================================================================

let _hardeningTimer: ReturnType<typeof setInterval> | null = null

/**
 * Periodic re-check for runtime tampering.
 * Jittered interval makes timing unpredictable.
 */
export function startHardeningMonitor(
  onTamper: (flags: HardeningFlags) => void,
  baseIntervalMs = 3 * 60 * 1000,
): void {
  if (!isCompiledBinary()) return
  if (_hardeningTimer) return

  // ±45s jitter
  const jitter = Math.floor(Math.random() * 90_000) - 45_000
  const interval = Math.max(60_000, baseIntervalMs + jitter)

  _hardeningTimer = setInterval(() => {
    const flags: HardeningFlags = {
      injectionDetected: detectLibraryInjection(),
      debuggerDetected: detectDebugger(),
    }
    if (flags.injectionDetected || flags.debuggerDetected) {
      onTamper(flags)
    }
  }, interval)

  if (_hardeningTimer && typeof _hardeningTimer === 'object' && 'unref' in _hardeningTimer) {
    _hardeningTimer.unref()
  }
}

export function stopHardeningMonitor(): void {
  if (_hardeningTimer) {
    clearInterval(_hardeningTimer)
    _hardeningTimer = null
  }
}
