import type { CommandResult } from './types'

const DEFAULT_CMD_TIMEOUT_MS = 45_000
const GH_AVAIL_CACHE_TTL_MS = 60_000

let ghAvailableCache: { at: number; value: boolean } | null = null

export async function runCommand(
  command: string[],
  cwd?: string,
  timeoutMs = DEFAULT_CMD_TIMEOUT_MS,
): Promise<CommandResult> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    try {
      proc.kill()
    } catch {
      // ignore
    }
  }, timeoutMs)

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, exitCode, timedOut }
  } finally {
    clearTimeout(timeout)
  }
}

export async function runGit(args: string[], cwd: string): Promise<CommandResult> {
  return runCommand(['git', ...args], cwd)
}

export async function runGh(args: string[], cwd: string): Promise<CommandResult> {
  return runCommand(['gh', ...args], cwd)
}

export function ensureGitSuccess(result: CommandResult, fallbackMessage: string): string | null {
  if (result.timedOut) return 'Command timed out'
  if (result.exitCode !== 0) {
    const err = result.stderr.trim() || result.stdout.trim() || fallbackMessage
    return err.slice(0, 5000)
  }
  return null
}

export async function isGhAvailable(cwd: string): Promise<boolean> {
  const now = Date.now()
  if (ghAvailableCache && now - ghAvailableCache.at < GH_AVAIL_CACHE_TTL_MS) {
    return ghAvailableCache.value
  }
  const probe = await runGh(['--version'], cwd)
  const available = probe.exitCode === 0 && !probe.timedOut
  ghAvailableCache = { at: now, value: available }
  return available
}
