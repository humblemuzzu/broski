# Repository Guidelines

## What Broski Is

Broski is a **mobile app that gives you full remote control of AI coding agents running on your computer** from your phone. It connects to 2 agent backends through a bridge server:

```
Phone (Flutter + Rust core) ←Broski Link (Noise e2e; LAN or relay)→ broski-link daemon (Rust, your Mac) ←unix socket→ Bridge (Bun/TS) ←SDK→ {Claude Code, Pi}
```

- **Bridge** (`packages/bridge/`) — TypeScript server on the user's dev machine. Connects to local AI agents via their SDKs. Serves the app protocol to the daemon over the unix socket `~/.broski/link/bridge.sock`, where every upgrade must quote the key the daemon wrote to `~/.broski/link/bridge.key` (`x-broski-link-key`, 32 random bytes hex, `0600`, rewritten by the daemon at every start and re-read by the bridge per upgrade — `server/link-key.ts`); its TCP listener is loopback-only (127.0.0.1) and exists for local things only: the CC permission hook, the dashboard, `/proxy/<port>`.
- **The bridge's environment** — a service start inherits only `PATH` and `HOME` from launchd/systemd, so at startup the bridge asks the user's login shell once (`platform/shell-env.ts`: one interactive `env -0` between markers, 10 s timeout, process-group kill) and runs every agent and PTY with the result. A `~/.zshrc` change applies on the next bridge start (`broski restart`, or the app's restart button). A compiled binary never takes `BROSKI_*`/`BUN_*` from a shell: those stay the service manager's and config's.
- **broski-link daemon** (`packages/link/daemon/`, Rust) — runs as a launchd (macOS) / systemd (Linux) service installed by `broski install`; supervises the bridge, terminates the Noise session with each paired phone, and dials the relay. Windows is not supported.
- **Relay** (`packages/link/relay/`) — blind rendezvous the phone and daemon both dial out to. It forwards encrypted frames and never sees plaintext.
- **Flutter app** (`lib/`, Rust core via `packages/link_dart/`) — iOS/Android app. Renders UI only; all AI logic stays on Mac.
- **Connection:** direct over the LAN when reachable, otherwise through the relay. No VPN, tunnel, port forwarding or public exposure of the bridge.
- **Auth layers:** QR v2 pairing (`broski://pair?v=2&h=<fingerprint>&s=<one-time secret>&e=<expiry>&n=<name>[&r=<relay>][&l=<lan>]`), Noise end-to-end encryption (hybrid X25519 + ML-KEM-768) with the machine fingerprint pinned from the QR, and per-device revocable authorisation on the daemon. Design docs: `docs/architecture/connectivity-v2/`.
- **604 Dart files** (~113K LOC under `lib/`, of which 37 files and ~15K LOC are the generated contract in `lib/contract/generated/` and 147 files the app core in `lib/agent/`), **527 TypeScript files** (~55K LOC under `packages/bridge/src/`, tests excluded).
- **OpenCode and Codex were removed** on 2026-11-01 (bridge connectors, handlers, mappers, app screens, contract ids); so was the unlaunched web app (`web-app/`).
- **Pi** is served only through the backend contract (`src/backends/pi/`, below); the old Pi protocol (`pi_*`) and the experimental Pi Durable backend (`pd_*`) were deleted on 2026-10-30 (last in `e9d1a10`). In the app Pi is a normal backend: it is chosen in the AI Backend picker and its sessions and projects are the Sessions and Projects tabs, drawn by the contract screens of `lib/agent/`.

### Core features that are INTENTIONAL, not vulnerabilities:
- **PTY / terminal access from the phone.** This is a primary feature. Users open terminal sessions, type commands, see output. Do NOT flag this as a security issue or suggest blocking it.
- **Command execution from the app.** The app sends commands to AI agents (Claude Code, Pi) and to the shell. This is the product. Do NOT suggest removing or restricting command execution.
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

The backend-agnostic contract that replaces the runtime abstraction below lives in `packages/bridge/src/contract/`. Its spec is [`docs/architecture/contract/README.md`](docs/architecture/contract/README.md). The bridge core (Phase 2) and the Flutter core (Phase 3) are built on it, and each backend gets one adapter under `packages/bridge/src/backends/<id>/` (Phase 4; Pi's is live; Claude Code's is built and served only behind `claudeCode.contract`, below, while the old protocol still serves it by default). Hard rules:

- **The UI never branches on the backend**, only on `Capabilities` / `SessionCapabilities` and the shape of the data. Backend extras arrive as typed `extension` events and `backend.call` ops.
- **Adapters are reached only through the contract** (`AgentBackend`). The core never imports `backends/<id>/`; an adapter never sees sockets, phones or the wire.
- **The contract is a leaf**: `src/contract/` imports only `zod` and itself (its `testing/` may add `bun:test`); `src/backends/<id>/` imports only the contract, itself, `zod`, `node:` built-ins (not `node:module`) and its own SDK; no adapter reaches another adapter's directory. Every import specifier is a plain string. `bun run check:layers` enforces it in CI.
- **Expected failures are values**: every adapter method that can fail returns `{status: "accepted", …} | Rejected`; `status()` never fails (its failures are `issues`). Every wire string, list and map is bounded (`src/contract/limits.ts`).
- **Generated code is never edited by hand**: `lib/contract/generated/`, `test/contract/generated/`, `test/contract/fixtures/` and `src/contract/contract.schema.json` come from the zod schemas via `bun run contract:gen`; CI runs `bun run contract:check`.
- **The protocol has a minor** (`PROTOCOL_VERSION`, 1.4): what a later minor added (`ADDED_IN_MINOR`) goes only to a client whose `hello` named it, and an adapter whose backend names a form field `__proto__` maps it to another key (`FieldKey` refuses it).
- **Every adapter passes the conformance suite** (`runConformance` in `src/contract/testing/`, 31 rules, each proven to fail by the broken adapters in `src/__tests__/contract_negative_*.test.ts`), and every answer goes through `answerProblem` before it reaches a backend.
- **Pi's adapter** (`src/backends/pi/`, Phase 4) is the only Pi, registered by default in every bridge, compiled binaries included (`server/contract-backends.ts`); what it is, its decisions and open questions: [`docs/architecture/backends/pi/README.md`](docs/architecture/backends/pi/README.md).
- **Claude Code's adapter** (`src/backends/claude-code/`) passes all 31 conformance rules against the real CLI, and is registered **only when the bridge config has `"claudeCode": {"contract": true}`** (default false; a compiled binary reads no env flag for it). With the flag on, the old `PreToolUse` terminal hook stands down and the adapter's `PermissionRequest` hook (`claudeCode.terminalAsks`, default true) takes its place; the server side is `server/claude-code-*.ts`. Plan, decisions and gaps: [`docs/architecture/backends/claude-code/README.md`](docs/architecture/backends/claude-code/README.md).

## Bridge core (the rebuild, Phase 2)

The core that speaks the contract lives in `packages/bridge/src/core/`; its doc is [`docs/architecture/core/README.md`](docs/architecture/core/README.md). Production registers Pi, and Claude Code behind `claudeCode.contract` (`server/contract-backends.ts`). Rules:

- **Contract messages travel as `{"type":"contract","message":…}`** on the same sockets as the old protocol, which owns every other frame type. The seam is `server/contract-seam.ts`; old code knows the core only through the seam's calls: in `server.ts` one `createContractSeam(…)` line, `contract` handed to three dependency objects, and `contract.start()` once the listeners are bound (backends start after the bridge listens); `server/messages.ts` hands an owned frame to the core before the old prototype-poison check; `server/connections.ts` calls `disconnect` on close and `refuse` when the rate limit refuses a contract frame; `server/shutdown.ts` calls `stop`. Do not route contract messages through `routing/`.
- **`src/core/` imports only itself, the contract (not its test kit), `zod` and `CORE_INFRASTRUCTURE`** (`state/bounded-map`, `transport/send-limits`, which may import only `zod` and each other; `scripts/contract-gen/layers.ts`). `bun run check:layers` enforces it. Adapters reach the core only through the `AgentBackend` they give the registry.
- **Every contract request gets exactly one answer**, within 120 s even from an adapter that never answers; inbound frames are bounded (8 MiB, 50,000 JSON values, the contract's list and depth bounds) before the schema checks them.
- **No automatic answers.** An interaction ends only when a human answers or cancels it, or the backend withdraws it or lets it expire. Never add a timeout that answers for the user.
- **Keep-open**: a session with a run, a pending ask, a compaction, a retry or queued input stays open, viewed or not; only bridge shutdown closes a busy session.
- **Every frame fits the link** (`wire-fit.ts`): every contract message goes out through `fitMessage`/`fitEvent` (only the core's own short `error` answers skip it), and fitting never cuts ids, cursors or image bytes.
- **The daemon's feed reaches the core through two things only**: `CoreOptions.observer` (every event of every open session, with the state before and after) and `BridgeCore.answer` (a person's answer from outside the attached phones, through the same desk and `answerProblem`); the seam installs `contractFeedObserver`. The core never imports `server/`; a feed decision is a human answer, never an automatic one (core README §19, `docs/architecture/connectivity-v2/bridge-feed.md`).
- **`BridgeCore.hold(ref)` / `release(ref)` pin a session open with no client attached** (core README §20), so an ask raised on it (a terminal Claude Code prompt) gets keep-open, the observer feed and snapshots: `hold` opens it by the attach path and resolves `accepted` or the open's `Rejected`, never throws; holds are counted, each needs its `release`; unheld, the session follows the idle-and-unviewed rule; shutdown closes it. A hold answers nothing and starts no timer. `server/` reaches them only through `ContractSeam.hold` / `release`.
- **A watch-only session may take answers and nothing else** (core README §21, contract README §5 rule 14): an adapter offers `OpenSession.answer` on a session without `control`, `SessionCapabilities.answer` says so (1.4, cut for an older client), and `interaction.answer` (viewer only) and `BridgeCore.answer` reach it through the same desk and `answerProblem`; every other control request on it stays `unsupported`. Never give such a session a `control` to make its asks answerable.
- **Tests drive the fake backend** (`__tests__/helpers/core-rig.ts`, `core-bridge.ts`) and break adapters by wrapping the fake (`adapt`, `helpers/core-adapters.ts`); they never mock the core. `bun run mutate:core` checks that the core's tests fail on every guard removed, except the equivalent mutants it lists with their reasons.

## App core (the rebuild, Phase 3)

The phone side of the contract lives in `lib/agent/`; its doc is [`docs/architecture/app-core/README.md`](docs/architecture/app-core/README.md). It is additive: the old screens keep working for the old protocol's backends, and a backend the bridge serves through the contract (Pi) is drawn by the new ones, from the AI Backend picker and the Sessions and Projects tabs. Rules:

- **`lib/agent/` never steers by backend.** Branch on `Capabilities`, `SessionCapabilities` and the data. `BackendId` members and backend-id strings appear only in `ui/backend_label.dart`, for display; `AgentType` never appears.
- **`lib/agent/` imports only** `dart:`, Flutter, Riverpod, the generated contract, itself, the theme, and the named infrastructure `tool/agent_core_check/import_rules.dart` lists, each with a `show` of only the names listed. `dart run tool/check_agent_core.dart` enforces both rules in CI; it catches accidents, not every determined bypass.
- **The reducer and the answer check are ports**, held equal to `session-reducer.ts` and `answer-check.ts` by fixtures the generator computes (`reducer_trace.json`, `answer_cases.json`). Change the TypeScript, regenerate, and the Dart tests say what to change; never write their expectations by hand. `dart run tool/format_differential.dart [--sweep all]` holds the string formats and patterns to Bun on a seeded corpus and on exhaustive sweeps (the app may pass what the bridge refuses, never the reverse); `dart run tool/mutate_agent_core.dart` checks that the agent tests fail on every guard removed, except the equivalent mutants it lists.
- **One client, one store.** Requests go through `ContractClient` (typed results, never a throw); session state through `sessionProvider(SessionRef)`. Do not add another request client.
- **Tests use the injected `AgentClock`** (`test/agent/support/manual_clock.dart`), the scripted bridge (`scripted_bridge.dart`) and a real controller; the e2e test runs the real daemon and `packages/bridge/scripts/dev-fake-bridge.ts`, which never ships.

## The Runtime Abstraction

This is the core architecture of the app. **Read this before adding any agent feature.**

### The Problem

Claude Code is the one old-protocol backend: its own event types, session model and streaming protocol. Pi speaks the backend contract instead (below). The runtime layer keeps the app's chat code independent of the Claude Code SDK's shapes.

### The Solution: BroskiRuntimeEvent

A unified event stream that normalizes the old-protocol backend (Claude Code) into one type system; Pi speaks the contract instead. The Flutter app receives `BroskiRuntimeEvent`s and doesn't care how the SDK shaped them.

**Bridge side** (`packages/bridge/src/types/runtime.ts`):
```typescript
type BroskiBackend = "claude-code";

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

The event mapper lives in `packages/bridge/src/runtime/`:

```
agent SDK event → runtime event mapper → BroskiRuntimeEvent → WebSocket → Flutter
```

| Backend | Mapper file | Read models file |
|---------|------------|-----------------|
| Claude Code | `runtime/claude-code-runtime-event-mapper.ts` (262) | `runtime/claude-code-runtime-read-models.ts` (86) |

Plus shared: `runtime/stream-contract.ts` (120) and `runtime/shared.ts` (17).

**When adding a new event type:** Add it to `types/runtime.ts`, implement mapping in the mapper that emits it, add the Dart model to `models/runtime/runtime_event.dart`, and handle it in the Flutter `runtime_common_reducer.dart`.

### Flutter Side

Dart models in `lib/models/runtime/` (6 files, 1,046 lines):
- `runtime_event.dart` (605) — sealed class with all 16 event types
- `runtime_state.dart` (170)
- `runtime_capabilities.dart` (73)
- `runtime_session_summary.dart` (125)
- `runtime_model_summary.dart` (68)

Provider layer in `lib/providers/chat/` (16 files, 3,003 lines; 7 `runtime_*` files, 2,034 lines):
- `runtime_chat_ingest.dart` (457) — main ingestion pipeline
- `runtime_common_reducer.dart` (403) — reduces events into state updates
- `runtime_cc_system_messages.dart` (421) / `runtime_cc_metadata_handler.dart` (288) — Claude Code handling
- `runtime_permission_handler.dart` (238) — permission request flow
- `runtime_common_models.dart` (143) — shared data types

### The Unified Handler

`packages/bridge/src/handlers/unified.ts` (106 lines) — instead of per-agent messages (`cc_list_sessions`), the app sends ONE message with a `backend` parameter:

```
{ type: "unified_list_sessions", backend: "claude-code", cwd: "...", limit: 100, before: "<cursor>" }
→ { type: "unified_sessions", backend: "claude-code", data: [...], hasMore: true, nextCursor: "...", requestId: "..." }
```

Old per-agent messages still work for backward compatibility. New features should use unified messages.

**Every session list is paged** (`utils/session-list-page.ts`, one implementation for
`cc_sessions` and `unified_sessions`): `limit` defaults to
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
| Replay buffer | `utils/runtime-replay-buffer.ts` (106) | Buffers events for reconnection replay |
| Bounded pool | `utils/bounded-pool.ts` (28) | Caps concurrency (Claude Code session enrichment) |
| Single-flight | `utils/single-flight.ts` (17) | Dedupes concurrent work on the same key |
| Replay tracker | `lib/services/bridge/runtime_replay_tracker.dart` (41) | Flutter-side replay handling |
| Bridge runtime | `lib/services/bridge/bridge_runtime.dart` (56) | Flutter→bridge runtime API |
| Bridge unified | `lib/services/bridge/bridge_unified.dart` (150) | Flutter→bridge unified API |

## ⛔ MODULAR CODE ARCHITECTURE — MANDATORY

Every edit must make the codebase more modular, not less. New code goes in new files. Existing large files are frozen — you delegate, not add.

### 🚫 FROZEN FILES — DO NOT ADD LINES TO THESE

**Bridge (TypeScript):**

| File | Lines | What it has | Where new code goes |
|------|-------|-------------|-------------------|
| `packages/bridge/src/types.ts` | 19 | Barrel re-exporting `types/*.ts` (ClientMessage/ServerMessage unions) | `types/*.ts` (22 files: `types/runtime.ts`, `types/claude-code*.ts`, …) |
| `packages/bridge/src/connectors/claude-code.ts` | 39 | Facade re-exporting `connectors/claude-code/` | `connectors/claude-code/` (31 files) |
| `packages/bridge/src/server.ts` | 269 | Server wiring; routing lives in `routing/` | `handlers/{domain}.ts` (36 handler files already extracted), `server/*.ts` (39 files) |

**Flutter (Dart):**

| File | Lines | What it has | Where new code goes |
|------|-------|-------------|-------------------|
| `lib/screens/chat_screen.dart` | 1,274 | Main chat screen build + routing | `lib/screens/sheets/` (17 files), `lib/screens/chat/` (29 files), `lib/screens/dialogs/` (4 files) |
| `lib/screens/settings_screen.dart` | 1,048 | All settings | Extract sections to `lib/screens/settings/`, `lib/screens/sheets/` or dedicated screens |
| `lib/screens/claude_code_settings_screen.dart` | 1,502 | CC settings | Extract to `lib/screens/sheets/cc_*.dart` |
| `lib/screens/projects_screen.dart` | 543 | Project management | Extract sections |
| `lib/screens/browse_screen.dart` | 917 | File browser | Extract sections |
| `lib/screens/sessions_screen.dart` | 103 | Sessions tab shell | `lib/screens/sessions/` (3 files) |

### ✅ Graduated Files (previously frozen, now clean — keep them lean)

These were 2,700–5,100 lines. Extraction is done. Keep adding to their extracted subdirectories, not back to these files.

| File | Was | Now | Where the code went |
|------|-----|-----|-------------------|
| `lib/services/bridge_service.dart` | 5,058 | 259 | `lib/services/bridge/` (28 extension files, 2,691 lines) |
| `lib/providers/chat_provider.dart` | 5,092 | 186 | `lib/providers/chat/` (16 files, 3,003 lines) |
| `lib/screens/onboarding_screen.dart` | 4,314 | 114 | `lib/screens/onboarding/` (10 files, 2,920 lines) |
| `lib/models/claude_code.dart` | 2,759 | 21 (barrel) | `lib/models/claude_code/` (17 files, 3,077 lines) |

### ⚠️ WATCH LIST — Files over 400 lines (extract on next touch)

Prioritised, not exhaustive. Recompute with `find lib packages/bridge/src \( -name '*.dart' -o -name '*.ts' \) -not -path '*__tests__*' | xargs wc -l | sort -rn`.

**Flutter widgets:**

| File | Lines | What to extract |
|------|-------|----------------|
| `lib/widgets/session_sidebar.dart` | 1,101 | Section widgets |
| `lib/widgets/permission_prompt.dart` | 841 | Action buttons, content sections |
| `lib/widgets/chat/compact_agent_card.dart` | 770 | Sub-widgets |
| `lib/widgets/chat/cli_input_bar.dart` | 671 | Sub-widgets |
| `lib/widgets/chat/compact_edit_card.dart` | 562 | Sub-widgets |
| `lib/widgets/file_tagging.dart` | 606 | Sub-widgets |
| `lib/widgets/sessions/session_helpers.dart` | 595 | Helper functions |
| `lib/widgets/question_prompt_sheet.dart` | 582 | Sub-widgets |
| `lib/widgets/onboarding_widgets.dart` | 575 | Step widgets |
| `lib/widgets/chat/compact_tool_card.dart` | 531 | Sub-widgets |
| `lib/widgets/message_bubble.dart` | 494 | Sub-widgets |
| `lib/widgets/chat/floating_input_bar.dart` | 513 | Sub-widgets |
| `lib/widgets/voice_recording_sheet.dart` | 503 | Sub-widgets |
| `lib/widgets/chat/adaptive_table.dart` | 452 | Sub-widgets |

**Flutter providers:**

| File | Lines |
|------|-------|
| `lib/providers/claude_code_provider.dart` | 718 |
| `lib/providers/chat/runtime_chat_ingest.dart` | 457 |
| `lib/providers/connection/link_connection_controller.dart` | 460 |
| `lib/providers/chat/runtime_cc_system_messages.dart` | 421 |
| `lib/providers/chat/runtime_common_reducer.dart` | 403 |

**Flutter screens/sheets** (excludes the 6 FROZEN screens above):

| File | Lines |
|------|-------|
| `lib/screens/sessions/cc_sessions_view.dart` | 1,399 |
| `lib/screens/sheets/git_panel_sheet.dart` | 1,131 |
| `lib/screens/subagents_screen.dart` | 1,074 |
| `lib/screens/appearance_screen.dart` | 1,027 |
| `lib/screens/subscription_usage_screen.dart` | 927 |
| `lib/screens/terminal_screen.dart` | 838 |
| `lib/screens/skills_screen.dart` | 810 |
| `lib/screens/plugins_screen.dart` | 811 |
| `lib/screens/custom_tool_editor_screen.dart` | 795 |
| `lib/screens/background_screen.dart` | 762 |
| `lib/screens/customization_screen.dart` | 746 |
| `lib/screens/sheets/cc_tools_sheet.dart` | 685 |
| `lib/screens/voice_settings_screen.dart` | 679 |
| `lib/screens/theme_selector_screen.dart` | 634 |
| `lib/screens/hooks_screen.dart` | 528 |
| `lib/screens/sessions/subagent_tasks_view.dart` | 406 |

**Flutter services:**

| File | Lines | What to extract |
|------|-------|----------------|
| `lib/services/storage_service.dart` | 685 | `lib/services/storage/` (3 files, 80 lines extracted so far) |

**Bridge:**

| File | Lines | What to extract |
|------|-------|----------------|
| `packages/bridge/src/cc-external-tail.ts` | 743 | Split tail vs parse |
| `packages/bridge/src/custom-tools.ts` | 708 | Split registry vs execution |
| `packages/bridge/src/subscription-tracker.ts` | 412 | Split per-provider trackers |
| `packages/bridge/src/handlers/git/git_commands.ts` | 611 | Split into git_operations, git_diff, etc. |
| `packages/bridge/src/platform.ts` | 558 | Split platform / build-flag probes |
| `packages/bridge/src/pty/runtime.ts` | 419 | Split session vs I/O |
| `packages/bridge/src/updater.ts` | 448 | Split check vs apply |
| `packages/bridge/src/file-search.ts` | 445 | Split walk vs match |
| `packages/bridge/src/pty/native-pty.ts` | 446 | Split by backend |
| `packages/bridge/src/plugins.ts` | 402 | Split registry vs loader |

Other files over 400 lines (not tabulated): `lib/theme/themes/all_themes.dart` (2,950, generated theme table — leave alone), `lib/theme/opencode_theme.dart` (651), `lib/models/runtime/runtime_event.dart` (605), `lib/models/message.dart` (566), `lib/models/claude_code/cc_custom_tool.dart` (497).

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

### Flutter (`lib/`) — 604 files, ~113K LOC (37 generated under `contract/generated/`)

```
lib/
  agent/                            ← the app core (Phase 3): contract client, session store, reducer and answer-check ports, generic screens (147 files)
  screens/                          ← 37 files here (20,921 lines); 115 recursive, 34,021 lines
    settings/                       ← the version line (`AppVersionLine`), contract feature tiles
    sheets/                         ← 17 extracted sheets (4,168 lines)
    chat/                           ← 29 extracted chat helpers incl. hydration/ (2,211 lines)
    sessions/                       ← 3 extracted session views (1,913 lines)
    dialogs/                        ← 4 extracted dialogs (344 lines)
    onboarding/                     ← 10 step files (2,920 lines)
  widgets/                          ← 25 files here (7,704 lines); 88 recursive, 19,198 lines
    chat/                           ← chat widgets (38 files, 8,099 lines)
    sessions/                       ← session card widgets (7 files, 1,477 lines)
    git/                            ← git file tile, diff inline, status badge
    file_viewers/                   ← file content rendering
    sidebar/                        ← sidebar widgets
    link/                           ← machine list, link status, reconnect banner
  services/                         ← 9 files here (1,927 lines)
    bridge/                         ← 28 bridge extension files (2,691 lines)
    link/                           ← pairing, machine store, discovery, push registration (20 files, 1,433 lines)
    storage/                        ← storage extensions (3 files, 80 lines)
    websocket/                      ← WebSocket connector, JSON decoder
  providers/                        ← 27 files here (3,863 lines)
    chat/                           ← 16 files (3,003 lines) — runtime event processing
    sessions/                       ← 3 runtime session handlers
    connection/                     ← Link connection controller, status mapping
    link/                           ← machines, link status, push providers
  models/                           ← 29 files here (4,441 lines); 56 recursive, 8,756 lines
    claude_code/                    ← 17 CC model files (3,077 lines)
    runtime/                        ← 6 runtime model files (1,046 lines)
  theme/                            ← design system, semantic color tokens
  utils/                            ← shared utilities
```

### Bridge (`packages/bridge/src/`) — 527 files, ~55K LOC (tests excluded; 836 files with tests)

```
packages/bridge/src/
  server.ts                         ← 269 lines — server wiring; delegates to server/, routing/ and handlers/
  types.ts                          ← 19-line barrel — ClientMessage/ServerMessage unions live in types/
  index.ts                          ← 127 lines — CLI entry + startup
  connectors/                       ← 32 files (4,529 lines)
    claude-code/                    ← 31 modules (4,490 lines) — query, live-session, sessions, hooks, config, …
    claude-code.ts                  ← 39-line facade re-exporting connectors/claude-code/*
  backends/pi/                      ← the Pi adapter behind the contract (163 files, 14,801 lines)
  backends/claude-code/             ← the Claude Code adapter behind the contract, served behind `claudeCode.contract` (216 files, 15,488 lines)
  contract/                         ← the backend contract (71 files, 7,301 lines)
  core/                             ← the bridge core on the contract (35 files, 2,693 lines)
  handlers/                         ← 36 files (4,953 lines)
    git/                            ← 9 files — git_commands, github, parse, security
    cc_*.ts                         ← 17 files — cc_chat, cc_sessions, cc_config, cc_skills, cc_hooks_mcp, cc_commands, cc_plugins, cc_custom_tools, cc_subagents, cc_memory, cc_live_session, cc_elicitation, cc_permission_hook, cc_hook_installer, cc_ask_user_question, cc_routing, …
    unified.ts                      ← 106 lines — unified backend-agnostic handler (plus unified_session_lists, unified_session_children)
    files.ts                        ← read_file, read_file_binary, browse, search_files_and_dirs
    devices.ts, misc.ts             ← shared handlers
    session_view.ts, session-stats.ts
  routing/                          ← 5 files — registry, routes (ALL_MESSAGE_TYPES), types, validate, messages
  server/                           ← 39 files (3,309 lines) — wiring: streams, sessions, link-feed/, the contract seam
  runtime/                          ← 4 files (485 lines)
    claude-code-runtime-event-mapper.ts ← the Claude Code event mapper
    claude-code-runtime-read-models.ts  ← the Claude Code read models
    stream-contract.ts              ← shared streaming contract
    shared.ts                       ← shared types
  types/                            ← 22 files (2,158 lines) — client/server unions
    runtime.ts                      ← BroskiRuntimeEvent, BroskiRuntimeState, BroskiBackend
    runtime-messages.ts             ← runtime_event / runtime_state / session-row server messages
    workspace-client.ts, workspace-server.ts ← PTY, git, GitHub and file messages
  pty/                              ← 9 files (1,309 lines) — runtime, native-pty (+reader/writer), manager, output, types, …
  doctor/                           ← 20 files (1,520 lines) — checks for agents, network, security, daemon
  config/                           ← 5 files (197 lines) — schema, defaults, read-write
  logging/                          ← 5 files (390 lines) — structured logger, redaction
  wizard/                           ← 13 files (1,022 lines) — onboarding, troubleshoot, steps
  utils/                            ← 17 files (1,385 lines) — runtime-send-queue, runtime-replay-buffer, bounded-pool, single-flight, session-list-page, jsonl-*, fs-helpers, …
  __tests__/                        ← test files
```

## Adding a Feature — The 9-Layer Flow

```
types → handler (registered in routing/routes.ts) → connector → runtime mapper → WebSocket → bridge extension → model → provider → UI
```

### Message Naming

Prefix by agent:
- **Claude Code:** `cc_` (`cc_list_skills`, `cc_chat`, `cc_abort`)
- **Pi:** none — Pi speaks the backend contract (`{"type":"contract",…}`), not prefixed messages

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
- `lib/screens/sheets/cc_model_sheet.dart` — sheet from chat_screen ✅
- `lib/screens/sheets/git_branch_sheet.dart` (109 lines) — sheet from chat_screen ✅
- `packages/bridge/src/handlers/git/` (9 files) — handlers from server.ts ✅
- `packages/bridge/src/handlers/files.ts` — handler from server.ts ✅

## SDK Integration Rules

### Use SDK types. Don't cast `as any`.

If the SDK exports a type — import it and use it. Casting `as any` hides breaking changes. When the SDK renames a field, TypeScript catches it at compile time with real types but silently returns `undefined` at runtime with `as any`.

### Don't write fallbacks for old SDK response formats.

When the current SDK returns `{ data: [...] }`, don't also handle the old format with `result?.data ?? result ?? []`. That middle `?? result` is dead code.

| Situation | Do this | Not this |
|-----------|---------|----------|
| SDK exports `SDKAssistantMessage` | `import type { SDKAssistantMessage }` | `(block as any).text` |
| An SDK returns `{ data: [...] }` | `result.data` | `result?.data ?? result ?? []` |
| Filesystem read might fail | `try { readdir() } catch { return [] }` ← fine | — |
| JSON from WebSocket has null fields | `json['name'] as String? ?? ''` ← fine | — |

**The test:** If `??` or `as any` exists because "SDK used to return something different" — remove it. If it exists because "runtime operation can genuinely fail" — keep it.

## SDK-Specific Notes

- **Claude Code** (`@anthropic-ai/claude-agent-sdk` 0.3.316, exact pin, bundled CLI 2.1.316): the SDK spawns a native `claude` binary from the optional per-platform package (`@anthropic-ai/claude-agent-sdk-darwin-arm64` etc., ~310 MB); there is no `cli.js`, so a compiled bridge must embed that binary and pass `pathToClaudeCodeExecutable`. Model aliases (sonnet/opus/haiku). New version of same tier = no code change. New tier = add to model union + enum + picker. The local docs in `reference/cc-docs/` date from 2026-01-01; the installed `.d.ts` wins. The contract adapter (`src/backends/claude-code/`, behind `claudeCode.contract`), its plan and research are in `docs/architecture/backends/claude-code/`; its tests run the real CLI against a scripted endpoint in a temp home, never the real `~/.claude`.
- **Pi** (`@earendil-works/pi-coding-agent` 1.4.0, with `@earendil-works/pi-ai` / `pi-agent-core` at 1.4.0, exact pins): Event-driven `AgentSession` with `AgentSessionEvent` streaming. Dynamic models via `ModelRuntime` — it replaced the removed `AuthStorage` / `ModelRegistry.create`, and `createAgentSession` now takes `{ modelRuntime }`. Models/auth come from the user's `~/.pi/agent`: `auth.json` (credentials), `models.json` (custom providers) and `models-store.json` (the pi.dev catalogue cache `pi update --models` writes). A model listing must call `refresh({ allowNetwork: false })` first and read `getAvailable()` — that is exactly what `pi --list-models` prints, and the bridge runs for days over files that change under it (`backends/pi/models/model-runtime.ts`). The user's own `enabledModels` list is resolved by the SDK's `resolveModelScopeWithDiagnostics()` (same file) — never parse `settings.json` by hand. All Pi code lives in `backends/pi/` behind the contract; extension dialogs reach the phone as contract interactions.

### SDK Trust Order (Claude Code)

1. Check the exact pin in `packages/bridge/package.json`; move it deliberately with `cd packages/bridge && bun add -E @anthropic-ai/claude-agent-sdk@<version>`
2. `reference/cc-docs/` — official API docs (primary reference)
3. Installed `.d.ts` files — actual compiled types (trust if docs disagree)
4. `reference/claude-code/` CHANGELOG — CLI changes only, not SDK

### SDK Sync

- `./reference/sync-sdks.sh --all` — thin redirect to `reference/sync.sh --all`: pulls the 2 SDK reference repos into `reference/` (claude-code, pi → `pi-mono`), updates CC npm, writes `reference/<date>_sdk-changes.md`
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

- **Never let a test touch real user data.** Tests must not read or write `~/.pi`, `~/.broski` or `~/.claude`. Inject temp roots instead: config read/write take an explicit path, and the Pi adapter takes its agent directory from its `agentDir` option or `$PI_CODING_AGENT_DIR` (the e2e harness sets it). Real user dirs belong to the running bridge, never to a test.
- **Drive a real agent with a scripted model, not a mock of it.** `packages/bridge/src/__tests__/helpers/` has a scripted OpenAI-compatible endpoint (`scripted-openai-server.ts`); the Pi adapter's tests (`__tests__/pi/`) run a real Pi `AgentSession` against Pi's faux provider or that endpoint, in a throwaway agent dir.
- **Bound long-running / real-data scripts** (session scans, index rebuilds) with a memory watchdog. A session-stats scan over 3,217 real (old-connector) Pi sessions once reached **38 GB RSS** before it was rewritten to stream JSONL through a bounded pool (`utils/bounded-pool.ts`).

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
- **A run, not a turn:** `agent_started`/`agent_finished` are the agent *run* only. Pi's `turn_start`/`turn_end` bracket every model call inside a run and map to nothing (`docs/architecture/notifications.md`); the app's Stop control, completion notification and queue draining all key on the run.
- **Viewers get the deltas:** thinking, text, tool output and `tool_finished` reach only the sockets viewing the session. On the contract, live events go only to the clients attached to the session (`docs/architecture/core/README.md`).
- **Stop is always on screen and always local:** `RunningStopBar` shows while `chatIsRunning`; `stopGeneration` sends the backend abort and `cancelRunLocally()` ends the run on the phone without waiting for the bridge.
