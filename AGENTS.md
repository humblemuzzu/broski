# Repository Guidelines

## What Broski Is

Broski is a **mobile app that gives you full remote control of AI coding agents running on your computer** from your phone. It connects to 4 agent backends through a bridge server:

```
Phone (Flutter) ←TLS WebSocket→ Bridge (Bun/TS on your Mac) ←SDK→ {Claude Code, OpenCode, Codex, Pi}
```

- **Bridge** (`packages/bridge/`) — TypeScript server on the user's dev machine. Connects to local AI agents via their SDKs, exposes WebSocket + HTTP API.
- **Flutter app** (`lib/`) — iOS/Android app. Renders UI only; all AI logic stays on Mac.
- **Connection methods:** Local WiFi, Tailscale (mesh VPN), Tailscale Funnel (public HTTPS via .ts.net).
- **Auth layers:** Bridge auth token (from QR), cloud session token (Convex/RevenueCat), TLS cert pinning.
- **509 Dart files** (~137K LOC), **217 TypeScript files** (~53K LOC).

### Core features that are INTENTIONAL, not vulnerabilities:
- **PTY / terminal access from the phone.** This is a primary feature. Users open terminal sessions, type commands, see output. Do NOT flag this as a security issue or suggest blocking it.
- **Command execution from the app.** The app sends commands to AI agents (Claude Code, Codex, OpenCode, Pi) and to the shell. This is the product. Do NOT suggest removing or restricting command execution.
- **File reading/writing from the phone.** Users browse, read, and edit files on their dev machine through the app. This is intentional.
- **AI agent control.** Users chat with AI agents, approve/reject permission prompts, and manage coding sessions. The bridge is the relay between phone and agents.
- **QR code pairing.** The QR code displayed in the user's terminal contains the auth token + connection info. This is the pairing mechanism (like SSH keys). The QR is only visible on the user's own screen.

### The architecture (so you understand the threat model):
- **Bridge** (`packages/bridge/`) = TypeScript server running on the user's own dev machine. It connects to local AI agents and exposes a WebSocket + HTTP API.
- **Flutter app** (`lib/`) = iOS/Android app that connects to the bridge over TLS WebSocket. Authenticated via token from QR code + cloud session (Convex).
- **Connection methods:** Local WiFi, Tailscale (private mesh VPN), Tailscale Funnel (public HTTPS via .ts.net).
- **Auth layers:** Bridge auth token (from QR), cloud session token (from Convex/RevenueCat entitlement), TLS cert pinning (SHA-256 fingerprint from QR).

### Security context for audits:
- This is a **personal dev tool**, not a multi-tenant SaaS. The user owns both the phone and the machine.
- Bearer token auth is standard for this category (same as VS Code tunnels, ngrok, SSH keys).
- The bridge deliberately has broad filesystem and process access because that is its job.
- Web app (`web-app/`) exists but is NOT launched yet. Bridge serves its static assets without auth (standard SPA behavior) but all API/WS endpoints require auth.
- Compiled production binaries disable all debug flags, force TLS, hardcode entitlement timings, and ignore env overrides that could weaken security.

### What IS worth auditing:
- Auth token lifecycle (rotation, storage, transmission security)
- TLS enforcement and cert pinning correctness
- Path traversal protections (realpath, symlink defense, base path checks)
- License/entitlement bypass attempts
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

4 different agent SDKs, each with its own event types, session models, and streaming protocols. Without abstraction, every feature needs 4 separate implementations.

### The Solution: BroskiRuntimeEvent

A unified event stream that normalizes all 4 backends into one type system. The Flutter app receives `BroskiRuntimeEvent`s and doesn't care which backend produced them.

