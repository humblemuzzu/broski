# broski

Bridge server connecting [Broski](https://github.com/humblemuzzu/broski) mobile app to AI coding agents (OpenCode, Claude Code, Codex).

**Vibe code from anywhere.** Control your AI coding agents from your phone - even with your Mac lid closed.

## Installation

```bash
# Using bun (recommended)
bunx broski

# Using npm
npx broski

# Global install
bun add -g broski
```

## Quick Start

```bash
# Install the Broski Link service (macOS launchd / Linux systemd)
broski install

# Show a pairing QR, then scan it with the Broski app
broski-link pair
```

No VPN or port forwarding is needed. The phone reaches your Mac directly over the local network, or through a relay when it is away from home.

## Background Service

`broski install` registers `broski-link` as a launchd (macOS) or systemd (Linux) user service. `broski-link` starts the bridge, restarts it if it crashes, and talks to it over `~/.broski/link/bridge.sock`. Windows is not supported.

```bash
# Install and start the service
broski install

# Check the service, and the link, relay and paired devices
broski status
broski-link status

# Stop the service
broski stop

# Remove the service
broski uninstall
```

**Using with Mac lid closed?** Install [Amphetamine](https://apps.apple.com/app/amphetamine/id937984704) (free on App Store) and uncheck "Allow system sleep when display is closed". This keeps your Mac awake and connected even with the lid closed - perfect for coding on the go!

## Usage

```bash
# Start the bridge in the foreground (spawns OpenCode automatically)
broski

# Show a pairing QR for your phone
broski-link pair

# List and revoke paired phones
broski-link devices
broski-link revoke <device id prefix>

# Attach to existing OpenCode instance
broski --attach

# Connect to specific OpenCode URL
broski --opencode-url http://localhost:4096

# Custom loopback port
broski --port 8080

# Verbose logging
broski --verbose

# Diagnose environment
broski doctor
```

## What it does

1. Serves the Broski app protocol to `broski-link` over a Unix socket (`~/.broski/link/bridge.sock`)
2. Spawns and manages AI agent servers (OpenCode, Claude Code, Codex, Pi)
3. Bridges messages between the Broski app and the AI agents
4. Handles file operations, permissions, and event streaming
5. Listens on `127.0.0.1` only, for the agent permission hooks, the dashboard and `/proxy/<port>`

## Architecture

```
┌─────────────┐   Noise e2e    ┌──────────────┐  Unix socket  ┌─────────────┐  SDK  ┌─────────────┐
│   Broski    │ ◄────────────► │ broski-link  │ ◄───────────► │   Bridge    │ ────► │  AI Agents  │
│   (phone)   │  LAN or relay  │  (your Mac)  │               │   (Bun)     │       │             │
└─────────────┘                └──────────────┘               └─────────────┘       └─────────────┘
```

The relay is blind: it forwards encrypted frames and cannot read them. See `docs/architecture/connectivity-v2/`.

## Requirements

- [Bun](https://bun.sh) 1.0+
- macOS or Linux (Windows is not supported)
- One of:
  - [OpenCode](https://github.com/opencode-ai/opencode)
  - [Claude Code](https://github.com/anthropics/claude-code)
  - [Codex](https://github.com/openai/codex)

## Security

- The phone link is end-to-end encrypted with Noise (hybrid X25519 + ML-KEM-768); a relay only sees ids, timing and sizes
- Pairing uses a one-time secret in the QR (`broski://pair?v=2`) that expires
- The bridge's TCP listener is loopback-only, TLS-protected and bearer-token-authenticated; it exists for the agent hooks, not for phones
- Path validation for file operations

## Bridge config

The bridge reads `~/.broski/config.json`. See `src/config/schema.ts` for the full config shape.

## Environment

A bridge started by the service inherits almost nothing: launchd and systemd hand it a `PATH` and a `HOME`, and
nothing from `~/.zshrc`. So at startup the bridge asks your login shell for its environment once (one interactive
`env -0` through `zsh`/`bash`/`fish`, 10 s timeout) and runs every agent with it — Claude Code, Codex, OpenCode,
Pi, Pi Durable and every terminal opened from the phone.

That means provider keys, `~/.local/bin` and version-manager shims exported in your shell profile work from the
app exactly as they do in your terminal.

- **Changed `~/.zshrc`?** Restart the bridge: tap restart in the app, or run `broski restart`. The environment is
  read once at startup, not per request.
- **A provider still shows as unavailable?** `broski doctor` resolves the same environment the service resolves and
  lists which known agent variables are present by name ([`agent_credentials`]), never their values.
- `broski doctor` and `resolveUserShellEnv` never print a value; only names, counts and timings.
- Running `broski` in a terminal skips the import — it already has your environment.

## Troubleshooting

**Pi providers are unavailable from the phone but work in the terminal.** Your key is exported in a shell profile
(`export RIVER_API_KEY=…`) and the service never read it. `bun scripts/measure-pi-models.ts --service-env` prints
the catalogue with the service's environment, and `bun scripts/measure-pi-models.ts` prints it with yours; the two
must match `pi --list-models`. If they do not, check `~/.broski/logs/bridge.log` for the `[shell-env]` line.

**`Ensure OpenCode is installed and on PATH`.** Same cause: `~/.local/bin`, `~/.npm-global/bin` or a version
manager's shims were not on the service's `PATH`. The login-shell import puts them there; restart the bridge.

**A provider row says "No API key — set X".** That `X` is the environment variable Pi's own auth check reads for
that provider. Export it in your shell profile, then restart the bridge.

```bash
broski restart                 # or the restart button in the app
broski logs                    # bridge.log, including the [shell-env] line
bun scripts/measure-pi-models.ts --service-env
```

## Development

```bash
bun run typecheck          # tsc --noEmit
bunx biome check src/      # lint + format check
bun test                   # Bun test runner

# Size of every session list reply against this machine's real session stores
bun scripts/measure-session-lists.ts
```

`measure-session-lists.ts` is read-only: it copies the Pi session index into a temp cache root, never
writes to `~/.broski`, `~/.pi`, `~/.claude` or `~/.codex`, stops if the process passes 2 GiB RSS, and
prints the full-list and first-page size of `pi_sessions`, `cc_sessions`, `cx_threads`, `sessions`
(OpenCode) and the `runtime_sessions` shape each one used to send whole. A backend that is not
installed is reported and skipped.

## Links

- [Broski App](https://github.com/humblemuzzu/broski)
- [OpenCode](https://github.com/opencode-ai/opencode)
- [Documentation](https://github.com/humblemuzzu/broski#readme)

## License

MIT
