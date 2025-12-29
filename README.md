<div align="center">

```

   ██████╗ ██████╗  ██████╗ ███████╗██╗  ██╗██╗
   ██╔══██╗██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██║
   ██████╔╝██████╔╝██║   ██║███████╗█████╔╝ ██║
   ██╔══██╗██╔══██╗██║   ██║╚════██║██╔═██╗ ██║
   ██████╔╝██║  ██║╚██████╔╝███████║██║  ██╗██║
   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝

```

**Your AI coding agent, in your pocket.**

*The mobile companion for [OpenCode](https://github.com/opencode-ai/opencode)*

[![Stars](https://img.shields.io/github/stars/humblemuzzu/broski?style=flat)](https://github.com/humblemuzzu/broski/stargazers)
[![License](https://img.shields.io/github/license/humblemuzzu/broski?style=flat)](LICENSE)
[![npm](https://img.shields.io/npm/v/broski-bridge?style=flat&label=bridge)](https://www.npmjs.com/package/broski-bridge)
![Flutter](https://img.shields.io/badge/Flutter-02569B?style=flat&logo=flutter&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-000000?style=flat&logo=bun&logoColor=white)
![OpenCode](https://img.shields.io/badge/OpenCode-fab283?style=flat)

[Quick Start](#-quick-start) •
[Features](#-features) •
[Installation](#-installation) •
[Architecture](#-architecture) •
[Contributing](#-contributing)

---

</div>

> **Note**: This project is not built by the OpenCode team and is not affiliated with them. It's an independent mobile client built with the OpenCode SDK.

## What is Broski?

Broski turns your phone into a remote control for [OpenCode](https://github.com/opencode-ai/opencode)—the open source AI coding agent.

**The problem:** Your AI agent runs on your Mac. You're on the couch, at a coffee shop, on a flight. You want to ship that feature.

**The solution:** Broski connects your phone to OpenCode via WebSocket. Chat with the AI, see file changes live, approve permissions with haptic feedback—all from your pocket.

<div align="center">

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Broski    │ ──WS──► │   Bridge    │ ──SDK─► │  OpenCode   │
│  (iPhone)   │         │   (Mac)     │         │   (Mac)     │
└─────────────┘         └─────────────┘         └─────────────┘
```

</div>

---

## Highlights

<table>
<tr>
<td width="50%">

### Mobile-First AI Coding
Stream responses at 60fps. Approve dangerous commands with haptic feedback. See diffs inline. All optimized for thumb-friendly interaction.

</td>
<td width="50%">

### Works From Anywhere
Local WiFi for home. Tailscale for coffee shops. Funnel for public HTTPS. Your choice of connectivity.

</td>
</tr>
<tr>
<td width="50%">

### Offline-Ready
L1/L2 tiered caching means you can browse sessions and history without a connection. Stale-while-revalidate keeps things fast.

</td>
<td width="50%">

### Full SDK Coverage
22 OpenCode features implemented end-to-end. Sessions, tools, MCP servers, providers, terminal, file browser—it's all there.

</td>
</tr>
</table>

---

## Quick Start

### 1. Start the bridge

```bash
# One-liner (recommended)
bunx broski-bridge

# Or install globally
bun add -g broski-bridge
broski-bridge
```

### 2. Connect from your phone

1. Open Broski app
2. Scan the QR code from your terminal
3. Start coding

That's it.

---

## Features

### Chat Interface

| Feature | Description |
|---------|-------------|
| **Streaming responses** | 60fps token streaming with RTT-adaptive batching |
| **Tool visualization** | See read, edit, write, bash calls with syntax highlighting |
| **Inline diffs** | Expandable diff previews with +/- line counts |
| **Permission prompts** | Approve dangerous commands with haptic feedback |
| **Slash commands** | `/init`, `/review`, custom commands with autocomplete |
| **Agent switching** | Toggle between `build` and `plan` agents mid-session |
| **Image attachments** | Send screenshots and photos to the AI |
| **Todo tracking** | Real-time view of AI's task plan |

### Session Management

| Feature | Description |
|---------|-------------|
| **Full CRUD** | Create, rename, delete, archive sessions |
| **Fork** | Branch from any message in history |
| **Share** | Generate public URLs for sessions |
| **Compact** | Summarize old messages to free context window |
| **Undo** | Revert file changes made by AI |
| **Offline mode** | Browse cached sessions without connection |

### Tools & Integrations

| Feature | Description |
|---------|-------------|
| **MCP servers** | Manage Model Context Protocol servers and their tools |
| **Provider management** | Configure Claude, OpenAI, Gemini, and more |
| **Tool settings** | Enable/disable specific AI tools per session |
| **File browser** | Navigate your Mac's filesystem with syntax highlighting |
| **Terminal** | PTY terminal sessions with full xterm emulation |
| **Git info** | Branch display and modified file tracking |

### Connectivity

| Feature | Description |
|---------|-------------|
| **Local network** | Works on your home WiFi |
| **Tailscale** | Secure access from anywhere (WireGuard encryption) |
| **Tailscale Funnel** | Public HTTPS—no VPN needed on phone |
| **Smart reconnection** | Exponential backoff with automatic re-sync |
| **Connection quality** | RTT monitoring with adaptive event batching |

### Appearance

| Feature | Description |
|---------|-------------|
| **Theme switching** | Multiple theme variants |
| **Icon customization** | Choose your icon style |
| **Tool colors** | Toggle colored borders on tool cards |
| **OpenCode design system** | 50+ semantic color tokens |

---

## Installation

### Prerequisites

| Dependency | Version | Notes |
|------------|---------|-------|
| macOS | 12+ | Required for now |
| [Bun](https://bun.sh) | 1.0+ | JS runtime for bridge |
| [OpenCode](https://github.com/opencode-ai/opencode) | Latest | The AI agent |
| [Flutter](https://flutter.dev) | 3.0+ | Optional—for building from source |
| [Tailscale](https://tailscale.com) | Any | Optional—for remote access |

### Bridge

```bash
# Run directly (no install)
bunx broski-bridge

# Or install globally
bun add -g broski-bridge

# Or from source
git clone https://github.com/humblemuzzu/broski.git
cd broski/packages/bridge
bun install && bun run dev
```

### Mobile App

```bash
# From repo root
flutter pub get
flutter run  # iOS/Android simulator or device

# Release builds
flutter build ios
flutter build apk
```

---

## CLI Reference

```bash
broski-bridge                           # Start (spawns OpenCode automatically)
broski-bridge --attach                  # Choose from running OpenCode instances
broski-bridge --opencode-url <url>      # Connect to specific OpenCode URL
broski-bridge --funnel                  # Enable Tailscale Funnel (public HTTPS)
broski-bridge --port <port>             # Custom port (default: 18274)
broski-bridge --verbose                 # Debug logging
broski-bridge doctor                    # Diagnose environment
broski-bridge setup-tailscale           # Interactive Tailscale setup
```

---

## Architecture

Broski is a thin UI layer. OpenCode does all the heavy lifting.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PHONE                         MAC                         AI PROVIDERS     │
│                                                                             │
│  ┌───────────┐              ┌─────────────┐              ┌───────────┐     │
│  │           │              │             │              │           │     │
│  │  Broski   │──────────────│   Bridge    │──────────────│  Claude   │     │
│  │   App     │  WebSocket   │   Server    │     SDK      │  OpenAI   │     │
│  │           │              │   (Bun)     │              │  Gemini   │     │
│  │  Flutter  │◄─────────────│             │◄─────────────│           │     │
│  │  Riverpod │              │             │              │           │     │
│  └───────────┘              └──────┬──────┘              └───────────┘     │
│                                    │                                        │
│                                    ▼                                        │
│                             ┌─────────────┐                                 │
│                             │             │                                 │
│                             │  OpenCode   │                                 │
│                             │   Server    │                                 │
│                             │             │                                 │
│                             │  AI Agent   │                                 │
│                             │  + Tools    │                                 │
│                             │             │                                 │
│                             └─────────────┘                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Tech | Role |
|-----------|------|------|
| **Mobile App** | Flutter + Riverpod | UI rendering, caching, offline mode |
| **Bridge Server** | Bun + TypeScript | WebSocket server, SDK wrapper, file ops |
| **OpenCode** | TypeScript | AI reasoning, tool execution, sessions |

### Key Design Decisions

- **Thin client**: App only renders UI. All AI logic stays on Mac.
- **SDK-based**: Uses official `@opencode-ai/sdk` for all OpenCode communication.
- **Peer-to-peer**: No cloud servers. Direct phone ↔ Mac connection.
- **RTT-adaptive**: Event batching adjusts to connection latency (4ms local → 150ms high-latency).

---

## Project Structure

```
broski/
├── lib/                          # Flutter app (34K LOC)
│   ├── screens/                  # 25 screens
│   │   ├── chat_screen.dart      # Main chat interface
│   │   ├── sessions_screen.dart  # Session management
│   │   ├── browse_screen.dart    # File browser
│   │   ├── terminal_screen.dart  # PTY terminal
│   │   └── ...
│   ├── widgets/                  # 18 reusable components
│   ├── providers/                # Riverpod state management
│   ├── services/                 # Business logic + caching
│   ├── models/                   # Data models
│   └── theme/                    # OpenCode design system
│
├── packages/bridge/              # Bridge server (3.8K LOC)
│   └── src/
│       ├── index.ts              # CLI entry
│       ├── server.ts             # WebSocket + HTTP server
│       ├── opencode.ts           # SDK wrapper
│       └── ...
│
└── docs/                         # Documentation
```

---

## Performance

| Metric | Target | Implementation |
|--------|--------|----------------|
| App startup | <2s | Cache pre-warming in `main.dart` |
| Message latency (local) | <100ms | RTT-adaptive event batching |
| Message latency (Tailscale) | <300ms | Connection type detection |
| Offline cache read | <1ms | L1 in-memory cache |
| Bridge memory | <30MB | Efficient event streaming |

### Optimizations

- **L1/L2 tiered caching**: Memory → SecureStorage
- **Stale-while-revalidate**: Show cached, refresh in background
- **In-flight deduplication**: Prevent duplicate API calls
- **Message pagination**: Load 20 messages initially, fetch more on scroll
- **Skeleton loading**: Shimmer UI while data loads

---

## Security

| Aspect | Implementation |
|--------|----------------|
| Local network | Traffic stays on your WiFi |
| Tailscale | WireGuard encryption (military-grade) |
| No cloud | No Broski servers. Direct phone ↔ Mac |
| Credentials | iOS Keychain / Android EncryptedSharedPrefs |
| API keys | Never leave your Mac |
| Auth tokens | Random 24-byte, timing-safe comparison |
| File access | Path validation against allowed directories |

---

## Troubleshooting

### Bridge won't start

```bash
# Check if OpenCode is installed
which opencode

# Check if port is in use
lsof -nP -iTCP:18274 -sTCP:LISTEN

# Use different port
broski-bridge --port 8080

# Run diagnostics
broski-bridge doctor
```

### Can't connect from phone

1. **Same WiFi?** Phone and Mac must be on same network
2. **Firewall?** Allow incoming on port 18274
3. **Tailscale?** Both devices logged in with same account

### Slow responses

```bash
# Check connection quality in app (Settings → Connection)
# Try local network instead of Tailscale if possible
```

---

## Roadmap

### Shipped

- [x] Real-time chat with streaming
- [x] Tool visualization with inline diffs
- [x] Session management (CRUD, fork, share, compact)
- [x] Slash commands with autocomplete
- [x] Agent switching
- [x] Message undo/revert
- [x] MCP server management
- [x] Provider management
- [x] Tool enable/disable
- [x] Image attachments
- [x] File browser with viewers (PDF, images, CSV, code)
- [x] Terminal (PTY)
- [x] Git integration
- [x] Tailscale + Funnel
- [x] Offline mode
- [x] Appearance customization
- [x] Background notifications
- [x] L1/L2 tiered caching

### Next

- [ ] Push notifications (APNs/FCM)
- [ ] Voice input
- [ ] Apple Watch companion
- [ ] iPad layout
- [ ] Multi-device sessions
- [ ] E2E encryption

---

## Tech Stack

### Mobile App

| Package | Purpose |
|---------|---------|
| [Flutter](https://flutter.dev) | Cross-platform UI |
| [Riverpod](https://riverpod.dev) | State management |
| [flutter_markdown](https://pub.dev/packages/flutter_markdown) | Markdown rendering |
| [flutter_highlight](https://pub.dev/packages/flutter_highlight) | Syntax highlighting |
| [xterm](https://pub.dev/packages/xterm) | Terminal emulation |
| [pdfrx](https://pub.dev/packages/pdfrx) | PDF viewing |
| [mobile_scanner](https://pub.dev/packages/mobile_scanner) | QR scanning |
| [flutter_secure_storage](https://pub.dev/packages/flutter_secure_storage) | Credential encryption |

### Bridge Server

| Package | Purpose |
|---------|---------|
| [Bun](https://bun.sh) | Fast JS runtime |
| [TypeScript](https://www.typescriptlang.org) | Type safety |
| [@opencode-ai/sdk](https://github.com/opencode-ai/opencode) | OpenCode integration |

---

## Contributing

```bash
# Clone
git clone https://github.com/humblemuzzu/broski.git
cd broski

# Bridge development
cd packages/bridge && bun dev

# Flutter development (separate terminal)
flutter run

# Before submitting PR
flutter analyze
dart format .
```

See [AGENTS.md](AGENTS.md) for code conventions.

---

## Stats

| Metric | Value |
|--------|-------|
| Flutter app | ~34,000 LOC |
| Bridge server | ~3,800 LOC |
| Screens | 25 |
| Widgets | 18 |
| SDK features | 22 |
| Color tokens | 50+ |

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">

**[Documentation](docs/mvp/)** •
**[Report Bug](https://github.com/humblemuzzu/broski/issues)** •
**[Request Feature](https://github.com/humblemuzzu/broski/issues)**

Built by [humblemuzzu](https://github.com/humblemuzzu)

</div>