**Bridge side** (`packages/bridge/src/types/runtime.ts`):
```typescript
type BroskiBackend = "opencode" | "claude-code" | "codex" | "pi";

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
| Claude Code | `runtime/claude-code-runtime-event-mapper.ts` (262 lines) | `runtime/claude-code-runtime-read-models.ts` (103 lines) |
| OpenCode | `runtime/opencode-runtime-event-mapper.ts` (417 lines) | `runtime/opencode-runtime-read-models.ts` (97 lines) |
| Codex | `runtime/codex-runtime-event-mapper.ts` (620 lines) | `runtime/codex-runtime-read-models.ts` (108 lines) |
| Pi | `runtime/pi-runtime-event-mapper.ts` (157 lines) | `runtime/pi-runtime-read-models.ts` (117 lines) |

Plus shared: `runtime/stream-contract.ts` (103), `runtime/shared.ts` (27), and bootstrap files for Pi.

**When adding a new event type:** Add it to `types/runtime.ts`, implement mapping in each backend's mapper that emits it, add the Dart model to `models/runtime/runtime_event.dart`, and handle it in the Flutter `runtime_event_reducer.dart`.

### Flutter Side

Dart models in `lib/models/runtime/`:
- `runtime_event.dart` (583 lines) — sealed class with all 16 event types
- `runtime_state.dart` (170 lines)
- `runtime_capabilities.dart` (73 lines)
- `runtime_session_summary.dart` (91 lines)
- `runtime_model_summary.dart` (68 lines)

Provider layer in `lib/providers/chat/runtime_*` (22 files, 6,919 lines):
- `runtime_chat_ingest.dart` (649) — main ingestion pipeline
- `runtime_event_reducer.dart` (306) — reduces events into state updates
- `runtime_common_reducer.dart` (403) — shared reduction logic
- `runtime_cx_handlers.dart` (594) — Codex-specific event handling
- `runtime_oc_message_handler.dart` (521) / `runtime_oc_part_handler.dart` (383) — OpenCode handling
- `runtime_cc_system_messages.dart` (421) / `runtime_cc_metadata_handler.dart` (288) — Claude Code handling
- `runtime_permission_handler.dart` (354) — permission request flow
- `runtime_event_models.dart` (162) / `runtime_common_models.dart` (143) — shared data types

### The Unified Handler

`packages/bridge/src/handlers/unified.ts` (363 lines) — instead of per-agent messages (`cc_list_sessions`, `cx_list_threads`, `pi_list_sessions`), the app sends ONE message with a `backend` parameter:

```
{ type: "unified_list_sessions", backend: "codex", cwd: "..." }
→ { type: "unified_sessions", backend: "codex", data: [...], requestId: "..." }
```

Old per-agent messages still work for backward compatibility. New features should use unified messages.

### Supporting Infrastructure

| Component | File | Purpose |
|-----------|------|---------|
| Send queue | `utils/runtime-send-queue.ts` (106) | Batches runtime events, RTT-adaptive |
| Replay buffer | `utils/runtime-replay-buffer.ts` (80) | Buffers events for reconnection replay |
| Replay tracker | `lib/services/bridge/runtime_replay_tracker.dart` | Flutter-side replay handling |
| Bridge runtime | `lib/services/bridge/bridge_runtime.dart` | Flutter→bridge runtime API |
| Bridge unified | `lib/services/bridge/bridge_unified.dart` | Flutter→bridge unified API |

## ⛔ MODULAR CODE ARCHITECTURE — MANDATORY

Every edit must make the codebase more modular, not less. New code goes in new files. Existing large files are frozen — you delegate, not add.

### 🚫 FROZEN FILES — DO NOT ADD LINES TO THESE

**Bridge (TypeScript):**

| File | Lines | What it has | Where new code goes |
|------|-------|-------------|-------------------|
| `packages/bridge/src/types.ts` | 3,400 | All type definitions, ClientMessage/ServerMessage unions | `types/runtime.ts`, `types/codex.ts`, `types/pi.ts` |
| `packages/bridge/src/connectors/claude-code.ts` | 3,293 | All CC connector logic | `connectors/claude-code/` (stream-supplemental-events, model-normalization, cc-session-stats already extracted) |
| `packages/bridge/src/server.ts` | 3,160 | Routing + remaining direct handlers | `handlers/{domain}.ts` (82 handler files already extracted) |
| `packages/bridge/src/connectors/opencode.ts` | 1,846 | All OC connector logic | `connectors/opencode/` (oc-sqlite, session-list already extracted) |

**Flutter (Dart):**

| File | Lines | What it has | Where new code goes |
|------|-------|-------------|-------------------|
| `lib/screens/chat_screen.dart` | 2,114 | Main chat screen build + routing | `lib/screens/sheets/` (50 files), `lib/screens/chat/` (39 files), `lib/screens/dialogs/` (9 files) |
| `lib/screens/settings_screen.dart` | 1,653 | All settings | Extract sections to `lib/screens/sheets/` or dedicated screens |
| `lib/screens/claude_code_settings_screen.dart` | 1,502 | CC settings | Extract to `lib/screens/sheets/cc_*.dart` |
| `lib/screens/projects_screen.dart` | 1,362 | Project management | Extract sections |
| `lib/screens/browse_screen.dart` | 1,312 | File browser | Extract sections |
| `lib/screens/sessions_screen.dart` | 1,131 | Session list + filters | `lib/screens/sessions/` (9 files) |

### ✅ Graduated Files (previously frozen, now clean — keep them lean)

These were 5,000–13,000 lines. Extraction is done. Keep adding to their extracted subdirectories, not back to these files.

| File | Was | Now | Where the code went |
|------|-----|-----|-------------------|
| `lib/services/bridge_service.dart` | 5,058 | 303 | `lib/services/bridge/` (38 extension files) |
| `lib/providers/chat_provider.dart` | 5,092 | 265 | `lib/providers/chat/` (22 files) |
| `lib/screens/onboarding_screen.dart` | 4,314 | 114 | `lib/screens/onboarding/` (9 files, 2,634 lines) |
| `lib/models/claude_code.dart` | 2,759 | 21 (barrel) | `lib/models/claude_code/` (17 files, 4,039 lines) |

### ⚠️ WATCH LIST — Files over 400 lines (extract on next touch)

**Flutter widgets:**

| File | Lines | What to extract |
|------|-------|----------------|
| `lib/widgets/permission_rules_sheet.dart` | 1,658 | Item widgets → separate files |
| `lib/widgets/session_sidebar.dart` | 1,383 | Section widgets |
| `lib/widgets/power_sheet.dart` | 1,132 | Section widgets |
| `lib/widgets/permission_prompt.dart` | 948 | Action buttons, content sections |
| `lib/widgets/chat/cli_input_bar.dart` | 753 | Sub-widgets |
| `lib/widgets/chat/compact_agent_card.dart` | 728 | Sub-widgets |
| `lib/widgets/chat/compact_edit_card.dart` | 616 | Sub-widgets |
| `lib/widgets/file_tagging.dart` | 606 | Sub-widgets |
| `lib/widgets/sessions/session_helpers.dart` | 590 | Helper functions |
| `lib/widgets/question_prompt_sheet.dart` | 582 | Sub-widgets |
| `lib/widgets/message_bubble.dart` | 576 | Sub-widgets |
| `lib/widgets/onboarding_widgets.dart` | 575 | Step widgets |
| `lib/widgets/chat/compact_tool_card.dart` | 528 | Sub-widgets |
| `lib/widgets/chat/input_bar_content.dart` | 521 | Sub-widgets |
| `lib/widgets/chat/floating_input_bar.dart` | 516 | Sub-widgets |
| `lib/widgets/voice_recording_sheet.dart` | 503 | Sub-widgets |
| `lib/widgets/chat/floating_header.dart` | 482 | Sub-widgets |
| `lib/widgets/chat/adaptive_table.dart` | 452 | Sub-widgets |
| `lib/widgets/chat/pi_actions_content.dart` | 413 | Sub-widgets |

**Flutter providers:**

| File | Lines |
|------|-------|
| `lib/providers/connection_provider.dart` | 1,464 |
| `lib/providers/claude_code_provider.dart` | 967 |
| `lib/providers/sessions_provider.dart` | 878 |
| `lib/providers/chat/chat_session_state.dart` | 706 |
| `lib/providers/chat/runtime_chat_ingest.dart` | 649 |
| `lib/providers/chat/runtime_cx_handlers.dart` | 594 |
| `lib/providers/chat/runtime_oc_message_handler.dart` | 521 |
| `lib/providers/codex_provider.dart` | 468 |
| `lib/providers/chat/runtime_cc_system_messages.dart` | 421 |
| `lib/providers/chat/runtime_common_reducer.dart` | 403 |

**Flutter screens/sheets:**

| File | Lines |
|------|-------|
| `lib/screens/sheets/git_panel_sheet.dart` | 1,131 |
| `lib/screens/sheets/pi_tree_sheet.dart` | 706 |
| `lib/screens/sheets/cc_tools_sheet.dart` | 685 |
| `lib/screens/sheets/pi_session_sidebar_sheet.dart` | 613 |
| `lib/screens/sheets/pi_settings_sheet.dart` | 568 |
| `lib/screens/mcp_servers_screen.dart` | 1,094 |
| `lib/screens/subagents_screen.dart` | 1,074 |
| `lib/screens/appearance_screen.dart` | 1,027 |
| `lib/screens/subscription_usage_screen.dart` | 929 |
| `lib/screens/account_screen.dart` | 900 |
| `lib/screens/scan_screen.dart` | 884 |
| `lib/screens/skills_screen.dart` | 876 |
| `lib/screens/terminal_screen.dart` | 842 |

**Flutter services:**

| File | Lines | What to extract |
|------|-------|----------------|
| `lib/services/storage_service.dart` | 1,388 | `lib/services/storage/` (only 1 file extracted so far) |
| `lib/services/pi_bridge_service.dart` | 756 | Methods → `lib/services/bridge/bridge_pi_*.dart` extensions |
| `lib/services/websocket_service.dart` | 626 | Reconnection logic, message handling |

**Bridge:**

| File | Lines | What to extract |
|------|-------|----------------|
| `packages/bridge/src/handlers/pi_features.ts` | 743 | Split into `pi_sessions.ts`, `pi_config.ts`, `pi_chat.ts` |
| `packages/bridge/src/connectors/pi.ts` | 817 | `translateEvent()` switch → `connectors/pi/pi-events.ts` (already 308 lines extracted) |
| `packages/bridge/src/connectors/codex-fs.ts` | 643 | Split file ops vs search |
| `packages/bridge/src/handlers/git/git_commands.ts` | 604 | Split into git_operations, git_diff, etc. |
| `packages/bridge/src/runtime/codex-runtime-event-mapper.ts` | 620 | Split by event category |
| `packages/bridge/src/index.ts` | 1,503 | Extract CLI entry, startup logic |

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

### Flutter (`lib/`) — 509 files, ~137K LOC

```
lib/
  screens/                          ← 54 screen files (34,175 lines)
    sheets/                         ← 50 extracted sheets (12,209 lines)
    chat/                           ← 39 extracted chat helpers (5,251 lines)
    sessions/                       ← 9 extracted session views (4,602 lines)
    dialogs/                        ← 9 extracted dialogs (921 lines)
    onboarding/                     ← 9 step files (2,634 lines)
    pi/                             ← extension UI handler (272 lines)
    opencode/                       ← OC-specific screen widgets (589 lines)
  widgets/                          ← 127 widget files (30,195 lines)
    chat/                           ← chat-specific widgets (compact cards, input bar, headers)
    sessions/                       ← session card widgets (15 files, 3,139 lines)
    pi/                             ← Pi-specific widgets (tree node, queue indicator)
    git/                            ← git file tile, diff inline, status badge
    file_viewers/                   ← file content rendering
    sidebar/                        ← sidebar widgets
    opencode/                       ← OC-specific widgets
  services/                         ← 12 service files (4,217 lines at top level)
    bridge/                         ← 38 bridge extension files (6,425 lines)
    storage/                        ← storage extensions (1 file so far)
    websocket/                      ← WebSocket connector, JSON decoder
  providers/                        ← ~30 provider files (7,517 lines at top level)
    chat/                           ← 22 files (6,919 lines) — runtime event processing
    sessions/                       ← 2 runtime session handlers
    codex/                          ← 4 Codex-specific providers
    connection/                     ← endpoint racer, error policy
  models/                           ← data models (13,597 lines)
    claude_code/                    ← 17 CC model files (4,039 lines)
    runtime/                        ← 6 runtime model files (990 lines)
    codex/                          ← 3 Codex model files (257 lines)
  theme/                            ← design system, semantic color tokens
  utils/                            ← shared utilities
  config/                           ← app configuration
