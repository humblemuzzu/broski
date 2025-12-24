import { stdin as input, stdout as output } from 'node:process'
import readline from 'node:readline/promises'

export type OpencodeMode = 'managed' | 'manual' | 'attach'

export type CliOptions = {
  bridgePort: number
  opencodeMode: OpencodeMode
  opencodeUrl?: string
  opencodeHostname: string
  opencodePort: number
  verbose: boolean
  help: boolean
}

const DEFAULT_BRIDGE_PORT = 18274

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function parseCli(argv: string[], env: NodeJS.ProcessEnv): CliOptions {
  const args = argv.slice(2)

  let bridgePort = parseNumber(env.BROSKI_PORT, DEFAULT_BRIDGE_PORT)
  let opencodeMode: OpencodeMode = 'managed'
  let opencodeUrl: string | undefined = env.OPENCODE_BASE_URL
  let opencodeHostname = env.BROSKI_OPENCODE_HOSTNAME ?? '127.0.0.1'
  let opencodePort = parseNumber(env.BROSKI_OPENCODE_PORT, 0)
  let verbose = env.BROSKI_VERBOSE === '1'
  let help = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--verbose' || arg === '-v') {
      verbose = true
      continue
    }
    if (arg === '--port' || arg === '--bridge-port') {
      bridgePort = parseNumber(args[i + 1], bridgePort)
      i++
      continue
    }
    if (arg === '--opencode-url') {
      opencodeUrl = args[i + 1]
      i++
      continue
    }
    if (arg === '--opencode-hostname') {
      opencodeHostname = args[i + 1] ?? opencodeHostname
      i++
      continue
    }
    if (arg === '--opencode-port') {
      opencodePort = parseNumber(args[i + 1], opencodePort)
      i++
      continue
    }
    if (arg === '--attach') {
      opencodeMode = 'attach'
      continue
    }
    if (arg === '--manual') {
      opencodeMode = 'manual'
      continue
    }
    if (arg === '--managed') {
      opencodeMode = 'managed'
      continue
    }
  }

  if (opencodeUrl) {
    opencodeMode = 'manual'
  }

  return {
    bridgePort,
    opencodeMode,
    opencodeUrl,
    opencodeHostname,
    opencodePort,
    verbose,
    help,
  }
}

export function printHelp(): void {
  // Keep this small and action-oriented (users see this in terminal).
  // We avoid ANSI art here to keep copy/paste clean.
  // eslint-disable-next-line no-console
  console.log(`
Usage:
  broski-bridge [options]

Default (recommended):
  Starts and manages its own OpenCode server (no auto-attach, no ambiguity).

Options:
  --help, -h                Show help
  --verbose, -v             Verbose logging (SDK events + debug)
  --port, --bridge-port N   Bridge WebSocket port (default: 18274; use 0 for random free port)

OpenCode:
  --managed                 Force managed mode (default)
  --manual                  Force manual/attach mode (requires --opencode-url or OPENCODE_BASE_URL)
  --opencode-url URL        Attach to an existing OpenCode server (power users)
  --attach                  Scan common ports and interactively choose a running OpenCode server
  --opencode-hostname HOST  Hostname for managed OpenCode server (default: 127.0.0.1)
  --opencode-port N         Port for managed OpenCode server (default: 0 for random)

Examples:
  broski-bridge
  broski-bridge --verbose
  broski-bridge --opencode-url http://127.0.0.1:4096
  broski-bridge --attach
`.trim())
}

export async function promptForChoice(prompt: string, choices: string[]): Promise<number | null> {
  if (choices.length === 0) return null
  const rl = readline.createInterface({ input, output })
  try {
    // eslint-disable-next-line no-console
    console.log(prompt)
    for (let i = 0; i < choices.length; i++) {
      // eslint-disable-next-line no-console
      console.log(`  ${i + 1}) ${choices[i]}`)
    }
    const answer = (await rl.question(`Select 1-${choices.length} (or press Enter to cancel): `)).trim()
    if (!answer) return null
    const idx = Number(answer)
    if (!Number.isFinite(idx) || idx < 1 || idx > choices.length) return null
    return idx - 1
  } finally {
    rl.close()
  }
}
