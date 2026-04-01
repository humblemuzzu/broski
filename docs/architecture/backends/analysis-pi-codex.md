# Analysis: Pi & Codex Real-Time Sync, Permissions, and Questionnaires

> Generated: 2026-03-31
> Scope: How Broski implements real-time streaming, permission approval, and user-input/questionnaire flows for the Pi and Codex backends.
> Sources: Architecture docs (`pi.md`, `codex.md`), bridge connectors, handlers, runtime event mappers, Flutter providers, and git history `ab0d9f9..d647e1a`.

---

## Table of Contents

1. [Pi: Current Real-Time Sync Implementation](#1-pi-current-real-time-sync-implementation)
2. [Pi: Extension UI System](#2-pi-extension-ui-system)
3. [Pi: Permission Handling](#3-pi-permission-handling)
4. [Pi: Question / Input Handling](#4-pi-question--input-handling)
5. [Pi: Tool Use Display](#5-pi-tool-use-display)
6. [Pi: What Changed in d647e1a](#6-pi-what-changed-in-d647e1a)
7. [Codex: Current Real-Time Sync Implementation](#7-codex-current-real-time-sync-implementation)
8. [Codex: Permission Handling](#8-codex-permission-handling)
9. [Codex: User Input / Questions](#9-codex-user-input--questions)
10. [Codex: Tool Use Display](#10-codex-tool-use-display)
11. [Codex: Streaming Issues](#11-codex-streaming-issues)
12. [Cross-Cutting: Pi vs Codex Event Architecture](#12-cross-cutting-pi-vs-codex-event-architecture)
13. [Cross-Cutting: Extension UI as a Pattern](#13-cross-cutting-extension-ui-as-a-pattern)
14. [Cross-Cutting: What Changed in ab0d9f9..d647e1a](#14-cross-cutting-what-changed-in-ab0d9f9d647e1a)
15. [Gap Analysis](#15-gap-analysis)

---

## 1. Pi: Current Real-Time Sync Implementation

### Architecture Summary

Pi runs **in-process** within the bridge. There is no child process or JSON-RPC — the bridge `import`s `@mariozechner/pi-coding-agent` directly, creates `AgentSession` instances, and subscribes to their event streams.

### Event Flow (Working)

```
AgentSession.subscribe(event)
    ↓
PiInstance.listeners (Set<PiEventListener>)
    ↓
pi-events.ts: translateEvent(event) → PiStreamMessage | null
    ↓
pi-runtime-event-mapper.ts: mapPiStreamToRuntimeEvent(streamMsg, ctx) → BroskiRuntimeEvent | null
    ↓
enrichRuntimeEvent() adds seq, streamId, turnId
    ↓
recordRuntimeEvent() → replay buffer
broadcast({ type: "runtime_event", backend: "pi", data: runtimeEvent })
    ↓
WebSocket → Flutter app
    ↓
BridgeService.runtimeEvents stream → chat_provider runtime ingest
```

### Key Components

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| Connector | `connectors/pi.ts` | 534 | ✅ Working |
| Event translator | `connectors/pi/pi-events.ts` | 302 | ✅ Working |
| Runtime mapper | `runtime/pi-runtime-event-mapper.ts` | 158 | ✅ Working |
| Handler | `handlers/pi_features.ts` | 707 | ✅ Working |
| Stream delivery | `handlers/pi_stream_delivery.ts` | 164 | ✅ Working (batching + buffering) |
| External tail | `connectors/pi/pi-external-tail.ts` | — | ✅ Working (for non-bridge sessions) |
| Dart service | `lib/services/pi_bridge_service.dart` | 713 | ✅ Working |
| Dart models | `lib/models/pi.dart` | 728 | ✅ Working |

### Stream Bridge Lifecycle

The handler maintains a `streamUnsubscribers` map keyed by normalized cwd. `ensureStreamBridge(cwd, broadcast)` creates a listener that:

1. On every `AgentSessionEvent`, calls `pi.translateEvent(event)` to get a `PiStreamMessage`.
2. Re-resolves the **live instance** on every event (not captured at registration time) so session switches are reflected immediately.
3. Passes the `PiStreamMessage` through `mapPiStreamToRuntimeEvent()` → `enrichRuntimeEvent()` → broadcasts as `runtime_event`.
4. On `agent-start`, `agent-end`, and `error`: also broadcasts `runtime_state` with a fresh `PiStatePayload` snapshot so the Flutter app never gets stuck.

### State Authoritative Updates

State broadcasts happen on:
- `agent-start` — sets `isStreaming: true`
- `agent-end` — sets `isStreaming: false`, broadcasts updated session list
- `error` — resets streaming state
- After `pi_chat` errors (via `.catch()`) — broadcasts error + state reset

### What Works

- **Text streaming**: `text-delta` and `thinking-delta` events flow correctly through the pipeline.
- **Tool execution**: `tool-exec-start` → `tool-exec-update` → `tool-exec-end` events are translated and mapped to `tool_started` → `tool_updated` → `tool_finished` runtime events.
- **Compaction / Retry**: Both `compaction_start/end` and `auto_retry_start/end` events propagate.
- **Extension UI**: Dialog requests flow through via `backend_event` type (see section 2).
- **External tailing**: Pi sessions running outside the bridge (in TUI) can be tailed by watching the JSONL file.
- **Event buffering**: `pi_stream_delivery.ts` buffers events per session and replays them when a watcher reconnects.
- **Message batching**: High-frequency `text_delta`, `thinking_delta`, and `tool_updated` events are batched with a 6ms timer to reduce WebSocket message count on mobile.

### Translation Table: AgentSessionEvent → PiStreamMessage → BroskiRuntimeEvent

| AgentSessionEvent | PiStreamMessage | BroskiRuntimeEvent |
|-------------------|-----------------|-------------------|
| `agent_start` | `agent-start` | `agent_started` |
| `agent_end` | `agent-end` | `agent_finished` |
| `turn_start` | `turn-start` | `agent_started` |
| `turn_end` | `turn-end` | `agent_finished` |
| `message_start` | `message-start` | `null` (skipped) |
| `message_end` | `message-end` | `null` (skipped) |
| `message_update` (text_delta) | `text-delta` | `assistant_text_delta` |
| `message_update` (thinking_delta) | `thinking-delta` | `assistant_thinking_delta` |
| `message_update` (toolcall_start) | `tool-call-start` | `null` (skipped) |
| `message_update` (toolcall_end) | `tool-call-args-done` | `null` (skipped) |
| `message_update` (done/error) | `message-done` | `null` (skipped) |
| `tool_execution_start` | `tool-exec-start` | `tool_started` |
| `tool_execution_update` | `tool-exec-update` | `tool_updated` |
| `tool_execution_end` | `tool-exec-end` | `tool_finished` |
| `compaction_start` | `compaction-start` | `compaction_started` |
| `compaction_end` | `compaction-end` | `compaction_finished` |
| `auto_retry_start` | `retry-start` | `retry_started` |
| `auto_retry_end` | `retry-end` | `retry_finished` |
| `__pi_bridge_stream__` (extension UI) | passthrough | `backend_event` |

---

## 2. Pi: Extension UI System

### Architecture

Pi extensions can interact with users via an `ExtensionUIContext` interface. The bridge implements this via `pi_extension_ui.ts`, which relays UI requests to the Flutter app as `extension-ui-request` stream messages, then waits for responses.

### The Full Pipeline (End to End)

```
1. Extension calls uiContext.select("Pick an option", ["A", "B", "C"])
2. pi_extension_ui.ts creates Promise + UUID, stores in pending map
3. Emits PiStreamMessage: { type: "extension-ui-request", id: "uuid", method: "select", ... }
4. Synthetic event type __pi_bridge_stream__ wraps it
5. emitToListeners() broadcasts to all PiInstance listeners
6. pi-events.ts: translateEvent() passes it through unchanged
7. pi-runtime-event-mapper.ts: maps to { type: "backend_event", kind: "extension-ui-request", payload: piEvent }
8. broadcast({ type: "runtime_event", backend: "pi", data: runtimeEvent })
9. WebSocket → Flutter app
10. chat_init.dart: setupPiExtensionUiListener() filters for backend == pi && kind == 'extension-ui-request'
11. Reconstructs PiStreamMessage from payload
12. pi_extension_ui_request_handler.dart: handlePiExtensionUiRequest() dispatches by method
13. For 'select': shows a DetailSheet with options
14. User taps "B"
15. Flutter calls piBridge.respondToExtensionUi(id: "uuid", value: "B")
16. Sends: { type: "pi_extension_ui_response", id: "uuid", value: "B" }
17. server.ts routes to pi_features.ts handler
18. Handler calls pi.respondToExtensionUi(cwd, { id, value: "B" })
19. pi_extension_ui.ts: resolveResponse() resolves the pending Promise
20. Extension continues execution with "B"
```

### Supported Methods (Bidirectional — Wait for Response)

| Method | What it shows | Response shape |
|--------|---------------|----------------|
| `select` | Bottom sheet with option list | `{ value: string }` or `{ cancelled: true }` |
| `confirm` | AlertDialog with Confirm/Cancel | `{ confirmed: boolean }` or `{ cancelled: true }` |
| `input` | AlertDialog with text field | `{ value: string }` or `{ cancelled: true }` |
| `editor` | AlertDialog with multiline text field | `{ value: string }` or `{ cancelled: true }` |

### Supported Methods (Fire-and-Forget — No Response)

| Method | What it does |
|--------|-------------|
| `notify` | Shows a snackbar |
| `setStatus` | Acknowledged, no visible UI |
| `setWidget` | Acknowledged, no visible UI |
| `setTitle` | Calls `onSetTitle` callback (if provided) |
| `paste_to_editor` | Inserts text at cursor position in composer |
| `set_editor_text` | Replaces entire composer text |
| `set_tools_expanded` | Acknowledged, handled by UI layer |

### Timeouts and Fallbacks

- **Default timeout**: 30 seconds. On timeout, the promise resolves with the fallback value (`undefined` for select/input/editor, `false` for confirm).
- **Abort signal**: If the agent is aborted, the signal triggers cleanup and resolves with fallback.
- **Dispose**: On instance dispose, all pending requests are rejected.

### Status: ✅ FULLY WORKING

The extension UI pipeline is complete and tested. All four dialog methods (select, confirm, input, editor) work end-to-end. Fire-and-forget methods work for notify, paste, and title changes.

---

## 3. Pi: Permission Handling

### Pi's Philosophy: Yolo by Default

Pi is **yolo by default** — all tools execute without asking permission. There is **no built-in permission prompt** in the Pi SDK. Permission checks are added by **extensions** that hook `beforeToolCall`.

### How It Works in Pi

1. Agent loop calls `config.beforeToolCall(context, signal)` before executing a tool.
2. This calls `extensionRunner.emitToolCall(event)`.
3. Extensions can return `{ block: true, reason: "..." }` to prevent execution.
4. If blocked, an error tool result is created and returned to the LLM.

### How Extensions Add Permissions via Extension UI

When an extension wants to ask the user for approval, it uses the Extension UI system:

```typescript
// Extension code:
on("tool_call", async (event) => {
  if (isDangerous(event.input)) {
    const confirmed = await ctx.ui.confirm("Dangerous command", `Run: ${event.input.command}?`);
    if (!confirmed) return { block: true, reason: "User denied" };
  }
  return undefined; // Allow
});
```

This triggers the Extension UI pipeline described in section 2 — the confirm dialog appears on the phone, and the extension blocks until the user responds or times out.

### What Broski Implements

- **No special permission handling**: Pi doesn't emit `permission_requested` runtime events. The `RuntimePermissionRequestedEvent` handler in `runtime_permission_handler.dart` never fires for Pi.
- **Extension UI is the mechanism**: All user interaction (including permission-like dialogs) goes through the Extension UI pipeline.
- **There is no Pi entry in the permission request handler**: The `_handleRuntimePermissionRequested` method handles CC, CX, and OC — but Pi is conspicuously absent because Pi's permission model is extension-driven via UI context.

### Status: ✅ WORKING (by design)

Pi permissions work through extension UI. This is architecturally correct — Pi doesn't need a separate permission handler because the Extension UI bridge IS the permission mechanism.

---

## 4. Pi: Question / Input Handling

### How Questions Work in Pi

Pi handles user questions through the same Extension UI system:

- **`input`** method: Shows a text input dialog. Extension calls `uiContext.input("Enter your API key")`.
- **`editor`** method: Shows a multiline editor dialog. Extension calls `uiContext.editor("Edit configuration")`.
- **`select`** method: Shows a selection list. Extension calls `uiContext.select("Choose provider", ["OpenAI", "Anthropic"])`.

### Implementation Status

The Flutter handler (`pi_extension_ui_request_handler.dart`) implements all four dialog methods:

- `select` → `DetailSheet.show()` with `ListView` of options (lines 76-132)
- `confirm` → `showDialog()` with Cancel/Confirm buttons (lines 135-178)
- `input` → `showDialog()` with `TextField` (lines 181-253)
- `editor` → `showDialog()` with multiline `TextField`, same code path as `input` (lines 181-253)

### Status: ✅ FULLY WORKING

All question/input paths are implemented and functional.

---

## 5. Pi: Tool Use Display

### Event Flow

Pi tool execution emits three events:
1. `tool_execution_start` → `tool-exec-start` → `tool_started` (runtime event)
2. `tool_execution_update` → `tool-exec-update` → `tool_updated` (runtime event)
3. `tool_execution_end` → `tool-exec-end` → `tool_finished` (runtime event)

### What Gets Displayed

The `tool_started` event carries `toolCallId`, `toolName`, and `input` (the tool arguments). The `tool_finished` event carries `output` (text result), `details` (structured data), and `isError`.

The Flutter chat provider's unified runtime ingest processes these events identically to Claude Code and OpenCode tool events — they all map to the same `ToolCall` model with `callId`, `name`, `status`, `input`, `output`.

### Pi-Specific Tool Names

Pi uses descriptive tool names: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. These are displayed directly in the UI.

### Status: ✅ WORKING

Tool display works correctly — Pi tools show inline with start/update/end lifecycle.

---

## 6. Pi: What Changed in d647e1a

### Git Range: `ab0d9f9..d647e1a`

The commit messages describe:
```
c11ffba: real time sync for pi (works on mac screen and app)
e19ebfe: works for claude code too
b117ba4: real time sync on codex but now more fixes and pi logo
d647e1a: lots of session related stuff and website
```

### Changes to Pi-Specific Files

**`connectors/pi.ts`** (additive only):
- Added `resolveSessionFilePath(sessionId)` — resolves a Pi session ID to its JSONL path on disk
- Added `isSessionOwnedByBridge(sessionId)` — checks if a session is managed by the bridge

These functions support **external tailing** — watching Pi sessions running in the TUI from the phone.

**`handlers/pi_features.ts`** (significant changes):
1. **Added `pi_stream_delivery.ts` import**: New batching/buffering layer for Pi runtime events
2. **Added `runtime-replay-buffer.ts` import**: Records events for replay on reconnect
3. **Added external tail support**: `syncPiExternalTail()`, `stopPiExternalTail()`, `stopAllPiExternalTails()`
4. **Enhanced error handling in `pi_chat`**: Now broadcasts `runtime_state` with reset state on prompt errors (the `.catch()` block)
5. **Removed legacy comment**: "Phase 4: Only send runtime_event. Legacy pi_stream removed." (cleaned up)
6. **Changed runtime_state broadcast trigger**: Now emits on `agent-end`, `agent-start`, AND `error` (previously only on agent-end/start)
7. **Added session list broadcast**: `broadcastPiRuntimeSessions()` called on state changes

### What Did NOT Break

The core Pi streaming pipeline was **not changed** in this range. The `translateEvent()`, `mapPiStreamToRuntimeEvent()`, and `ensureStreamBridge()` functions all remained intact. The changes were **additive** — adding external tail support, event buffering, and error handling improvements.

### What Was Added

- **External session tailing**: The major new feature. Pi sessions running in the terminal can now be observed from the phone.
- **Event replay buffer**: Buffered events can be replayed when a client reconnects.
- **Send queue batching**: High-frequency delta events are batched with a 6ms timer for mobile performance.

### Conclusion: Pi Real-Time Sync Was NOT Broken by d647e1a

The changes in this range were improvements, not regressions. If Pi real-time sync stopped working, the cause is likely:
- A Pi SDK update (`@mariozechner/pi-coding-agent` npm package) that changed the event format
- A bridge reconnection issue where `ensureStreamBridge()` isn't called after reconnect
- A Flutter-side issue where the `runtimeEvents` stream listener is not re-registered after navigation

---

## 7. Codex: Current Real-Time Sync Implementation

### Architecture Summary

Codex is a **Rust binary** that communicates via **JSON-RPC over stdio**. The bridge spawns `codex app-server` as a persistent child process and communicates via stdin/stdout JSONL.

### Event Flow

```
Codex binary (Rust) — stdout JSONL
    ↓
CodexAppServerClient._pump() — readline reads lines
    ↓
Dispatches to one of three paths:
  1. Response to our request → pending.resolve()
  2. Server-initiated request (has id) → onServerRequest handler → respond via stdin
  3. Notification (no id) → onNotification handler
    ↓
server.ts: onNotification callback
    ↓
handleCodexRuntimeNotification() or direct mapping
    ↓
codex-runtime-event-mapper.ts: mapCodexStreamToRuntimeEvent()
    ↓
enrichRuntimeEvent() adds seq, streamId, turnId
    ↓
broadcast({ type: "runtime_event", backend: "codex", data: runtimeEvent })
    ↓
WebSocket → Flutter app
```

### Key Components

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| JSON-RPC client | `connectors/codex.ts` | 332 | ✅ Working |
| Filesystem reader | `connectors/codex-fs.ts` | 634 | ✅ Working (offline mode) |
| Session stats | `connectors/codex/cx-session-stats.ts` | — | ✅ Working |
| SQLite lookup | `connectors/codex/cx-sqlite.ts` | — | ✅ Working |
| Runtime mapper | `runtime/codex-runtime-event-mapper.ts` | 622 | ✅ Working |
| Features handler | `handlers/codex_features.ts` | 411 | ✅ Working |
| Approval decision | `handlers/codex/approval-decision.ts` | — | ✅ Working |
| Runtime notifications | `handlers/codex/runtime-notifications.ts` | — | ✅ Working |
| Dart service | `lib/services/bridge/bridge_codex_runtime.dart` | 155 | ✅ Working |

### Notification → Runtime Event Translation

The Codex runtime event mapper handles the rich notification protocol:

| Codex Notification | BroskiRuntimeEvent |
|-------------------|-------------------|
| `turn/started` | `agent_started` |
| `turn/completed` | `agent_finished` |
| `item/started` (commandExecution/fileChange/mcpToolCall/etc.) | `tool_started` |
| `item/completed` (same types) | `tool_finished` |
| `item/agentMessage/delta` | `assistant_text_delta` |
| `item/reasoning/summaryTextDelta` | `assistant_thinking_delta` |
| `item/commandExecution/outputDelta` | `tool_updated` |
| `item/fileChange/outputDelta` | `tool_updated` |
| `error` | `error` |
| `thread/tokenUsage/updated` | (not currently mapped to runtime event) |
| `turn/diff/updated` | (not currently mapped to runtime event) |
| Server request (`requestApproval`) | `permission_requested` |
| Server request (`requestUserInput`) | `user_input_requested` |

---

## 8. Codex: Permission Handling

### Architecture

Codex has a sophisticated permission system. The app-server sends **JSON-RPC server requests** (messages with an `id` that expect a response) when the agent needs approval for commands or file changes.

### The Full Pipeline

```
1. Codex wants to run `rm -rf build/`
2. App-server sends server request:
   { method: "item/commandExecution/requestApproval", id: 42,
     params: { threadId, turnId, itemId, command: [...], cwd, reason, ... } }
3. CodexAppServerClient._pump() detects server request (has id + method)
4. Calls onServerRequest handler in server.ts
5. server.ts enriches params with cached item data
6. Creates CodexStreamMessage: { type: "request", requestId: "42", method: "item/commandExecution/requestApproval", params: enrichedParams }
7. codex-runtime-event-mapper.ts maps to:
   { type: "permission_requested", request: { requestId: "42", kind: "item/commandExecution/requestApproval", title, message, metadata } }
8. broadcast({ type: "runtime_event", backend: "codex", data: runtimeEvent })
9. WebSocket → Flutter
10. chat_provider: _handleRuntimePermissionRequested()
    - Detects backend == codex
    - Extracts command from metadata
    - Builds title using buildCodexApprovalTitle()
    - Creates PermissionRequest and adds to state.permissions
11. UI shows permission prompt
12. User taps "Approve"
13. Flutter sends: { type: "cx_permission_response", requestId: "42", response: "accept" }
14. server.ts: cxApprovalWaiters map resolves the promise
15. buildCodexApprovalDecision() translates to Codex protocol: { decision: "accept" }
16. Bridge sends JSON-RPC response: { id: 42, result: { decision: "accept" } }
17. Codex continues executing the command
```

### Timeout Handling

If no response within 120 seconds, the bridge auto-rejects:
```typescript
const timer = setTimeout(() => {
  cxApprovalWaiters.delete(key);
  resolve({ response: "reject" });
}, PERMISSION_TIMEOUT_MS);
```

### Decision Types

| Flutter Response | Codex Protocol |
|-----------------|---------------|
| `accept` | `{ decision: "accept" }` |
| `accept_for_session` | `{ decision: "acceptForSession" }` |
| `accept_with_amendment` | `{ decision: "acceptWithExecpolicyAmendment", ... }` |
| `reject` | `{ decision: "decline" }` |
| `reject_and_cancel` | `{ decision: "cancel" }` |

### Approval Enrichment

Before forwarding to Flutter, the bridge enriches approval params:
- `cachedItem`: From `cxItemCache`, contains the item's current state (type, command, changes)
- `approvalCommand` / `approvalCwd`: Explicit command/cwd from the approval params
- `commandActions`, `networkApprovalContext`, `proposedNetworkPolicyAmendments`: Structured data for advanced decisions
- `fileChanges`, `grantRoot`: For file change approvals

### Status: ✅ FULLY WORKING

The permission pipeline is complete. Command approvals, file change approvals, and permission requests all work end-to-end. The Flutter UI shows appropriate prompts with accept/reject options.

---

## 9. Codex: User Input / Questions

### Architecture

Codex can request user input via `item/tool/requestUserInput`, a server-initiated request that expects structured answers.

### The Pipeline

```
1. Codex tool needs user input (e.g., API key)
2. App-server sends: { method: "item/tool/requestUserInput", id: 50,
     params: { threadId, turnId, itemId, questions: { api_key: { prompt: "Enter API key:", type: "text" } } } }
3. Bridge maps to CodexStreamMessage type: "request"
4. codex-runtime-event-mapper.ts maps to:
   { type: "user_input_requested", request: { requestId: "50", kind: "tool_input", title, metadata } }
5. broadcast → Flutter
6. chat_provider: _handleRuntimeUserInputRequested()
   - Detects backend == codex
   - Creates CodexUserInputRequest from metadata
   - Sets state.cxPendingUserInput
7. UI shows questionnaire form
8. User fills in answers
9. cx_stream_handler.dart: replyToCodexUserInput(answers)
   - Converts to protocol format: { answers: { questionId: { answers: [...] } } }
   - Calls bridge.cxRespondToUserInput(requestId, answers)
10. Bridge sends JSON-RPC response: { id: 50, result: { answers: { api_key: { answers: ["sk-abc123"] } } } }
11. Codex tool receives the input and continues
```

### MCP Elicitation

Codex also supports `mcpServer/elicitation/request` for MCP server authentication. This follows the same pattern but maps to a different `kind: "mcp_elicitation"` in the runtime event.

### Status: ✅ IMPLEMENTED

The user input pipeline is implemented:
- Bridge: Maps `item/tool/requestUserInput` to `user_input_requested` runtime event
- Flutter: `_handleRuntimeUserInputRequested()` creates `CodexUserInputRequest` and sets `cxPendingUserInput`
- Flutter: `CxStreamHandler.replyToCodexUserInput()` sends structured answers back
- Flutter: `CxStreamHandler.rejectCodexUserInput()` sends empty answers to dismiss

---

## 10. Codex: Tool Use Display

### Tool Types in Codex

Unlike Pi (which has generic tool calls), Codex has **typed tool items**:

| Item Type | Display Name | What it is |
|-----------|-------------|------------|
| `commandExecution` | `Bash` | Shell command execution |
| `fileChange` | `ApplyPatch` | File modification via patch |
| `mcpToolCall` | `{server}.{tool}` | MCP tool invocation |
| `webSearch` | `WebSearch` | Web search query |
| `dynamicToolCall` | tool name | Client-side dynamic tool |
| `imageGeneration` | — | Image generation |

### Event Sequence for Tools

```
item/started → tool_started (with type, command, etc.)
item/commandExecution/outputDelta → tool_updated (streaming output)
item/completed → tool_finished (final state, exit code, etc.)
```

### Turn-Level Diff

Codex also emits `turn/diff/updated` with aggregated diffs across all file changes in a turn. This is currently **not mapped** to a runtime event — it's only available via the session transcript.

### Status: ✅ WORKING

Tool display works correctly. The `codex-runtime-event-mapper.ts` handles all item types and maps them to the unified `tool_started/updated/finished` events.

---

## 11. Codex: Streaming Issues

### Known Issues

1. **High-volume telemetry**: Codex emits `codex/event/*` notifications that can overwhelm mobile devices. The bridge filters these to non-streaming notifications only (see server.ts line 1237 comment).

2. **Token usage not mapped**: `thread/tokenUsage/updated` notifications are received but not mapped to runtime events. Token information is only available via transcript hydration.

3. **Turn diff not mapped**: `turn/diff/updated` aggregated diffs are not forwarded as runtime events. File changes are only visible through individual `item/fileChange` events.

4. **Process restart gap**: When the Codex app-server crashes and auto-restarts (up to 3 attempts), there's a gap during which all pending requests are rejected and no events flow. The `onStatusChange` callback notifies clients, but the Flutter app may need to re-hydrate the thread state.

5. **Thread-scoped events**: All Codex notifications include `threadId`, which enables routing. But the bridge uses a global singleton `CodexAppServerClient` — if multiple clients are connected, all receive all thread events. Filtering by active thread happens in the Flutter provider.

---

## 12. Cross-Cutting: Pi vs Codex Event Architecture

### Fundamental Differences

| Aspect | Pi | Codex |
|--------|-----|-------|
| **Process model** | In-process SDK | External Rust binary via JSON-RPC |
| **Event delivery** | `AgentSessionEvent` emitter (sync) | JSON-RPC notifications (async JSONL) |
| **Tool abstraction** | Generic `tool_execution_*` events | Typed `ThreadItem` variants |
| **Permission model** | Yolo by default, extensions add via UI | Built-in approval policies, server requests |
| **User input** | Extension UI (select/confirm/input/editor) | `item/tool/requestUserInput` server request |
| **Session management** | In-process `AgentSession` + JSONL persistence | External thread management via JSON-RPC |
| **Instance lifecycle** | Per-cwd Map, persists across requests | Single shared process, multi-thread |
| **Streaming protocol** | 3-layer: AgentEvent → PiStreamMessage → BroskiRuntimeEvent | 2-layer: CodexStreamMessage → BroskiRuntimeEvent |
| **Offline access** | Direct JSONL file reading + external tail | Direct JSONL file reading + SQLite index |

### Event Mapping Symmetry

Despite different architectures, both backends produce the same set of `BroskiRuntimeEvent` types:

```
Both emit:  agent_started, agent_finished, assistant_text_delta,
            assistant_thinking_delta, tool_started, tool_updated,
            tool_finished, error

Pi also:    compaction_started, compaction_finished, retry_started,
            retry_finished, backend_event (extension-ui-request)

Codex also: permission_requested, user_input_requested
```

### Key Architectural Insight

Pi and Codex are **inverted** in where complexity lives:

- **Pi**: Simple SDK interface → complex bridge adapter layer → simple runtime events. The bridge does the heavy lifting of translating rich `AgentSessionEvent` streams into normalized events.
- **Codex**: Complex binary protocol → thin bridge adapter → complex runtime events. The bridge mostly passes through, and the Codex binary handles all the complexity.

---

## 13. Cross-Cutting: Extension UI as a Pattern

### Could Pi's Extension UI Pattern Work for All Backends?

Pi's extension UI system is elegant: extensions emit dialog requests, the bridge relays them to the phone, the user responds, and the extension continues. This is a **generic pattern** that could work for any backend that needs interactive user input.

### Current State by Backend

| Backend | Permission Mechanism | User Input Mechanism |
|---------|---------------------|---------------------|
| **Pi** | Extension UI (`confirm`) | Extension UI (`select`, `input`, `editor`) |
| **Codex** | Server request (`requestApproval`) → `permission_requested` | Server request (`requestUserInput`) → `user_input_requested` |
| **Claude Code** | `AskUserQuestion` → `permission_requested` | Same (question with options) |
| **OpenCode** | `permission` event → `permission_requested` | `question` event → `user_input_requested` |

### Where Extension UI Could Help

1. **MCP elicitation across all backends**: Pi's extension UI could handle MCP auth dialogs uniformly, rather than each backend implementing its own.
2. **Rich user interactions**: The `editor` method (multiline text input) is unique to Pi's extension UI. Other backends would benefit from this.
3. **Extension-driven workflows**: If a cross-backend extension system existed, the UI context pattern would be the natural interaction mechanism.

### Limitation

The extension UI pattern requires the dialog to be synchronous from the extension's perspective (it blocks on a Promise). This works for Pi because tools run in the same process. For Codex, the binary process manages its own async flow via JSON-RPC requests — the bridge can't inject arbitrary dialogs into the Codex binary's execution flow.

---

## 14. Cross-Cutting: What Changed in ab0d9f9..d647e1a

### Summary of Changes

The 4-commit range (c11ffba → e19ebfe → b117ba4 → d647e1a) represents the **"real-time sync" feature rollout** that made streaming work simultaneously on the Mac screen and the phone app.

### New Files Created

| File | Purpose |
|------|---------|
| `handlers/pi_stream_delivery.ts` (163 lines) | Batching + buffering for Pi events |
| `handlers/cc_hook_installer.ts` (153 lines) | CC permission hook installation |
| `handlers/cc_permission_hook.ts` (192 lines) | CC permission event handling |
| `handlers/cx_hook_installer.ts` (178 lines) | CX hook installation |
| `handlers/cx_permission_hook.ts` (170 lines) | CX permission hook handling |
| `handlers/cc_routing.ts` (16 lines) | CC message routing |
| `handlers/codex/cx_chat.ts` (10 lines) | Codex chat helper |
| `runtime/stream-contract.ts` (108 lines) | `enrichRuntimeEvent()` with seq/streamId/turnId |
| `utils/runtime-replay-buffer.ts` (85 lines) | Event recording for replay on reconnect |
| `utils/runtime-send-queue.ts` (106 lines) | Ordered send queue |

### Changes to Existing Files

**`packages/bridge/src/server.ts`** (+99/-47 lines):
- Enhanced Codex notification handling
- Improved runtime event broadcasting
- Better error handling

**`packages/bridge/src/handlers/pi_features.ts`** (+85 lines):
- Added external tail support
- Added event recording
- Enhanced error handling in `pi_chat`
- Added runtime_state broadcast on error

**`packages/bridge/src/runtime/pi-runtime-event-mapper.ts`** (+42 lines):
- Added `turn-start` → `agent_started` and `turn-end` → `agent_finished` mappings
- Added `external-user-message` → `backend_event` mapping

**`packages/bridge/src/runtime/codex-runtime-event-mapper.ts`** (+42 lines):
- Enhanced notification handling
- Better item type detection

**`packages/bridge/src/connectors/pi.ts`** (+41 lines):
- Added `resolveSessionFilePath()` and `isSessionOwnedByBridge()`

**Flutter side** (5,146 insertions across all files):
- Major Flutter-side changes to support the unified runtime event stream
- New session view handler
- Website additions

### Impact Assessment

The changes were **overwhelmingly additive**. No existing working functionality was removed. The core streaming pipelines for both Pi and Codex were enhanced, not replaced. If real-time sync stopped working after these changes, it would be due to:

1. **Bridge reconnection**: The new `ensureStreamBridge(force=true)` logic re-registers listeners on reconnect, which could race with existing listeners.
2. **Event ordering**: The new `enrichRuntimeEvent()` adds seq numbers. If the Flutter side expects strict ordering but events arrive out of order, it could cause display issues.
3. **External tail interference**: If an external tail is running for a session that's also bridge-owned, events could duplicate.

---

## 15. Gap Analysis

### What's Missing for Flawless Permission + Questionnaire Support

#### Pi Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| **No permission event in runtime** | Low | Pi doesn't emit `permission_requested` events because it uses extension UI instead. This means the unified permission UI in the chat provider never fires for Pi. This is by design, but means Pi permissions don't show in the permissions list — they show as dialog popups instead. |
| **No `requestUserInput` equivalent** | Low | Pi doesn't have a formal "questionnaire" system like Codex's `requestUserInput`. Input requests go through extension UI `input` method, which shows a simple dialog. For multi-question forms, extensions would need to call `input` multiple times sequentially. |
| **Extension UI timeout may be too short** | Medium | The 30-second default timeout may not be enough for complex decisions. If the user is slow to respond, the dialog auto-closes with the fallback value. The timeout is configurable per call, but most extensions use the default. |
| **No persistent state for extension UI** | Medium | If the app goes to background and comes back, there's no mechanism to re-show pending extension UI requests. The promise on the bridge side will timeout. |
| **No `setWidget` rendering** | Low | Pi's `setWidget` method is acknowledged but not visually rendered in the mobile UI. Widget content (status lines, progress indicators) is silently dropped. |
| **`bash-output` not mapped** | Low | The `bash-output` PiStreamMessage type is not mapped to a runtime event. Live bash output from `pi_execute_bash` is not streamed to the app. |

#### Codex Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| **Token usage not in runtime events** | Low | `thread/tokenUsage/updated` notifications are received but not mapped to runtime events. Token info is only available via transcript hydration. |
| **Turn diff not forwarded** | Low | `turn/diff/updated` aggregated diffs are not forwarded. Only individual `item/fileChange` events show diffs. |
| **No guardian review display** | Medium | `item/autoApprovalReview/started/completed` notifications are not surfaced in the UI. When guardian mode is active, the user has no visibility into what the guardian is reviewing. |
| **Plan updates not displayed** | Low | `turn/plan/updated` and `item/plan/delta` are not mapped to runtime events. Plan step progress is invisible. |
| **MCP elicitation response path untested** | Medium | The `mcpServer/elicitation/request` handler maps to `user_input_requested` with `kind: "mcp_elicitation"`, but the Flutter-side handling of this specific kind is not clearly differentiated from regular tool input. |
| **Collaboration events basic** | Low | Codex multi-agent `collab/*` notifications are forwarded as raw `cx_global` messages but not mapped to structured runtime events. |
| **Hook notifications invisible** | Low | `hook/started` and `hook/completed` are not surfaced. When hooks run (preToolUse, sessionStart, etc.), the user doesn't see them. |
| **Network approval context** | Medium | Network access approvals include `networkApprovalContext` with host/port details, but the Flutter UI displays these as generic "Allow command execution?" prompts. The enrichment logic is there (`buildCodexApprovalTitle` handles the `host` case), but needs testing. |

#### Cross-Backend Gaps

| Gap | Severity | Description |
|-----|----------|-------------|
| **Inconsistent permission UX** | Medium | Pi shows permissions as modal dialogs (extension UI), while CC/CX/OC show them as inline permission cards in the chat. This inconsistency means users experience permission prompts differently depending on the active backend. |
| **No unified questionnaire UI** | Medium | CC uses `QuestionRequest` with options, CX uses `CodexUserInputRequest` with questions map, OC uses `QuestionRequest`. Pi uses extension UI dialogs. Four different code paths for the same UX concept. |
| **No cross-backend extension UI** | Low | Pi's extension UI is Pi-only. If CC or OC extensions wanted to show dialogs, they'd need their own implementation. The pattern is generic but the implementation is not reusable. |
| **Event replay may cause duplicates** | Low | The replay buffer (`runtime-replay-buffer.ts`) records events globally. On reconnect, replayed events are tagged with `replayed: true`, but the Flutter provider must correctly deduplicate based on `seq` numbers. |
| **No permission persistence** | Medium | If the app disconnects and reconnects while a permission request is pending, the permission is lost. The Codex side will timeout after 120s and auto-reject. The Pi side will timeout after 30s and resolve with fallback. There's no mechanism to re-request pending permissions on reconnect. |

### Priority Recommendations

1. **High**: Ensure reconnection correctly re-establishes Pi stream bridges and Codex event listeners. Test the `ensureStreamBridge(force=true)` path.
2. **High**: Add `replayed: true` deduplication in Flutter's runtime event processing if not already present.
3. **Medium**: Consider extending Pi's Extension UI timeout for permission-like dialogs to 120s (matching Codex's timeout).
4. **Medium**: Render `setWidget` content in the mobile UI — even basic text rendering would improve the extension experience.
5. **Medium**: Map `thread/tokenUsage/updated` to a runtime event for consistent cost tracking across backends.
6. **Low**: Map Codex `turn/diff/updated` to a runtime event for better diff visibility.
7. **Low**: Surface guardian review notifications in the UI.

---

## Appendix: File Reference

### Bridge (TypeScript)

| File | Lines | What |
|------|-------|------|
| `connectors/pi.ts` | 534 | Pi instance management, event translation |
| `connectors/pi_extension_ui.ts` | 293 | Extension UI bridge (dialog/confirm/select/input) |
| `connectors/pi/pi-events.ts` | 302 | AgentSessionEvent → PiStreamMessage translation |
| `connectors/pi/pi-external-tail.ts` | — | JSONL file watching for non-bridge sessions |
| `connectors/pi/pi-session-stats.ts` | — | Diff stats computation |
| `connectors/codex.ts` | 332 | JSON-RPC client for Codex app-server |
| `connectors/codex-fs.ts` | 634 | Direct JSONL file reading (offline mode) |
| `connectors/codex/cx-session-stats.ts` | — | Codex diff stats |
| `connectors/codex/cx-sqlite.ts` | — | SQLite thread-to-path lookup |
| `handlers/pi_features.ts` | 707 | All pi_* message handlers |
| `handlers/pi_stream_delivery.ts` | 164 | Pi event batching + buffering |
| `handlers/codex_features.ts` | 411 | Codex steer/rename/compact/skills/apps/exec |
| `handlers/codex/approval-decision.ts` | — | Translates our responses to Codex protocol |
| `handlers/codex/runtime-notifications.ts` | — | Codex notification → runtime event |
| `runtime/pi-runtime-event-mapper.ts` | 158 | PiStreamMessage → BroskiRuntimeEvent |
| `runtime/codex-runtime-event-mapper.ts` | 622 | CodexStreamMessage → BroskiRuntimeEvent |
| `runtime/stream-contract.ts` | 108 | Event enrichment (seq, streamId, turnId) |
| `types/pi.ts` | 107 | PiStatePayload, PiModelPayload, PiStreamMessage types |

### Flutter (Dart)

| File | Lines | What |
|------|-------|------|
| `services/pi_bridge_service.dart` | 713 | Pi request-response service |
| `services/bridge/bridge_codex_runtime.dart` | 155 | Codex chat/abort/permission/input methods |
| `models/pi.dart` | 728 | All Pi model classes |
| `models/runtime/runtime_event.dart` | 584 | Unified runtime event types |
| `providers/chat/runtime_permission_handler.dart` | 347 | Permission + user input handling |
| `providers/chat/codex_permission_helpers.dart` | 80 | Codex approval title builder |
| `providers/chat/cx_stream_handler.dart` | 224 | Codex session setup + user input responses |
| `screens/pi/pi_extension_ui_request_handler.dart` | 273 | Pi extension UI dialog rendering |
| `screens/chat/chat_init.dart` | 236 | Pi extension UI stream listener setup |
