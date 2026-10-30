# Repository Guidelines

## What Broski Is

Broski is a **mobile app that gives you full remote control of AI coding agents running on your computer** from your phone. It connects to 5 agent backends (4 stable, 1 experimental) through a bridge server:

```
Phone (Flutter + Rust core) ←Broski Link (Noise e2e; LAN or relay)→ broski-link daemon (Rust, your Mac) ←unix socket→ Bridge (Bun/TS) ←SDK→ {Claude Code, OpenCode, Codex, Pi, Pi Durable}
```

- **Bridge** (`packages/bridge/`) — TypeScript server on the user's dev machine. It listens before a managed OpenCode start finishes (that start runs beside the listeners; a request that needs OpenCode waits for it up to 30 s, then gets `OpenCode unavailable: <reason>` — `server/opencode-slot.ts`, `server/opencode-gate.ts`). Connects to local AI agents via their SDKs. Serves the app protocol to the daemon over the unix socket `~/.broski/link/bridge.sock`, where every upgrade must quote the key the daemon wrote to `~/.broski/link/bridge.key` (`x-broski-link-key`, 32 random bytes hex, `0600`, rewritten by the daemon at every start and re-read by the bridge per upgrade — `server/link-key.ts`); its TCP listener is loopback-only (127.0.0.1) and exists for local things only: the CC permission hook, the dashboard, `/proxy/<port>`.
- **The bridge's environment** — a service start inherits only `PATH` and `HOME` from launchd/systemd, so at startup the bridge asks the user's login shell once (`platform/shell-env.ts`: one interactive `env -0` between markers, 10 s timeout, process-group kill) and runs every agent and PTY with the result. A `~/.zshrc` change applies on the next bridge start (`broski restart`, or the app's restart button). A compiled binary never takes `BROSKI_*`/`BUN_*` from a shell: those stay the service manager's and config's.
- **broski-link daemon** (`packages/link/daemon/`, Rust) — runs as a launchd (macOS) / systemd (Linux) service installed by `broski install`; supervises the bridge, terminates the Noise session with each paired phone, and dials the relay. Windows is not supported.
- **Relay** (`packages/link/relay/`) — blind rendezvous the phone and daemon both dial out to. It forwards encrypted frames and never sees plaintext.
- **Flutter app** (`lib/`, Rust core via `packages/link_dart/`) — iOS/Android app. Renders UI only; all AI logic stays on Mac.
- **Connection:** direct over the LAN when reachable, otherwise through the relay. No VPN, tunnel, port forwarding or public exposure of the bridge.
- **Auth layers:** QR v2 pairing (`broski://pair?v=2&h=<fingerprint>&s=<one-time secret>&e=<expiry>&n=<name>[&r=<relay>][&l=<lan>]`), Noise end-to-end encryption (hybrid X25519 + ML-KEM-768) with the machine fingerprint pinned from the QR, and per-device revocable authorisation on the daemon. Design docs: `docs/architecture/connectivity-v2/`.
- **760 Dart files** (~163K LOC under `lib/`, of which 32 files and ~14K LOC are the generated contract in `lib/contract/generated/` and 104 files and ~10K LOC the app core in `lib/agent/`), **546 TypeScript files** (~68K LOC under `packages/bridge/src/`, tests excluded).
- **OpenCode** is wired to the 1.x SDK (`@opencode-ai/sdk` 1.3.17). The installed OpenCode CLI is 2.x (v2.1.4: new storage under `$XDG_DATA_HOME|~/.local/share/opencode`, one registered service). The integration is slated for a rewrite; until then treat OpenCode behaviour against a 2.x CLI as unverified.
- **`pi-durable`** is the experimental 5th backend (`@earendil-works/pi-durable@1.4.0`, behind an Experimental toggle in the app). See `docs/architecture/backends/pi-durable.md`.

### Core features that are INTENTIONAL, not vulnerabilities:
- **PTY / terminal access from the phone.** This is a primary feature. Users open terminal sessions, type commands, see output. Do NOT flag this as a security issue or suggest blocking it.
- **Command execution from the app.** The app sends commands to AI agents (Claude Code, Codex, OpenCode, Pi) and to the shell. This is the product. Do NOT suggest removing or restricting command execution.
- **File reading/writing from the phone.** Users browse, read, and edit files on their dev machine through the app. This is intentional.
- **AI agent control.** Users chat with AI agents, approve/reject permission prompts, and manage coding sessions. The bridge is the relay between phone and agents.
- **QR code pairing.** `broski-link pair` shows a QR v2 code in the user's terminal. It carries the machine fingerprint, a one-time pairing secret and an expiry, plus relay/LAN hints. This is the pairing mechanism (like SSH keys). The QR is only visible on the user's own screen, and the secret is consumed by the first successful pairing.

### The architecture (so you understand the threat model):
- **Bridge** (`packages/bridge/`) = TypeScript server running on the user's own dev machine. It connects to local AI agents. Phones never reach it directly: it listens on a unix socket for `broski-link` and on 127.0.0.1 (TLS + local bearer token) for the CC permission hook, the dashboard and `/proxy/<port>`.
- **broski-link daemon** (`packages/link/daemon/`) = the only network-facing process on the Mac. It accepts Noise sessions from paired phones over the LAN or the relay and pipes their traffic to the bridge.
- **Flutter app** (`lib/`) = iOS/Android app. Pairs by scanning the QR v2 code, then talks to the daemon through the Rust Link core (`packages/link_dart/`).
- **Connection methods:** direct LAN, or the blind relay (`packages/link/relay/`) when the phone is away. The relay sees ids, timing, sizes and push metadata; never plaintext.
- **Auth layers:** one-time pairing secret from the QR, Noise end-to-end encryption with the pinned machine fingerprint, per-device authorisation and revocation on the daemon (`broski-link devices` / `revoke`), and the bridge link key: the daemon's own key on every unix-socket upgrade, so a socket file reachable by another process on the machine is not on its own enough (`server/link-key.ts`; a bridge started without `--link-key-file` is the dev case and says so once).

### Security context for audits:
- This is a **personal dev tool**, not a multi-tenant SaaS. The user owns both the phone and the machine.
- A one-time pairing secret plus a Noise end-to-end channel with a pinned machine fingerprint is the SSH-style trust model for this category; the relay is untrusted by design.
- The bridge deliberately has broad filesystem and process access because that is its job.
- Web app (`web-app/`) exists but is NOT launched yet. Bridge serves its static assets without auth (standard SPA behavior) but all API/WS endpoints require auth.
- Compiled production binaries disable all debug flags, force TLS on the loopback listener, and ignore env overrides that could weaken security.

### What IS worth auditing:
- Pairing lifecycle (one-time secret consumption, expiry, device revocation, relay token storage)
- Noise handshake correctness and relay blindness (what the relay can and cannot see)
- Loopback listener hardening (TLS, local bearer token, bind address) for the CC permission hook
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

## Backend contract (the rebuild, Phase 1)

The backend-agnostic contract that replaces the runtime abstraction below lives in `packages/bridge/src/contract/`. Its spec is [`docs/architecture/contract/README.md`](docs/architecture/contract/README.md). Nothing is wired to it yet: Phase 2 builds the bridge core on it, Phase 3 the Flutter core, Phase 4 one adapter per backend under `packages/bridge/src/backends/<id>/`. Hard rules:

- **The UI never branches on the backend**, only on `Capabilities` / `SessionCapabilities` and the shape of the data. Backend extras arrive as typed `extension` events and `backend.call` ops.
- **Adapters are reached only through the contract** (`AgentBackend`). The core never imports `backends/<id>/`; an adapter never sees sockets, phones or the wire.
- **The contract is a leaf**: `src/contract/` imports only `zod` and itself (its `testing/` may add `bun:test`); `src/backends/<id>/` imports only the contract, itself, `node:` built-ins (not `node:module`) and its own SDK; `src/backends/pi-shared/` is the one shared directory, for `pi` and `pi-durable`. Every import specifier is a plain string. `bun run check:layers` enforces it in CI.
- **Expected failures are values**: every adapter method that can fail returns `{status: "accepted", …} | Rejected`; `status()` never fails (its failures are `issues`). Every wire string, list and map is bounded (`src/contract/limits.ts`).
- **Generated code is never edited by hand**: `lib/contract/generated/`, `test/contract/generated/`, `test/contract/fixtures/` and `src/contract/contract.schema.json` come from the zod schemas via `bun run contract:gen`; CI runs `bun run contract:check`.
- **The protocol has a minor** (`PROTOCOL_VERSION`, 1.1): what a later minor added (`ADDED_IN_MINOR`) goes only to a client whose `hello` named it, and an adapter whose backend names a form field `__proto__` maps it to another key (`FieldKey` refuses it).
- **Every adapter passes the conformance suite** (`runConformance` in `src/contract/testing/`, 28 rules, each proven to fail by the broken adapters in `src/__tests__/contract_negative_*.test.ts`), and every answer goes through `answerProblem` before it reaches a backend.
- **Pi's adapter** (`src/backends/pi/`, Phase 4) is served only with `BROSKI_CONTRACT_PI=1` in a dev bridge (`server/contract-backends.ts`); what it is, its decisions and open questions: [`docs/architecture/backends/pi/README.md`](docs/architecture/backends/pi/README.md).

## Bridge core (the rebuild, Phase 2)

The core that speaks the contract lives in `packages/bridge/src/core/`; its doc is [`docs/architecture/core/README.md`](docs/architecture/core/README.md). Production registers no backend yet (Phase 4 does, one adapter at a time). Rules:

- **Contract messages travel as `{"type":"contract","message":…}`** on the same sockets as the old protocol, which owns every other frame type. The seam is `server/contract-seam.ts`; old code knows the core only through the seam's calls: in `server.ts` one `createContractSeam(…)` line, `contract` handed to three dependency objects, and `contract.start()` once the listeners are bound (backends start after the bridge listens); `server/messages.ts` hands an owned frame to the core before the old prototype-poison check; `server/connections.ts` calls `disconnect` on close and `refuse` when the rate limit refuses a contract frame; `server/shutdown.ts` calls `stop`. Do not route contract messages through `routing/`.
- **`src/core/` imports only itself, the contract (not its test kit), `zod` and `CORE_INFRASTRUCTURE`** (`state/bounded-map`, `transport/send-limits`, which may import only `zod` and each other; `scripts/contract-gen/layers.ts`). `bun run check:layers` enforces it. Adapters reach the core only through the `AgentBackend` they give the registry.
- **Every contract request gets exactly one answer**, within 120 s even from an adapter that never answers; inbound frames are bounded (8 MiB, 50,000 JSON values, the contract's list and depth bounds) before the schema checks them.
- **No automatic answers.** An interaction ends only when a human answers or cancels it, or the backend withdraws it or lets it expire. Never add a timeout that answers for the user.
- **Keep-open**: a session with a run, a pending ask, a compaction, a retry or queued input stays open, viewed or not; only bridge shutdown closes a busy session.
- **Every frame fits the link** (`wire-fit.ts`): every contract message goes out through `fitMessage`/`fitEvent` (only the core's own short `error` answers skip it), and fitting never cuts ids, cursors or image bytes.
- **Tests drive the fake backend** (`__tests__/helpers/core-rig.ts`, `core-bridge.ts`) and break adapters by wrapping the fake (`adapt`, `helpers/core-adapters.ts`); they never mock the core. `bun run mutate:core` checks that the core's tests fail on every guard removed, except the equivalent mutants it lists with their reasons.

## App core (the rebuild, Phase 3)

The phone side of the contract lives in `lib/agent/`; its doc is [`docs/architecture/app-core/README.md`](docs/architecture/app-core/README.md). It is additive: the old screens keep working, and the new ones are reached only by a long press on the version line in Settings (debug builds). Rules:

- **`lib/agent/` never steers by backend.** Branch on `Capabilities`, `SessionCapabilities` and the data. `BackendId` members and backend-id strings appear only in `ui/backend_label.dart`, for display; `AgentType` never appears.
- **`lib/agent/` imports only** `dart:`, Flutter, Riverpod, the generated contract, itself, the theme, and the named infrastructure `tool/agent_core_check/import_rules.dart` lists, each with a `show` of only the names listed. `dart run tool/check_agent_core.dart` enforces both rules in CI; it catches accidents, not every determined bypass.
- **The reducer and the answer check are ports**, held equal to `session-reducer.ts` and `answer-check.ts` by fixtures the generator computes (`reducer_trace.json`, `answer_cases.json`). Change the TypeScript, regenerate, and the Dart tests say what to change; never write their expectations by hand. `dart run tool/format_differential.dart [--sweep all]` holds the string formats and patterns to Bun on a seeded corpus and on exhaustive sweeps (the app may pass what the bridge refuses, never the reverse); `dart run tool/mutate_agent_core.dart` checks that the agent tests fail on every guard removed, except the equivalent mutants it lists.
- **One client, one store.** Requests go through `ContractClient` (typed results, never a throw); session state through `sessionProvider(SessionRef)`. Do not add another request client.
- **Tests use the injected `AgentClock`** (`test/agent/support/manual_clock.dart`), the scripted bridge (`scripted_bridge.dart`) and a real controller; the e2e test runs the real daemon and `packages/bridge/scripts/dev-fake-bridge.ts`, which never ships.

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
| Claude Code | `runtime/claude-code-runtime-event-mapper.ts` (262) | `runtime/claude-code-runtime-read-models.ts` (86) |
| OpenCode | `runtime/opencode-runtime-event-mapper.ts` (417) | `runtime/opencode-runtime-read-models.ts` (80) |
| Codex | `runtime/codex-runtime-event-mapper.ts` (578) | `runtime/codex-runtime-read-models.ts` (90) |
| Pi | `runtime/pi-runtime-event-mapper.ts` (188) | `runtime/pi-runtime-read-models.ts` (159) |
| Pi Durable | `runtime/pi-durable-runtime-event-mapper.ts` (184) | `runtime/pi-durable-runtime-read-models.ts` (144) |

Plus shared: `runtime/stream-contract.ts` (120), `runtime/shared.ts` (27), `runtime/pi-runtime-bootstrap.ts` (49), and `runtime/pi-durable-partial-message.ts` (147) — the whole-block text diff Pi Durable needs because its `message_update.changes` is not a flat delta stream.

**When adding a new event type:** Add it to `types/runtime.ts`, implement mapping in each backend's mapper that emits it, add the Dart model to `models/runtime/runtime_event.dart`, and handle it in the Flutter `runtime_common_reducer.dart`.

### Flutter Side

Dart models in `lib/models/runtime/` (6 files, 1,046 lines):
- `runtime_event.dart` (605) — sealed class with all 16 event types
- `runtime_state.dart` (170)
- `runtime_capabilities.dart` (73)
- `runtime_session_summary.dart` (125)
- `runtime_model_summary.dart` (68)

Provider layer in `lib/providers/chat/` (26 files, 6,503 lines; 10 `runtime_*` files, 3,641 lines):
- `runtime_chat_ingest.dart` (661) — main ingestion pipeline
- `runtime_common_reducer.dart` (403) — reduces events into state updates
- `runtime_cx_handlers.dart` (383) — Codex-specific event handling
- `runtime_oc_message_handler.dart` (521) / `runtime_oc_part_handler.dart` (383) — OpenCode handling
- `runtime_cc_system_messages.dart` (421) / `runtime_cc_metadata_handler.dart` (288) — Claude Code handling
- `runtime_permission_handler.dart` (354) — permission request flow
- `runtime_common_models.dart` (143) — shared data types

### The Unified Handler

`packages/bridge/src/handlers/unified.ts` (379 lines) — instead of per-agent messages (`cc_list_sessions`, `cx_list_threads`, `pi_list_sessions`), the app sends ONE message with a `backend` parameter:

```
{ type: "unified_list_sessions", backend: "codex", cwd: "...", limit: 100, before: "<cursor>" }
→ { type: "unified_sessions", backend: "codex", data: [...], hasMore: true, nextCursor: "...", requestId: "..." }
```

Old per-agent messages still work for backward compatibility. New features should use unified messages.

**Every session/thread list is paged** (`utils/session-list-page.ts`, one implementation for all of
`pi_sessions`, `cc_sessions`, `cx_threads`, OC `sessions` and `unified_sessions`): `limit` defaults to
100, is clamped to 500, rows are newest-modified first with `id` breaking ties, and `nextCursor` is a
cursor into that order. A request with neither `limit` nor `before` still gets the whole list.

**List rows carry previews, not transcripts**: any free-text preview field goes through
`sessionPreview()` (`utils/session-preview.ts`, `SESSION_PREVIEW_MAX_CHARS = 280`), which cuts on code
points. A list row is a list row; the full text belongs to a per-item read.

**A session list is never broadcast.** On a state change emit one row — `runtime_session_updated`
`{ backend, session }` or `runtime_session_removed` `{ backend, sessionId }` — and let the app upsert
its cached list. A whole list is only ever the reply to an explicit list request.

### Supporting Infrastructure

| Component | File | Purpose |
|-----------|------|---------|
| Send queue | `utils/runtime-send-queue.ts` (369) | Batches runtime events, RTT-adaptive |
| Replay buffer | `utils/runtime-replay-buffer.ts` (106) | Buffers events for reconnection replay (Pi Durable does NOT use it — its attach snapshot is the reconnect view) |
| Bounded pool | `utils/bounded-pool.ts` (28) | Caps concurrency (Pi session-stats enrichment) |
| Single-flight | `utils/single-flight.ts` (17) | Dedupes concurrent work on the same key |
| Session list cache | `connectors/pi/pi-session-list-cache.ts` (227) | Caches Pi session listings by directory fingerprint |
| Replay tracker | `lib/services/bridge/runtime_replay_tracker.dart` (41) | Flutter-side replay handling |
| Bridge runtime | `lib/services/bridge/bridge_runtime.dart` (56) | Flutter→bridge runtime API |
| Bridge unified | `lib/services/bridge/bridge_unified.dart` (150) | Flutter→bridge unified API |

## ⛔ MODULAR CODE ARCHITECTURE — MANDATORY

Every edit must make the codebase more modular, not less. New code goes in new files. Existing large files are frozen — you delegate, not add.

### 🚫 FROZEN FILES — DO NOT ADD LINES TO THESE

**Bridge (TypeScript):**

| File | Lines | What it has | Where new code goes |
|------|-------|-------------|-------------------|
| `packages/bridge/src/types.ts` | 28 | Barrel re-exporting `types/*.ts` (ClientMessage/ServerMessage unions) | `types/*.ts` (32 files: `types/runtime.ts`, `types/codex*.ts`, `types/pi*.ts`, …) |
| `packages/bridge/src/connectors/claude-code.ts` | 39 | Facade re-exporting `connectors/claude-code/` | `connectors/claude-code/` (31 files) |
| `packages/bridge/src/server.ts` | 373 | Server wiring; routing lives in `routing/` | `handlers/{domain}.ts` (106 handler files already extracted), `server/*.ts` (37 files) |
| `packages/bridge/src/connectors/opencode.ts` | 633 | OC connector class | `connectors/opencode/` (21 files, session-list already extracted) |

**Flutter (Dart):**

| File | Lines | What it has | Where new code goes |
|------|-------|-------------|-------------------|
| `lib/screens/chat_screen.dart` | 2,135 | Main chat screen build + routing | `lib/screens/sheets/` (52 files), `lib/screens/chat/` (52 files), `lib/screens/dialogs/` (9 files) |
| `lib/screens/settings_screen.dart` | 1,284 | All settings | Extract sections to `lib/screens/settings/`, `lib/screens/sheets/` or dedicated screens |
| `lib/screens/claude_code_settings_screen.dart` | 1,502 | CC settings | Extract to `lib/screens/sheets/cc_*.dart` |
| `lib/screens/projects_screen.dart` | 1,261 | Project management | Extract sections |
| `lib/screens/browse_screen.dart` | 1,312 | File browser | Extract sections |
| `lib/screens/sessions_screen.dart` | 1,233 | Session list + filters | `lib/screens/sessions/` (11 files) |

### ✅ Graduated Files (previously frozen, now clean — keep them lean)

These were 2,700–5,100 lines. Extraction is done. Keep adding to their extracted subdirectories, not back to these files.

| File | Was | Now | Where the code went |
|------|-----|-----|-------------------|
| `lib/services/bridge_service.dart` | 5,058 | 296 | `lib/services/bridge/` (52 extension files, 7,182 lines) |
| `lib/providers/chat_provider.dart` | 5,092 | 293 | `lib/providers/chat/` (26 files, 6,503 lines) |
| `lib/screens/onboarding_screen.dart` | 4,314 | 114 | `lib/screens/onboarding/` (10 files, 2,954 lines) |
| `lib/models/claude_code.dart` | 2,759 | 21 (barrel) | `lib/models/claude_code/` (17 files, 3,077 lines) |

### ⚠️ WATCH LIST — Files over 400 lines (extract on next touch)

Prioritised, not exhaustive. Recompute with `find lib packages/bridge/src \( -name '*.dart' -o -name '*.ts' \) -not -path '*__tests__*' | xargs wc -l | sort -rn`.

**Flutter widgets:**

| File | Lines | What to extract |
|------|-------|----------------|
| `lib/widgets/permission_rules_sheet.dart` | 1,660 | Item widgets → separate files |
| `lib/widgets/session_sidebar.dart` | 1,383 | Section widgets |
| `lib/widgets/power_sheet.dart` | 1,136 | Section widgets |
| `lib/widgets/permission_prompt.dart` | 936 | Action buttons, content sections |
| `lib/widgets/chat/compact_agent_card.dart` | 823 | Sub-widgets |
| `lib/widgets/chat/cli_input_bar.dart` | 753 | Sub-widgets |
| `lib/widgets/chat/compact_edit_card.dart` | 616 | Sub-widgets |
| `lib/widgets/file_tagging.dart` | 606 | Sub-widgets |
| `lib/widgets/sessions/session_helpers.dart` | 595 | Helper functions |
| `lib/widgets/question_prompt_sheet.dart` | 582 | Sub-widgets |
| `lib/widgets/onboarding_widgets.dart` | 575 | Step widgets |
| `lib/widgets/chat/input_bar_content.dart` | 537 | Sub-widgets |
| `lib/widgets/chat/compact_tool_card.dart` | 531 | Sub-widgets |
| `lib/widgets/message_bubble.dart` | 519 | Sub-widgets |
| `lib/widgets/chat/floating_input_bar.dart` | 516 | Sub-widgets |
| `lib/widgets/voice_recording_sheet.dart` | 503 | Sub-widgets |
| `lib/widgets/chat/floating_header.dart` | 483 | Sub-widgets |
| `lib/widgets/chat/adaptive_table.dart` | 452 | Sub-widgets |
| `lib/widgets/chat/pi_actions_content.dart` | 413 | Sub-widgets |
| `lib/widgets/project_tools_sheet.dart` | 408 | Sub-widgets |

**Flutter providers:**

| File | Lines |
|------|-------|
| `lib/providers/sessions_provider.dart` | 875 |
| `lib/providers/claude_code_provider.dart` | 718 |
| `lib/providers/chat/chat_session_state.dart` | 693 |
| `lib/providers/chat/runtime_chat_ingest.dart` | 661 |
| `lib/providers/chat/runtime_oc_message_handler.dart` | 521 |
| `lib/providers/codex_provider.dart` | 462 |
| `lib/providers/connection/link_connection_controller.dart` | 460 |
| `lib/providers/chat/runtime_cc_system_messages.dart` | 421 |
| `lib/providers/chat/runtime_common_reducer.dart` | 403 |

**Flutter screens/sheets** (excludes the 6 FROZEN screens above):

| File | Lines |
|------|-------|
| `lib/screens/sessions/cc_sessions_view.dart` | 1,401 |
| `lib/screens/sessions/cx_threads_view.dart` | 1,266 |
| `lib/screens/sheets/git_panel_sheet.dart` | 1,131 |
| `lib/screens/mcp_servers_screen.dart` | 1,094 |
| `lib/screens/subagents_screen.dart` | 1,074 |
| `lib/screens/sessions/pi_sessions_view.dart` | 1,054 |
| `lib/screens/appearance_screen.dart` | 1,027 |
| `lib/screens/subscription_usage_screen.dart` | 929 |
| `lib/screens/terminal_screen.dart` | 842 |
| `lib/screens/skills_screen.dart` | 832 |
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
| `lib/screens/sheets/pi_subagent_detail_sheet.dart` | 579 |
| `lib/screens/sheets/pi_settings_sheet.dart` | 568 |
| `lib/screens/codex_mcp_screen.dart` | 553 |
| `lib/screens/opencode_global_config_screen.dart` | 540 |
| `lib/screens/hooks_screen.dart` | 528 |
| `lib/screens/sessions/subagent_tasks_view.dart` | 503 |

**Flutter services:**

| File | Lines | What to extract |
|------|-------|----------------|
| `lib/services/storage_service.dart` | 1,289 | `lib/services/storage/` (5 files, 144 lines extracted so far) |
| `lib/services/pi_bridge_service.dart` | 750 | Methods → `lib/services/bridge/bridge_pi_*.dart` extensions |
| `lib/services/bridge/bridge_git.dart` | 405 | Git method group → smaller extensions |

**Bridge:**

| File | Lines | What to extract |
|------|-------|----------------|
| `packages/bridge/src/cc-external-tail.ts` | 743 | Split tail vs parse |
| `packages/bridge/src/custom-tools.ts` | 708 | Split registry vs execution |
| `packages/bridge/src/subscription-tracker.ts` | 672 | Split per-provider trackers |
| `packages/bridge/src/handlers/git/git_commands.ts` | 611 | Split into git_operations, git_diff, etc. |
| `packages/bridge/src/runtime/codex-runtime-event-mapper.ts` | 578 | Split by event category |
| `packages/bridge/src/platform.ts` | 558 | Split platform / build-flag probes |
| `packages/bridge/src/cx-external-tail.ts` | 533 | Split tail vs parse |
| `packages/bridge/src/pty/runtime.ts` | 496 | Split session vs I/O |
| `packages/bridge/src/cli.ts` | 440 | Split command groups |
| `packages/bridge/src/updater.ts` | 448 | Split check vs apply |
| `packages/bridge/src/file-search.ts` | 447 | Split walk vs match |
| `packages/bridge/src/pty/native-pty.ts` | 446 | Split by backend |
| `packages/bridge/src/runtime/opencode-runtime-event-mapper.ts` | 417 | Split by event category |
| `packages/bridge/src/plugins.ts` | 402 | Split registry vs loader |

Other files over 400 lines (not tabulated): `lib/theme/themes/all_themes.dart` (2,950, generated theme table — leave alone), `lib/models/codex.dart` (871), `lib/models/pi.dart` (796), `lib/theme/opencode_theme.dart` (651), `lib/models/runtime/runtime_event.dart` (605), `lib/models/message.dart` (566), `lib/models/claude_code/cc_custom_tool.dart` (497).

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

### Flutter (`lib/`) — 760 files, ~163K LOC (32 generated under `contract/generated/`)

```
lib/
  agent/                            ← the app core (Phase 3): contract client, session store, reducer and answer-check ports, generic screens
  screens/                          ← 50 files here (30,029 lines); 197 recursive, 61,735 lines
    settings/                       ← the version line (`AppVersionLine`, the agent core's hidden entry)
    sheets/                         ← 52 extracted sheets (13,305 lines)
    chat/                           ← 52 extracted chat helpers incl. hydration/ (6,458 lines)
    sessions/                       ← 11 extracted session views (6,016 lines)
    dialogs/                        ← 9 extracted dialogs (921 lines)
    onboarding/                     ← 10 step files (2,954 lines)
    pi/                             ← extension UI handler (272 lines)
    opencode/                       ← OC-specific screen widgets (589 lines)
  widgets/                          ← 33 files here (12,066 lines); 134 recursive, 30,840 lines
    chat/                           ← chat widgets (62 files, 12,639 lines)
    sessions/                       ← session card widgets (16 files, 3,282 lines)
    pi/                             ← Pi-specific widgets (tree node, queue indicator)
    git/                            ← git file tile, diff inline, status badge
    file_viewers/                   ← file content rendering
    sidebar/                        ← sidebar widgets
    opencode/                       ← OC-specific widgets
    link/                           ← machine list, link status, reconnect banner
  services/                         ← 10 files here (3,330 lines)
    bridge/                         ← 52 bridge extension files (7,182 lines)
    link/                           ← pairing, machine store, discovery, push registration (20 files, 1,433 lines)
    storage/                        ← storage extensions (5 files, 144 lines)
    websocket/                      ← WebSocket connector, JSON decoder
  providers/                        ← 37 files here (5,794 lines)
    chat/                           ← 26 files (6,503 lines) — runtime event processing
    sessions/                       ← 3 runtime session handlers
    codex/                          ← 4 Codex-specific providers
    connection/                     ← Link connection controller, status mapping
    link/                           ← machines, link status, push providers
    pi_durable/                     ← Pi Durable providers + experimental flag
  models/                           ← 44 files here (8,236 lines); 78 recursive, 13,134 lines
    claude_code/                    ← 17 CC model files (3,077 lines)
    runtime/                        ← 6 runtime model files (1,046 lines)
    codex/                          ← 3 Codex model files (257 lines)
  theme/                            ← design system, semantic color tokens
  utils/                            ← shared utilities
```

### Bridge (`packages/bridge/src/`) — 546 files, ~68K LOC (tests excluded; 744 files with tests)

```
packages/bridge/src/
  server.ts                         ← 373 lines — server wiring; delegates to server/, routing/ and handlers/
  types.ts                          ← 28-line barrel — ClientMessage/ServerMessage unions live in types/
  index.ts                          ← 127 lines — CLI entry + startup
  connectors/                       ← 117 files (15,891 lines)
    claude-code/                    ← 31 modules (4,490 lines) — query, live-session, sessions, hooks, config, …
    opencode/                       ← 21 modules — session-list, sessions, messages, permissions, …
    codex/                          ← cx-sqlite, cx-session-stats, …
    pi/                             ← 34 modules (4,900 lines) — pi-events, pi-instance, pi-session-lifecycle, pi-session-queries, pi-session-list-cache, pi-model-runtime, pi-session-stats, …
    pi-durable/                     ← 8 modules plus tools/ — harness-host, session-store, storage-lock, permissions, model-runtime, session-runtime, agent-setup
    claude-code.ts                  ← 39-line facade re-exporting connectors/claude-code/*
    opencode.ts                     ← 633 lines — FROZEN, extract to subdirectory
    pi.ts                           ← 42-line facade re-exporting connectors/pi/*
    codex.ts                        ← 326 lines
    codex-fs.ts                     ← 149 lines
    pi_extension_ui.ts              ← 335 lines
  handlers/                         ← 106 files (14,055 lines)
    git/                            ← 9 files — git_commands, github, parse, security
    codex/                          ← 22 files — cx_threads, cx_chat, cx_files, cx_workspace, cx_agents, cx_plugins, cx_skills, cx_mcp, cx_fuzzy_search, etc.
    pi_durable/                     ← 6 modules — events, host, ops, read-models, transport, view
    cc_*.ts                         ← 17 files — cc_chat, cc_sessions, cc_config, cc_skills, cc_hooks_mcp, cc_commands, cc_plugins, cc_custom_tools, cc_subagents, cc_memory, cc_live_session, cc_elicitation, cc_permission_hook, cc_hook_installer, cc_ask_user_question, cc_routing, …
    pi_*.ts                         ← 22 files — pi_chat, pi_stream_bridge, pi_session_lifecycle, pi_features (router), pi_models, pi_settings, pi_tools, pi_tree, …
    oc_*.ts                         ← OpenCode handlers — oc_routing, oc_sessions, oc_chat, oc_messages, oc_providers, …
    unified.ts                      ← 379 lines — unified backend-agnostic handler (plus unified_session_lists, unified_session_children, unified_pi)
    devices.ts, misc.ts             ← shared handlers
    session_view.ts, session-stats.ts
  routing/                          ← 5 files — registry, routes (ALL_MESSAGE_TYPES), types, validate, messages
  server/                           ← 42 files (4,393 lines) — wiring: streams, sessions, codex notifications/requests, link-feed/, opencode events, the contract seam
  runtime/                          ← 14 files (2,531 lines)
    *-runtime-event-mapper.ts       ← 5 per-backend event mappers (incl. pi-durable)
    *-runtime-read-models.ts        ← 5 per-backend read models
    pi-durable-partial-message.ts   ← whole-block text diff for Pi Durable streaming
    stream-contract.ts              ← shared streaming contract
    shared.ts                       ← shared types
    pi-runtime-bootstrap.ts         ← Pi bootstrap
  types/                            ← 32 files (4,301 lines) — per-agent client/server unions
    runtime.ts                      ← BroskiRuntimeEvent, BroskiRuntimeState, BroskiBackend
    runtime-messages.ts             ← runtime_event / runtime_state / session-row server messages
    codex*.ts, pi*.ts               ← Codex and Pi types
    pi-durable.ts                   ← Pi Durable WebSocket contract
  pty/                              ← 9 files (1,439 lines) — runtime, native-pty (+reader/writer), manager, output, types, …
  doctor/                           ← 20 files (1,600 lines) — checks for agents, network, security, daemon
  config/                           ← 5 files (199 lines) — schema, defaults, read-write
  logging/                          ← 5 files (390 lines) — structured logger, redaction
  wizard/                           ← 13 files (1,086 lines) — onboarding, troubleshoot, steps
  utils/                            ← 17 files (1,386 lines) — runtime-send-queue, runtime-replay-buffer, bounded-pool, single-flight, session-list-page, jsonl-*, fs-helpers, …
  __tests__/                        ← test files
```

## Adding a Feature — The 9-Layer Flow

```
types → handler (registered in routing/routes.ts) → connector → runtime mapper → WebSocket → bridge extension → model → provider → UI
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
- **Stream:** `cc_chat` → `runtime_event` / `runtime_state` (the reply to a chat is the normalized stream, not a per-agent stream message)
- **Unified:** `unified_list_sessions` → `unified_sessions` (response keeps unified prefix + noun)

### New Feature Checklist

To add `xx_list_widgets` for agent XX:

1. **`types/xx-client.ts`**: Add to the ClientMessage union: `| { type: 'xx_list_widgets'; cwd?: string }`
2. **`types/xx-server.ts`**: Add to the ServerMessage union: `| { type: 'xx_widgets'; data: XxWidget[]; requestId?: string }`
3. **`types/xx.ts`**: Define `export type XxWidget = { ... }` if new type
4. **`connectors/xx.ts`** (or `connectors/xx/xx-widgets.ts` if the connector is FROZEN): Add `export async function listWidgets(cwd?: string): Promise<XxWidget[]>`
5. **`handlers/xx_widgets.ts`** ← NEW FILE, not server.ts. List its message types in the module's `MODULE_TYPES`; `routing/routes.ts` collects them (a ClientMessage type with no handler fails typecheck)
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

**Recipe 2: Handler module** (see `handlers/devices.ts` for the smallest real one)
```typescript
// NEW FILE: packages/bridge/src/handlers/xx_things.ts
import { registerAll } from '../routing/registry'
import type { MessageRouter, ServerDeps } from '../routing/types'

const THING_OPS = ['xx_list_things'] as const

export const MODULE_TYPES = THING_OPS

export function register(router: MessageRouter, deps: ServerDeps): void {
  registerAll(router, THING_OPS, async (message, ctx) => {
    const result = await deps.xxConnector.listThings(message.cwd)
    ctx.reply({ type: 'xx_things', data: result, requestId: message.requestId })
  })
}

// IN routing/routes.ts — add ONLY:
// import * as xxThings from '../handlers/xx_things'
// ...xxThings.MODULE_TYPES in ALL_MESSAGE_TYPES, and xxThings.register(router, deps) in createMessageRegistry
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
- `packages/bridge/src/connectors/pi/` (34 modules, 4,900 lines) — connector split out of the `pi.ts` facade ✅
- `packages/bridge/src/handlers/pi_features.ts` (164-line router) → `handlers/pi_*.ts` modules ✅
- `packages/bridge/src/handlers/git/` (9 files) — handlers from server.ts ✅
- `packages/bridge/src/handlers/codex_features.ts` (372 lines) — handler from server.ts ✅

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

- **Claude Code** (`@anthropic-ai/claude-agent-sdk` 0.2.92, exact pin): Model aliases (sonnet/opus/haiku). New version of same tier = no code change. New tier = add to model union + enum + picker. Docs in `reference/cc-docs/`.
- **OpenCode** (`@opencode-ai/sdk` 1.3.17, exact pin, imported through its `/v2` subpath — that is the SDK's API generation, not the OpenCode CLI version; the installed CLI is 2.x and the integration is slated for a rewrite): Fully dynamic models from `provider.list()`. SDK returns `{ data, error }` wrapper — always destructure `.data`.
- **Codex** (`codex app-server` child process): JSON-RPC over stdio. Bridge talks via `request(method, params)` and `notify(method, params)`.
- **Pi** (`@earendil-works/pi-coding-agent` 1.4.0, with `@earendil-works/pi-ai` / `pi-agent-core` / `chord` at 1.4.0, exact pins): Event-driven `AgentSession` with `AgentSessionEvent` streaming. Dynamic models via `ModelRuntime` — it replaced the removed `AuthStorage` / `ModelRegistry.create`, and `createAgentSession` now takes `{ modelRuntime }`. Models/auth come from the user's `~/.pi/agent`: `auth.json` (credentials), `models.json` (custom providers) and `models-store.json` (the pi.dev catalogue cache `pi update --models` writes). A model listing must call `refresh({ allowNetwork: false })` first and read `getAvailable()` — that is exactly what `pi --list-models` prints, and the bridge runs for days over files that change under it (`connectors/pi/pi-model-runtime.ts`). The user's own `enabledModels` list is resolved by the SDK's `resolveModelScopeWithDiagnostics()` and served alongside the catalogue (`connectors/pi/pi-model-catalogue.ts`) — never parse `settings.json` by hand. Connector code lives in `connectors/pi/` behind the 42-line `connectors/pi.ts` facade; extension UI bridge (`pi_extension_ui.ts`) relays dialog/confirm/select prompts to the app.
- **Pi Durable** (`@earendil-works/pi-durable` 1.4.0, **experimental**): a crash-durable re-run of the Pi backend on the durable `Harness` + JSONL storage, not `AgentSession`. One process owns a storage at a time (own lock file); JSONL-only under Bun. A tool's result is `{ output, details, isError }` — `output` is what the model reads (it was `content` before 1.2.0), and returning only `details` silently gives the model an empty result. `HarnessOptions.models` may be a function, so the shared `ModelRuntime` can be refreshed under an open harness. Backend notes and gotchas: `docs/architecture/backends/pi-durable.md`.

### SDK Trust Order (Claude Code)

1. Check the exact pin in `packages/bridge/package.json`; move it deliberately with `cd packages/bridge && bun add -E @anthropic-ai/claude-agent-sdk@<version>`
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

# Bridge (Bun 1.4.2+)
cd packages/bridge && bun install && bun dev  # Dev with hot reload
bun run typecheck                             # tsc --noEmit (local TypeScript 7)
bun run lint                                  # biome check src/
bun test                                      # Bun test runner
broski install                               # Register broski-link as a launchd/systemd service
broski-link pair                             # Show the QR v2 pairing code
broski-link status                           # Machine, bridge, relay and session status
broski-bridge doctor                         # Diagnose environment
```

### CI (`.github/workflows/ci.yml`)

- **bridge:** Bun 1.4.2, `bun install --frozen-lockfile` (bridge `bun.lock` is tracked), `bun run typecheck`, `bunx biome check src/ --diagnostic-level=error`, `bun test`, then the synthetic perf budget (`bench/`).
- **link:** `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` in `packages/link` (ubuntu + macos).
- **flutter:** Flutter 3.38.5, `dart format --output=none --set-exit-if-changed lib test`, `flutter analyze`, `flutter test`, then `dart test` in `packages/link_dart`.

## Test Hygiene

- **Never let a test touch real user data.** Tests must not read or write `~/.pi`, `~/.broski`, `~/.claude`, or `~/.codex`. Inject temp roots instead: config read/write take an explicit path, and the Pi connector accepts a `sessionRoot`. Real user dirs belong to the running bridge, never to a test.
- **Drive a real agent with a scripted model, not a mock of it.** `packages/bridge/src/__tests__/helpers/` has a scripted OpenAI-compatible endpoint (`scripted-openai-server.ts`) and a rig (`pi-live-rig.ts`) that runs a real Pi AgentSession behind a link socket; `packages/link_dart/test/e2e/pi_chat_e2e_test.dart` does the same through the real daemon. Both use a throwaway agent dir.
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
- **Extension pattern:** `bridge_service.dart` is 296 lines of core. All agent methods live in 52 extension files in `services/bridge/`.
- **Handler delegation:** `routing/routes.ts` registers the message types of the 106 files under `handlers/` (each module exports `MODULE_TYPES` and `register`). New cases get a new handler file + its entry in `routing/routes.ts`.
- **A run, not a turn:** `agent_started`/`agent_finished` are the agent *run* only. Pi's and Pi Durable's `turn_start`/`turn_end` bracket every model call inside a run and map to nothing (`docs/architecture/notifications.md`); the app's Stop control, completion notification and queue draining all key on the run.
- **Viewers get the deltas:** thinking, text, tool output and `tool_finished` reach only the sockets viewing the session. The socket that creates, switches to, prompts or steers a Pi session becomes a viewer (`handlers/pi_view_binding.ts`), because a draft chat has no session id to `set_view` with.
- **Stop is always on screen and always local:** `RunningStopBar` shows while `chatIsRunning`; `stopGeneration` sends the backend abort and `cancelRunLocally()` ends the run on the phone without waiting for the bridge.
- **Snapshot-first attach (Pi Durable):** a reconnecting client gets the harness snapshot, not a replay buffer — the WS `set_view` attach streams `runtime_state` + `runtime_event` and every later commit batch follows.
