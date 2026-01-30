import type { WizardPrompter } from './prompter'
import { WizardCancelledError } from './errors'
import { readConfig, writeConfig, getConfigPath } from '../config'
import { getDefaultConfig } from '../config/defaults'
import type { BroskiConfig } from '../config/schema'
import { brand, muted, warning } from './palette'
import packageMeta from '../../package.json'
import { runWelcomeStep } from './steps/welcome'
import { runAgentsStep } from './steps/agents'
import { runNetworkStep } from './steps/network'
import { runSecurityStep } from './steps/security'
import { runDaemonStep } from './steps/daemon'
import { runConnectivityStep } from './steps/connectivity'
import { runFinalizeStep } from './steps/finalize'
import {
  findBinary,
  installDaemon,
  getBroskiBinaryPath,
  getDaemonType,
  IS_MACOS,
  IS_LINUX,
  IS_WINDOWS,
  type DaemonConfig,
} from '../platform'
import { getLocalIP, getTailscaleIP } from '../network'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'

export interface OnboardingOptions {
  quick?: boolean
  advanced?: boolean
  nonInteractive?: boolean
  // Non-interactive flag overrides
  agents?: string[]
  networkMode?: string
  tls?: boolean
  tokenTtl?: number
  daemon?: boolean
  port?: number
}

// ---------------------------------------------------------------------------
// Non-interactive setup (for CI / automated environments)
// ---------------------------------------------------------------------------

function detectAgentsNonInteractive(): { opencode: boolean; claudeCode: boolean; codex: boolean } {
  return {
    opencode: !!findBinary('opencode'),
    claudeCode: !!findBinary('claude'),
    codex: !!findBinary('codex'),
  }
}

function agentNameFromFlag(flag: string): 'opencode' | 'claude' | 'codex' | null {
  const lower = flag.toLowerCase().trim()
  if (lower === 'opencode') return 'opencode'
  if (lower === 'claude' || lower === 'claude-code' || lower === 'claudecode') return 'claude'
  if (lower === 'codex') return 'codex'
  return null
}

function daemonTypeLabel(): string {
  if (IS_MACOS) return 'LaunchAgent'
  if (IS_LINUX) return 'systemd'
  if (IS_WINDOWS) return 'TaskScheduler'
  return 'none'
}

function mapDaemonTypeNonInteractive(): 'launchagent' | 'systemd' | 'taskscheduler' | 'none' {
  const t = getDaemonType()
  if (t === 'launchagent') return 'launchagent'
  if (t === 'systemd') return 'systemd'
  if (t === 'task-scheduler') return 'taskscheduler'
  return 'none'
}

