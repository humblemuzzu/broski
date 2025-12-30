# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Broski?

Broski is a mobile companion app for [OpenCode](https://github.com/opencode-ai/opencode)—an open source AI coding agent. It consists of two main components:

1. **Flutter Mobile App** (`lib/`) - Cross-platform mobile UI using Riverpod for state management
2. **Bridge Server** (`packages/bridge/`) - Bun/TypeScript WebSocket server that connects the app to OpenCode via SDK

Architecture: `Phone (Flutter) ←→ Bridge (Bun) ←→ OpenCode (AI Agent)`

## Commands

### Flutter App
```bash
flutter pub get              # Install dependencies
flutter run                  # Run on device/simulator
flutter run -d chrome        # Run in web browser
flutter test                 # Run all tests
flutter test test/foo_test.dart  # Run single test
flutter analyze              # Static analysis
dart format .                # Format all Dart files
```

### Bridge Server
```bash
cd packages/bridge
bun install                  # Install dependencies
bun dev                      # Start with hot reload (--watch)
bun start                    # Start without watch
bunx broski-bridge           # Run directly without installing
broski-bridge --attach       # Attach to existing OpenCode instance
broski-bridge --funnel       # Enable Tailscale Funnel (public HTTPS)
broski-bridge doctor         # Diagnose environment
```

## Code Architecture

### Flutter App (`lib/`)
- `providers/` - Riverpod state management (session state, WebSocket connection, settings)
- `services/` - Business logic and L1/L2 tiered caching (memory → SecureStorage)
- `models/` - Data models matching OpenCode SDK types
- `screens/` - 25 screens (chat, sessions, terminal, file browser, settings, etc.)
- `widgets/` - Reusable UI components (tool cards, diff viewers, markdown renderers)
- `theme/` - OpenCode design system with 50+ semantic color tokens

### Bridge Server (`packages/bridge/src/`)
- `server.ts` - Main WebSocket + HTTP server (~49K LOC, handles all SDK wrapping)
- `subscription-tracker.ts` - Manages OpenCode SDK event subscriptions
- `types.ts` - TypeScript types for phone ↔ bridge protocol
- `connectors/` - OpenCode and Claude Code connection adapters
- `cli.ts`, `doctor.ts`, `setup-tailscale.ts` - CLI tooling

### Key Patterns
- **Thin client**: App only renders UI; all AI logic stays on Mac
- **RTT-adaptive batching**: Event streaming adjusts to connection latency (4ms local → 150ms high-latency)
- **Stale-while-revalidate**: Show cached data immediately, refresh in background

## Coding Conventions

### Dart/Flutter
- 2-space indentation, trailing commas
- `UpperCamelCase` for types, `lowerCamelCase` for variables/functions, `snake_case.dart` for files
- Lint rules via `flutter_lints` in `analysis_options.yaml`

### TypeScript/Bridge
- Bun runtime (not Node.js)
- ESM modules (`"type": "module"`)
- Main entry: `src/index.ts`

## Continuity Ledger

This project uses a Continuity Ledger pattern for session state across context compactions. Ledgers live in `thoughts/ledgers/` with format `CONTINUITY_CLAUDE-<session-name>.md`. Update the ledger when goal, constraints, decisions, or progress changes.

## Rules & Hooks

The `.claude/` directory contains project-specific Claude Code configuration:
- `.claude/rules/` - Development guidelines (observe before editing, agent orchestration, git commits, etc.)
- `.claude/hooks/` - Pre-bundled TypeScript hooks for skill activation and file tracking
- `.claude/skills/` - Claude Code Skills with SKILL.md + workflow.py pattern
- `.claude/settings.json` - Hook registration and project settings

Key rule: Use `/commit` skill instead of raw `git commit` to remove Claude attribution from commits.
