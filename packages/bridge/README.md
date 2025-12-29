# broski-bridge

Bridge server connecting [Broski](https://github.com/humblemuzzu/broski) mobile app to [OpenCode](https://github.com/opencode-ai/opencode) AI coding agent.

## Installation

```bash
# Using bun (recommended)
bunx broski-bridge

# Using npm
npx broski-bridge

# Global install
bun add -g broski-bridge
```

## Usage

```bash
# Start bridge (spawns OpenCode automatically)
broski-bridge

# Attach to existing OpenCode instance
broski-bridge --attach

# Connect to specific OpenCode URL
broski-bridge --opencode-url http://localhost:4096

# Enable Tailscale Funnel (public HTTPS)
broski-bridge --funnel

# Custom port
broski-bridge --port 8080

# Verbose logging
broski-bridge --verbose

# Diagnose environment
broski-bridge doctor
```

## What it does

1. Starts a WebSocket server on port 18274
2. Spawns and manages OpenCode server (or attaches to existing)
3. Displays QR code for phone pairing
4. Bridges messages between Broski app and OpenCode SDK
5. Handles file operations, permissions, and event streaming

## Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Broski    │ ──WS──► │   Bridge    │ ──SDK─► │  OpenCode   │
│  (iPhone)   │         │   (Mac)     │         │   (Mac)     │
└─────────────┘         └─────────────┘         └─────────────┘
```

## Requirements

- [Bun](https://bun.sh) 1.0+
- [OpenCode](https://github.com/opencode-ai/opencode)
- macOS (Windows/Linux support coming)

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
