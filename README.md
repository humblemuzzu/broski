<div align="center">
  <pre>
   ██████╗ ██████╗  ██████╗ ███████╗██╗  ██╗██╗
   ██╔══██╗██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██║
   ██████╔╝██████╔╝██║   ██║███████╗█████╔╝ ██║
   ██╔══██╗██╔══██╗██║   ██║╚════██║██╔═██╗ ██║
   ██████╔╝██║  ██║╚██████╔╝███████║██║  ██╗██║
   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝
  </pre>
  
  <p><strong>Your AI coding agent, in your pocket.</strong></p>
  
  <p>
    <a href="#quick-start">Quick Start</a> •
    <a href="#features">Features</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#installation">Installation</a> •
    <a href="docs/mvp/">Docs</a>
  </p>

  <p>
    <a href="https://github.com/humblemuzzu/broski/stargazers"><img src="https://img.shields.io/github/stars/humblemuzzu/broski?style=flat" alt="Stars" /></a>
    <a href="https://github.com/humblemuzzu/broski/blob/main/LICENSE"><img src="https://img.shields.io/github/license/humblemuzzu/broski?style=flat" alt="License" /></a>
    <img src="https://img.shields.io/badge/Flutter-02569B?style=flat&logo=flutter&logoColor=white" alt="Flutter" />
    <img src="https://img.shields.io/badge/Bun-000000?style=flat&logo=bun&logoColor=white" alt="Bun" />
    <img src="https://img.shields.io/badge/OpenCode-fab283?style=flat" alt="OpenCode" />
  </p>
</div>

---

## What is Broski?

