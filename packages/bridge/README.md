# broski

Bridge server connecting your phone, through [Broski](https://github.com/humblemuzzu/broski), to the AI coding agents on your computer (Claude Code, Pi).

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

# Show a pairing QR, then scan it with the Broski app on your phone
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
# Start the bridge in the foreground
broski

# Show a pairing QR for your phone
broski-link pair

# List and revoke paired phones
broski-link devices
broski-link revoke <device id prefix>

# Custom loopback port
broski --port 8080

# Verbose logging
broski --verbose

# Diagnose environment
broski doctor
```

## What it does

1. Serves the backend contract to `broski-link` over a Unix socket (`~/.broski/link/bridge.sock`)
2. Hosts the AI agents: Claude Code through its SDK driving your installed `claude`, Pi through its SDK
3. Streams their sessions to your phone, and relays permission prompts, questions and answers both ways
4. Watches the sessions you start in a terminal, and relays their permission prompts to your phone
5. Listens on `127.0.0.1` only, for the Claude Code permission hook, the dev-server preview proxy (`/proxy/<port>`) and a status probe at `/`

## Architecture

```
┌─────────────┐   Noise e2e    ┌──────────────┐  Unix socket  ┌─────────────┐  SDK  ┌─────────────┐
│   Broski    │ ◄────────────► │ broski-link  │ ◄───────────► │   Bridge    │ ────► │  AI Agents  │
│   (phone)   │  LAN or relay  │  (your Mac)  │               │   (Bun)     │       │             │
└─────────────┘                └──────────────┘               └─────────────┘       └─────────────┘
```

The relay is blind: it forwards encrypted frames and cannot read them. See `docs/architecture/connectivity-v2/`.

## Requirements

- [Bun](https://bun.sh) 1.4.2+
- macOS or Linux (Windows is not supported)
- One of:
  - [Claude Code](https://github.com/anthropics/claude-code)
  - [Pi](https://github.com/mariozechner/pi-coding-agent)

## Security

- The phone link is end-to-end encrypted with Noise (hybrid X25519 + ML-KEM-768); a relay only sees ids, timing and sizes
- Pairing uses a one-time secret in the QR (`broski://pair?v=2`) that expires
- The bridge's TCP listener is loopback-only, TLS-protected and bearer-token-authenticated; it exists for the agent hooks, not for phones
- Every directory a phone names is validated against the allowed base paths (realpath, symlinks)

## Bridge config

The bridge reads `~/.broski/config.json`. See `src/config/schema.ts` for the full config shape.

## Environment

A bridge started by the service inherits almost nothing: launchd and systemd hand it a `PATH` and a `HOME`, and
nothing from `~/.zshrc`. So at startup the bridge asks your login shell for its environment once (one interactive
`env -0` through `zsh`/`bash`/`fish`, 10 s timeout) and runs every agent with it — Claude Code and Pi.

That means provider keys, `~/.local/bin` and version-manager shims exported in your shell profile work from the
phone exactly as they do in your terminal.

- **Changed `~/.zshrc`?** Restart the bridge: run `broski restart`. The environment is
  read once at startup, not per request.
- **A provider still shows as unavailable?** `broski doctor` resolves the same environment the service resolves and
  lists which known agent variables are present by name ([`agent_credentials`]), never their values.
- `broski doctor` and `resolveUserShellEnv` never print a value; only names, counts and timings.
- Running `broski` in a terminal skips the import — it already has your environment.

## Troubleshooting

**Pi providers are unavailable from the phone but work in the terminal.** Your key is exported in a shell profile
(`export RIVER_API_KEY=…`) and the service never read it. `broski doctor` resolves the service's environment and
names the provider variables it finds; compare that with `pi --list-models` in your terminal. If they differ, check
`~/.broski/logs/bridge.log` for the `[shell-env]` line.

**An agent CLI is not found.** Same cause: `~/.local/bin`, `~/.npm-global/bin` or a version
manager's shims were not on the service's `PATH`. The login-shell import puts them there; restart the bridge.

**A provider row says "No API key — set X".** That `X` is the environment variable Pi's own auth check reads for
that provider. Export it in your shell profile, then restart the bridge.

```bash
broski restart
broski logs                    # bridge.log, including the [shell-env] line
broski doctor                  # the provider variables the service can see
```

## Development

```bash
bun run typecheck          # tsc --noEmit
bun run lint               # biome check
bun test                   # Bun test runner
```

## Links

- [Broski App](https://github.com/humblemuzzu/broski)
- [Documentation](https://github.com/humblemuzzu/broski#readme)

## License

MIT
