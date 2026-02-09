/**
 * Leveled bridge logger.
 *
 * - **user**  — always printed to console (bridge started, client connected, critical events)
 * - **info**  — printed in dev, suppressed in compiled binary console (auth details, cache, lifecycle)
 * - **debug** — printed only with --verbose / BROSKI_DEBUG in dev (RTS internals, filters, etc.)
 * - **error** — always printed to console (stderr) + written to error log
 *
 * ALL levels are always written to the log file so `broski logs` has full data.
 *
 * Daemon mode (launchd) redirects stdout/stderr to bridge.log / bridge.error.log.
 * When that happens, we skip direct file writes to avoid double entries.
 */

import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { isCompiledBinary } from '../platform'
import { redactSensitiveText } from './redact'

const LOG_DIR = resolve(homedir(), '.broski', 'logs')
const PRIMARY_LOG = resolve(LOG_DIR, 'bridge.log')
const ERROR_LOG = resolve(LOG_DIR, 'bridge.error.log')

export type LogLevel = 'user' | 'info' | 'debug'

export interface BridgeLogger {
  /** Always visible on console. Use for: bridge started, client connected/disconnected, critical events. */
  user(message: string): void
  /** Visible in dev console, hidden in binary console. Always in log file. */
  info(message: string): void
  /** Visible only with --verbose/DEBUG in dev. Always in log file. */
  debug(message: string): void
  /** Always visible on stderr. Goes to error log file too. */
  error(message: string, ...args: unknown[]): void
  /** Flush and close log file streams. Call on shutdown. */
  flush(): Promise<void>
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  user: 0,
  info: 1,
  debug: 2,
}

export type BridgeLoggerOptions = {
  /** Override console filter level. Default: 'user' for binary, 'info' for dev. */
  consoleLevel?: LogLevel
  /** Force redaction on/off. Default: on for binary, off for dev. */
  redact?: boolean
  /** Enable debug-level console output (like --verbose). */
  verbose?: boolean
}

export function createBridgeLogger(options?: BridgeLoggerOptions): BridgeLogger {
  const compiled = isCompiledBinary()
  const shouldRedact = options?.redact ?? compiled
  const verbose = options?.verbose ?? false

  // Console level: binary = user only, dev = info (or debug if verbose)
  const consoleLevel: LogLevel = options?.consoleLevel ?? (compiled ? 'user' : (verbose ? 'debug' : 'info'))
  const consolePriority = LEVEL_PRIORITY[consoleLevel]

  // Detect if stdout is being captured by a daemon (not a TTY).
  // In daemon mode, launchd already redirects stdout → bridge.log,
  // so we skip our own file writes to avoid double entries.
  const stdoutIsTTY = process.stdout.isTTY ?? false
  const skipFileWrite = !stdoutIsTTY && compiled

  // Ensure log directory exists (sync — runs once at startup)
  let logStream: WriteStream | null = null
  let errorStream: WriteStream | null = null

  if (!skipFileWrite) {
    try {
      mkdirSync(LOG_DIR, { recursive: true })
      logStream = createWriteStream(PRIMARY_LOG, { flags: 'a' })
      errorStream = createWriteStream(ERROR_LOG, { flags: 'a' })
    } catch {
      // Can't write log files — continue without file logging
    }
  }

  const redact = (msg: string): string => {
    return shouldRedact ? redactSensitiveText(msg) : msg
  }

  const formatFileLine = (level: string, message: string): string => {
    const ts = new Date().toISOString()
    return `[${ts}] [${level.toUpperCase()}] ${message}\n`
  }

  const writeToFile = (level: string, message: string, isError = false): void => {
    const formatted = formatFileLine(level, message)
    logStream?.write(formatted)
    if (isError) errorStream?.write(formatted)
  }

  const shouldPrintToConsole = (level: LogLevel): boolean => {
    return LEVEL_PRIORITY[level] <= consolePriority
  }

  return {
    user(message: string) {
      const safe = redact(message)
      writeToFile('user', safe)
      if (shouldPrintToConsole('user')) {
        console.log(safe)
      }
    },

    info(message: string) {
      const safe = redact(message)
      writeToFile('info', safe)
      if (shouldPrintToConsole('info')) {
        console.log(safe)
      }
    },

    debug(message: string) {
      const safe = redact(message)
      writeToFile('debug', safe)
      if (shouldPrintToConsole('debug')) {
        console.log(safe)
      }
    },

    error(message: string, ...args: unknown[]) {
      const safe = redact(message)
      writeToFile('error', safe, true)
      // Errors always go to console
      if (args.length > 0) {
        console.error(safe, ...args)
      } else {
        console.error(safe)
      }
    },

    async flush(): Promise<void> {
      await Promise.all([
        logStream
          ? new Promise<void>((res) => {
              logStream!.end(() => res())
            })
          : Promise.resolve(),
        errorStream
          ? new Promise<void>((res) => {
              errorStream!.end(() => res())
            })
          : Promise.resolve(),
      ])
    },
  }
}
