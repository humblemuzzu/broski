import type { WizardPrompter } from './prompter'
import { WizardCancelledError } from './errors'
import { readConfig, writeConfig } from '../config'
import { getDefaultConfig } from '../config/defaults'
import type { BroskiConfig } from '../config/schema'
import { brand, muted, warning } from './palette'
import { runWelcomeStep } from './steps/welcome'
import { runAgentsStep } from './steps/agents'
import { runNetworkStep } from './steps/network'
import { runSecurityStep } from './steps/security'
import { runDaemonStep } from './steps/daemon'
import { runConnectivityStep } from './steps/connectivity'
import { runFinalizeStep } from './steps/finalize'

export interface OnboardingOptions {
  quick?: boolean
  advanced?: boolean
}

export async function runOnboardingWizard(
  prompter: WizardPrompter,
  options?: OnboardingOptions,
): Promise<void> {
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
        lastRunVersion: undefined, // Will be set when we can access package version
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
