# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Repository Guidelines

## What Broski Is

Broski is a **mobile app that gives you full remote control of AI coding agents running on your computer** from your phone. It connects to 5 agent backends (4 stable, 1 experimental) through a bridge server:

```
Phone (Flutter + Rust core) ←Broski Link (Noise e2e; LAN or relay)→ broski-link daemon (Rust, your Mac) ←unix socket→ Bridge (Bun/TS) ←SDK→ {Claude Code, OpenCode, Codex, Pi, Pi Durable}
```

- **Bridge** (`packages/bridge/`) — TypeScript server on the user's dev machine. Connects to local AI agents via their SDKs. Serves the app protocol to the daemon over the unix socket `~/.broski/link/bridge.sock`; its TCP listener is loopback-only (127.0.0.1) and exists for local things only: the CC/CX permission hooks, the dashboard, `/proxy/<port>`.
- **broski-link daemon** (`packages/link/daemon/`, Rust) — runs as a launchd (macOS) / systemd (Linux) service installed by `broski install`; supervises the bridge, terminates the Noise session with each paired phone, and dials the relay. Windows is not supported.
- **Relay** (`packages/link/relay/`) — blind rendezvous the phone and daemon both dial out to. It forwards encrypted frames and never sees plaintext.
- **Flutter app** (`lib/`, Rust core via `packages/link_dart/`) — iOS/Android app. Renders UI only; all AI logic stays on Mac.
- **Connection:** direct over the LAN when reachable, otherwise through the relay. No VPN, tunnel, port forwarding or public exposure of the bridge.
- **Auth layers:** QR v2 pairing (`broski://pair?v=2&h=<fingerprint>&s=<one-time secret>&e=<expiry>&n=<name>[&r=<relay>][&l=<lan>]`), Noise end-to-end encryption (hybrid X25519 + ML-KEM-768) with the machine fingerprint pinned from the QR, and per-device revocable authorisation on the daemon. Design docs: `docs/architecture/connectivity-v2/`.
- **530 Dart files** (~139K LOC under `lib/`), **239 TypeScript files** (~50K LOC under `packages/bridge/src/`, tests excluded).
- **`pi-durable`** is the experimental 5th backend (`@earendil-works/pi-durable@1.1.0`, behind an Experimental toggle in the app). See `docs/architecture/backends/pi-durable.md`.

### Core features that are INTENTIONAL, not vulnerabilities:
- **PTY / terminal access from the phone.** This is a primary feature. Users open terminal sessions, type commands, see output. Do NOT flag this as a security issue or suggest blocking it.
- **Command execution from the app.** The app sends commands to AI agents (Claude Code, Codex, OpenCode, Pi) and to the shell. This is the product. Do NOT suggest removing or restricting command execution.
- **File reading/writing from the phone.** Users browse, read, and edit files on their dev machine through the app. This is intentional.
- **AI agent control.** Users chat with AI agents, approve/reject permission prompts, and manage coding sessions. The bridge is the relay between phone and agents.
- **QR code pairing.** `broski-link pair` shows a QR v2 code in the user's terminal. It carries the machine fingerprint, a one-time pairing secret and an expiry, plus relay/LAN hints. This is the pairing mechanism (like SSH keys). The QR is only visible on the user's own screen, and the secret is consumed by the first successful pairing.

### The architecture (so you understand the threat model):
- **Bridge** (`packages/bridge/`) = TypeScript server running on the user's own dev machine. It connects to local AI agents. Phones never reach it directly: it listens on a unix socket for `broski-link` and on 127.0.0.1 (TLS + local bearer token) for the agent hooks, the dashboard and `/proxy/<port>`.
- **broski-link daemon** (`packages/link/daemon/`) = the only network-facing process on the Mac. It accepts Noise sessions from paired phones over the LAN or the relay and pipes their traffic to the bridge.
- **Flutter app** (`lib/`) = iOS/Android app. Pairs by scanning the QR v2 code, then talks to the daemon through the Rust Link core (`packages/link_dart/`).
- **Connection methods:** direct LAN, or the blind relay (`packages/link/relay/`) when the phone is away. The relay sees ids, timing, sizes and push metadata; never plaintext.
- **Auth layers:** one-time pairing secret from the QR, Noise end-to-end encryption with the pinned machine fingerprint, per-device authorisation and revocation on the daemon (`broski-link devices` / `revoke`).

### Security context for audits:
- This is a **personal dev tool**, not a multi-tenant SaaS. The user owns both the phone and the machine.
- A one-time pairing secret plus a Noise end-to-end channel with a pinned machine fingerprint is the SSH-style trust model for this category; the relay is untrusted by design.
- The bridge deliberately has broad filesystem and process access because that is its job.
- Web app (`web-app/`) exists but is NOT launched yet. Bridge serves its static assets without auth (standard SPA behavior) but all API/WS endpoints require auth.
- Compiled production binaries disable all debug flags, force TLS on the loopback listener, and ignore env overrides that could weaken security.

