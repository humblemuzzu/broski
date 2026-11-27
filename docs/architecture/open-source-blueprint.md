# Broski Open-Source Architecture & Agent-Authoring Blueprint

> **Purpose:** This document records Broski's open-source architecture and serves as the permanent engineering handbook for adding new coding agents cleanly.
>
> **Status:** All core architecture waves (**open `BackendId`/`PlanId`, `BackendDescriptor`, `CacheWindow` + `CacheClock`, shared `adapter-kit/`, bridge core fallbacks, loopback `/mcp` server, vanilla Pi `broski_ask` + terminal handoff, third-party plugin loader, generic `/hook/<backend>` ingress, and Session Info / Pin / Unread / Mute on iOS & Android**) are **implemented on `main`**. Antigravity is a built-in backend over ACP (`backends/antigravity/`, [notes](backends/antigravity/README.md)). Part III below is the live handbook for adding Codex, Gemini CLI, Cursor, Grok Build, OpenCode, other ACP agents, or standalone npm plugins.

---

## Contents

1. [Architectural Thesis & Core Principles](#1-architectural-thesis--core-principles)
2. [Part I — The Focused Execution Plan (Waves 1–3 + Launch)](#2-part-i--the-focused-execution-plan)
   - [2.1 Wave 1: Open the Contract & Dynamic Mobile Backends](#21-wave-1-open-the-contract--dynamic-mobile-backends)
   - [2.2 Wave 2: Bridge Intelligence, Shared Kit, Bridge MCP & CacheClock](#22-wave-2-bridge-intelligence-shared-kit-bridge-mcp--cacheclock)
   - [2.3 Wave 3: Open-Source Extensibility Seams & Launch Polish](#23-wave-3-open-source-extensibility-seams--launch-polish)
   - [2.4 Multi-Agent Parallel Execution Playbook (Git Worktrees + Review Gates)](#24-multi-agent-parallel-execution-playbook)
3. [Part II — Target Bridge Architecture Reference](#3-part-ii--target-bridge-architecture-reference)
   - [3.1 The Four Layers (Mario-Style Minimalism)](#31-the-four-layers-mario-style-minimalism)
   - [3.2 Complete Feature Ownership Matrix](#32-complete-feature-ownership-matrix)
   - [3.3 Bridge Loopback HTTP MCP Server Specification](#33-bridge-loopback-http-mcp-server-specification)
   - [3.4 Prompt Cache Clock Specification (`CacheWindow`)](#34-prompt-cache-clock-specification-cachewindow)
   - [3.5 Bridge Core Fallbacks (Queue, Steer, Portable Fork)](#35-bridge-core-fallbacks-queue-steer-portable-fork)
4. [Part III — Complete Guide to Adding Any New Agent Later](#4-part-iii--complete-guide-to-adding-any-new-agent-later)
   - [4.1 Choosing the Right Integration Tier](#41-choosing-the-right-integration-tier)
   - [4.2 Tier 0: Building the Shared ACP v1/v2 Adapter (40+ Agents)](#42-tier-0-building-the-shared-acp-v1v2-adapter)
   - [4.3 Tier 1: Building a Minimal Native Adapter (~400–800 LOC)](#43-tier-1-building-a-minimal-native-adapter)
   - [4.4 Tier 2: Full Native Adapters (Codex App Server & OpenCode Blueprints)](#44-tier-2-full-native-adapters-codex--opencode-blueprints)
   - [4.5 Tier 3: Deep Host Adapters (Terminal Mirroring & Detached Holders)](#45-tier-3-deep-host-adapters-terminal-mirroring--detached-holders)
   - [4.6 Packaging as a Third-Party npm Plugin (`broski-adapter-*`)](#46-packaging-as-a-third-party-npm-plugin)
   - [4.7 Conformance Testing, Verification & Merge Checklist](#47-conformance-testing-verification--merge-checklist)
5. [Part IV — Non-Negotiable Invariants & Anti-Patterns](#5-part-iv--non-negotiable-invariants--anti-patterns)

---

## 1. Architectural Thesis & Core Principles

### 1.1 What Broski Is (and What It Refuses to Become)

Broski is a **native, end-to-end encrypted, Inbox-first phone remote** for the AI coding agents already installed on your computer(s):

```
iOS (SwiftUI, Liquid Glass)      Android (Compose, Material 3 Expressive)
              └──────────────┬──────────────┘
               BroskiCore (Rust via UniFFI)
               Noise E2E · LAN/Relay · Reducer · Inbox
                             │  Noise (X25519 + ML-KEM-768)
                  broski-link daemon (Rust)
                             │  unix socket (~/.broski/link/bridge.sock)
                 Broski Bridge (Bun / TypeScript)
                 ├─ Core (hub, replay, wire-fit, InteractionDesk, CacheClock, queue/fork fallbacks)
                 ├─ Bridge Tools (loopback HTTP MCP + generic terminal hook ingress)
                 ├─ Workspace (files, git, native PTY terminals — 100% backend-agnostic)
                 ├─ Usage (pluggable subscription plan meters — 100% backend-agnostic)
                 └─ Adapters (Claude Code, Pi, Antigravity over ACP, future ACP & native plugins)
```

Broski is **not** a desktop IDE, **not** an agent runtime (it never bundles `claude`, `pi`, or any LLM harness), and **not** a cloud enterprise orchestration cluster (no Kafka streams, no multi-tenant cloud POSIX filesystem, no server-side SQLite event store).

Broski wins by staying **sharp, native, private, and thin**:
- **Native mobile craft:** True SwiftUI and Jetpack Compose, native haptics, Live Activities, Android Live Updates, and lock-screen Allow/Deny.
- **Zero-trust transport:** Hybrid post-quantum Noise encryption directly over LAN with an automatic blind relay that never sees plaintext.
- **Respects your terminal:** Runs the exact installed agent, version, config, and extensions you already use locally — and lets you watch and answer sessions started in your Mac terminal.
- **Inbox-first UX:** Separates high-signal human attention (approvals, structured questions, completed-run alerts in the Inbox) from the raw tool-call inspector (one tap away inside a session).

### 1.2 The Empirical Reality of Broski's Codebase Today

Measured directly across non-test TypeScript files in `packages/bridge/src/`:

| Directory | Files | LOC | Responsibility |
|---|---:|---:|---|
| `src/contract/` | 72 | 7,286 | Zod schemas, protocol 1.0, reducer, validator, conformance suite |
| `src/core/` | 45 | 3,399 | Session hub, replay log, keep-open, `InteractionDesk`, `RunClock`, `WireFit` |
| `src/server/` | 37 | 2,665 | Socket seam, loopback TLS/bearer server, daemon push feed (`ContractFeedTap`), CC hook |
| `src/workspace/` | 25 | 2,329 | Files, git, native PTY terminal |
| `src/usage/` | 9 | 789 | Subscription usage readers & history sampler |
| `src/backends/claude-code/` | 191 | 14,520 | Claude Agent SDK 0.3.328 adapter (`live` 2.6k, `mapping` 2.7k, `store` 2.6k, `terminal` 2.4k, `ui` 1.4k) |
| `src/backends/pi/` | 160 | 16,695 | Pi 1.5.2 RPC adapter (`live` 4.2k, `store` 3.4k, `terminal` 2.5k, `mapping` 1.8k, `holder` 1.1k, `rpc` 0.9k, `ui`+`host` 1.1k) |

Two facts jump off the page:
1. **The core is already extraordinarily clean.** `contract/` + `core/` + `workspace/` + `usage/` are strict, layered, mutation-tested, and backend-agnostic. We do **not** tear them down.
2. **Only 6–9% of adapter code is interactions (`ui/`).** Moving voluntary questions to a bridge MCP server gives every agent a great user experience, *and* unlocking open-source extensibility equally requires:
   - Opening the closed `BackendId` and `PlanId` enums so adding an agent never requires an App Store or Play Store release.
   - Moving generic fallbacks (queue, interrupt-restart steer, portable fork, `CacheClock`, external interaction ingress) into `core/`.
   - Extracting duplicated adapter plumbing (`AskDesk`, `PhoneText`, `CursorCodec`, `SafeTrash`, `ImageCache`, `StdioHolder`) into a shared `adapter-kit/`.
   - Allowing third-party adapters via `broski.config.json` and clearly defining Tier 0 / Tier 1 / Tier 2 / Tier 3 expectations.

### 1.3 The Golden Boundary: Voluntary Tools vs Security Gates vs Runtime Control

Every feature in an AI coding remote falls into exactly one of three categories. Mixing them up causes either security theater or brittle bloat:

1. **Voluntary Agent-Initiated Tools → Bridge Loopback HTTP MCP (or Pi Host Tool)**
   - Examples: `broski_ask` (structured questions, pickers, text input), `broski_notify` (mid-run mobile alerts), `broski_propose_plan` (plan review when an agent has no native plan mode).
   - Why here: The model *wants* to communicate with the human. One tiny bridge tool works identically across Pi, Codex, Gemini, Cursor, Grok, OpenCode, and future agents, and automatically triggers Broski's locked-phone push notifications.
   - Token discipline (Mario's rule): Expose **1–3 ultra-tight tools** (~150–250 tokens total), **capability-gate** them so they never duplicate native tools (e.g., hide `broski_ask` on Claude Code where `AskUserQuestion` is built-in), and **freeze the tool list at session start** so prompt caches are never invalidated.

2. **Security Enforcement Gates → Agent Harness Intercept → Bridge `InteractionDesk`**
   - Examples: `tool_permission` (Approve / Deny / Allow Session / Allow Always / Edit Input before executing `bash`, `edit`, `write`, network calls).
   - Why NEVER MCP: Asking an LLM to voluntarily call a permission MCP tool before running a destructive command is unenforceable. Prompt injection or model drift simply skips the MCP call.
   - Enforcement MUST happen inside the agent runtime (`canUseTool` on Claude Code, `tool_call` in Pi's host extension, JSON-RPC approvals on Codex, `session/request_permission` on ACP, pre-tool hooks on terminal CLIs). Once intercepted, every agent hands the ask to Broski's unified `InteractionDesk` and `ContractFeedTap` lock-screen push pipeline.

3. **Runtime & Context Control → Agent Adapter (with Core Fallbacks Where Possible)**
   - Examples: starting/stopping runs, streaming deltas, `compact`, `setModel`, `setThinking`, `setMode`, native `fork`, slash commands, native transcripts.
   - Where an agent lacks an optional runtime feature (`queue`, active `steer`, native `fork`), `BridgeCore` provides an honest, clean fallback rather than leaving the phone button dead or forcing every adapter to reimplement it.

---

## 2. Part I — The Focused Execution Plan

We execute in **3 disciplined engineering waves + a launch polish wave**. Every wave merges to `main` clean, reviewed, and green before the next wave branches off it.

### 2.1 Wave 1: Open the Contract & Dynamic Mobile Backends

**Goal:** Eliminate every hardcoded 2-agent enum across TypeScript, Rust, Swift, and Kotlin in **one single atomic contract update**, and add the `CacheWindow` schema field so we only regenerate Rust and rebuild XCFrameworks/AARs once.

#### Workstream 1A — Contract, Generator & Rust Core (`wt-1a-contract`)

**Files to modify:**
- `packages/bridge/src/contract/ids.ts`
  - Change `BackendId` from `z.enum(["claude-code", "pi"])` to:
    ```ts
    export const BACKEND_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
    export const BackendId = z.string().regex(BACKEND_ID_PATTERN);
    export type BackendId = z.infer<typeof BackendId>;
    ```
  - Export well-known constants (`KNOWN_BACKENDS = { claudeCode: "claude-code", pi: "pi" } as const`) for convenience in tests and built-in wiring — never as a closed wire enum.
- `packages/bridge/src/contract/protocol.ts` & `packages/bridge/src/contract/backend.ts`
  - Add `BackendMeta` to `AgentBackend` and `BackendDescriptor`:
    ```ts
    export const BackendIconHint = z.enum([
      "claude",
      "pi",
      "codex",
      "gemini",
      "cursor",
      "grok",
      "opencode",
      "antigravity",
      "acp",
      "generic",
    ]);

    export const BackendDescriptor = z.strictObject({
      id: BackendId,
      displayName: z.string().min(1).max(MAX_NAME_CHARS),
      /** Optional `#RRGGBB` brand accent for dynamic badges on iOS/Android. */
      accentHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      iconHint: BackendIconHint.optional(),
      capabilities: Capabilities,
    });
    ```
  - Add `readonly meta: BackendMeta` (or `displayName`, `accentHex?`, `iconHint?`) on `AgentBackend` in `contract/backend.ts`. Provide `meta` in `backends/claude-code/backend.ts`, `backends/pi/backend.ts`, and `contract/testing/fake-backend.ts`.
- `packages/bridge/src/contract/plan-usage.ts`
  - Change `PlanId` from `z.enum(["claude", "antigravity"])` to `z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)`.
  - Add `displayName: z.string().min(1).max(MAX_NAME_CHARS).optional()` to `PlanMeter`.
  - Update `PlanUsage.meters` max bound from `PlanId.options.length` to `MAX_PLAN_METERS` (e.g., `32` in `contract/limits.ts`).
- `packages/bridge/src/contract/usage.ts`
  - Add `CacheConfidence` and `CacheWindow`, attached as optional `cache?: CacheWindow` on `Usage`:
    ```ts
    export const CacheConfidence = z.enum(["exact", "estimated"]);

    export const CacheWindow = z.strictObject({
      /** Epoch ms when the latest model request wrote or refreshed the prompt cache. */
      lastTouchAt: Timestamp,
      /** Lifetime from `lastTouchAt` in ms, omitted when the provider publishes no TTL. */
      ttlMs: z.int().positive().optional(),
      confidence: CacheConfidence.optional(),
      /** Cached input tokens on the latest request (not cumulative). */
      cachedTokens: z.int().nonnegative().optional(),
      /** Total prompt tokens on the latest request (for latest-turn hit ratio). */
      promptTokens: z.int().nonnegative().optional(),
    });
    ```
- `packages/bridge/src/contract/capabilities.ts`
  - Add optional honest capability hints (additive, default `false` on existing fakes/adapters until enabled):
    - Keep `Capabilities` crisp; verify `contract-gen/samples.ts` and `contract-gen/type-model.ts` handle regex-validated string aliases cleanly when generating `packages/link/contract/src/generated/`.
- `packages/bridge/scripts/contract-gen/layers.ts`
  - Allow `src/adapter-kit/` as a shared layer that `src/backends/<id>/` may import (and `src/adapter-kit/` may import only `src/contract/` [not `testing/`], `zod`, `node:` built-ins [not `node:module`], and itself — never `core/`, `server/`, or any backend SDK).
  - Allow dynamic/non-enum backend directories cleanly (e.g., explicit SDK allowlist per directory, defaulting to `[]` for zero-SDK adapters like `acp`).
- **Regenerate & update Rust:**
  - Run `bun run contract:gen` in `packages/bridge`.
  - Update `packages/link/contract/` (`src/generated/` is generated; update any hand-written `BackendId` enum matches in `packages/link/client/`, `packages/link/mobile/`, `packages/link/session/`, `packages/link/daemon/` so `BackendId` is `String` / type alias).
  - Verify `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.
  - Rebuild mobile cores:
    - `scripts/build-ios-core.sh` + `(cd apps/ios/BroskiCore && swift test)`
    - `scripts/build-android-core.sh` + `(cd apps/android && ./gradlew :core:testDebugUnitTest)`

#### Workstream 1B — iOS Dynamic Backends (`wt-1b-ios`, parallel with 1C after 1A)

**Files to modify (`apps/ios/Broski/Sources/`):**
- `Core/PhoneStorage.swift`: remove `BackendId.wireName` / `init?(wireName:)` switch (it is now a `String`!). Keep validation via a small helper if needed for deep links/push payloads.
- `DesignSystem/Palette.swift` & `DesignSystem/AgentMark.swift`:
  - Switch from exhaustive enum cases to descriptor-driven rendering:
    - Look up known brand art (`claude-code`, `pi`, plus ready-made icons/palettes for `codex`, `gemini`, `cursor`, `grok`, `opencode`, `antigravity`).
    - For any unknown `BackendId`, render a clean Liquid Glass monogram tile using `BackendDescriptor.displayName` (first 1–2 letters) and `BackendDescriptor.accentHex` (defaulting to neutral slate).
- `App/RootView.swift`, `Core/AppModel.swift`, `Core/LiveRuns.swift`, `Core/PushNotifications.swift`, `Core/MachineModel.swift`: pass `BackendId` string directly, and store `[BackendId: BackendDescriptor]` on `MachineModel` so every row, header, and New Session picker reads `displayName` from the descriptor.
- **Verify:** `BROSKI_SIMULATOR="iPhone Duo" scripts/build-ios-app.sh --test`.

#### Workstream 1C — Android Dynamic Backends (`wt-1c-android`, parallel with 1B after 1A)

**Files to modify (`apps/android/app/src/main/kotlin/com/muzammil/broski/`):**
- `design/AgentMark.kt`: replace exhaustive `when (this)` on `BackendId` enum with descriptor lookup (`displayName`, `accentHex`, `iconHint`) + Material 3 Expressive monogram fallback for unknown slugs.
- `app/Routes.kt`, `app/OpenRequests.kt`, `core/vault/SeenStateCodec.kt`, `feature/notifications/LiveStatus.kt`, `feature/notifications/StopReceiver.kt`, `core/MachineState.kt`, `core/PhoneSession.kt`: migrate from `BackendId.valueOf(...)` / `BackendId.entries` to plain `BackendId` strings.
- Ensure previously persisted `SeenState` entries (`"CLAUDE_CODE"`, `"PI"`) migrate cleanly to `"claude-code"` / `"pi"` on decode so existing installs lose no unread state.
- **Verify:** `(cd apps/android && ./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lint)`.

#### Wave 1 Exit Gate
- `review_code` (`opus`, `high`) across 1A + 1B + 1C.
- `bun run typecheck && bun run lint && bun run check:layers && bun run contract:check && bun test`
- `cargo test --workspace` + iOS unit tests + Android unit tests & lint.
- Merge Wave 1 to `main`.

---

### 2.2 Wave 2: Bridge Intelligence, Shared Kit, Bridge MCP & CacheClock

Once Wave 1 is merged to `main`, **three isolated worktrees run in parallel** with zero overlapping files.

#### Workstream 2A — `adapter-kit/` + Bridge Core Smarts (`wt-2a-core-kit`)

**1. Create `packages/bridge/src/adapter-kit/` (shared adapter building blocks):**

| Module | What it provides | Why it exists |
|---|---|---|
| `adapter-kit/ask-desk.ts` | Generic pending-interaction ledger & promise resolver (mint IDs, signal abort → `withdrawn`, close → `expired`, `answerProblem` guard, first-answer-wins, re-delivery from snapshot) | Today duplicated between `claude-code/ui/{desk,book,ledger,floor}.ts` and `pi/ui/interactions.ts` |
| `adapter-kit/phone-text.ts` | ANSI/CSI/OSC/control-char/UAX-#9 bidi sanitizer + length clipping (`phoneName`, `phoneText`) | Today duplicated in `claude-code/phone-text.ts` and `pi/phone-text.ts` |
| `adapter-kit/cursor.ts` | Versioned, scope-bound opaque cursor encode/decode (`invalid_input` on foreign cursors) | Today duplicated in `claude-code/cursor.ts` and `pi/cursor.ts` |
| `adapter-kit/safe-trash.ts` | Atomic move-to-Trash respecting injected `HOME` (never copies/unlinks; clear FDA error on macOS `EPERM`) | Today duplicated in `claude-code/trash.ts` and `pi/store/delete.ts` |
| `adapter-kit/image-cache.ts` | Bounded LRU cache for base64 image attachments + `ImageRef` helpers | Today duplicated in `claude-code/live/image-cache.ts` and `pi/live/image-cache.ts` |
| `adapter-kit/stdio-holder.ts` | Optional generic detached JSONL stdio process holder + replay log + orphan policy | Extracted cleanly from `pi/holder/` so future stdio adapters (ACP, Codex) can opt into restart-surviving runs |

*(Important discipline: keep `claude-code/` and `pi/` green and low-churn — only swap in `adapter-kit` where trivial and proven by existing tests, never do a risky big-bang rewrite of working Tier 3 adapters.)*

**2. Add 5 bridge-wide smarts to `packages/bridge/src/core/`:**

- **`core/cache-clock.ts`** (modeled directly on `core/run-clock.ts`):
  - Observes every `usage_updated` and `run_finished` event on every open session.
  - Stamps `usage.cache.lastTouchAt` automatically when a turn completes if the adapter didn't provide it.
  - Computes latest-turn `cachedTokens` and `promptTokens` from sequential usage deltas when the adapter only reports cumulative totals.
  - Preserves `CacheWindow` across idle session close/reopen via a bounded map (512 entries, 24h TTL) so reattaching to a warm session still shows the real countdown.
- **`core/bridge-queue.ts`**:
  - Activated automatically for any backend whose `traits.queue === false` (or when `promptModes` omits `"queue"` — opt-in via a clean core policy).
  - Holds up to 32 queued `PromptInput` items per session in memory, emits synthetic `queue_changed` events to phones, supports per-item `queue.cancel`, pins the session open (`keep-open.ts`), returns items via `input_returned` on `abort()`, and dispatches the next queued prompt as `mode: "start"` immediately after `run_finished`.
  - Result: **any** future Tier 1 or ACP adapter gets full queue + per-item cancel UI for free without writing a single line of queue logic.
- **`core/steer-fallback.ts`**:
  - For backends whose `promptModes` lacks native `"steer"`, provides an opt-in interrupt-and-restart steering policy: `abort()` active run → await `run_finished` → immediately dispatch the steering prompt.
  - Never activates on backends that already implement native `steer` (Claude Code, Pi).
- **`core/portable-fork.ts`**:
  - When `session.fork` is requested on a backend that has no native `backend.fork` method:
    - Reads the normalized transcript up to `ForkPoint` via `readTranscript`.
    - Formats a bounded, auditable `<broski_context_handoff>` preamble (capped at 64 KiB, keeping newest turns intact).
    - Opens a new session in the same `cwd` and remembers the pending handoff so the user's first prompt carries the context cleanly.
  - Native `backend.fork` always wins when present (Claude Code, Pi).
- **`core/external-interactions.ts` (`BridgeCore.raiseExternalInteraction`):**
  - Exposes one clean method on `BridgeCore` (and `ContractSeam`):
    ```ts
    raiseExternalInteraction(
      session: SessionRef,
      spec: ExternalInteractionSpec,
      signal: AbortSignal,
    ): Promise<ExternalInteractionOutcome>
    ```
  - Flow:
    1. Acquires a core `hold(session)` so the session cannot idle-close while waiting.
    2. Injects an `interaction_requested` event directly into the session's `LiveSession` stream (incrementing `seq`, updating `SessionSnapshot.interactions`, triggering `ContractFeedTap` → **instant encrypted push notification on locked phone!**).
    3. Routes `interaction.answer` from any attached phone (or lock-screen decision via `BridgeCore.answer`) through `InteractionDesk` (`answerProblem` validation + first-answer-wins) and resolves the waiting Promise instead of forwarding to `OpenSession.control.answer` (since the interaction is bridge-owned, not adapter-owned).
    4. Emits `interaction_resolved` (`answered` / `withdrawn` on signal abort or session `abort()` / `expired` on shutdown) and releases the hold.
  - **Also add `BridgeCore.emitExternalNotice(session, notice)`** so `broski_notify` can emit a live `notice` event + trigger an immediate push notification when `urgency === "high"`.

**Verification for 2A:** Full unit tests in `src/__tests__/core_cache_clock.test.ts`, `core_bridge_queue.test.ts`, `core_steer_fallback.test.ts`, `core_portable_fork.test.ts`, `core_external_interactions.test.ts`, plus `bun run mutate:core --check` and `bun run check:layers`.

---

#### Workstream 2B — Bridge HTTP MCP Server + Vanilla Pi `broski_ask` + Cache TTL Wiring (`wt-2b-mcp-cache`)

**1. Build `packages/bridge/src/mcp/` (Loopback Authenticated Streamable HTTP MCP Server):**
- **Files:**
  - `src/mcp/session-tokens.ts` — `McpSessionRegistry`: mints 32-byte random hex bearer tokens scoped to `{ session: SessionRef, capabilities: Set<"ask" | "notify" | "plan"> }`. Tokens expire on session close or max lifetime (24h), compared in constant time, never logged or persisted.
  - `src/mcp/tools.ts` — Exact tool definitions, Zod input schemas, and capability-gating filter (see Section 3.3).
  - `src/mcp/http-server.ts` — Implements MCP Streamable HTTP (`POST /mcp` JSON-RPC 2.0 + SSE response stream with **20-second `notifications/progress` heartbeats** while awaiting human answers). Mounted on Broski's existing loopback server (`src/server/http-handler.ts`), using the same TLS cert already trusted by local agents.
  - `src/mcp/index.ts` — Clean facade exposed to `server/contract-backends.ts` and `BackendFactory` options.
- **Wire into Claude Code (`backends/claude-code/process/options.ts`):**
  - Pass Broski's MCP server with **only** `broski_notify` enabled (optional config flag `bridgeTools.notify`, default `true` or opt-in — **never** enable `broski_ask` or `broski_propose_plan` on Claude Code because Claude has native `AskUserQuestion` and `ExitPlanMode`!).
  - Total overhead on Claude Code: ~65 tokens (or 0 tokens if disabled in config).
- **Wire `broski_ask` directly into Vanilla Pi (`backends/pi/host/extension/index.ts`):**
  - Register a native Pi tool named `broski_ask` (unless another user extension already registered an `ask` tool — inspect `pi.getAllTools()` at `session_start` or expose cleanly under `broski_ask`) inside `broski-host`:
    - Uses the exact same `broski-questions:` RPC UI channel that `broski:questions` already uses (`host/extension/index.ts:77-96`)!
    - **Why inside `broski-host` instead of Pi's native `mcp.json`?** Because Pi's native MCP has a 60-second default timeout (`docs/mcp.md:68`), whereas `broski-host`'s RPC dialog channel has **no timeout** and already survives bridge restarts through Pi's `holder/`!
    - Result: **Vanilla Pi (zero custom extensions installed)** immediately gains structured multiple-choice / multi-select / free-text question cards on iOS & Android + locked-phone push notifications.
- **Wire exact Prompt Cache TTL into Claude Code & Pi:**
  - **Claude Code (`backends/claude-code/mapping/usage.ts`):**
    - Read `modelUsage[main].cacheCreationEphemeral5mInputTokens` and `cacheCreationEphemeral1hInputTokens` (`sdk.d.ts:1575-1579`).
    - Read the last `message` iteration in `result.usage.iterations` for exact latest-turn `cachedTokens = cache_read_input_tokens` and `promptTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
    - Derive `ttlMs`: if `ephemeral1h > 0` (delta vs previous turn, or cumulative 1h active), `ttlMs = 3_600_000`; else if `ephemeral5m > 0 || cacheReadInputTokens > 0 || cacheCreationInputTokens > 0`, `ttlMs = 300_000`; `confidence = "exact"`.
  - **Pi (`backends/pi/mapping/usage.ts` & `backends/pi/live/usage-feed.ts`):**
    - Inspect the latest assistant message's usage (`cacheRead`, `cacheWrite`, `cacheWrite1h`) and model provider/retention:
      - Anthropic with `cacheWrite1h > 0` or `PI_CACHE_RETENTION=long` → `ttlMs = 3_600_000`, `confidence = "exact"`.
      - Anthropic default (`short`) → `ttlMs = 300_000`, `confidence = "exact"`.
      - OpenAI / Codex → `confidence = "estimated"` (5–10m or 24h only when configured, otherwise omit `ttlMs` and report `cachedTokens` + `promptTokens` only).
      - Unknown / Grok / implicit Gemini → omit `ttlMs`, report `cachedTokens` + `promptTokens` only.

**Verification for 2B:**
- Unit + real HTTP integration tests in `src/__tests__/mcp_server.test.ts` (auth rejection, token revocation on close, `broski_ask` blocking + 20s progress heartbeat + answer resolution + abort withdrawal, capability gating hiding `broski_ask` on Claude Code, prompt-cache static-list check).
- Real Pi CLI test in `src/__tests__/pi/live_broski_ask.test.ts` proving vanilla Pi (with no user `ask` extension) calls `broski_ask`, pauses, shows a `questions` interaction, and resumes with the human's answer.
- Claude Code & Pi usage mapping tests verifying `CacheWindow` (`5m`, `1h`, latest-turn hit %, omitted TTL).

---

#### Workstream 2C — Mobile UI for Prompt Cache Timer & Dynamic Agent Polish (`wt-2c-mobile-cache-ui`)

**iOS (`apps/ios/Broski/Sources/Features/Chat/`):**
- Add a lightweight `CacheStatusPill` / subtitle element in `ChatHeader.swift` (and detailed breakdown in the session info sheet):
  - Uses `TimelineView(.periodic(from: .now, by: 1))` **only while `expiresAt > now`** (stops ticking the instant the cache expires so idle views burn zero CPU/battery!).
  - Exact TTL warm: `Cache · 3m 42s · 94%` (green/amber as remaining time drops under 60s).
  - Estimated TTL warm: `~3m · 94% cached`.
  - Expired or no TTL (Grok / implicit Gemini): `91% cached` (when `cachedTokens > 0`), hidden when no caching occurred.
- In the model picker (`ComposerCatalog` / model switcher): when `cache` is warm and `cachedTokens >= 20_000`, display a subtle inline note: *"Cache warm (142k tokens, 3m left) — switching models will re-cache."*

**Android (`apps/android/app/src/main/kotlin/com/muzammil/broski/feature/chat/`):**
- Mirror the exact same behavior in `ChatLayout.kt` and the session details sheet using a Compose `LaunchedEffect` 1-second ticker that cancels automatically once expired.
- Mirror the subtle warm-cache note in the model picker sheet.

#### Wave 2 Exit Gate
- Merge `2A` → `main`.
- Merge `2B` → `main` (connect `/mcp` handler to `ContractSeam.raiseExternalInteraction`).
- Merge `2C` → `main`.
- Run `review_code` (`opus`, `high`) on the integrated Wave 2 diff.
- Run full test matrix: `bun test`, `cargo test --workspace`, iOS simulator unit tests, Android unit tests + lint.

---

### 2.3 Wave 3: Open-Source Extensibility Seams & Launch Polish

**Goal:** Make Broski genuinely open-source ready so contributors can plug in external adapters, usage meters, and terminal hooks cleanly — without shipping 40 untested agents ourselves.

#### Workstream 3A — Extensibility Seams (`wt-3a-extensibility`)
1. **External Adapter Plugin Loader (`src/config/schema.ts` + `src/server/plugin-loader.ts` + `src/server/contract-backends.ts`):**
   - Extend `BroskiConfigSchema` with:
     ```ts
     adapters: z.array(z.object({
       id: BackendId,
       module: z.string().min(1),       // npm package name or absolute path
       enabled: z.boolean().default(true),
       config: z.record(z.string(), z.unknown()).optional(),
     })).default([])
     ```
   - `server/plugin-loader.ts` (outside `core/` and `backends/`, so `layers.ts` static-import guarantees stay 100% intact!) loads each enabled plugin at startup, validates that it exports `createBroskiAdapter(ctx): BackendFactory`, and hands `(id, factory)` to `BridgeCore.addBackend`.
   - A broken plugin never crashes the bridge — `BackendRegistry` already contains factory failures and surfaces them in `status()`.
2. **Pluggable Plan Usage Registry (`src/usage/usage-reader.ts`):**
   - Register `PlanSource` implementations dynamically (`claude`, `antigravity`, plus clean registration hook for plugin-supplied meters).
3. **Generic Terminal Hook Ingress (`src/server/hook-ingress.ts`):**
   - Refactor `server/cc-terminal-hook.ts` behind a clean router (`/hook/<backend>`, keeping `/cc-terminal-hook` aliased for backwards compatibility) so future terminal hooks (Gemini `BeforeTool`, Cursor `hooks.json`, Grok hooks) reuse the exact same bearer-auth + `hold()`/`release()` + bounded-body receiver.

#### Workstream 3B — Open-Source Hygiene, Docs & Full Proof (`wt-3b-oss-polish`)
1. **Personal Reference & Signing Audit:**
   - Remove the hardcoded personal tailnet hostname from `AGENTS.md` / scripts (read from env var `BROSKI_OTA_HOST` instead).
   - Ensure iOS `project.yml` signing team / bundle IDs override cleanly via local `Local.xcconfig` (gitignored) with a clear `Local.xcconfig.example`.
   - Verify `.env.local` and personal keys are never required to build or run tests.
   - Add a crisp single-command self-hosting guide (and Dockerfile if absent) for `packages/link/relay/`.
2. **Public Documentation:**
   - Root `README.md`: crisp pitch, visual architecture diagram, 2-minute quickstart, security model summary, macOS host + Linux roadmap note.
   - `ARCHITECTURE.md`: 1-page visual map of the 4 layers linking to `docs/architecture/`.
   - `CONTRIBUTING.md`: dev setup, test rules, PR guidelines, linking directly to Part III of this blueprint for adapter authors.
3. **End-to-End Verification & Real Device Smoke Test:**
   - `packages/bridge`: `bun run typecheck`, `bun run lint`, `bun run check:layers`, `bun run contract:check`, `bun test`, `bun run mutate:core --check`.
   - `packages/link`: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo clippy -p broski-contract --all-targets -- -D warnings`, `cargo test --workspace`.
   - iOS: `scripts/build-ios-core.sh`, `(cd apps/ios/BroskiCore && swift test)`, `BROSKI_SIMULATOR="iPhone Duo" scripts/build-ios-app.sh --test`, `BROSKI_SIMULATOR="iPhone Duo" scripts/e2e-ios-app.sh`.
   - Android: `scripts/build-android-core.sh`, `scripts/build-android-terminal.sh`, `(cd apps/android && ./gradlew :core:assembleDebug :core:assembleRelease :core:testDebugUnitTest :terminal:testDebugUnitTest :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :app:lint)`, `scripts/check-android-alignment.sh`.
   - Live device check: `scripts/dev-daemon.sh restart`, `scripts/install-ios-wifi.sh` — verify live Claude Code + vanilla Pi `broski_ask` push notification on locked iPhone, prompt cache countdown, and clean shutdown of simulators afterward.

---

### 2.4 Multi-Agent Parallel Execution Playbook

When executing this plan with `delegate` (`model: "opus"`, `thinking: "high"`) and `review_code` (`model: "opus"`, `thinking: "high"`):

| Wave | Worktree Path | Branch | Parallel? | Owned Paths (Strict Non-Overlap) |
|---|---|---|---|---|
| **1A** | `.worktrees/wt-1a-contract` | `feat/open-contract` | Solo first | `packages/bridge/src/contract/**`, `packages/bridge/scripts/contract-gen/**`, `packages/bridge/src/backends/{claude-code,pi}/backend.ts`, `packages/link/**` |
| **1B** | `.worktrees/wt-1b-ios` | `feat/ios-open-backends` | Parallel w/ 1C | `apps/ios/**` |
| **1C** | `.worktrees/wt-1c-android` | `feat/android-open-backends` | Parallel w/ 1B | `apps/android/**` |
| **2A** | `.worktrees/wt-2a-core-kit` | `feat/core-smarts-kit` | Parallel w/ 2B, 2C | `packages/bridge/src/adapter-kit/**`, `packages/bridge/src/core/**`, `packages/bridge/src/__tests__/core_*.test.ts` |
| **2B** | `.worktrees/wt-2b-mcp-cache` | `feat/mcp-and-cache-ttl` | Parallel w/ 2A, 2C | `packages/bridge/src/mcp/**`, `packages/bridge/src/server/http-handler.ts`, `packages/bridge/src/backends/pi/host/**`, `packages/bridge/src/backends/{claude-code,pi}/mapping/usage.ts`, `packages/bridge/src/__tests__/mcp_*.test.ts` |
| **2C** | `.worktrees/wt-2c-mobile-cache` | `feat/mobile-cache-ui` | Parallel w/ 2A, 2B | `apps/ios/Broski/Sources/Features/Chat/**`, `apps/android/app/src/main/kotlin/.../feature/chat/**` |
| **3A** | `.worktrees/wt-3a-extensibility` | `feat/extensibility-seams` | Parallel w/ 3B | `packages/bridge/src/config/**`, `packages/bridge/src/server/{plugin-loader,hook-ingress,contract-backends}.ts`, `packages/bridge/src/usage/**` |
| **3B** | `.worktrees/wt-3b-oss-polish` | `feat/oss-polish` | Parallel w/ 3A | `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `AGENTS.md`, `scripts/**`, `apps/ios/Broski/project.yml` |

**Rules for every delegate launch:**
1. Create worktree cleanly from latest `main`: `git worktree add .worktrees/<name> -b <branch> main`.
2. Give each delegate its exact owned paths, exact verification commands, and explicit prohibition against touching files outside its boundary.
3. Never trust a delegate's self-report blindly — inspect `git diff main...<branch>`, run `review_code` (`opus`, `high`) on the diff, fix all Important findings, re-verify tests, fast-forward/merge to `main`, and remove the worktree (`git worktree remove .worktrees/<name>`).

---

## 3. Part II — Target Bridge Architecture Reference

### 3.1 The Four Layers (Mario-Style Minimalism)

Inspired by Mario Zechner's 4-package Pi architecture (`pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`), Broski's bridge enforces strict one-way dependencies via `bun run check:layers`:

```
Layer 1: src/contract/       → imports ONLY: zod, itself (+ bun:test in testing/)
Layer 2: src/core/           → imports ONLY: contract (no testing/), zod, CORE_INFRASTRUCTURE, itself
Layer 3: src/adapter-kit/    → imports ONLY: contract (no testing/), zod, node: (no node:module), itself
Layer 4: src/backends/<id>/  → imports ONLY: contract (no testing/), adapter-kit/, zod, node: (no node:module), own SDK, itself
Wiring:  src/server/ + mcp/  → connects listeners, core, workspace, usage, plugins, and backends
```

**Why this guarantees long-term cleanliness:**
- `core/` can never accidentally import Claude Code, Pi, or Node filesystem APIs.
- No adapter can ever reach into another adapter or bypass `BridgeCore`.
- `adapter-kit/` is pure helper code — never a framework that forces inheritance.

### 3.2 Complete Feature Ownership Matrix

| Feature | Primary Owner | Bridge Role | Adapter Role | Fallback When Unsupported |
|---|---|---|---|---|
| **Structured Questions (`questions`)** | Bridge MCP (`broski_ask`) / Native Override | Raises `Interaction`, validates via `answerProblem`, sends locked-phone push via `ContractFeedTap` | Either pass Bridge MCP URL (or Pi `broski-host` tool), OR disable `broski_ask` and route native tool (`AskUserQuestion`, OpenCode `question`) | Always available for any MCP-capable agent |
| **Mid-run Phone Alerts** | Bridge MCP (`broski_notify`) | Emits `notice` + optional high-priority push notification | Pass Bridge MCP URL | Optional; zero cost when disabled |
| **Tool Permissions (`tool_permission`)** | Agent Harness Gate | Unified `InteractionDesk`, option rendering, validation, lock-screen Allow/Deny | Intercept in real execution pipeline (`canUseTool`, Pi `tool_call`, ACP `request_permission`, Codex RPC, CLI hooks) | Never faked via MCP; runs under agent's native mode |
| **Plan Approval (`plan_approval`)** | Native Preferred / Bridge MCP Fallback | Renders Markdown plan + Approve/Reject/Feedback card | Native (`ExitPlanMode`, Codex plan) OR enable `broski_propose_plan` MCP tool | Bridge MCP `broski_propose_plan` |
| **Compact (`/compact`)** | Agent Adapter | UI button, `compaction_started/finished` state, keep-open | Execute agent's native compaction (`compact` RPC, `/compact`, ACP) | Button hidden when `SessionCapabilities.compact` is false |
| **Fork (`fork`)** | Agent Adapter (Preferred) / Bridge Core Fallback | Exposes `session.fork`, tracks lineage | Native `backend.fork()` (Claude `forkSession`, Pi v3 JSONL, Codex `thread/fork`, ACP `session/fork`) | `core/portable-fork.ts` bounded transcript handoff into a fresh session |
| **Prompt Cache Timer & Hit %** | Bridge Core (`CacheClock`) + Adapter TTL Hint | Tracks `lastTouchAt`, per-turn hit %, preserves across idle close; phone ticks locally | Emit `Usage.cache.ttlMs` + `confidence` when known (CC 5m/1h, Pi retention) | Show hit % only (never fake a countdown when TTL is unknown) |
| **Context Window Fill** | Agent Adapter | Displays fill bar + warning | Emit `Usage.contextTokens` & `Usage.contextWindow` | Hidden when absent |
| **Plan / Subscription Usage** | Bridge (`src/usage/`) | Periodic 15m sampling + history charts + open `PlanId` | None (read independently per provider credentials) | Shown per signed-in plan |
| **Queue & Per-Item Cancel** | Native OR Bridge Core (`BridgeQueue`) | Holds queue, emits `queue_changed`, cancels items, dispatches sequentially | Optional native queue (Pi `followUp`) | `core/bridge-queue.ts` handles automatically |
| **Steering mid-run (`steer`)** | Native OR Bridge Core (`SteerFallback`) | Routes `mode: "steer"` | Native active steer (Pi, Claude `priority: "next"`, Codex) | Optional interrupt-and-restart in `core/steer-fallback.ts` |
| **Streaming Text / Thinking / Tools / Diffs** | Agent Adapter → Bridge Core | `seq`/`epoch`, 4 MiB replay log, `WireFit`, Rust reducer, `broski-render` | Emit normalized `block_*` and `tool_*` events | Non-streaming agents emit finished blocks whole |
| **Models / Thinking / Modes / Commands** | Agent Adapter | Opaque pickers in iOS & Android — zero UI branching | Return `ModelSummary[]`, `ThinkingSpec`, `ModeAxis[]`, `CommandSummary[]` | Pickers auto-hide when empty |
| **Subagents / Child Sessions** | Agent Adapter | Renders nested tool calls + child session links | Emit `tool_updated(child_session)` + `parent: { kind: "subagent" }` | Hidden when `traits.children` is false |
| **Files / Git / PTY Terminal** | Bridge (`src/workspace/`) | 100% served by bridge behind path policy | None | Always available |
| **Dictation / Markdown / Highlighting** | Phone Core (`broski-voice`, `broski-render`) | None | None | Always available |
| **Run Elapsed Clock (`runStartedAt`)** | Bridge Core (`RunClock`) | Tracks active run start across all backends | Optional earlier start for pre-existing terminal runs | Always available |
| **Terminal Session Watch & Hook Answering** | Tier 3 Adapter + Generic `/hook/<backend>` | `BridgeCore.hold/release`, `OpenSession.answer` without `control` | File tail / terminal link extension / CLI hook installer | Optional Tier 3 capability (`externalLive`) |
| **Restart-Surviving Runs** | `adapter-kit/StdioHolder` (Optional) | Reattaches smoothly under new `RunId` | Opt-in detached holder for stdio processes | Runs end cleanly on bridge restart |

---

### 3.3 Bridge Loopback HTTP MCP Server Specification

**Endpoint:** `https://127.0.0.1:<loopback-port>/mcp` (Streamable HTTP, MCP protocol `2025-06-18`).

#### Authentication & Session Binding
- Before an adapter spawns or opens a hosted session, it requests a credential from `McpSessionRegistry`:
  ```ts
  const cred = mcp.issue({
    session: ref,
    tools: {
      ask: !backend.traits.interactions.includes("questions"),
      plan: !backend.traits.interactions.includes("plan_approval"),
      notify: config.bridgeTools.notify,
    },
  });
  // cred = { url: "https://127.0.0.1:<port>/mcp", token: "<64-hex>", revoke(): void }
  ```
- Every HTTP request must carry `Authorization: Bearer <token>`.
- The token binds the call to one exact `SessionRef` and one frozen tool set. An agent cannot ask questions on another session, cannot elevate privileges, and cannot alter its tool set mid-session.
- `cred.revoke()` runs when the hosted session closes or disposes.

#### Tool Definitions (Frozen at Session Start — ~150–250 Tokens Total)

1. **`broski_ask`** *(only registered when backend lacks native `questions`)*
   - Description: `"Ask the user structured questions on their phone and wait for their answer. Use for decisions, preferences, or clarifications—never for tool permissions."`
   - Input schema:
     ```ts
     {
       title: string,                    // max 120 chars
       questions: Array<{
         id: string,                     // short stable key, e.g. "store"
         header?: string,                // short tab/chip label, 1-3 words
         text: string,                   // full question
         options?: Array<{
           label: string,
           description?: string,
         }>,
         multiSelect?: boolean,          // default false
         allowCustom?: boolean,          // default true
         secret?: boolean,               // default false (masks input on phone)
         required?: boolean,             // default true
       }>                                // 1..10 questions
     }
     ```
   - Annotations: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }`.
   - Behavior: Calls `BridgeCore.raiseExternalInteraction(session, { kind: "questions", ... }, signal)`.
   - **Timeout defense (mandatory):** Responds with `Content-Type: text/event-stream` and emits an MCP `notifications/progress` frame every **20 seconds** (`{ progress, message: "Waiting for user response on Broski" }`) while pending. Resets client timeouts (Pi, ACP, Claude Code, Codex) indefinitely until the user answers or the run is aborted.
   - Return value: `{ status: "answered", answers: [{ id, selected, custom? }] }` or `{ status: "cancelled", message? }`.

2. **`broski_notify`** *(optional, ~60 tokens)*
   - Description: `"Send a brief progress update or alert to the user's phone without pausing your run."`
   - Input schema:
     ```ts
     {
       title: string,                    // max 120 chars
       body?: string,                    // max 500 chars
       urgency?: "normal" | "high",      // "high" sends an immediate push alert
     }
     ```
   - Behavior: Non-blocking. Sanitizes text via `adapter-kit/phone-text.ts`, emits a `notice` event on the session, and when `urgency === "high"` triggers a push notification through `ContractFeedTap`. Returns `{ sent: true }` immediately.

3. **`broski_propose_plan`** *(only registered when backend lacks native `plan_approval`)*
   - Description: `"Present a Markdown implementation plan to the user on their phone and wait for Approve or Reject with feedback."`
   - Input schema: `{ title: string, plan: string }`.
   - Behavior: Same blocking SSE + 20s progress heartbeat pattern via `raiseExternalInteraction` (`kind: "plan_approval"`). Returns `{ decision: "approve" | "reject", plan?, feedback? }`.

#### Cache Safety & Security Invariants for Bridge MCP
- **Never** call `notifications/tools/list_changed` mid-session — changing declared tools breaks Anthropic/OpenAI prefix caches.
- **Never** expose `broski_ask` on a session where the backend natively handles `questions` (prevents duplicate tool confusion and wasted tokens).
- **Never** expose any permission-granting or mode-changing MCP tool.
- **Always** sanitize all incoming MCP strings through `adapter-kit/phone-text.ts` (strips ANSI escapes, C0/C1 controls, and UAX #9 bidi spoofing characters) before displaying on the phone.
- **For Codex App Server (future Tier 2):** Register blocking tools (`broski_ask`, `broski_propose_plan`) with `omit_tools_from = ["code_mode", "deferred"]` because Codex Code Mode yields after ~30 seconds.
- **For Pi:** Register `broski_ask` directly in `backends/pi/host/extension/index.ts` over Pi's RPC UI channel (bypasses Pi's 60s native MCP timeout and survives bridge restarts via `holder/`).

---

### 3.4 Prompt Cache Clock Specification (`CacheWindow`)

#### Provider Ground Truth

| Provider / Path | Cache Lifetime (TTL) | Confidence | Source of Truth |
|---|---|---|---|
| Anthropic (Claude Code SDK 0.3.328) | `300_000` (5m) or `3_600_000` (1h) | `"exact"` | `ModelUsage.cacheCreationEphemeral5mInputTokens` / `cacheCreationEphemeral1hInputTokens` (`sdk.d.ts:1575-1579`) |
| Anthropic via Pi (`pi-ai` 1.5.2) | `300_000` (5m) or `3_600_000` (1h) | `"exact"` | `usage.cacheWrite1h` (`pi-ai/dist/types.d.ts:297`) + `getPromptCacheTtlMs` (`cache-warming.js:26`) |
| OpenAI / Codex (in-memory) | ~5–10 min (or 24h when extended retention active) | `"estimated"` (or omit `ttlMs`) | `cached_tokens` reported; eviction time not guaranteed |
| Google Gemini (implicit) | Uncontrolled (up to 24h best-effort) | Omit `ttlMs` | Report `cachedTokens` & `promptTokens` hit % only |
| Google Gemini (explicit) | Configured TTL (default 1h) | `"exact"` | Explicit cache TTL |
| xAI Grok | Unspecified (load-evicted) | Omit `ttlMs` | Report `cachedTokens` & `promptTokens` hit % only |

#### Wire & Client Behavior
- The bridge sends `Usage.cache` **only on `usage_updated` / snapshot** (zero polling, zero timer frames).
- Phone calculates locally:
  - `expiresAt = cache.lastTouchAt + cache.ttlMs`
  - `remainingMs = max(0, expiresAt - now)`
  - `hitRatio = cache.promptTokens > 0 ? cache.cachedTokens / cache.promptTokens : undefined`
- If `cache.ttlMs` is absent, the UI displays **hit ratio only** (never fabricates a timer).
- When `remainingMs > 0` and `cachedTokens >= 20_000`, the model switcher displays a gentle warm-cache warning before switching models.

---

### 3.5 Bridge Core Fallbacks (Queue, Steer, Portable Fork)

These live in `src/core/` so every future adapter (ACP or Tier 1 native) feels complete immediately:

1. **`core/bridge-queue.ts`:**
   - Triggered when a phone sends `prompt(mode: "queue")` to a session whose backend does not declare `traits.queue`.
   - Core accepts `{ status: "accepted", disposition: "queued", queueItemId }`, appends to per-session bounded queue (max 32), emits `queue_changed`, keeps the session open via `holdsOpen()`, handles `queue.cancel(queueItemId)` directly in core, returns remaining texts via `input_returned` on `abort()`, and automatically dispatches the head item via `control.prompt({ mode: "start", ... })` once `run_finished` settles.
2. **`core/steer-fallback.ts`:**
   - Triggered when `prompt(mode: "steer")` arrives while a run is active on a backend whose `traits.promptModes` lacks `"steer"` (and core fallback is enabled for that backend).
   - Core calls `control.abort()`, waits for `run_finished` (bounded by 10s deadline), then dispatches the steering prompt with `mode: "start"`.
3. **`core/portable-fork.ts`:**
   - Triggered when `session.fork(ref, at?)` targets a backend whose `backend.fork` method is `undefined`.
   - Core reads the finished transcript up to `at`, builds a deterministic, bounded `<broski_context_handoff>` summary (max 64 KiB, newest messages prioritized), calls `backend.open({ kind: "new", options: { cwd } })`, records the fork relationship in a core fork journal (`~/.broski/core/forks.jsonl`), and prepends the handoff transparently to the first prompt sent on the forked session.

---

## 4. Part III — Complete Guide to Adding Any New Agent Later

This section is your reusable playbook for adding **any** coding agent after Waves 1–3 are done — whether you add it yourself in a weekend or an open-source contributor submits a PR or publishes an npm plugin.

### 4.1 Choosing the Right Integration Tier

Use this decision tree before writing a single line of code:

```
Does the agent speak ACP (Agent Client Protocol, e.g. --acp or agent stdio)?
  ├── YES ─► Does the agent need features ACP lacks (active steering, native rollback, terminal mirroring)?
  │            ├── NO  ─► TIER 0: Add a 10-line preset to `backends/acp/` (or user config). Done!
  │            └── YES ─► Start on TIER 0 (ACP) first; upgrade later to TIER 2 (Native) if needed.
  └── NO  ─► Does the agent expose an SDK, JSON-RPC, or HTTP/SSE API?
               ├── Basic chat + streaming + tools ─► TIER 1: Minimal Native Adapter (~400–800 LOC)
               ├── Rich permissions + fork + compact + usage ─► TIER 2: Full Native Adapter (~1.5k–3k LOC)
               └── Also want Mac terminal session live mirroring ─► TIER 3: Deep Host Adapter
```

| Tier | Target Agents | Estimated Effort | Conformance Rules Required |
|---|---|---:|---|
| **Tier 0 (ACP Preset)** | Gemini CLI, Cursor CLI, Grok Build, OpenCode, Codex-ACP, Kiro, Goose, Copilot CLI, 40+ ACP Registry agents (Antigravity is built in) | ~15 lines config (once `backends/acp/` exists) | Covered automatically by `backends/acp/` conformance suite |
| **Tier 1 (Minimal Native)** | Custom/niche CLIs, Aider-style tools, internal company agents | ~400–800 LOC | Core subset (auto-gated by `traits` — all optional capabilities off) |
| **Tier 2 (Full Native)** | OpenAI Codex (`codex app-server`), OpenCode (`opencode serve`), Cursor (`@cursor/sdk`) | ~1,500–3,000 LOC | Full `runConformance` for every declared trait |
| **Tier 3 (Deep Host)** | Claude Code (done), Pi (done) | Existing reference | All 28 rules incl. `externalLive` / `watchedAsk` / `runsSurviveRestart` |

---

### 4.2 Tier 0: Building the Shared ACP v1/v2 Adapter

**What exists:** Antigravity is a built-in backend that runs `agy acp` (`packages/bridge/src/backends/antigravity/`, [notes](backends/antigravity/README.md)). Its `acp/` folder is an agent-neutral ACP v1 client (connection, JSON-RPC both ways, the payload readers); it moves to `adapter-kit/` when a second ACP agent arrives, and the shared adapter below starts from it. agy 1.5.18 speaks ACP v1 only: the client asks for v1 and refuses an agent that answers another version, so the v2 rows below do not apply to it.

When you are ready to unlock Gemini CLI, Cursor CLI, Grok Build, OpenCode, Codex-ACP, and 40+ ACP Registry agents in one move, build **one** adapter at `packages/bridge/src/backends/acp/`.

#### Directory Layout (~12–15 small files, <1,500 LOC total)

```
packages/bridge/src/backends/acp/
  factory.ts           acpBackendFactory(preset, services) → BackendFactory
  backend.ts           AgentBackend implementation over ACP process pool
  traits.ts            Capabilities derived dynamically from ACP initialize response
  presets.ts           Built-in presets (gemini, cursor, grok, opencode, codex-acp)
  protocol/
    transport.ts       Newline-delimited JSON-RPC 2.0 over stdio (uses adapter-kit/ + bounded 32 MiB frames)
    schemas.ts         Strict Zod schemas for ACP v1 & v2 methods/notifications
    negotiate.ts       Version negotiation: prefer ACP v2, gracefully fall back to ACP v1
  live/
    session.ts         OpenSession + SessionControl over one ACP sessionId
    mapper.ts          ACP session/update → Broski AgentEvent[]
    permissions.ts     ACP session/request_permission → Broski tool_permission (via adapter-kit/ask-desk.ts)
    elicitation.ts     ACP v2 elicitation → Broski form / confirm
    config-options.ts  ACP configOptions / modes → Broski ModeAxis + ModelSummary + ThinkingSpec
  store/
    sessions.ts        ACP session/list + session/resume + fallback local index when agent lacks session/list
```

#### Exact ACP → Broski Mapping Table

| ACP Method / Notification | Broski Contract Equivalent | Notes |
|---|---|---|
| `initialize` → `capabilities` | `BackendTraits` + `BackendStatus` | Negotiate v2 first, fallback to v1; never spawn sessions during `status()` probe |
| `session/new({ cwd, mcpServers, configOptions })` | `open({ kind: "new" })` | **Inject Broski's `/mcp` server directly in `mcpServers`!** (Must use absolute path if stdio, or HTTP URL + bearer header if agent advertises HTTP MCP.) agy advertises no HTTP MCP, so Antigravity opens every session with `mcpServers: []` |
| `session/list` | `listSessions(query, page)` | Paginate via `adapter-kit/cursor.ts`; filter by canonical `cwd` |
| `session/resume` / `session/load` | `open({ kind: "existing" })` + `readTranscript` | Wait for ACP v2 `replay_complete` before resolving `open()` snapshot; over v1, agy replays the history before it answers `session/load` |
| `session/fork` (when advertised) | `fork(ref, at?)` | Omit `backend.fork` when agent doesn't advertise `session.fork` → `BridgeCore` portable fork kicks in automatically! |
| `session/prompt` | `control.prompt({ mode: "start" })` | Map `ImageContent` attachments; `BridgeCore` handles `queue` & `steer` fallbacks |
| `session/cancel` | `control.abort()` | Settle all open blocks, running tools, and pending asks before `run_finished(aborted)` |
| `session/update: agent_message_chunk` | `block_started` / `block_delta` / `block_finished` (`kind: "text"`) | Close open blocks on message change or `run_finished` |
| `session/update: agent_thought_chunk` | `block_started` / `block_delta` / `block_finished` (`kind: "thinking"`) | Declare `streamThinking: true` |
| `session/update: tool_call` / `tool_call_update` | `tool_started` / `tool_updated` / `tool_finished` | Extract file diffs into `fileChanges`; sanitize titles/outputs with `adapter-kit/phone-text.ts` |
| `session/request_permission` (v1 & v2) | `interaction_requested` (`kind: "tool_permission"`) | Preserve agent's native `optionId`s verbatim! Never invent fake option IDs. Handle cancel → `{ outcome: { outcome: "cancelled" } }` |
| `session/elicitation` (v2) | `interaction_requested` (`kind: "form"` or `"confirm"`) | Map form schema to `FormFieldSpec[]`; URL elicitation → `confirm{ url }`. Over v1, agy asks its questions as a form `elicitation/create`, which Antigravity reads as `questions` |
| `session/update: usage_update` | `usage_updated` | Map context window, tokens, cumulative cost; `CacheClock` automatically stamps `lastTouchAt` |
| `session/update: compaction_update` | `compaction_started` / `compaction_finished` | Handle `in_progress`, `completed`, `failed`, `cancelled` |
| `session/update: available_commands_update` | `listCommands` + `catalog_invalidated("commands")` | Expose slash commands & skills cleanly |
| `session/set_config_option` / `session/set_mode` | `setModel`, `setThinking`, `setMode` | Wait until options are advertised before applying initial settings (classic ACP trap!) |

#### Built-In Preset Table (Added to `backends/acp/presets.ts` Later)

| Preset `id` | `displayName` | Command & Args | Default `iconHint` | Special Notes |
|---|---|---|---|---|
| `gemini` | `Gemini CLI` | `gemini --acp` | `gemini` | Reads `~/.gemini/policies/*.toml`; supports HTTP MCP |
| `cursor` | `Cursor` | `agent acp` | `cursor` | Uses `.cursor/mcp.json` + ACP `mcpServers`; watch out for team MCP exclusion |
| `grok` | `Grok Build` | `grok agent stdio` | `grok` | Optional tiny flavor for xAI custom question extension, else uses Bridge MCP `broski_ask` |
| `opencode` | `OpenCode` | `opencode acp` | `opencode` | Must pass session's `cwd` on load/resume/fork; emits built-in `compact` |
| `codex` | `Codex` | `codex-acp` | `codex` | Great Day-1 Tier 0 path; can be swapped to native `codex app-server` (Tier 2) seamlessly using the same `BackendId: "codex"` |

Antigravity is not a preset: it is the built-in `antigravity` backend, which runs `agy acp`.

#### User-Defined Custom ACP Agents in `~/.broski/config.json`

Once `backends/acp/` exists, any user can add any unlisted ACP agent with zero code:

```json
{
  "acpAgents": [
    {
      "id": "goose",
      "displayName": "Goose",
      "command": "/usr/local/bin/goose",
      "args": ["acp"],
      "accentHex": "#4F46E5"
    }
  ]
}
```

#### Testing the ACP Adapter
Write a 200-line scripted fake ACP stdio server (`src/__tests__/acp/helpers/fake-acp-agent.ts`) that speaks real JSON-RPC 2.0 over stdin/stdout (supporting both v1 and v2 modes, permissions, streaming chunks, tool calls, usage, compaction, and calling back to Broski's `/mcp` `broski_ask`), and run the full `runConformance("acp", ...)` suite against it!

---

### 4.3 Tier 1: Building a Minimal Native Adapter (~400–800 LOC)

When an agent does **not** speak ACP (or you want direct native control), here is the minimal, clean skeleton using `adapter-kit/` and `BridgeCore` fallbacks.

#### Recommended Directory Layout

```
packages/bridge/src/backends/<id>/
  factory.ts         Exports `<id>BackendFactory(options) → BackendFactory`
  backend.ts         Implements `AgentBackend` (thin orchestration over parts)
  traits.ts          Declares honest `BackendTraits` + `BackendMeta`
  status.ts          Checks binary on PATH / version / auth (NEVER throws!)
  live/
    session.ts       Implements `OpenSession` & `SessionControl`
    mapper.ts        Native stream frames → Broski `SinkRecord[]`
  store/
    sessions.ts      Lists sessions & reads finished transcripts (uses `adapter-kit/cursor.ts`)
```

#### Minimal `AgentBackend` Skeleton

```ts
import type {
  AgentBackend,
  BackendFactory,
  BackendTraits,
  OpenResult,
  OpenSession,
  OpenTarget,
  SessionControl,
  SessionRef,
  SessionSink,
} from "../../contract";
import { applyEvent, emptySnapshot } from "../../contract";
import { createAskDesk, phoneText, encodeCursor, decodeCursor } from "../../adapter-kit";

export const MY_AGENT_TRAITS: BackendTraits = {
  streamText: true,
  streamThinking: false,
  promptModes: ["start"],         // BridgeCore handles queue + steer fallback automatically!
  attachments: [],                // Add "image" only when readAttachment() works byte-for-byte
  commands: false,
  queue: false,                   // BridgeCore provides BridgeQueue automatically
  interactions: [],               // Add "tool_permission" when native gate is wired;
                                  // Bridge MCP handles "questions" automatically via core!
  thinking: false,
  children: false,
  usage: false,
  planProposals: false,
  externalLive: false,
  extensions: [],
};

export function myAgentBackendFactory(deps: MyAgentDeps): BackendFactory {
  return async (host) => {
    const openSessions = new Map<string, HostedSession>();

    const backend: AgentBackend = {
      id: "my-agent",
      meta: {
        displayName: "My Agent",
        accentHex: "#0EA5E9",
        iconHint: "generic",
      },
      traits: MY_AGENT_TRAITS,

      // Rule 5: status() NEVER throws — return usable: false + issues[] instead.
      async status() {
        const cli = await probeBinary(deps.cliPath);
        if (!cli.found) {
          return {
            installed: false,
            auth: "unknown",
            usable: false,
            issues: [{ severity: "error", message: cli.reason, fix: "Install my-agent CLI" }],
          };
        }
        return { installed: true, version: cli.version, auth: cli.auth, usable: true, issues: [] };
      },

      async listSessions(query, page) {
        // Validate cursor via adapter-kit/cursor.ts; reject foreign cursors with "invalid_input"
        // Return newest updatedAt first, filtered by canonical query.cwd
      },

      async getSession(ref) { /* Return SessionSummary or rejected("not_found", ...) */ },

      async readTranscript(ref, page) {
        // CRITICAL MERGE RULE (contract README §8):
        // Return FINISHED runs ONLY! While a session has an active run, stop before that run's
        // first item so transcript and snapshot.run.items never overlap or duplicate.
      },

      async readAttachment(_ref, _id) {
        return { status: "rejected", rejection: { code: "not_found", message: "No attachments" } };
      },

      async listModels(_cwd) { return { status: "accepted", models: [] }; },
      async listCommands(_scope) { return { status: "accepted", commands: [] }; },
      async listModes(_cwd) { return { status: "accepted", modes: [] }; },

      async open(target: OpenTarget, sink: SessionSink): Promise<OpenResult> {
        // 1. Resolve or create sessionId
        // 2. Issue scoped Bridge MCP token (deps.mcp.issue({ session: ref, tools: ... }))
        // 3. Build initial SessionSnapshot BEFORE emitting anything to sink (Rule 1!)
        // 4. Maintain snapshot by passing EVERY emitted SinkRecord through applyEvent() (Rule 2!)
        // 5. On close(): detach sink immediately, reject subsequent control calls with "closed",
        //    do NOT abort an active run (Rule 24!)
      },

      async dispose() {
        // Close all open sessions, revoke MCP tokens, silence catalog sink (Rule 25!)
      },
    };

    return backend;
  };
}
```

#### The 5 Mandatory Contract Invariants Every Tier 1 Adapter Must Satisfy

1. **Snapshot-before-events (Rule 1 & Rule 2):** Nothing enters `sink.emit()` until `open()` has resolved with its initial `snapshot`. After `open()` resolves, `session.snapshot()` must *always* equal the open snapshot with every emitted event folded through `applyEvent()`. Easiest way: keep a single `liveState` object whose only `emit(record)` method updates `snapshot = applyEvent(snapshot, record)` and then calls `sink?.emit(record)`.
2. **Idempotent `prompt` by `clientRequestId` (Rule 14):** Remember accepted `clientRequestId`s in the open session and return the original `PromptResult` on duplicates. Never remember rejections (`busy`, `invalid_input`). Echo `clientRequestId` on the emitted `user_message` event AND persist/attach it in `readTranscript`.
3. **Balanced stream lifecycle (Stream Rules 1–6):** Every `run_started` ends with exactly one `run_finished`. Every open `block_started` and `tool_started` closes before `run_finished` (even on crash or abort!). Never reuse a `runId`, `blockId`, `toolCallId`, or `interactionId` within a session.
4. **No overlap between live snapshot and transcript (Rule 23):** While a run is active, `readTranscript` stops strictly before that run's first item. Once `run_finished` fires, the finished run appears in `readTranscript`.
5. **Non-destructive `close()` (Rule 24):** Calling `OpenSession.close()` detaches the sink so nothing more is emitted and subsequent `control.*` calls reject `closed` — it must **never** abort an active run or auto-deny a pending interaction.

---

### 4.4 Tier 2: Full Native Adapters (Codex & OpenCode Blueprints)

When a contributor wants richer native fidelity than ACP provides, here are the exact verified protocol blueprints for the two highest-value Tier 2 upgrades:

#### Blueprint A: Native OpenAI Codex (`codex app-server`)
- **Transport:** Bidirectional JSON-RPC 2.0 over stdio JSONL (`codex app-server`; note Codex omits the `"jsonrpc": "2.0"` header field on the wire).
- **Capabilities gained over ACP:**
  - Native active steering & queued turns.
  - Native `fork`: `thread/fork` with inclusive `lastTurnId` (or rollback via `thread/revert` on paginated history).
  - Native approvals: server-initiated JSON-RPC approval requests (`approval_policy`: `on-request`, `never`, etc.) → map directly to `tool_permission` via `adapter-kit/ask-desk.ts`, keeping native decision payloads intact.
  - Native async questions: Codex emits non-blocking question notifications answered by posting a user message; preserve as `questions` interaction or wire Bridge MCP `broski_ask`.
  - Native `/compact` and rich per-turn token usage (`cached_tokens` → `Usage.cache` with `confidence: "estimated"` or `"exact"` if `prompt_cache_options.ttl` is configured).
- **Bridge MCP injection note:**
  - Pass Broski's `/mcp` server in `thread/start`, `thread/resume`, and `thread/fork` `mcp_servers` config with the per-session `Authorization: Bearer <token>` header.
  - **CRITICAL:** Register `broski_ask` / `broski_propose_plan` with `omit_tools_from = ["code_mode", "deferred"]` because Codex's Code Mode yields scripts after ~30 seconds, which breaks human-blocking tools!
- **Process gotchas:**
  - Handle RPC error `-32001` (overloaded → `retry_scheduled`) and `-32600` (`serverShuttingDown`).
  - Opt out of `turn/diff/updated` if you want lightweight streaming, or map file patches directly to `ToolUpdate(file_changes)`.
  - Watch out for Codex `/goal` multi-turn continuations (a new native turn can start milliseconds after the prior one ends — keep the Broski run open until the goal settles).

#### Blueprint B: Native OpenCode (`opencode serve`)
- **Transport:** Local HTTP + SSE server (`opencode serve`, authenticated with `OPENCODE_SERVER_PASSWORD`).
- **Capabilities gained over ACP:**
  - Native `POST /session/:id/fork` (with optional `messageID`).
  - Native `POST /session/:id/permissions/:permissionID` (map OpenCode's `once` / `always` carefully: OpenCode persists `"always"` at project scope, so for session-scoped allows reply `once` and track session allowlist in the adapter).
  - Native `question` tool (`/question/:id/reply`, `/question/:id/reject`) → **disable Bridge MCP `broski_ask`** on OpenCode to avoid duplicate question tools!
  - Native `GET /session/:id/children` for child subagent sessions.
  - Native `POST /session/:id/abort`, native compaction, and steering/queue.
- **MCP scoping note:**
  - OpenCode registers MCP servers per directory, while Broski's MCP tokens are per session. On OpenCode 2.x, register a session-namespaced server key (`broski-<shortSessionId>`) and deny other sessions' keys in session permission rules so two concurrent sessions in one folder never collide on tokens.

---

### 4.5 Tier 3: Deep Host Adapters (Terminal Mirroring & Detached Holders)

Only build Tier 3 when you want **live Mac terminal ↔ phone handoff** (like Claude Code and Pi already have):

1. **Watch-only terminal sessions with answerable asks (`OpenSession.answer` without `control`):**
   - Never grant `control` on a session another terminal process owns (two writers corrupt JSONL session files!).
   - Instead, open the session with `control: undefined` and `answer: (reply) => ...`.
   - `SessionCapabilities` automatically derives `controllable: false, answer: true`: the phone hides the composer but shows active Approve/Deny and Question cards (and lock-screen Allow/Deny works automatically!).
2. **Plug into Generic Terminal Hook Ingress (`/hook/<backend>`):**
   - Install a non-blocking HTTP hook (or small command script calling `curl` against `https://127.0.0.1:<port>/hook/<backend>` with the loopback bearer token and `NODE_EXTRA_CA_CERTS`).
   - When the bridge is down, the hook must fail **open to the terminal prompt** (never hang or auto-deny the user's terminal!).
   - While waiting for a human answer on the phone, the receiver holds the session open via `ContractSeam.hold(ref)` and releases it on settlement.
3. **Detached Restart-Surviving Runs (`adapter-kit/stdio-holder.ts`):**
   - For stdio-based agents that abort when stdin closes (like `pi --mode rpc`, ACP, or `codex app-server`), launch the agent inside `StdioHolder` (`setsid`, separate process group, unix socket + bounded replay log + orphan timeouts: 10m idle / 4h running / 24h waiting for human).
   - On bridge restart, adopt live holders before opening new processes so runs and pending phone asks survive bridge upgrades seamlessly (`runsSurviveRestart: true`).

---

### 4.6 Packaging as a Third-Party npm Plugin (`broski-adapter-*`)

Once Wave 3A lands, external developers never need to fork Broski to ship an adapter.

#### Plugin Contract
A third-party npm package exports one named factory:

```ts
// package: broski-adapter-example
import type { BroskiPluginContext, BackendFactory } from "broski-bridge/plugin";

export function createBroskiAdapter(ctx: BroskiPluginContext): BackendFactory {
  // ctx provides:
  //   ctx.config          - user's custom config block from ~/.broski/config.json
  //   ctx.env             - login-shell environment (PATH, HOME, API keys)
  //   ctx.mcp             - McpSessionRegistry.issue() for injecting Bridge MCP
  //   ctx.phoneWriting    - optional phone-formatting prompt note
  //   ctx.fitImage        - image resizing/compression helper
  //   ctx.stateDir        - isolated writable folder under ~/.broski/adapters/<id>/
  //   ctx.log             - structured logger
  return async (host) => {
    // return AgentBackend
  };
}
```

#### User Installation (2 steps)
1. `bun add -g broski-adapter-example` (or point `module` to a local path).
2. Add to `~/.broski/config.json`:
   ```json
   {
     "adapters": [
       { "id": "example", "module": "broski-adapter-example", "enabled": true }
     ]
   }
   ```
3. `broski-link` restarts the bridge → `backends.list` announces `example` with its `displayName` and `accentHex` → **existing iOS and Android apps immediately show it in New Session and Inbox with zero app update.**

---

### 4.7 Conformance Testing, Verification & Merge Checklist

Every adapter (built-in or third-party) proves correctness against **Broski's 28-rule conformance suite** (`packages/bridge/src/contract/testing/run-conformance.ts`).

#### How to Write a Conformance Driver
Implement `ConformanceDriver` (`src/contract/testing/conformance-types.ts`) against a **real local process + scripted model endpoint** (never mock the agent's core behavior):
- Use temp directories (`mktemp`) for `HOME`, agent config dirs, and `cwd` — `safety/real-home-guard` will fail any test that touches `~/.claude`, `~/.pi`, or `~/.broski`.
- Route the agent's model calls to a local scripted HTTP server (`__tests__/helpers/scripted-openai-server.ts` or `scripted-anthropic-server.ts`), or for ACP a scripted stdio ACP server.
- Run `runConformance("my-agent", factory)`. Rules for capabilities your adapter declares `false` automatically verify that undeclared actions reject cleanly with `unsupported` rather than crashing!

#### Pre-Merge / Pre-Publish Checklist for Any New Adapter

- [ ] **Open `BackendId` slug:** lowercase alphanumeric + hyphens (`^[a-z0-9][a-z0-9-]{0,63}$`), clear `meta.displayName` and `meta.accentHex`.
- [ ] **Honest capabilities:** Every declared `true` trait is genuinely implemented and exercised by `runConformance`. Every unsupported feature is `false` or absent (so `BridgeCore` fallbacks or UI hiding work cleanly).
- [ ] **No faked permissions:** `tool_permission` only reflects real harness enforcement, never an advisory LLM prompt or MCP tool.
- [ ] **Bridge MCP hygiene:** If injecting Broski's `/mcp` server, pass the scoped bearer token in headers (never argv or logged output), keep the tool list frozen per session, hide `broski_ask` if native questions are supported, and revoke the token on session close.
- [ ] **Prompt cache hygiene:** Never mutate the session's system prompt or tool declarations mid-conversation. Emit `Usage.cache.ttlMs` only when known (never fabricate a timer).
- [ ] **Input & output sanitization:** Every title, body, preview, option label, notice, and tool output passes through `adapter-kit/phone-text.ts`. Every wire string/list respects `contract/limits.ts`.
- [ ] **Error values, never throws:** `status()` never throws; every fallible method returns `{ status: "accepted", ... } | Rejected`; sinks never throw.
- [ ] **No auto-answering:** Pending interactions wait indefinitely until a human answers/cancels, the agent withdraws them, or the process/bridge exits.
- [ ] **Process & memory hygiene:** Child processes run in their own process group, clean up on `dispose()`, respect bounded memory on large outputs/transcripts, and pass a leak check (zero stray processes after tests).
- [ ] **Checks pass:** `bun run typecheck`, `bun run lint`, `bun run check:layers`, `bun test src/__tests__/<id>/`.

---

## 5. Part IV — Non-Negotiable Invariants & Anti-Patterns

If you remember only ten rules while maintaining or reviewing open-source PRs for Broski, make it these ten:

1. **Never put tool permissions (`Approve/Deny`) behind a voluntary MCP tool.** Security gates must intercept tool execution inside the agent harness.
2. **Never auto-answer an interaction on a timeout.** Only a human, an explicit backend withdrawal, or process/bridge exit may end an ask.
3. **Never mutate a session's system prompt or MCP tool list mid-session.** Doing so silently destroys prompt caching and multiplies the user's API bill.
4. **Never fabricate a prompt-cache countdown.** Only show a ticking timer when the provider/SDK has a real TTL (e.g., Anthropic 5m/1h); otherwise show cache hit % alone.
5. **Never branch mobile UI behavior on `BackendId`.** Branch only on `Capabilities`, `SessionCapabilities`, and `BackendDescriptor` metadata.
6. **Never bundle an agent binary or take over the user's agent installation.** Always drive the user's installed binary from config or login-shell `PATH` so they keep their exact version, auth, and extensions.
7. **Never grant `control` to a watch-only terminal session.** Use `OpenSession.answer` without `control` so the phone can answer terminal prompts without racing the terminal as a second writer.
8. **Never let an adapter bypass `answerProblem` or `CoreObserver`.** All answers flow through `InteractionDesk` (strict validation + first-answer-wins), and all push notifications flow through `ContractFeedTap`.
9. **Never touch the user's real home directory in tests, and never leak ambient credentials across isolated instances.** Enforce via `safety/real-home-guard`.
10. **Keep the bridge lean.** Resist turning Broski into an Electron IDE, a 30-tool orchestrator, or a cloud workflow engine. Every added line in `core/` must serve *every* agent; everything else belongs at the edge.

---

## Appendix A — All 28 Conformance Rules by Adapter Tier

Broski's conformance suite (`packages/bridge/src/contract/testing/conformance.ts`) runs each rule against a fresh backend instance. Rules for optional capabilities automatically verify clean `unsupported` rejections when a trait is `false`. Use this table when building or reviewing any new adapter.

| Rule | What It Proves | Tier 0 (ACP) | Tier 1 (Minimal) | Tier 2 (Full Native) | Tier 3 (Deep Host) | Common Mistake That Fails It |
|---:|---|---|---|---|---|---|
| **1** | `Capabilities` matches implemented methods; `status()` returns valid `BackendStatus` without throwing | Required | Required | Required | Required | Throwing in `status()` when CLI is missing instead of returning `usable: false` |
| **2** | Models + thinking options have unique IDs, at most one default, valid defaults, usable listed before unavailable | Required | Required | Required | Required | Returning duplicate `"default"` and resolved model aliases (CC D12) |
| **3** | Commands list uniquely when `commands: true`, or reject/empty when `false` | Required | Auto-gated | Required | Required | Declaring `commands: true` while listing 0 commands in test workspace |
| **4** | Mode axes & options have unique IDs/values and valid defaults | Required | Auto-gated | Required | Required | Passing mode default value not present in `options[]` |
| **5** | `listSessions` pages newest-first inside canonical `cwd`, concatenates cleanly, rejects foreign cursors | Required | Required | Required | Required | Returning sessions from parent git repo instead of requested worktree `cwd` |
| **6** | `getSession` returns accurate ref, cwd, origin, status; `not_found` for unknown | Required | Required | Required | Required | Returning `backend_error` instead of `not_found` for missing session |
| **7** | `readTranscript` pages newest-first, concatenates without gaps/dupes, preserves `clientRequestId`, rejects foreign cursors | Required | Required | Required | Required | Splitting a multi-block assistant message incorrectly or dropping `clientRequestId` |
| **8** | `rename`, `fork` (whole + `before`/`through`), `delete` update summaries & emit catalog events | Auto-gated | Auto-gated | Required | Required | Forgetting `catalog.emit(session_updated / session_removed)` after mutation |
| **9** | Single run streams text (`streamText`), echoes `clientRequestId` on `user_message`, ends once `completed` | Required | Required | Required | Required | Missing `clientRequestId` echo or emitting `block_finished.text` ≠ joined deltas |
| **10** | Tool call starts and finishes inside active run with valid IDs | Required | Required | Required | Required | Leaving a `RunningTool` open when `run_finished` fires |
| **11** | Every declared feature (`thinking`, `usage`, `planProposals`, `children`) emits its contract event | Auto-gated | Auto-gated | Required | Required | Declaring `usage: true` without emitting `usage_updated` during/after a run |
| **12** | Declared attachment kinds & commands reach the model; undeclared ones reject `unsupported` | Auto-gated | Auto-gated | Required | Required | Silently ignoring an unsupported `FileContent` attachment instead of rejecting |
| **13** | Images come back as `ImageRef` live & in transcript and `readAttachment` returns exact bytes | Auto-gated | Auto-gated | Required | Required | Returning inline base64 in transcript or forgetting `not_found` on unknown ID |
| **14** | Repeat accepted `clientRequestId` runs once with same result; rejected `busy` prompt can retry with same ID | Required | Required | Required | Required | Caching a `busy` rejection so the user's retry after the run ends is still rejected |
| **15** | `prompt(mode: "start")` while a run is active rejects `busy` | Required | Required | Required | Required | Silently queueing a `start` prompt instead of rejecting `busy` |
| **16** | `prompt(mode: "steer")` joins active run (`steered`) or rejects `unsupported` when undeclared | Auto-gated | Auto-gated | Required | Required | Accepting `steer` without declaring `"steer"` in `traits.promptModes` |
| **17** | `queue` shows in `queue_changed`, cancellable via `cancelQueued` (second cancel rejects), else `unsupported` | Auto-gated | Auto-gated | Required | Required | Reusing queue item IDs or accepting duplicate cancels |
| **18** | `abort()` with no run is accepted & silent; during a run ends it `aborted` | Required | Required | Required | Required | Emitting `run_finished(error)` instead of `run_finished(aborted)` on user Stop |
| **19** | `setModel` / `setThinking` emit `model_changed`, refuse invalid values, apply to next run | Auto-gated | Auto-gated | Required | Required | Sending `"default"` sentinel raw to provider or accepting unlisted model ID |
| **20** | `NewSessionOptions.modes` and `setMode` emit `mode_changed`, reject unknown axis/value with `invalid_input` | Auto-gated | Auto-gated | Required | Required | Writing mode before ACP agent advertises `configOptions` |
| **21** | `compact()` runs as one `compaction_started` → `compaction_finished` cycle when supported | Auto-gated | Auto-gated | Required | Required | Starting compaction while another compaction is already open |
| **22** | Every declared interaction kind validates (`invalid_input`), resolves once (`answered`), repeats `stale`, obeys `cancel{stopRun}`, withdraws on `abort` | Required | Auto-gated | Required | Required | Leaving pending ask open after `abort()` or throwing on malformed reply |
| **23** | Mid-run `snapshot()` equals open snapshot + emitted events; `run.items` holds active run while transcript holds none of it; reopen matches | Required | Required | Required | Required | Overlapping active run items in both `readTranscript` and `snapshot.run.items` |
| **24** | `close()` is idempotent, silent afterward, rejects control with `closed`, aborts nothing, preserves pending asks for next `open()` | Required | Required | Required | Required | Killing the running child process inside `OpenSession.close()` |
| **25** | `dispose()` closes every open session and silences catalog sink | Required | Required | Required | Required | Emitting a stray `session_updated` from a file watcher after `dispose()` |
| **26** | With `externalLive: true`, a run started by another client reports live with `trigger: "external"` | Optional | Optional | Optional | Required | Failing to distinguish bridge-sent prompts from external terminal prompts |
| **27** | Sessions survive bridge restart; runs either end cleanly or continue under a fresh `RunId` (`runsSurviveRestart`) | Required | Required | Required | Required | Reusing pre-restart `RunId` or losing the session file on restart |
| **28** | Watched session with `answer` (no `control`) validates, resolves once, repeats `stale`, rejects `closed` after close | Optional | Optional | Optional | Required | Exposing both `control` and `OpenSession.answer` on the same open session |

---

## Appendix B — Bridge MCP Wire Transcript & `adapter-kit/` Usage Reference

### B.1 Exact Wire Exchange for `broski_ask` over Streamable HTTP (`/mcp`)

This is the exact HTTP/SSE sequence a compliant MCP client (ACP agent, Codex, Cursor, Gemini, custom agent) exchanges with Broski's bridge when calling `broski_ask`:

```http
POST /mcp HTTP/1.1
Host: 127.0.0.1:41234
Authorization: Bearer <64-char-hex-session-token>
Content-Type: application/json
Accept: application/json, text/event-stream
mcp-protocol-version: 2025-06-18

{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "broski_ask",
    "arguments": {
      "title": "Database choice",
      "questions": [
        {
          "id": "db",
          "header": "Database",
          "text": "Which database should we use for local caching?",
          "options": [
            { "label": "SQLite", "description": "Zero setup, single file" },
            { "label": "Postgres", "description": "Matches production" }
          ],
          "multiSelect": false,
          "allowCustom": true,
          "required": true
        }
      ]
    },
    "_meta": { "progressToken": "tok-7" }
  }
}
```

**Bridge response (Streamable HTTP SSE — keeps the connection alive while the phone is locked):**

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

event: message
data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"tok-7","progress":1,"message":"Waiting for user response on Broski"}}

... (one heartbeat every 20 seconds while pending; resets client 60s tool timeouts) ...

event: message
data: {"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"{\"status\":\"answered\",\"answers\":[{\"id\":\"db\",\"selected\":[\"SQLite\"]}]}"}],"structuredContent":{"status":"answered","answers":[{"id":"db","selected":["SQLite"]}]},"isError":false}}
```

If the user taps **Stop** on the phone or dismisses the card:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "content": [{ "type": "text", "text": "{\"status\":\"cancelled\",\"message\":\"The user dismissed the question.\"}" }],
    "structuredContent": { "status": "cancelled", "message": "The user dismissed the question." },
    "isError": false
  }
}
```

### B.2 `adapter-kit/ask-desk.ts` Reference Pattern

Every native or ACP adapter that handles native permissions or elicitations uses the same 10-line pattern instead of writing its own promise ledger:

```ts
import { createAskDesk } from "../../adapter-kit/ask-desk";

const desk = createAskDesk({
  emit: (record) => liveState.emit(record),
  stopRun: () => void abortActiveRun(),
});

// Inside your agent's native permission callback (e.g., ACP session/request_permission):
async function onNativePermission(req: AcpPermissionRequest, signal: AbortSignal) {
  const outcome = await desk.ask({
    runId: liveState.activeRunId(),
    title: phoneName(`Allow ${req.toolName}`),
    request: toToolPermissionRequest(req), // preserves native optionIds verbatim!
    signal,                                // agent cancel → emits interaction_resolved("withdrawn")
  });
  if (outcome.kind !== "answered" || outcome.reply.kind !== "tool_permission") {
    return { outcome: { outcome: "cancelled" } };
  }
  return { outcome: { outcome: "selected", optionId: outcome.reply.optionId } };
}

// Inside SessionControl.answer(answer):
answer(answer) {
  return Promise.resolve(desk.answer(answer)); // validates via answerProblem, first-answer-wins!
}
```

---

## Appendix C — Exact Cross-Stack File Touchpoint Map (Wave 1 & Wave 2C)

Use this verified file list when running Waves 1 and 2C so no platform falls out of sync:

### TypeScript Bridge (`packages/bridge/`)
- **Contract schemas:** `src/contract/ids.ts`, `src/contract/protocol.ts`, `src/contract/backend.ts`, `src/contract/plan-usage.ts`, `src/contract/usage.ts`, `src/contract/limits.ts`, `src/contract/schema-registry.ts`
- **Generator & layers:** `scripts/contract-gen/type-model.ts`, `scripts/contract-gen/samples.ts`, `scripts/contract-gen/rust-emit.ts`, `scripts/contract-gen/layers.ts`
- **Core smarts:** `src/core/core.ts`, `src/core/backend-registry.ts`, `src/core/live-session.ts`, `src/core/keep-open.ts`, `src/core/interaction-desk.ts`, `src/core/run-clock.ts`, plus new `cache-clock.ts`, `bridge-queue.ts`, `steer-fallback.ts`, `portable-fork.ts`, `external-interactions.ts`
- **Server & MCP:** `src/server/contract-seam.ts`, `src/server/contract-backends.ts`, `src/server/http-handler.ts`, `src/server/cc-terminal-hook.ts`, plus new `src/server/hook-ingress.ts`, `src/server/plugin-loader.ts`, `src/mcp/{index,http-server,session-tokens,tools}.ts`
- **Config & Usage:** `src/config/schema.ts`, `src/usage/usage-reader.ts`
- **Built-in Adapters:** `src/backends/claude-code/{backend.ts,process/options.ts,mapping/usage.ts}`, `src/backends/pi/{backend.ts,host/extension/index.ts,mapping/usage.ts,live/usage-feed.ts}`

### Rust Link & Mobile Core (`packages/link/`)
- **Generated contract:** `packages/link/contract/src/generated/` (regenerated via `bun run contract:gen` — never edit by hand)
- **Client core:** `packages/link/client/src/catalog/{mod,lists,state}.rs`, `packages/link/client/src/exported.rs`
- **UniFFI facade:** `packages/link/mobile/src/{machine,values}.rs`
- **Push & session:** `packages/link/session/src/push.rs`, `packages/link/daemon/tests/push_vectors.rs`

### iOS App (`apps/ios/Broski/Sources/`)
- **Open `BackendId` & Descriptor:** `Core/PhoneStorage.swift`, `Core/MachineModel.swift`, `Core/AppModel.swift`, `Core/LiveRuns.swift`, `Core/PushNotifications.swift`, `App/RootView.swift`, `DesignSystem/Palette.swift`, `DesignSystem/AgentMark.swift`
- **Cache Timer & Model Switch Warning:** `Features/Chat/Header/ChatHeader.swift`, `Features/Chat/Composer/ComposerCatalog.swift`, `Features/Chat/NewSession/{NewSessionModel,NewSessionScreen,ProjectChooser}.swift`

### Android App (`apps/android/app/src/main/kotlin/com/muzammil/broski/`)
- **Open `BackendId` & Descriptor:** `design/AgentMark.kt`, `app/Routes.kt`, `app/OpenRequests.kt`, `core/MachineState.kt`, `core/PhoneSession.kt`, `core/vault/SeenStateCodec.kt`, `feature/notifications/{LiveStatus,StopReceiver}.kt`
- **Cache Timer & Model Switch Warning:** `feature/chat/ChatLayout.kt`, `feature/chat/composer/Catalog.kt`, `feature/newsession/{NewSessionViewModel,NewSessionScreen,ProjectChooser}.kt`