```

### Bridge (`packages/bridge/src/`) — 217 files, ~53K LOC

```
packages/bridge/src/
  server.ts                         ← 3,160 lines — routing, delegates to handlers
  types.ts                          ← 3,400 lines — ClientMessage/ServerMessage unions
  index.ts                          ← 1,503 lines — CLI entry + startup
  connectors/                       ← 16 files (9,231 lines)
    claude-code/                    ← stream-supplemental-events, model-normalization, cc-session-stats
    opencode/                       ← oc-sqlite, session-list
    codex/                          ← cx-sqlite, cx-session-stats
    pi/                             ← pi-events, pi-external-tail, pi-session-stats
    claude-code.ts                  ← 3,293 lines — FROZEN, extract to subdirectory
    opencode.ts                     ← 1,846 lines — FROZEN, extract to subdirectory
    pi.ts                           ← 817 lines — watch, partially extracted
    codex.ts                        ← 331 lines
    codex-fs.ts                     ← 643 lines
    pi_extension_ui.ts              ← 279 lines
  handlers/                         ← 82 files (12,317 lines)
    git/                            ← 10 files — git_commands, github, parse, security
    codex/                          ← 16 files — cx_threads, cx_chat, cx_files, cx_workspace, cx_agents, cx_plugins, cx_skills, cx_mcp, cx_fuzzy_search, etc.
    cc_*.ts                         ← 16 files — cc_chat, cc_sessions, cc_config, cc_skills, cc_hooks_mcp, cc_commands, cc_plugins, cc_custom_tools, cc_subagents, cc_memory, cc_live_session, cc_elicitation, cc_permission_hook, cc_hook_installer, cc_ask_user_question, cc_routing
    pi_*.ts                         ← 6 files — pi_features, pi_tree, pi_stream_delivery, pi_tools, pi_bash, pi_session_messages
    unified.ts                      ← 363 lines — unified backend-agnostic handler
    auth.ts, devices.ts, misc.ts    ← shared handlers
    session_view.ts, session-stats.ts
  runtime/                          ← 11 files (2,060 lines)
    *-runtime-event-mapper.ts       ← 4 per-backend event mappers
    *-runtime-read-models.ts        ← 4 per-backend read models
    stream-contract.ts              ← shared streaming contract
    shared.ts                       ← shared types
    pi-runtime-bootstrap.ts         ← Pi bootstrap
  types/                            ← 3 files (591 lines)
    runtime.ts                      ← BroskiRuntimeEvent, BroskiRuntimeState, BroskiBackend
    codex.ts                        ← Codex-specific types
    pi.ts                           ← Pi-specific types
  pty/                              ← 5 files (1,213 lines) — runtime, native-pty, manager, output, types
  license/                          ← 8 files (1,283 lines) — integrity, hardening, fallback, crypto, store
  doctor/                           ← 15 files (1,224 lines) — checks for agents, network, security, daemon
  config/                           ← 4 files — schema, defaults, read-write
  logging/                          ← 2 files — structured logger, redaction
  wizard/                           ← 9 files (1,454 lines) — onboarding, troubleshoot, steps
  utils/                            ← 7 files — file-tailer, runtime-send-queue, runtime-replay-buffer, codex-compat-retry, message-buffer
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
- `lib/screens/sheets/cx_model_sheet.dart` (255 lines) — sheet from chat_screen ✅
- `lib/screens/sheets/cx_apps_sheet.dart` (165 lines) — sheet from chat_screen ✅
- `lib/screens/sheets/git_branch_sheet.dart` (109 lines) — sheet from chat_screen ✅
- `packages/bridge/src/handlers/git/` (10 files) — handlers from server.ts ✅
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
- **Pi** (`@mariozechner/pi-coding-agent`): Event-driven `AgentSession` with `AgentSessionEvent` streaming. Dynamic models via `ModelRegistry`. Has extension UI bridge (`pi_extension_ui.ts`) for dialog/confirm/select prompts relayed to app.