### What IS worth auditing:
- Pairing lifecycle (one-time secret consumption, expiry, device revocation, relay token storage)
- Noise handshake correctness and relay blindness (what the relay can and cannot see)
- Loopback listener hardening (TLS, local bearer token, bind address) for the agent hooks
- Path traversal protections (realpath, symlink defense, base path checks)
- Input validation and injection (prototype pollution, message size limits)
- Rate limiting and DoS protection

### What is NOT a vulnerability (stop flagging these):
- PTY/terminal access existing at all
- Command execution from the app
- File read/write from the app
- QR code containing the auth token (it's the pairing mechanism)
- Bridge having access to AI agent credentials (it's the relay, that's its job)
- Localhost proxy to dev server ports (authenticated, loopback-only)

## The Runtime Abstraction

This is the core architecture of the app. **Read this before adding any agent feature.**

### The Problem

5 agent backends, each with its own event types, session models, and streaming protocols. Without abstraction, every feature needs a separate implementation per backend.

### The Solution: BroskiRuntimeEvent

A unified event stream that normalizes all 5 backends into one type system. The Flutter app receives `BroskiRuntimeEvent`s and doesn't care which backend produced them.

**Bridge side** (`packages/bridge/src/types/runtime.ts`):
```typescript
type BroskiBackend = "opencode" | "claude-code" | "codex" | "pi" | "pi-durable";

type BroskiRuntimeEvent =
  | BroskiAgentStartedEvent
  | BroskiAgentFinishedEvent
  | BroskiAssistantTextDeltaEvent
  | BroskiAssistantThinkingDeltaEvent
  | BroskiToolStartedEvent
  | BroskiToolUpdatedEvent
  | BroskiToolFinishedEvent
  | BroskiPermissionRequestedEvent
  | BroskiUserInputRequestedEvent
  | BroskiSessionStateChangedEvent
  | BroskiCompactionStartedEvent
  | BroskiCompactionFinishedEvent
  | BroskiRetryStartedEvent
  | BroskiRetryFinishedEvent
  | BroskiErrorEvent
  | BroskiBackendEvent;  // escape hatch for backend-specific data
```

Every event has: `{ type, backend, timestampMs, sessionId?, cwd?, messageId?, toolCallId?, streamId?, turnId?, seq?, replayed?, backendData? }`.

**BroskiRuntimeState** — the current session state: `{ backend, sessionId, cwd, isStreaming, isCompacting, isRetrying, model, permissionRequest, capabilities, backendData }`.

**RuntimeCapabilities** — what this backend can do: `{ canStreamText, canStreamThinking, canUseTools, canPrompt, canAbort, canSwitchModel, canListSessions, canReadTranscript, canForkSession, canCompact, canRetry, canRequestUserInput, canRequestPermissions, backendExtras[] }`.

### The Mapper Pattern

Each agent has an event mapper in `packages/bridge/src/runtime/`:

```
agent SDK event → runtime event mapper → BroskiRuntimeEvent → WebSocket → Flutter
```

| Backend | Mapper file | Read models file |
|---------|------------|-----------------|
| Claude Code | `runtime/claude-code-runtime-event-mapper.ts` (262) | `runtime/claude-code-runtime-read-models.ts` (114) |
| OpenCode | `runtime/opencode-runtime-event-mapper.ts` (417) | `runtime/opencode-runtime-read-models.ts` (118) |
| Codex | `runtime/codex-runtime-event-mapper.ts` (639) | `runtime/codex-runtime-read-models.ts` (126) |
| Pi | `runtime/pi-runtime-event-mapper.ts` (203) | `runtime/pi-runtime-read-models.ts` (144) |
| Pi Durable | `runtime/pi-durable-runtime-event-mapper.ts` (199) | `runtime/pi-durable-runtime-read-models.ts` (144) |

Plus shared: `runtime/stream-contract.ts` (103), `runtime/shared.ts` (27), `runtime/pi-runtime-bootstrap.ts` (49), and `runtime/pi-durable-partial-message.ts` (147) — the whole-block text diff Pi Durable needs because its `message_update.changes` is not a flat delta stream.

**When adding a new event type:** Add it to `types/runtime.ts`, implement mapping in each backend's mapper that emits it, add the Dart model to `models/runtime/runtime_event.dart`, and handle it in the Flutter `runtime_event_reducer.dart`.

### Flutter Side

Dart models in `lib/models/runtime/` (6 files, 1,024 lines):
- `runtime_event.dart` (583) — sealed class with all 16 event types
- `runtime_state.dart` (170)
- `runtime_capabilities.dart` (73)
- `runtime_session_summary.dart` (125)
- `runtime_model_summary.dart` (68)

Provider layer in `lib/providers/chat/` (25 files, 7,325 lines; 15 `runtime_*` files, 4,752 lines):
- `runtime_chat_ingest.dart` (659) — main ingestion pipeline
- `runtime_event_reducer.dart` (306) — reduces events into state updates
- `runtime_common_reducer.dart` (403) — shared reduction logic
- `runtime_cx_handlers.dart` (594) — Codex-specific event handling
- `runtime_oc_message_handler.dart` (521) / `runtime_oc_part_handler.dart` (383) — OpenCode handling
- `runtime_cc_system_messages.dart` (421) / `runtime_cc_metadata_handler.dart` (288) — Claude Code handling
- `runtime_permission_handler.dart` (354) — permission request flow
- `runtime_event_models.dart` (162) / `runtime_common_models.dart` (143) — shared data types

### The Unified Handler

`packages/bridge/src/handlers/unified.ts` (378 lines) — instead of per-agent messages (`cc_list_sessions`, `cx_list_threads`, `pi_list_sessions`), the app sends ONE message with a `backend` parameter:

```
{ type: "unified_list_sessions", backend: "codex", cwd: "..." }
→ { type: "unified_sessions", backend: "codex", data: [...], requestId: "..." }
```

Old per-agent messages still work for backward compatibility. New features should use unified messages.

### Supporting Infrastructure

| Component | File | Purpose |
|-----------|------|---------|
| Send queue | `utils/runtime-send-queue.ts` (121) | Batches runtime events, RTT-adaptive |
| Replay buffer | `utils/runtime-replay-buffer.ts` (80) | Buffers events for reconnection replay (Pi Durable does NOT use it — its attach snapshot is the reconnect view) |
| Bounded pool | `utils/bounded-pool.ts` (11) | Caps concurrency (Pi session-stats enrichment) |
| Single-flight | `connectors/pi/pi-single-flight.ts` (17) | Dedupes concurrent work on the same key |
| Session list cache | `connectors/pi/pi-session-list-cache.ts` (223) | Caches Pi session listings by directory fingerprint |
| Replay tracker | `lib/services/bridge/runtime_replay_tracker.dart` (41) | Flutter-side replay handling |
| Bridge runtime | `lib/services/bridge/bridge_runtime.dart` (82) | Flutter→bridge runtime API |
| Bridge unified | `lib/services/bridge/bridge_unified.dart` (150) | Flutter→bridge unified API |

## ⛔ MODULAR CODE ARCHITECTURE — MANDATORY

Every edit must make the codebase more modular, not less. New code goes in new files. Existing large files are frozen — you delegate, not add.

### 🚫 FROZEN FILES — DO NOT ADD LINES TO THESE

**Bridge (TypeScript):**

| File | Lines | What it has | Where new code goes |
|------|-------|-------------|-------------------|
| `packages/bridge/src/types.ts` | 3,437 | All type definitions, ClientMessage/ServerMessage unions | `types/runtime.ts`, `types/codex.ts`, `types/pi.ts`, `types/pi-durable.ts` |
| `packages/bridge/src/connectors/claude-code.ts` | 3,322 | All CC connector logic | `connectors/claude-code/` (stream-supplemental-events, model-normalization, cc-session-stats already extracted) |
| `packages/bridge/src/server.ts` | 2,810 | Routing + remaining direct handlers | `handlers/{domain}.ts` (101 handler files already extracted) |
| `packages/bridge/src/connectors/opencode.ts` | 1,845 | All OC connector logic | `connectors/opencode/` (oc-sqlite, session-list already extracted) |

**Flutter (Dart):**

| File | Lines | What it has | Where new code goes |
|------|-------|-------------|-------------------|
| `lib/screens/chat_screen.dart` | 2,169 | Main chat screen build + routing | `lib/screens/sheets/` (53 files), `lib/screens/chat/` (42 files), `lib/screens/dialogs/` (9 files) |
| `lib/screens/settings_screen.dart` | 1,580 | All settings | Extract sections to `lib/screens/sheets/` or dedicated screens |
| `lib/screens/claude_code_settings_screen.dart` | 1,502 | CC settings | Extract to `lib/screens/sheets/cc_*.dart` |
| `lib/screens/projects_screen.dart` | 1,367 | Project management | Extract sections |
| `lib/screens/browse_screen.dart` | 1,312 | File browser | Extract sections |
| `lib/screens/sessions_screen.dart` | 1,233 | Session list + filters | `lib/screens/sessions/` (11 files) |

### ✅ Graduated Files (previously frozen, now clean — keep them lean)

These were 5,000–13,000 lines. Extraction is done. Keep adding to their extracted subdirectories, not back to these files.

| File | Was | Now | Where the code went |
|------|-----|-----|-------------------|
| `lib/services/bridge_service.dart` | 5,058 | 295 | `lib/services/bridge/` (41 extension files, 6,666 lines) |
| `lib/providers/chat_provider.dart` | 5,092 | 271 | `lib/providers/chat/` (25 files, 7,325 lines) |
| `lib/screens/onboarding_screen.dart` | 4,314 | 114 | `lib/screens/onboarding/` (9 files, 2,634 lines) |
| `lib/models/claude_code.dart` | 2,759 | 21 (barrel) | `lib/models/claude_code/` (17 files, 4,052 lines) |

### ⚠️ WATCH LIST — Files over 400 lines (extract on next touch)

Prioritised, not exhaustive. Recompute with `find lib packages/bridge/src \( -name '*.dart' -o -name '*.ts' \) -not -path '*__tests__*' | xargs wc -l | sort -rn`.

**Flutter widgets:**

| File | Lines | What to extract |
|------|-------|----------------|
| `lib/widgets/permission_rules_sheet.dart` | 1,660 | Item widgets → separate files |
| `lib/widgets/session_sidebar.dart` | 1,383 | Section widgets |
| `lib/widgets/power_sheet.dart` | 1,136 | Section widgets |
| `lib/widgets/permission_prompt.dart` | 948 | Action buttons, content sections |
| `lib/widgets/chat/compact_agent_card.dart` | 823 | Sub-widgets |
| `lib/widgets/chat/cli_input_bar.dart` | 753 | Sub-widgets |
| `lib/widgets/chat/compact_edit_card.dart` | 616 | Sub-widgets |
| `lib/widgets/file_tagging.dart` | 606 | Sub-widgets |
| `lib/widgets/sessions/session_helpers.dart` | 595 | Helper functions |
| `lib/widgets/question_prompt_sheet.dart` | 582 | Sub-widgets |
| `lib/widgets/message_bubble.dart` | 576 | Sub-widgets |
| `lib/widgets/onboarding_widgets.dart` | 575 | Step widgets |
| `lib/widgets/chat/input_bar_content.dart` | 532 | Sub-widgets |
| `lib/widgets/chat/compact_tool_card.dart` | 528 | Sub-widgets |
| `lib/widgets/chat/floating_input_bar.dart` | 516 | Sub-widgets |
| `lib/widgets/voice_recording_sheet.dart` | 503 | Sub-widgets |
| `lib/widgets/chat/floating_header.dart` | 482 | Sub-widgets |
| `lib/widgets/chat/adaptive_table.dart` | 452 | Sub-widgets |
| `lib/widgets/chat/pi_actions_content.dart` | 413 | Sub-widgets |

**Flutter providers:**

| File | Lines |
|------|-------|
| `lib/providers/connection_provider.dart` | 1,314 |
| `lib/providers/claude_code_provider.dart` | 967 |
| `lib/providers/sessions_provider.dart` | 882 |
| `lib/providers/chat/chat_session_state.dart` | 706 |
| `lib/providers/chat/runtime_chat_ingest.dart` | 659 |
| `lib/providers/chat/runtime_cx_handlers.dart` | 594 |
| `lib/providers/chat/runtime_oc_message_handler.dart` | 521 |
| `lib/providers/codex_provider.dart` | 468 |
| `lib/providers/chat/runtime_cc_system_messages.dart` | 421 |
| `lib/providers/chat/runtime_common_reducer.dart` | 403 |
| `lib/providers/chat/message_builder.dart` | 402 |

**Flutter screens/sheets** (excludes the 6 FROZEN screens above):

| File | Lines |
|------|-------|
| `lib/screens/sessions/cc_sessions_view.dart` | 1,400 |
| `lib/screens/sessions/cx_threads_view.dart` | 1,282 |
| `lib/screens/sheets/git_panel_sheet.dart` | 1,131 |
| `lib/screens/mcp_servers_screen.dart` | 1,094 |
| `lib/screens/subagents_screen.dart` | 1,074 |
| `lib/screens/sessions/pi_sessions_view.dart` | 1,059 |
| `lib/screens/appearance_screen.dart` | 1,027 |
| `lib/screens/subscription_usage_screen.dart` | 929 |
| `lib/screens/scan_screen.dart` | 884 |
| `lib/screens/skills_screen.dart` | 876 |
| `lib/screens/terminal_screen.dart` | 842 |
| `lib/screens/plugins_screen.dart` | 811 |
| `lib/screens/custom_tool_editor_screen.dart` | 795 |
| `lib/screens/background_screen.dart` | 762 |
| `lib/screens/customization_screen.dart` | 746 |
| `lib/screens/sheets/pi_tree_sheet.dart` | 716 |
| `lib/screens/sheets/cc_tools_sheet.dart` | 685 |
| `lib/screens/voice_settings_screen.dart` | 679 |
| `lib/screens/tools_screen.dart` | 668 |
| `lib/screens/theme_selector_screen.dart` | 634 |
| `lib/screens/sheets/pi_session_sidebar_sheet.dart` | 613 |
| `lib/screens/sheets/pi_settings_sheet.dart` | 568 |

**Flutter services:**

| File | Lines | What to extract |
|------|-------|----------------|
| `lib/services/storage_service.dart` | 1,352 | `lib/services/storage/` (2 files, 64 lines extracted so far) |
| `lib/services/pi_bridge_service.dart` | 758 | Methods → `lib/services/bridge/bridge_pi_*.dart` extensions |
| `lib/services/websocket_service.dart` | 626 | Reconnection logic, message handling |
| `lib/services/bridge/bridge_git.dart` | 405 | Git method group → smaller extensions |

**Bridge:**

| File | Lines | What to extract |
|------|-------|----------------|
| `packages/bridge/src/index.ts` | 1,335 | Extract CLI entry, startup logic |
| `packages/bridge/src/platform.ts` | 1,073 | Split platform / build-flag probes |
| `packages/bridge/src/cc-external-tail.ts` | 740 | Split tail vs parse |
| `packages/bridge/src/custom-tools.ts` | 706 | Split registry vs execution |
| `packages/bridge/src/subscription-tracker.ts` | 672 | Split per-provider trackers |
| `packages/bridge/src/connectors/codex-fs.ts` | 645 | Split file ops vs search |
| `packages/bridge/src/runtime/codex-runtime-event-mapper.ts` | 639 | Split by event category |
| `packages/bridge/src/handlers/git/git_commands.ts` | 610 | Split into git_operations, git_diff, etc. |
| `packages/bridge/src/cx-external-tail.ts` | 533 | Split tail vs parse |
| `packages/bridge/src/cli.ts` | 491 | Split command groups |
| `packages/bridge/src/pty/runtime.ts` | 481 | Split session vs I/O |
| `packages/bridge/src/pty/native-pty.ts` | 477 | Split by backend |
| `packages/bridge/src/file-search.ts` | 447 | Split walk vs match |
| `packages/bridge/src/handlers/codex/cx_threads.ts` | 442 | Split list vs mutate |
| `packages/bridge/src/updater.ts` | 436 | Split check vs apply |
| `packages/bridge/src/runtime/opencode-runtime-event-mapper.ts` | 417 | Split by event category |
| `packages/bridge/src/oc-external-tail.ts` | 413 | Split tail vs parse |
| `packages/bridge/src/handlers/codex_features.ts` | 410 | Split by feature |
| `packages/bridge/src/plugins.ts` | 402 | Split registry vs loader |

Other files over 400 lines (not tabulated): `lib/theme/themes/all_themes.dart` (2,950, generated theme table — leave alone), `lib/models/claude_code/cc_stream_message.dart` (1,247), `lib/models/codex.dart` (1,100), `lib/models/pi.dart` (789), `lib/models/runtime/runtime_event.dart` (583), `lib/models/message.dart` (566).

### 🔢 Hard Limits

| Metric | Limit | Action |
|--------|-------|--------|
| New file | < 400 lines | If approaching 400, split further |
| New function | < 50 lines | Extract helper functions |
| Adding to a FROZEN file | 0 new methods/cases | Create a new file, add a 1-line call |
| Editing a FROZEN file | Must extract while editing | Fix in a new file, replace original with 1-line call |

### ✅ Pre-Completion Checklist

- Did I add any new method/function to a FROZEN file? → Extract it NOW.
- Did I add more than 10 lines to any file over 500 lines? → Extract the changed section.
- Is my new file under 400 lines? → Split if not.
- Can I describe what my new file does without using "and"? → Split if not.
- Did I update imports in the parent file? → Frozen file should delegate, not contain logic.

## Where Code Lives

### Flutter (`lib/`) — 530 files, ~139K LOC

```
lib/
  screens/                          ← 51 files here (31,981 lines); 180 recursive, 61,908 lines
    sheets/                         ← 53 extracted sheets (13,316 lines)
    chat/                           ← 42 extracted chat helpers (5,604 lines)
    sessions/                       ← 11 extracted session views (6,408 lines)
    dialogs/                        ← 9 extracted dialogs (921 lines)
    onboarding/                     ← 9 step files (2,634 lines)
    pi/                             ← extension UI handler (272 lines)
    opencode/                       ← OC-specific screen widgets (589 lines)
  widgets/                          ← 36 files here (12,767 lines); 128 recursive, 30,332 lines
    chat/                           ← chat widgets (62 files, 12,563 lines)
    sessions/                       ← session card widgets (15 files, 3,144 lines)
    pi/                             ← Pi-specific widgets (tree node, queue indicator)
    git/                            ← git file tile, diff inline, status badge
    file_viewers/                   ← file content rendering
    sidebar/                        ← sidebar widgets
    opencode/                       ← OC-specific widgets
  services/                         ← 9 files here (3,700 lines)
    bridge/                         ← 41 bridge extension files (6,666 lines)
    storage/                        ← storage extensions (2 files, 64 lines)
    websocket/                      ← WebSocket connector, JSON decoder
  providers/                        ← 36 files here (7,131 lines)
    chat/                           ← 25 files (7,325 lines) — runtime event processing
    sessions/                       ← 2 runtime session handlers
    codex/                          ← 4 Codex-specific providers
    connection/                     ← Link connection controller, status mapping
    link/                           ← machines, link status, push providers
    pi_durable/                     ← Pi Durable providers + experimental flag
  models/                           ← 44 files here (8,556 lines); 74 recursive, 14,216 lines
    claude_code/                    ← 17 CC model files (4,052 lines)
    runtime/                        ← 6 runtime model files (1,024 lines)
    codex/                          ← 3 Codex model files (257 lines)
  theme/                            ← design system, semantic color tokens
  utils/                            ← shared utilities
  config/                           ← app configuration
```

### Bridge (`packages/bridge/src/`) — 239 files, ~50K LOC (tests excluded; 273 files with tests)

```
packages/bridge/src/
  server.ts                         ← 2,810 lines — routing, delegates to handlers
  types.ts                          ← 3,437 lines — ClientMessage/ServerMessage unions
  index.ts                          ← 1,335 lines — CLI entry + startup
  connectors/                       ← 41 files (11,543 lines)
    claude-code/                    ← stream-supplemental-events, model-normalization, cc-session-stats
    opencode/                       ← oc-sqlite, session-list
    codex/                          ← cx-sqlite, cx-session-stats
    pi/                             ← 18 modules (2,598 lines) — pi-events, pi-instance, pi-session-lifecycle, pi-session-queries, pi-session-list-cache, pi-single-flight, pi-model-runtime, pi-session-stats, …
    pi-durable/                     ← 8 modules (1,068 lines) — harness-host, session-store, storage-lock, permissions, model-runtime, session-runtime, agent-setup
    claude-code.ts                  ← 3,322 lines — FROZEN, extract to subdirectory
    opencode.ts                     ← 1,845 lines — FROZEN, extract to subdirectory
    pi.ts                           ← 36-line facade re-exporting connectors/pi/*
    codex.ts                        ← 331 lines
    codex-fs.ts                     ← 645 lines
    pi_extension_ui.ts              ← 335 lines
  handlers/                         ← 101 files (13,624 lines)
    git/                            ← 9 files — git_commands, github, parse, security
    codex/                          ← 19 files — cx_threads, cx_chat, cx_files, cx_workspace, cx_agents, cx_plugins, cx_skills, cx_mcp, cx_fuzzy_search, etc.
    pi_durable/                     ← 6 modules — events, host, ops, read-models, transport, view
    cc_*.ts                         ← 16 files — cc_chat, cc_sessions, cc_config, cc_skills, cc_hooks_mcp, cc_commands, cc_plugins, cc_custom_tools, cc_subagents, cc_memory, cc_live_session, cc_elicitation, cc_permission_hook, cc_hook_installer, cc_ask_user_question, cc_routing
    pi_*.ts                         ← 21 files — pi_chat, pi_stream_bridge, pi_session_lifecycle, pi_features (router), pi_models, pi_settings, pi_tools, pi_tree, …
    unified.ts                      ← 378 lines — unified backend-agnostic handler
    auth.ts, devices.ts, misc.ts    ← shared handlers
    session_view.ts, session-stats.ts
  runtime/                          ← 14 files (2,692 lines)
    *-runtime-event-mapper.ts       ← 5 per-backend event mappers (incl. pi-durable)
    *-runtime-read-models.ts        ← 5 per-backend read models
    pi-durable-partial-message.ts   ← whole-block text diff for Pi Durable streaming
    stream-contract.ts              ← shared streaming contract
    shared.ts                       ← shared types
    pi-runtime-bootstrap.ts         ← Pi bootstrap
  types/                            ← 4 files (717 lines)
    runtime.ts                      ← BroskiRuntimeEvent, BroskiRuntimeState, BroskiBackend
    codex.ts                        ← Codex-specific types
    pi.ts                           ← Pi-specific types
    pi-durable.ts                   ← Pi Durable WebSocket contract
  pty/                              ← 5 files (1,213 lines) — runtime, native-pty, manager, output, types
  doctor/                           ← 15 files (1,224 lines) — checks for agents, network, security, daemon
  config/                           ← 4 files (181 lines) — schema, defaults, read-write
  logging/                          ← 2 files (211 lines) — structured logger, redaction
  wizard/                           ← 15 files (1,454 lines) — onboarding, troubleshoot, steps
  utils/                            ← file-tailer, runtime-send-queue, runtime-replay-buffer, bounded-pool, codex-compat-retry, message-buffer, fs-helpers
  __tests__/                        ← test files
```

## Adding a Feature — The 9-Layer Flow

```
types → server.ts route → handler → connector → runtime mapper → WebSocket → bridge extension → model → provider → UI
```

### Message Naming

Prefix by agent:
- **OpenCode:** no prefix or `oc_` (`list_sessions`, `oc_list_skills`)
- **Claude Code:** `cc_` (`cc_list_skills`, `cc_chat`, `cc_abort`)
- **Codex:** `cx_` (`cx_chat`, `cx_list_threads`)
- **Pi:** `pi_` (`pi_chat`, `pi_abort`, `pi_list_models`)
- **Pi Durable:** `pd_` (`pd_create_session`, `pd_chat`, `pd_compact`, `pd_get_transcript`, `pd_permission_response`); `set_view` attaches with `agent: "pi-durable"`

Request → Response:
- **List:** `cc_list_skills` → `cc_skills` (response = noun plural)
- **Mutate:** `cc_save_skill` → `cc_skill_saved` (response = noun past tense)
- **Stream:** `cc_chat` → `cc_stream` (response = prefix_stream)
- **Unified:** `unified_list_sessions` → `unified_sessions` (response keeps unified prefix + noun)

### New Feature Checklist

To add `xx_list_widgets` for agent XX:

1. **`types.ts`** (or `types/xx.ts`): Add to ClientMessage union: `| { type: 'xx_list_widgets'; cwd?: string }`
2. **`types.ts`** (or `types/xx.ts`): Add to ServerMessage union: `| { type: 'xx_widgets'; data: XxWidget[]; requestId?: string }`
3. **`types.ts`** (or `types/xx.ts`): Define `export type XxWidget = { ... }` if new type
4. **`connectors/xx.ts`** (or `connectors/xx/xx-widgets.ts` if connector is FROZEN): Add `export async function listWidgets(cwd?: string): Promise<XxWidget[]>`
5. **`handlers/xx_widgets.ts`** ← NEW FILE, not server.ts. Add 1-line import + route in server.ts
6. **`lib/models/xx.dart`** (or `lib/models/xx/xx_widget.dart` if model is FROZEN): Add `class XxWidget` with `factory fromJson()` + `toJson()`
7. **`lib/services/bridge/bridge_xx.dart`** ← EXTENSION FILE, not bridge_service.dart. Add method as extension on BridgeService
8. **`lib/providers/xx_provider.dart`**: Add Riverpod provider
9. **`lib/screens/sheets/xx_widgets_sheet.dart`** ← NEW FILE, not chat_screen.dart. Add 1-line call in chat_screen.dart

### Extraction Recipes

**Recipe 1: Sheet from chat_screen.dart**
```dart
// NEW FILE: lib/screens/sheets/xx_settings_sheet.dart
void showXxSettingsSheet(BuildContext context) {
  DetailSheet.show(
    context: context,
    title: 'Settings',
    child: Consumer(builder: (context, ref, _) {
      // Consumer gives you ref — no need to pass providers as params
      return Column(...);
    }),
  );
}

// IN chat_screen.dart — replace the old method:
void _showXxSettingsSheet() => showXxSettingsSheet(context);
```

**Recipe 2: Handler from server.ts**
```typescript
// NEW FILE: packages/bridge/src/handlers/xx_things.ts
import type { ServerContext } from '../types'

export async function handle(message: any, reply: (msg: any) => void, ctx: ServerContext): Promise<boolean> {
  switch (message.type) {
    case 'xx_list_things': {
      const result = await ctx.xxConnector.listThings(message.cwd)
      reply({ type: 'xx_things', data: result, requestId: message.requestId })
      return true
    }
    default: return false
  }
}

// IN server.ts — add ONLY:
// import * as xxThings from './handlers/xx_things'
// if (await xxThings.handle(message, reply, ctx)) return
```

**Recipe 3: Bridge extension from bridge_service.dart**
```dart
// NEW FILE: lib/services/bridge/bridge_xx.dart
extension BridgeXx on BridgeService {
  Future<List<Thing>> xxListThings({String? cwd}) async {
    final requestId = _generateRequestId();
    _socket.send({'type': 'xx_list_things', 'requestId': requestId, if (cwd != null) 'cwd': cwd});
    final response = await _waitFor('xx_things', requestId: requestId);
    final data = response['data'] as List<dynamic>? ?? [];
    return data.map((item) => Thing.fromJson(item as Map<String, dynamic>)).toList();
  }
}

// bridge_service.dart auto-attaches extensions — just needs: export 'bridge/bridge_xx.dart';
```

**Recipe 4: Menu handler from chat_screen.dart**
```dart
// NEW FILE: lib/screens/chat/xx_menu_handler.dart
void handleXxMenuAction(BuildContext context, WidgetRef ref, String value) {
  switch (value) { case 'settings': ... }
}

// IN chat_screen.dart:
void _handleXxMenuAction(String value) => handleXxMenuAction(context, ref, value);
```

### Existing extractions to use as reference:
- `lib/screens/sheets/cx_model_sheet.dart` (248 lines) — sheet from chat_screen ✅
- `lib/screens/sheets/cx_apps_sheet.dart` (165 lines) — sheet from chat_screen ✅
- `lib/screens/sheets/git_branch_sheet.dart` (109 lines) — sheet from chat_screen ✅
- `packages/bridge/src/connectors/pi/` (18 modules, 2,598 lines) — connector split out of the `pi.ts` facade ✅
- `packages/bridge/src/handlers/pi_features.ts` (48-line router) → `handlers/pi_*.ts` modules ✅
- `packages/bridge/src/handlers/git/` (9 files) — handlers from server.ts ✅
- `packages/bridge/src/handlers/codex_features.ts` (410 lines) — handler from server.ts ✅

## SDK Integration Rules

### Use SDK types. Don't cast `as any`.

If the SDK exports a type — import it and use it. Casting `as any` hides breaking changes. When the SDK renames a field, TypeScript catches it at compile time with real types but silently returns `undefined` at runtime with `as any`.

### Don't write fallbacks for old SDK response formats.

When the current SDK returns `{ data: [...] }`, don't also handle the old format with `result?.data ?? result ?? []`. That middle `?? result` is dead code.

| Situation | Do this | Not this |
|-----------|---------|----------|
| SDK exports `SDKAssistantMessage` | `import type { SDKAssistantMessage }` | `(block as any).text` |
| Codex returns `{ data: [...] }` | `result.data` | `result?.data ?? result ?? []` |
| OpenCode `{ responseStyle: 'data' }` | Use typed return | `(result as any) ?? []` |
| Filesystem read might fail | `try { readdir() } catch { return [] }` ← fine | — |
| JSON from WebSocket has null fields | `json['name'] as String? ?? ''` ← fine | — |

**The test:** If `??` or `as any` exists because "SDK used to return something different" — remove it. If it exists because "runtime operation can genuinely fail" — keep it.

## SDK-Specific Notes

- **Claude Code** (`@anthropic-ai/claude-agent-sdk`): Model aliases (sonnet/opus/haiku). New version of same tier = no code change. New tier = add to model union + enum + picker. Docs in `reference/cc-docs/`.
- **OpenCode** (`@opencode-ai/sdk/v2`): Fully dynamic models from `provider.list()`. SDK returns `{ data, error }` wrapper — always destructure `.data`.
- **Codex** (`codex app-server` child process): JSON-RPC over stdio. Bridge talks via `request(method, params)` and `notify(method, params)`.
- **Pi** (`@earendil-works/pi-coding-agent` 1.1.0, with `@earendil-works/pi-ai` / `pi-agent-core`, exact pins): Event-driven `AgentSession` with `AgentSessionEvent` streaming. Dynamic models via `ModelRuntime` — it replaced the removed `AuthStorage` / `ModelRegistry.create`, and `createAgentSession` now takes `{ modelRuntime }`. Models/auth come from the user's `~/.pi/agent/auth.json`. Connector code lives in `connectors/pi/` behind the 36-line `connectors/pi.ts` facade; extension UI bridge (`pi_extension_ui.ts`) relays dialog/confirm/select prompts to the app.
- **Pi Durable** (`@earendil-works/pi-durable` 1.1.0, **experimental**): a crash-durable re-run of the Pi backend on the durable `Harness` + JSONL storage, not `AgentSession`. One process owns a storage at a time (own lock file); JSONL-only under Bun. Backend notes and gotchas: `docs/architecture/backends/pi-durable.md`.

### SDK Trust Order (Claude Code)

1. Ensure SDK is current: `cd packages/bridge && bun update @anthropic-ai/claude-agent-sdk`
2. `reference/cc-docs/` — official API docs (primary reference)
3. Installed `.d.ts` files — actual compiled types (trust if docs disagree)
4. `reference/claude-code/` CHANGELOG — CLI changes only, not SDK

### SDK Sync

- `./reference/sync-sdks.sh --all` — thin redirect to `reference/sync.sh --all`: pulls the 4 SDK reference repos into `reference/` (claude-code, codex, opencode, pi → `pi-mono`), updates CC npm, writes `reference/<date>_sdk-changes.md`
- `./reference/generate-codebase-map.sh` — static architecture reference with line counts → `reference/codebase-map.md`
- `./reference/sync-refs.sh --all` — thin redirect to `reference/sync.sh --refs`: pulls competitor/reference repos, Cursor docs, OneContext

## Build Commands

```bash
# Flutter
flutter pub get && flutter run              # Install + run on device
flutter test test/foo_test.dart             # Single test
flutter analyze                              # Static analysis
dart format .                                # Format all Dart files

# Bridge (Bun 1.3.5)
cd packages/bridge && bun install && bun dev  # Dev with hot reload
bun run typecheck                             # tsc --noEmit (local TypeScript 7)
bun run lint                                  # biome check src/
bun test                                      # Bun test runner
broski-bridge --attach                       # Attach to existing agent instance
broski install                               # Register broski-link as a launchd/systemd service
broski-link pair                             # Show the QR v2 pairing code
broski-link status                           # Machine, bridge, relay and session status
broski-bridge doctor                         # Diagnose environment
```

### CI (`.github/workflows/ci.yml`)

- **bridge:** Bun 1.3.5, `bun install --frozen-lockfile` (bridge `bun.lock` is tracked), `bun run typecheck`, `bunx biome check src/`, `bun test`.
- **flutter:** Flutter 3.38.5, `dart format --set-exit-if-changed lib test`, `flutter analyze`, `flutter test`.

## Test Hygiene

- **Never let a test touch real user data.** Tests must not read or write `~/.pi`, `~/.broski`, `~/.claude`, or `~/.codex`. Inject temp roots instead: config read/write take an explicit path, and the Pi connector accepts a `sessionRoot`. Real user dirs belong to the running bridge, never to a test.
- **Bound long-running / real-data scripts** (session scans, index rebuilds) with a memory watchdog. A Pi session-stats scan over 3,217 real sessions once reached **38 GB RSS** before it was rewritten to stream JSONL through a bounded pool (`utils/bounded-pool.ts`).

## Coding Conventions

- 2-space indentation, trailing commas where they improve formatting
- `UpperCamelCase` types, `lowerCamelCase` variables/functions, `snake_case.dart` files
- Error handling at real I/O boundaries (network, filesystem, user input), not defensive null-checks for impossible states
- Riverpod for state: `FutureProvider.family` for read-only lists, `StateNotifierProvider` for mutable state
- Bottom sheets via `DetailSheet.show()` with `Consumer` for `ref` access

## Key Patterns

- **Thin client:** App renders UI only. All AI logic stays on Mac.
- **RTT-adaptive batching:** Event streaming adjusts to connection latency (4ms local → 150ms high-latency).
- **Stale-while-revalidate:** Show cached data immediately, refresh in background. Providers check `isOfflineMode` → cache fallback on error.
- **Extension pattern:** `bridge_service.dart` is 295 lines of core. All agent methods live in 41 extension files in `services/bridge/`.
- **Handler delegation:** `server.ts` routes to 101 handler files. New cases get a new handler file + 1-line route in server.ts.
- **Snapshot-first attach (Pi Durable):** a reconnecting client gets the harness snapshot, not a replay buffer — the WS `set_view` attach streams `runtime_state` + `runtime_event` and every later commit batch follows.