async function runNonInteractiveSetup(options: OnboardingOptions): Promise<void> {
  const log = (msg: string) => console.log(`[broski] ${msg}`)

  log('Non-interactive setup')

  // 1. Agents — use flag or auto-detect
  let agents: { opencode: boolean; claudeCode: boolean; codex: boolean }
  if (options.agents && options.agents.length > 0) {
    agents = { opencode: false, claudeCode: false, codex: false }
    for (const a of options.agents) {
      const name = agentNameFromFlag(a)
      if (name === 'opencode') agents.opencode = true
      else if (name === 'claude') agents.claudeCode = true
      else if (name === 'codex') agents.codex = true
      else log(`Warning: unknown agent "${a}", skipping`)
    }
  } else {
    agents = detectAgentsNonInteractive()
  }

  const agentNames: string[] = []
  if (agents.opencode) agentNames.push('OpenCode')
  if (agents.claudeCode) agentNames.push('Claude Code')
  if (agents.codex) agentNames.push('Codex')
  log(`Agents: ${agentNames.length > 0 ? agentNames.join(', ') : 'none detected'}`)

  // 2. Network mode
  const networkMode = (options.networkMode || 'local') as 'local' | 'tailscale' | 'hotspot-iphone' | 'hotspot-android'
  const port = options.port ?? 18274

  let ipDisplay = '127.0.0.1'
  try {
    if (networkMode === 'tailscale') {
      const tsIp = await getTailscaleIP()
      if (tsIp) ipDisplay = tsIp
    } else {
      const localIp = getLocalIP()
      if (localIp) ipDisplay = localIp
    }
  } catch {
    // best effort
  }
  log(`Network: ${networkMode} (${ipDisplay}:${port})`)

  // 3. Security
  const tlsEnabled = options.tls !== undefined ? options.tls : true
  const tokenTtlDays = options.tokenTtl ?? 7
  log(`Security: TLS ${tlsEnabled ? 'enabled' : 'disabled'}, token TTL ${tokenTtlDays} days`)

  // 4. TLS cert (best-effort, silent failure)
  if (tlsEnabled) {
    try {
      const { ensureTlsMaterial } = await import('../tls')
      await ensureTlsMaterial()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`Warning: TLS cert setup failed (${msg}), continuing`)
    }
  }

  // 5. Daemon
  const shouldInstallDaemon = options.daemon !== undefined ? options.daemon : true
  let daemonInstalled = false
  let daemonType: 'launchagent' | 'systemd' | 'taskscheduler' | 'none' = 'none'

  if (shouldInstallDaemon) {
    try {
      const logDir = resolve(homedir(), '.broski', 'logs')
      await mkdir(logDir, { recursive: true })

      const daemonConfig: DaemonConfig = {
        binaryPath: getBroskiBinaryPath(),
        args: ['--daemon', '--hotspot'],
        logDir,
        workDir: homedir(),
      }
      await installDaemon(daemonConfig)
      daemonInstalled = true
      daemonType = mapDaemonTypeNonInteractive()
      log(`Daemon: installed (${daemonTypeLabel()})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`Warning: Daemon install failed (${msg}), skipping`)
    }
  } else {
    log('Daemon: skipped (--no-daemon)')
  }

  // 6. Write config
  const finalConfig: BroskiConfig = {
    version: 1,
    wizard: {
      completedSetup: true,
      lastRunAt: new Date().toISOString(),
      lastRunVersion: packageMeta.version ?? '0.1.0',
    },
    network: {
      port,
      mode: networkMode,
      enableFunnel: false,
    },
    security: {
      tls: tlsEnabled,
      tokenTtlDays,
    },
    agents: {
      opencode: agents.opencode,
      claudeCode: agents.claudeCode,
      codex: agents.codex,
    },
    daemon: {
      installed: daemonInstalled,
      type: daemonType,
    },
  }

  await writeConfig(finalConfig)

  const configPath = getConfigPath()
  log(`Config written to ${configPath}`)
  log("Setup complete. Run 'broski' to start.")
}

export async function runOnboardingWizard(
  prompter: WizardPrompter,
  options?: OnboardingOptions,
): Promise<void> {
  if (options?.nonInteractive) {
    await runNonInteractiveSetup(options)
    return
  }

  try {
    // 1. Read existing config
    let config = await readConfig()

    // 2. Welcome step
    const welcome = await runWelcomeStep(prompter, config)

    if (welcome.action === 'keep') {
      await prompter.outro(brand('Keeping current settings. Run ') + muted('broski') + brand(' to start.'))
      return
    }

    if (welcome.action === 'reset') {
      config = getDefaultConfig()
    }

    // 3. Determine mode (quick vs advanced)
    let isQuick: boolean
    if (options?.quick) {
      isQuick = true
    } else if (options?.advanced) {
      isQuick = false
    } else {
      const mode = await prompter.select<'quick' | 'advanced'>({
        message: 'How would you like to set up?',
        options: [
          { value: 'quick', label: 'QuickStart (recommended)', hint: 'auto-detect everything' },
          { value: 'advanced', label: 'Advanced', hint: 'customize each setting' },
        ],
        initialValue: 'quick',
      })
      isQuick = mode === 'quick'
    }

    // 4. Agents step
    const agents = await runAgentsStep(prompter, { isQuick })

    // 5. Network step
    const network = await runNetworkStep(prompter, {
      isQuick,
      currentPort: config.network.port,
    })

    // 6. Security step
    const security = await runSecurityStep(prompter, { isQuick })

    // 7. Daemon step
    const daemon = await runDaemonStep(prompter)

    // 8. Assemble final config
    const finalConfig: BroskiConfig = {
      version: 1,
      wizard: {
        completedSetup: true,
        lastRunAt: new Date().toISOString(),
        lastRunVersion: packageMeta.version ?? '0.1.0',
      },
      network: {
        port: network.port,
        mode: network.mode,
        enableFunnel: network.enableFunnel,
      },
      security: {
        tls: security.tls,
        tokenTtlDays: security.tokenTtlDays,
      },
      agents: {
        opencode: agents.opencode,
        claudeCode: agents.claudeCode,
        codex: agents.codex,
      },
      daemon: {
        installed: daemon.installed,
        type: daemon.type,
      },
    }

    // 9. Write config
    await writeConfig(finalConfig)

    // 10. Connectivity step (informational)
    await runConnectivityStep(prompter, finalConfig)

    // 11. Finalize
    await runFinalizeStep(prompter, finalConfig)
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      await prompter.outro(
        `${warning('Setup cancelled.')} Run ${brand('broski setup')} to try again.`,
      )
      return
    }
    throw err
  }
}