### SDK Trust Order (Claude Code)

1. Ensure SDK is current: `cd packages/bridge && bun update @anthropic-ai/claude-agent-sdk`
2. `reference/cc-docs/` — official API docs (primary reference)
3. Installed `.d.ts` files — actual compiled types (trust if docs disagree)
4. `reference/claude-code/` CHANGELOG — CLI changes only, not SDK

### SDK Sync

- `./reference/sync-sdks.sh --all` — pulls 4 SDK repos, updates CC npm, generates `sdk-changes.md`
- `./reference/generate-codebase-map.sh` — static architecture reference with line counts
- `./reference/sync-refs.sh --all` — pulls competitor/reference repos

## Build Commands

```bash
# Flutter
flutter pub get && flutter run              # Install + run on device
flutter test test/foo_test.dart             # Single test
flutter analyze                              # Static analysis
dart format .                                # Format all Dart files

# Bridge
cd packages/bridge && bun install && bun dev  # Dev with hot reload
broski-bridge --attach                       # Attach to existing agent instance
broski-bridge --funnel                       # Tailscale Funnel (public HTTPS)
broski-bridge doctor                         # Diagnose environment
```

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
- **Extension pattern:** `bridge_service.dart` is 303 lines of core. All agent methods live in 38 extension files in `services/bridge/`.
- **Handler delegation:** `server.ts` routes to 82 handler files. New cases get a new handler file + 1-line route in server.ts.