Broski is a mobile client for [OpenCode](https://github.com/opencode-ai/opencode). It turns your phone into a remote control for your AI coding agent running on your Mac.

**The problem:** OpenCode runs in your terminal. You're away from your desk—on the couch, at a coffee shop, on a flight. You want to ship that feature or fix that bug.

**The solution:** Broski bridges your phone to OpenCode via WebSocket. Chat with the AI, see file changes live, approve permissions with haptic feedback—all from your pocket.

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Broski    │ ──WS──► │   Bridge    │ ──SDK─► │  OpenCode   │
│  (iPhone)   │         │   (Mac)     │         │   (Mac)     │
└─────────────┘         └─────────────┘         └─────────────┘
```

---

## Quick Start

**1. Start the bridge on your Mac:**

```bash
# Clone and run
git clone https://github.com/humblemuzzu/broski.git
cd broski/packages/bridge
bun install && bun run dev
```

**2. Connect from your phone:**

- Open Broski app
- Scan the QR code from your terminal
- Start coding

That's it. You're now controlling OpenCode from your phone.

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

### Session Management

| Feature | Description |
|---------|-------------|
| **CRUD** | Create, rename, delete sessions |
| **Fork** | Branch from any message in history |
| **Share** | Generate public URLs for sessions |
| **Compact** | Summarize old messages to free context window |
| **Undo** | Revert file changes made by AI |
| **Offline mode** | Browse cached sessions without connection |

### Advanced

| Feature | Description |
|---------|-------------|
| **MCP servers** | Manage Model Context Protocol servers and their tools |
| **Provider management** | Configure Claude, OpenAI, Gemini, and more |
| **Tool settings** | Enable/disable specific AI tools per session |
| **File browser** | Navigate your Mac's filesystem |
| **Image attachments** | Send screenshots and photos to the AI |
| **Terminal** | PTY terminal sessions with full xterm emulation |
| **Todo tracking** | Real-time view of AI's task plan |
| **Git info** | Branch display and modified file tracking |

### Connectivity

| Feature | Description |
|---------|-------------|
| **Local network** | Works on your home WiFi |
| **Tailscale** | Secure access from anywhere (WireGuard encryption) |
| **Tailscale Funnel** | Public HTTPS—no VPN needed on phone |
| **Smart reconnection** | Exponential backoff with automatic re-sync |
| **Connection quality** | RTT monitoring with adaptive event batching |

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

### What Each Layer Does

**Bridge Server (Bun/TypeScript)**
- Accepts WebSocket connections from phone
- Wraps OpenCode SDK for bidirectional communication
- Batches SDK events based on connection latency
- Displays QR code for pairing
- Manages OpenCode server lifecycle

**Mobile App (Flutter/Dart)**
- Renders chat UI with markdown + syntax highlighting
- Displays tool calls with inline diff previews
- Handles user input and file attachments
- L1/L2 tiered caching for offline mode
- Stores credentials in iOS Keychain / Android EncryptedSharedPrefs

**OpenCode**
- AI reasoning and tool execution
- File operations (read, edit, write, bash)
- Session and project management
- Authentication with AI providers

---

## Installation

### Prerequisites

| Dependency | Version | Notes |
|------------|---------|-------|
| macOS | 12+ | Required |
| [Bun](https://bun.sh) | 1.0+ | JS runtime for bridge |
| [OpenCode](https://github.com/opencode-ai/opencode) | Latest | The AI agent |
| [Flutter](https://flutter.dev) | 3.0+ | For building the app |
| [Tailscale](https://tailscale.com) | Any | Optional—for remote access |

### Bridge Setup

```bash
# Clone the repo
git clone https://github.com/humblemuzzu/broski.git
cd broski/packages/bridge

# Install dependencies
bun install

# Start the bridge (starts OpenCode automatically)
bun run dev

# Or attach to existing OpenCode instance
bun run dev -- --attach
```

### Mobile App Setup

```bash
# From repo root
cd broski
flutter pub get
flutter run  # iOS/Android simulator or connected device
```

For release builds:
```bash
flutter build ios      # iOS
flutter build apk      # Android
```

---

## CLI Options

```bash
# Default: starts OpenCode automatically
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
```

---

## Project Structure

```
broski/
├── lib/                          # Flutter app
│   ├── main.dart                 # Entry point with cache pre-warming
│   ├── screens/                  # 21 screens
│   │   ├── chat_screen.dart      # Main chat (2000+ lines)
│   │   ├── projects_screen.dart  # Project picker
│   │   ├── sessions_screen.dart  # Session history
│   │   ├── browse_screen.dart    # File browser
│   │   ├── mcp_servers_screen.dart
│   │   ├── providers_screen.dart
│   │   ├── tools_screen.dart
│   │   └── ...
│   ├── widgets/                  # Reusable components
│   │   ├── message_bubble.dart   # Markdown rendering
│   │   ├── tool_call.dart        # Tool cards with inline diffs
│   │   ├── diff_viewer.dart      # Syntax-highlighted diffs
│   │   ├── permission_prompt.dart
│   │   └── ...
│   ├── providers/                # Riverpod state management
│   │   ├── chat_provider.dart    # SDK event handling
│   │   ├── connection_provider.dart
│   │   └── ...
│   ├── services/                 # Business logic
│   │   ├── bridge_service.dart   # 1000+ lines, 20 features
│   │   ├── websocket_service.dart
│   │   ├── storage_service.dart  # L1/L2 tiered caching
│   │   └── ...
│   ├── models/                   # Data models
│   └── theme/                    # OpenCode design system
│       ├── opencode_theme.dart   # 50+ semantic color tokens
│       └── themes/               # Theme variants
│
├── packages/bridge/              # Bun/TypeScript bridge
│   └── src/
│       ├── index.ts              # CLI entry
│       ├── server.ts             # WebSocket + HTTP server
│       ├── opencode.ts           # SDK wrapper (1000+ lines)
│       ├── network.ts            # IP detection
│       ├── qr.ts                 # Terminal QR code
│       └── funnel.ts             # Tailscale Funnel
│
└── docs/mvp/                     # Documentation
```

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
| [mobile_scanner](https://pub.dev/packages/mobile_scanner) | QR scanning |
| [flutter_secure_storage](https://pub.dev/packages/flutter_secure_storage) | Keychain/EncryptedSharedPrefs |

### Bridge Server

| Package | Purpose |
|---------|---------|
| [Bun](https://bun.sh) | Fast JS runtime |
| [TypeScript](https://www.typescriptlang.org) | Type safety |
| [@opencode-ai/sdk](https://github.com/opencode-ai/opencode) | OpenCode integration |

### Design System

The app implements OpenCode's full design system with 50+ semantic color tokens:
- Core: `primary`, `secondary`, `accent`, `error`, `warning`, `success`, `info`
- Text: `text`, `textMuted`, `selectedListItemText`
- Background: `background`, `backgroundPanel`, `backgroundElement`, `backgroundMenu`
- Border: `border`, `borderActive`, `borderSubtle`
- Diff: 12 tokens for diff viewer
- Markdown: 14 tokens for markdown rendering
- Syntax: 9 tokens for syntax highlighting

---

## Performance

| Metric | Target | How |
|--------|--------|-----|
| App startup | <2s | Cache pre-warming in `main.dart` |
| Message latency (local) | <100ms | RTT-adaptive event batching |
| Message latency (Tailscale) | <300ms | Connection type detection |
| Offline cache read | <1ms | L1 in-memory cache |
| Bridge memory | <30MB | Efficient event streaming |

---

## Security

Broski is designed for personal use. Security is peer-to-peer:

| Aspect | Implementation |
|--------|---------------|
| Local network | Traffic stays on your WiFi |
| Tailscale | WireGuard encryption (military-grade) |
| No cloud | No Broski servers. Direct phone ↔ Mac |
| Credentials | iOS Keychain / Android EncryptedSharedPrefs |
| API keys | Never leave your Mac |

---

## Troubleshooting

### Bridge won't start

```bash
# Check if OpenCode is running
opencode serve

# Or let bridge manage it
bun run dev  # Starts OpenCode automatically
```

### Can't connect from phone

1. **Same WiFi?** Phone and Mac must be on same network
2. **Firewall?** Allow incoming on port 18274
3. **Tailscale?** Both devices logged in with same account

### Port in use

```bash
lsof -nP -iTCP:18274 -sTCP:LISTEN
broski-bridge --port 8080
```

---

## Development

```bash
# Terminal 1: Bridge
cd packages/bridge && bun dev

# Terminal 2: Flutter
flutter run

# Code style
flutter analyze
dart format .
```

---

## Roadmap

### Done

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
- [x] File browser
- [x] Git integration
- [x] Tailscale + Funnel
- [x] Offline mode
- [x] OpenCode design system

### Next

- [ ] Push notifications
- [ ] Voice input
- [ ] Apple Watch companion
- [ ] Multi-device support
- [ ] E2E encryption

---

## Contributing

```bash
git clone https://github.com/humblemuzzu/broski.git
cd broski
git checkout -b feature/your-feature
flutter test
git commit -m "Add your feature"
git push origin feature/your-feature
```

See [AGENTS.md](AGENTS.md) for code conventions.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">
  <p>
    <sub>Built by <a href="https://github.com/humblemuzzu">humblemuzzu</a></sub>
  </p>
</div>
