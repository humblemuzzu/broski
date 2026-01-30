import type { WizardPrompter } from './prompter'
import { WizardCancelledError } from './errors'
import { runDoctor } from '../doctor'
import { brand, muted, bold, warning, header } from './palette'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

type Problem =
  | 'phone-cant-connect'
  | 'sessions-not-showing'
  | 'bridge-crashing'
  | 'agent-not-responding'
  | 'qr-not-working'
  | 'something-else'

export async function runTroubleshootWizard(
  prompter: WizardPrompter,
): Promise<void> {
  try {
    await prompter.intro(header('  BROSKI  ') + muted(' — Troubleshooter'))

    const problem = await prompter.select<Problem>({
      message: 'What\'s the problem?',
      options: [
        { value: 'phone-cant-connect', label: 'Phone can\'t connect', hint: 'most common' },
        { value: 'sessions-not-showing', label: 'Sessions not showing up' },
        { value: 'bridge-crashing', label: 'Bridge keeps crashing' },
        { value: 'agent-not-responding', label: 'Agent not responding' },
        { value: 'qr-not-working', label: 'QR code not working' },
        { value: 'something-else', label: 'Something else' },
      ],
    })

    // Show context-specific guidance
    await showDiagnosis(prompter, problem)

    // Offer to run full doctor
    const runFull = await prompter.confirm({
      message: 'Run a full system check? (broski doctor)',
      initialValue: true,
    })

    if (runFull) {
      await prompter.note(muted('Running diagnostics...'), 'System Check')
      await runDoctor()
    }

    // Follow-up
    const helped = await prompter.confirm({
      message: 'Did this help resolve your issue?',
      initialValue: true,
    })

    if (helped) {
      await prompter.outro(brand('Great! Happy vibe coding.'))
    } else {
      await prompter.note(
        `${bold('Still stuck? Try these:')}\n\n` +
        `  ${brand('broski doctor')}    ${muted('— Full diagnostic with auto-fix')}\n` +
        `  ${brand('broski logs')}      ${muted('— View bridge logs')}\n` +
        `  ${brand('broski restart')}   ${muted('— Restart the bridge')}\n\n` +
        `${muted('Report bugs at: https://github.com/broskiapp/broski/issues')}`,
        'More Help',
      )
      await prompter.outro(muted('Good luck! We\'re here to help.'))
    }
  } catch (err) {
    if (err instanceof WizardCancelledError) {
      await prompter.outro(
        `${warning('Troubleshooter cancelled.')} Run ${brand('broski troubleshoot')} anytime.`,
      )
      return
    }
    throw err
  }
}

