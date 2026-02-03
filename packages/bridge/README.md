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
# Start the bridge
broski

# Scan the QR code with Broski app on your phone
# Done! Start coding from anywhere.
```

## Background Service

Keep the bridge running in the background:

```bash
# Install as background service
broski install

# Check if it's running
broski status

# Stop the service
broski stop

# Remove the service
broski uninstall
```

**Using with Mac lid closed?** Install [Amphetamine](https://apps.apple.com/app/amphetamine/id937984704) (free on App Store) and uncheck "Allow system sleep when display is closed". This keeps your Mac awake and connected even with the lid closed - perfect for coding on the go!

## Usage

```bash
# Start bridge (spawns OpenCode automatically)
broski

# Enable hotspot IP detection (for mobile tethering)
broski --hotspot

# Attach to existing OpenCode instance
broski --attach

# Connect to specific OpenCode URL
broski --opencode-url http://localhost:4096

# Enable Tailscale Funnel (public HTTPS)
broski --funnel

# Custom port
broski --port 8080

# Verbose logging
broski --verbose

# Diagnose environment
broski doctor

# Set up Tailscale for remote access
broski setup-tailscale
```

## What it does

1. Starts a WebSocket server on port 18274
2. Spawns and manages AI agent servers (OpenCode, Claude Code, Codex)
3. Displays QR code for phone pairing
4. Bridges messages between Broski app and AI agents
5. Handles file operations, permissions, and event streaming

## Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Broski    │ ──WS──► │   Bridge    │ ──SDK─► │  AI Agents  │
│  (iPhone)   │         │   (Mac)     │         │(OpenCode/CC)│
└─────────────┘         └─────────────┘         └─────────────┘
```

**Lid Closed Mode** (Mac in bag, phone hotspot + Amphetamine):
```
┌─────────────┐         ┌─────────────┐
│   iPhone    │◄──WiFi──│    Mac      │
│  (Broski)   │ Hotspot │  (Bridge)   │
│  (Hotspot)  │         │ (Lid Closed)│
└─────────────┘         └─────────────┘
```

## Requirements

- [Bun](https://bun.sh) 1.0+
- macOS (Windows/Linux support coming)
- One of:
  - [OpenCode](https://github.com/opencode-ai/opencode)
  - [Claude Code](https://github.com/anthropics/claude-code)
  - [Codex](https://github.com/openai/codex)

## Security

- Random auth token generation (timing-safe)
- Path validation for file operations
- Optional cloud entitlement check (Convex) to enforce Pro access
- Core agent traffic stays local; only entitlement checks hit the cloud
- Optional Tailscale WireGuard encryption

## Pro licensing (paid-only)

The bridge can enforce that a user has an active subscription by verifying a cloud session (Convex) and caching a **machine-bound signed license** locally with a **72 hour offline grace**.

**Convex env vars**

- `BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL` (required): Ed25519 private key (PKCS8 DER, base64url) used to sign licenses.
- `BROSKI_LICENSE_OFFLINE_GRACE_HOURS` (optional, default `72`): max offline duration before the bridge locks again.
- `BROSKI_MAX_MACHINES` (optional, default `3`): max active machines per account.

Generate keys (developer-only):

```bash
node scripts/generate-license-keys.mjs
```

Then paste the public key into `packages/bridge/src/license/fallback.ts` and set the private key in your Convex environment.

**Bridge config**

The bridge reads `~/.broski/config.json`. Defaults are production-safe:
- `cloud.convexHttpBaseUrl` defaults to `https://neat-gerbil-813.convex.site`
- `cloud.requireEntitlement` defaults to `true`
- `cloud.offlineGraceHours` defaults to `72`

To build with the optional native license library:

```bash
BROSKI_BUILD_NATIVE_LICENSE=1 bun run build --target darwin-arm64
```

## Links

- [Broski App](https://github.com/humblemuzzu/broski)
- [OpenCode](https://github.com/opencode-ai/opencode)
- [Documentation](https://github.com/humblemuzzu/broski#readme)

## License

MIT
