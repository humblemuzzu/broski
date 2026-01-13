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

## Travel Mode

Keep the bridge running with your Mac lid closed - no external apps needed:

```bash
# Start with lid-close protection (interactive)
broski travel

# Or install as daemon with Travel Mode
broski install --travel

# Check if it's running
broski status

# Stop the service
broski stop

# Remove the service
broski uninstall
```

With Travel Mode:
- Uses macOS `caffeinate` to prevent sleep even with lid closed
- Bridge starts automatically when you log in (daemon mode)
- Auto-restarts if it crashes
- Perfect for working on the go via phone hotspot
- No external apps like Amphetamine required!

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

**Travel Mode** (Mac lid closed, on phone hotspot):
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
- All traffic stays peer-to-peer (no cloud)
- Optional Tailscale WireGuard encryption

## Links

- [Broski App](https://github.com/humblemuzzu/broski)
- [OpenCode](https://github.com/opencode-ai/opencode)
- [Documentation](https://github.com/humblemuzzu/broski#readme)

## License

MIT