async function showDiagnosis(prompter: WizardPrompter, problem: Problem): Promise<void> {
  switch (problem) {
    case 'phone-cant-connect':
      await prompter.note(
        `${bold('Common causes:')}\n\n` +
        `  ${bold('1.')} Bridge isn't running\n` +
        `     ${muted('Fix:')} Run ${brand('broski')} to start the bridge\n\n` +
        `  ${bold('2.')} Phone and computer on different networks\n` +
        `     ${muted('Fix:')} Connect both to the same Wi-Fi network\n` +
        `     ${muted('Or:')}  Use ${brand('broski setup-tailscale')} for remote access\n\n` +
        `  ${bold('3.')} Firewall blocking port 18274\n` +
        `     ${muted('Fix:')} Allow incoming connections on port 18274\n\n` +
        `  ${bold('4.')} TLS certificate mismatch\n` +
        `     ${muted('Fix:')} Scan a fresh QR code with ${brand('broski qr')}\n\n` +
        `  ${bold('5.')} Auth token expired\n` +
        `     ${muted('Fix:')} Run ${brand('broski qr --new-token')} to generate a new one`,
        'Phone Connection Issues',
      )
      break

    case 'sessions-not-showing':
      await prompter.note(
        `${bold('Common causes:')}\n\n` +
        `  ${bold('1.')} No agent is running\n` +
        `     ${muted('Fix:')} Start an agent (opencode, claude, codex) in a terminal\n\n` +
        `  ${bold('2.')} Agent not detected by bridge\n` +
        `     ${muted('Fix:')} Check ${brand('broski doctor')} for agent status\n\n` +
        `  ${bold('3.')} Bridge needs restart to pick up new sessions\n` +
        `     ${muted('Fix:')} Run ${brand('broski restart')}\n\n` +
        `  ${bold('4.')} Wrong project directory\n` +
        `     ${muted('Fix:')} The bridge discovers sessions from your home directory`,
        'Missing Sessions',
      )
      break

    case 'bridge-crashing':
      await prompter.note(
        `${bold('Debugging steps:')}\n\n` +
        `  ${bold('1.')} Check the logs:\n` +
        `     ${brand(`cat ${resolve(homedir(), '.broski', 'logs', 'bridge.log')}`)}\n` +
        `     ${muted('Or run:')} ${brand('broski logs')}\n\n` +
        `  ${bold('2.')} Check for port conflicts:\n` +
        `     ${muted('Another process may be using port 18274')}\n` +
        `     ${muted('Fix:')} Run ${brand('broski --port 18275')} to use a different port\n\n` +
        `  ${bold('3.')} Check system resources:\n` +
        `     ${muted('Ensure you have enough RAM and disk space')}\n\n` +
        `  ${bold('4.')} Update to latest version:\n` +
        `     ${muted('Fix:')} Run ${brand('broski update')}`,
        'Bridge Crashes',
      )
      break

    case 'agent-not-responding':
      await prompter.note(
        `${bold('Common causes:')}\n\n` +
        `  ${bold('1.')} Agent binary not installed\n` +
        `     ${muted('OpenCode:')}    ${brand('npm i -g opencode')}\n` +
        `     ${muted('Claude Code:')} ${brand('npm i -g @anthropic-ai/claude-code')}\n` +
        `     ${muted('Codex:')}       ${brand('npm i -g @openai/codex')}\n\n` +
        `  ${bold('2.')} Agent process crashed\n` +
        `     ${muted('Fix:')} Restart the agent in your terminal\n\n` +
        `  ${bold('3.')} API key not set\n` +
        `     ${muted('Ensure your ANTHROPIC_API_KEY or OPENAI_API_KEY is set')}\n\n` +
        `  ${bold('4.')} Bridge lost connection to agent\n` +
        `     ${muted('Fix:')} Run ${brand('broski restart')}`,
        'Agent Issues',
      )
      break

    case 'qr-not-working':
      await prompter.note(
        `${bold('Common causes:')}\n\n` +
        `  ${bold('1.')} QR code is outdated\n` +
        `     ${muted('Fix:')} Generate a fresh one with ${brand('broski qr')}\n\n` +
        `  ${bold('2.')} Auth token expired\n` +
        `     ${muted('Fix:')} Run ${brand('broski qr --new-token')}\n\n` +
        `  ${bold('3.')} Bridge not running\n` +
        `     ${muted('Fix:')} Start with ${brand('broski')}, then scan the QR code\n\n` +
        `  ${bold('4.')} Terminal too small for QR code\n` +
        `     ${muted('Fix: Make your terminal window wider, or zoom out')}\n\n` +
        `  ${bold('5.')} Camera can\'t focus\n` +
        `     ${muted('Fix: Try holding your phone further from the screen')}`,
        'QR Code Issues',
      )
      break

    case 'something-else':
      await prompter.note(
        `${bold('Let\'s run a full system check to find the issue.')}\n\n` +
        `${muted('The doctor will check:')} system, dependencies, network,\n` +
        `security, daemon, agents, and connectivity.\n\n` +
        `${muted('It can also auto-fix common issues.')}`,
        'Full Diagnosis',
      )
      break
  }
}
