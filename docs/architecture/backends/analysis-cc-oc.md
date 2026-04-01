# Analysis: Claude Code & OpenCode — Real-Time Sync, Permissions, and Questionnaires

> Cross-cutting analysis of how Broski implements real-time sync, permission handling,
> and user-input (questionnaire) flows for Claude Code and OpenCode backends.
>
> **Date:** 2026-03-31
> **Scope:** Commits ab0d9f9 → d647e1a (real-time sync series)
> **Status:** Comprehensive audit of what works, what's broken, what's missing

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Claude Code: Real-Time Sync](#2-claude-code-real-time-sync)
3. [Claude Code: Permission Handling](#3-claude-code-permission-handling)
4. [Claude Code: Questionnaire / AskUserQuestion](#4-claude-code-questionnaire--askuserquestion)
5. [Claude Code: Tool Use Display](#5-claude-code-tool-use-display)
6. [Claude Code: Streaming Issues](#6-claude-code-streaming-issues)
7. [OpenCode: Real-Time Sync](#7-opencode-real-time-sync)
8. [OpenCode: Permission Handling](#8-opencode-permission-handling)
9. [OpenCode: User Input / Questions](#9-opencode-user-input--questions)
10. [OpenCode: Tool Use Display](#10-opencode-tool-use-display)
11. [OpenCode: Streaming Issues](#11-opencode-streaming-issues)
12. [Cross-Cutting: Event Normalization](#12-cross-cutting-event-normalization)
13. [Cross-Cutting: Real-Time Sync Architecture](#13-cross-cutting-real-time-sync-architecture)
14. [What Broke in d647e1a](#14-what-broke-in-d647e1a)
15. [Gap Analysis](#15-gap-analysis)
16. [Recommendations](#16-recommendations)

---

## 1. Executive Summary

Broski has two independent mechanisms for real-time sync:

1. **SDK-initiated sessions** ("Broski owns the prompt"): The user types in the phone app, bridge sends the prompt to the SDK, SDK streams events back through callbacks/SSE, and the bridge maps them to `runtime_event` messages for Flutter.

2. **External-initiated sessions** ("desktop CLI/TUI owns the prompt"): The user types in their terminal. The bridge detects activity via file-tailing (CC) or message-polling (OC) and synthesizes equivalent `runtime_event` messages so the phone mirrors what's happening.

The recent commit series (ab0d9f9 → d647e1a) added the external-session mechanism (type 2) for all four backends. **The SDK-initiated path (type 1) was already working.** The commit messages note that CC and OC real-time sync works "but not the permission prompt thing" — this is accurate.

### Summary of Current State

| Feature | Claude Code | OpenCode |
|---------|------------|----------|
| SDK-initiated streaming (text) | ✅ Working | ✅ Working |
| SDK-initiated streaming (thinking) | ✅ Working | ✅ Working |
| SDK-initiated tool display | ✅ Working | ✅ Working |
| External session streaming | ✅ Working (file tail) | ✅ Working (polling) |
| Permission flow (SDK-initiated) | ✅ Working (both canUseTool + hook) | ✅ Working (SSE + REST) |
| Permission flow (external session) | ⚠️ Partially working (hook only) | ⚠️ Working (polling) |
| Questionnaire (SDK-initiated) | ✅ Working (AskUserQuestion → canUseTool) | ✅ Working (question.asked → question.reply) |
| Questionnaire (external session) | ❌ Not supported (hooks don't relay AskUserQuestion data) | ⚠️ Working (polling listPendingQuestions) |
| MCP elicitation | ✅ Working (onElicitation callback) | N/A |

---

## 2. Claude Code: Real-Time Sync

### 2.1 Architecture

CC uses an **in-process SDK** — no separate server. The bridge calls `query()` which returns an `AsyncGenerator<SDKMessage>`. Events stream through the generator.

**Two sync paths:**

**Path A — SDK-initiated (phone → bridge → SDK):**
```
Phone sends: cc_chat { prompt, cwd, sessionId? }
  → cc_chat.ts handler
  → claudeCode.queryClaudeCode() with callbacks:
    onMessage → emitCcStream() → mapClaudeCodeStreamToRuntimeEvent() → runtime_event to phone
    onPermissionRequest → emitCcStream(permission-request) → wait for cc_permission_response
    onComplete → sendSessionIdle()
```

**Path B — External (terminal CLI → JSONL file → bridge → phone):**
```
User types in terminal: "claude code fix this"
  → CC writes to ~/.claude/projects/<encoded-path>/<session-id>.jsonl
  → cc-external-tail.ts watches the file (fsWatch + fallback polling)
  → Parses new JSONL lines → emits ClaudeCodeStreamMessage via emitCcStream()
  → mapClaudeCodeStreamToRuntimeEvent() → runtime_event to phone
```

### 2.2 External Tail Mechanics (cc-external-tail.ts, 730 lines)

The external tail:
1. **Bootstraps baseline**: Reads existing JSONL to build maps of lastText, lastThinking, emittedToolCalls. This prevents re-emitting historical events when the tail starts.
2. **Watches file with fsWatch**: On macOS, fsWatch uses kqueue/FSEvents. Falls back to polling (200ms) when fsWatch fails.
3. **Parses new lines**: Each JSONL line is parsed. For `assistant` records, extracts text/thinking deltas and tool_use blocks. For `user` records, extracts tool results.
4. **Emits through same pipeline**: Calls `emitCcStream()` → same runtime event mapper → same Flutter handler.

### 2.3 What Works

- Text streaming (both paths): incremental deltas computed correctly
- Thinking streaming: delta computation works for both paths
- Tool call display: tool_use blocks detected and emitted
- Tool results: user messages with tool_result blocks forwarded
- Token usage: extracted from completed assistant records in external tail
- Session status (busy/idle): properly tracked and broadcast

### 2.4 What's Missing

- **External tail doesn't detect permission prompts**: When CC asks for permission in the terminal, it blocks on stdin. This shows up in the JSONL only AFTER the user responds. The external tail can't intercept the permission dialog mid-flight.
- **Solution in d647e1a**: The `cc_permission_hook.ts` and `cc_hook_installer.ts` implement a shell hook that intercepts `PreToolUse` events. See §3.2.

---

## 3. Claude Code: Permission Handling

### 3.1 Path A — SDK-Initiated Permissions (canUseTool callback)

**Full flow:**
```
1. SDK calls canUseTool(toolName, input, ctx)
2. cc_chat.ts receives the callback
3. Emits "permission-request" ClaudeCodeStreamMessage via emitCcStream()
4. mapClaudeCodeStreamToRuntimeEvent() converts to RuntimePermissionRequestedEvent
5. Flutter's runtime_chat_ingest.dart receives RuntimePermissionRequestedEvent
6. runtime_permission_handler.dart._handleRuntimePermissionRequested() runs
7. Builds PermissionRequest model and adds to state.permissions
8. Chat screen shows permission sheet
9. User taps approve/reject
10. Flutter sends: cc_permission_response { sessionId, toolUseId, response }
11. cc_routing.ts resolves ccPermissionWaiters[sessionId:toolUseId]
12. SDK's canUseTool returns { behavior: "allow" | "deny" }
```

**Key details:**
- The `ccPermissionWaiters` Map holds Promise resolvers keyed by `${sessionId}:${toolUseId}`
- Timeout: configurable, defaults to 5 minutes (PERMISSION_TIMEOUT_MS)
- On timeout: auto-rejects
- SDK 0.2.87: Supports `suggestions` (PermissionUpdate[]) for "Always Allow" persistence
- The Flutter permission handler extracts metadata including `hasSuggestions`, `ccSuggestions`, `ccTitle`, `ccDescription`, `ccDisplayName`

**Status:** ✅ This path works fully. The commit messages confirm "permission prompt thing" doesn't work, but they mean the EXTERNAL path, not this SDK path.

### 3.2 Path B — External Permission Handling (Hook System)

**Added in commit d647e1a.** The hook system bypasses the JSONL tail limitation.

**Architecture:**
```
1. Bridge installs PreToolUse + PermissionRequest hooks in ~/.claude/settings.json
2. When CC CLI needs permission, it executes the hook (curl to bridge)
3. POST /cc-hook arrives at bridge HTTP handler
4. cc_permission_hook.ts emits "permission-request" via emitCcStream()
5. Phone shows permission sheet
6. User responds with cc_permission_response
7. cc_routing.ts tries ccPermissionWaiters first (for SDK sessions)
8. If no SDK waiter found, falls back to resolveHookPermissionByToolUse()
9. Hook HTTP response returns { hookSpecificOutput: { permissionDecision: "allow"|"deny" } }
10. CC CLI reads hook output and proceeds
```

**Key details:**
- Hook command is a curl that POSTs HookInput JSON to `http://localhost:<port>/cc-hook`
- Auth token passed in hook command for security
- Timeout: 5 minutes (HOOK_PERMISSION_TIMEOUT_MS), falls back to `"ask"` (CC shows terminal dialog)
- Installed on bridge startup, uninstalled on shutdown
- Handles both `PreToolUse` (tool execution) and `PermissionRequest` (permission dialogs incl. AskUserQuestion)

**Status:** ⚠️ **Partially working.** The hook installation and HTTP handler are implemented. The waiter resolution logic works. However:

1. **AskUserQuestion via hooks is incomplete**: The hook receives `hook_event_name: "PermissionRequest"` when CC asks AskUserQuestion, but the hook only relays basic tool info (toolName, toolInput). The structured question data (questions[], options[], multiSelect) IS in the toolInput, but the hook's `formatToolDescription()` doesn't extract or format it for the phone UI. The phone receives a plain permission-request, not a questionnaire.

2. **Hook installation timing**: The hook is installed when the bridge starts. If the user starts CC before the bridge, the hook isn't there. If the bridge restarts, the hook is reinstalled with a new port/token — but existing CC sessions have the OLD hook config until the user restarts CC or the settings.json is re-read.

3. **No "Always Allow" via hooks**: SDK-initiated permissions support `suggestions` (PermissionUpdate[]) for "Always Allow" rule persistence. Hooks return a simpler `permissionDecision` without rule updates.

### 3.3 Permission Response Routing

The `cc_routing.ts` has a dual-path resolver:

```typescript
if (type === "cc_permission_response") {
  // Try SDK-initiated waiter first
  const waiter = ccPermissionWaiters.get(key);
  if (waiter) { /* resolve waiter */ }
  else {
    // Fallback: try hook-initiated waiter
    resolveHookPermissionByToolUse(sessionId, toolUseId, response);
  }
}
```

This means the Flutter app sends the SAME `cc_permission_response` message regardless of whether the permission came from SDK or hook. The bridge figures out which waiter to resolve. **This is correct and elegant.**

---

## 4. Claude Code: Questionnaire / AskUserQuestion

### 4.1 How AskUserQuestion Works

AskUserQuestion is a CC built-in tool. When Claude wants to ask the user a structured question, it generates a `tool_use` block with `name: "AskUserQuestion"` and input containing `questions[]` with `options[]`.

In Broski, this fires through `canUseTool` with `toolName === "AskUserQuestion"`. The permission-request carries the question data in `input`.

### 4.2 Flutter-Side Detection

In `runtime_permission_handler.dart`:

```dart
void _handleRuntimePermissionRequested(RuntimePermissionRequestedEvent event) {
  if (event.backend == AgentType.claudeCode &&
      request.kind == 'AskUserQuestion') {
    _handleCcAskUserQuestion(event, sessionId);
    return;
  }
  // ... normal permission handling
}
```

The `_handleCcAskUserQuestion()` method:
1. Extracts `input.questions[]` from metadata
2. Parses each question: `question`, `header`, `options[]`, `multiSelect`
3. Creates a `QuestionRequest` with `QuestionInfo` entries
4. Sets `state.pendingQuestion = questionRequest`
5. The chat screen shows a questionnaire UI

### 4.3 Response Flow

When the user answers:
1. Flutter sends `cc_permission_response` with:
   - `response: "once"` (allow)
   - `updatedInput: { questions: [...], answers: { "question text": "selected option" } }`
2. Bridge resolves the `ccPermissionWaiters` waiter
3. SDK receives `{ behavior: "allow", updatedInput: { questions, answers } }`
4. Claude sees the user's answers and continues

### 4.4 Status

**SDK-initiated:** ✅ Working. The full flow from AskUserQuestion → permission_requested → Flutter QuestionRequest → user answers → cc_permission_response → SDK is implemented.

**External (hook):** ❌ **Not working.** The hook receives AskUserQuestion permission requests but:
- The hook relays it as a plain permission-request, not a questionnaire
- The phone shows "Allow AskUserQuestion?" instead of the actual questions
- Even if the user approves, the hook returns `permissionDecision: "allow"` without `updatedInput` containing the answers
- CC would proceed with the tool but get no answers, leading to undefined behavior

**Fix needed:** The hook handler needs to detect `toolName === "AskUserQuestion"` and:
1. Forward the full question data to the phone
2. Wait for the structured answer response
3. Return the answer as `updatedInput` in the hook output

---

## 5. Claude Code: Tool Use Display

### 5.1 Streaming Path (SDK-initiated)

Tool use blocks arrive through `stream_event`:
```
content_block_start → type: "tool_use", id, name
content_block_delta → input_json_delta (accumulated into buffer)
content_block_stop → cleanup buffer
```

The connector emits `tool-call` messages with partial input as it accumulates. The mapper converts to `tool_started` runtime events. When `tool_result` user messages arrive, it emits `tool_finished`.

### 5.2 External Tail

The external tail parses JSONL assistant records for `tool_use` content blocks and emits `tool-call` with `status: "running"`. When user records with `tool_result` blocks appear, it emits `tool-result`.

### 5.3 Issues

- **Tool input display during streaming**: Partial JSON is emitted as `{ _partialJson: "..." }` until the JSON is complete. Flutter needs to handle this gracefully (show "Loading input...").
- **Parallel tool calls**: When CC uses multiple tools in one turn, they share the same `message.id`. The connector tracks `toolUseIdByStreamIndex` to handle this correctly.
- **External tail tool ordering**: The tail processes JSONL lines sequentially, so tool calls and results appear in order. No ordering issues.

**Status:** ✅ Working for both paths.

---

## 6. Claude Code: Streaming Issues

### 6.1 Duplicate Messages

The connector has a `sawStreamEvents` guard: if `stream_event` messages were received, it skips processing full `SDKAssistantMessage` blocks. This prevents double-emitting.

**Risk:** If the SDK version changes and stops emitting `stream_event`, the fallback path activates. Both can't fire simultaneously.

### 6.2 Event Ordering

The SDK guarantees ordering within a turn:
```
thinking → text → tool_use → (permission) → tool_result → next turn
```

The connector preserves this ordering. The external tail also preserves it (JSONL is append-only).

### 6.3 External Tail Race Conditions

- **File write atomicity**: CC writes JSONL atomically (full lines). The tail reads on newline boundaries. No partial-line races.
- **File rotation**: The tail tracks inode numbers and resets on rotation.
- **Bootstrap vs new events**: The `initialSyncDone` flag ensures historical events aren't re-emitted.

### 6.4 Known Issue: Stale Deltas on Reconnect

If the phone disconnects and reconnects mid-stream:
- SDK path: The bridge buffers events. On reconnect, the phone catches up via the `ccEventBuffers` buffer.
- External path: The tail continues running. On reconnect, the phone gets the latest state from the shadow state / transcript hydration.

**Status:** ✅ Generally working. No critical ordering bugs identified.

---

## 7. OpenCode: Real-Time Sync

### 7.1 Architecture

OC uses a **separate REST server** at `http://localhost:4096`. All real-time updates come through a **single global SSE stream** at `GET /global/event`.

**Two sync paths:**

**Path A — SDK-initiated (phone → bridge → OC REST):**
```
Phone sends: chat { sessionId, content, projectPath }
  → oc_chat.ts handler
  → opencode.sendPromptAsync() (fire-and-forget HTTP POST)
  → SSE stream delivers events:
    message.part.delta → enqueueSdkEvent() → mapOpenCodeSdkEventToRuntimeEvent() → runtime_event
    permission.asked → runtime_event: permission_requested
    question.asked → runtime_event: user_input_requested
    session.idle → runtime_event: session_state_changed
```

**Path B — External (TUI → OC server → bridge polls messages):**
```
User types in OC TUI
  → OC server processes
  → oc-external-tail.ts polls messages every 150-2000ms (adaptive)
  → Synthesizes SDK events and feeds into enqueueSdkEvent()
  → Same mapper → same runtime_event flow
```

### 7.2 SSE Event Stream Setup

The bridge calls `opencode.startEventStream()` once at startup. All events for all sessions come through this single stream. The mapper routes events to the correct session/socket.

### 7.3 External Tail Mechanics (oc-external-tail.ts, 414 lines)

The OC external tail is simpler than CC's because it has a REST API:
1. **Polls `getSessionMessages()`** for the watched session
2. Tracks `seenMessageIds`, `seenPartIds`, `lastTextByPartId`, `lastToolStateByPartId`
3. Computes text deltas (append vs replace)
4. **Polls `listPendingPermissions()`** for new permission requests
5. **Polls `listPendingQuestions()`** for new question requests
6. **Adaptive polling**: 150ms when active, up to 2000ms when idle for 10+ consecutive polls
7. **Fallback idle detection**: If no changes for 1.5 seconds after being busy, emits idle

### 7.4 What Works

- Text streaming via SSE and polling: ✅
- Thinking/reasoning via SSE: ✅
- Tool state machine (pending → running → completed/error): ✅
- Session status (busy/idle/retry): ✅
- External user messages: User prompts typed in TUI are forwarded as `external-user-message` backend events

### 7.5 Session Ownership Model

OC has an ownership model to prevent duplicate events:
- When Broski sends a prompt, the session is marked "owned" by that WebSocket
- The external tail is paused for owned sessions
- When `session.idle` fires, ownership is released
- This prevents SSE events AND polling events from both arriving

---

## 8. OpenCode: Permission Handling

### 8.1 Path A — SSE-Driven Permissions

**Full flow:**
```
1. Tool needs permission → OC emits permission.asked via SSE
2. enqueueSdkEvent() → mapOpenCodeSdkEventToRuntimeEvent()
3. Mapper converts to RuntimePermissionRequestedEvent:
   - requestId: properties.id
   - kind: properties.permission (e.g., "bash", "edit")
   - title: properties.title
   - metadata: full PermissionRequest object
4. Flutter runtime_permission_handler.dart receives it
5. For OC backend: extracts tool, patterns, always, command from metadata
6. Builds PermissionRequest and adds to state.permissions
7. Chat screen shows permission sheet
8. User responds → Flutter sends: permission_response { permissionId, response, projectPath }
9. oc_chat.ts handles: opencode.respondToPermission(id, response, message, directory)
10. OC REST API: client.permission.reply({ requestID, directory, reply })
```

**Status:** ✅ Working. The SSE path is the primary path for OC permissions.

### 8.2 Path B — Polling-Based Permissions (External Sessions)

The OC external tail polls `listPendingPermissions()`:
```
1. External TUI triggers a tool needing permission
2. OC server holds the pending permission request
3. External tail polls listPendingPermissions() every 150-2000ms
4. New permission IDs are detected (via seenPermissionIds set)
5. Synthesized as permission.asked events → enqueueSdkEvent()
6. Same mapper/Flutter flow as Path A
7. User responds → same permission_response handling
```

**Status:** ⚠️ Working but with latency. Polling at 150ms when active means up to 150ms delay before the phone sees a permission prompt from an external session. At idle rates (2000ms), up to 2 seconds.

### 8.3 OC Permission Response Routing

Unlike CC (which has two waiter systems), OC permissions always go through the REST API:

```typescript
case "permission_response":
  await oc.respondToPermission(message.permissionId, normalized, message.message, message.projectPath);
```

The OC server handles resolving the pending permission regardless of whether it was initiated by Broski or the TUI. **This is cleaner than CC's dual-waiter system.**

---

## 9. OpenCode: User Input / Questions

### 9.1 The Question System

OC has a dedicated question API separate from permissions. Questions are structured multi-choice or free-text inputs.

### 9.2 SSE Path

```
1. Tool calls Question.ask() inside OC → question.asked SSE event
2. Mapper converts to RuntimeUserInputRequestedEvent:
   - requestId: properties.id
   - kind: "question"
   - title, prompt, options from properties
   - metadata: full QuestionRequest object
3. Flutter runtime_permission_handler.dart._handleRuntimeUserInputRequested()
4. Detects backend == AgentType.opencode → _handleOcQuestionFromRuntime()
5. Builds QuestionRequest.fromJson() from metadata
6. Sets state.pendingQuestion
7. Chat screen shows questionnaire UI
8. User answers → Flutter sends: oc_question_reply { questionId, answers: string[][] }
9. oc_questions.ts handles: opencode.replyToQuestion(id, answers, directory)
10. OC REST API: client.question.reply({ requestID, directory, answers })
```

### 9.3 Reject Path

```
User dismisses → Flutter sends: oc_question_reject { questionId }
→ oc_questions.ts: opencode.rejectQuestion(id, directory)
→ OC REST API: client.question.reject({ requestID, directory })
```

### 9.4 External Session Questions

The external tail polls `listPendingQuestions()`:
```
1. External TUI triggers a question
2. External tail detects new question ID
3. Synthesized as question.asked event → same flow
```

### 9.5 Status

**SSE path:** ✅ Working. The full flow from question.asked → Flutter QuestionRequest → user answers → oc_question_reply → OC REST is implemented.

**External polling:** ⚠️ Working but with same latency caveat as permissions.

**Reject path:** ✅ Working. `oc_question_reject` properly calls `client.question.reject()`.

---

## 10. OpenCode: Tool Use Display

### 10.1 Tool State Machine

OC tools progress through states: `pending → running → completed/error`. Each state change emits `message.part.updated` with the tool part's current state.

The mapper converts:
- `pending/running` → `tool_started` or `tool_updated` (with input, partial output)
- `completed/error` → `tool_finished` (with input, output, isError)

### 10.2 External Tail

The tail tracks `lastToolStateByPartId` and detects state changes. On change, it emits `message.part.updated` with the full tool part. The mapper handles it identically.

### 10.3 Status

✅ Working. OC's explicit state machine makes tool display cleaner than CC's. No ordering issues.

---

## 11. OpenCode: Streaming Issues

### 11.1 Reasoning Delta Computation

The mapper has a sophisticated reasoning delta system:
- Tracks `reasoningPartIds` (which parts are reasoning)
- Maintains `lastReasoningTextByPartId` (last emitted text per part)
- Handles `pendingTextDeltasByPartId` (deltas that arrive before part type is known)
- Computes incremental deltas from full text when out-of-order delivery occurs

This handles the case where `message.part.delta` arrives BEFORE the `message.part.updated` that declares the part type as "reasoning" (not "text").

### 11.2 Session Status Reporting

**Issue:** `getSessionStatus()` doesn't track external TUI sessions. The external tail works around this with fallback idle detection (no changes for 1.5 seconds → emit idle).

### 11.3 Duplicate Event Prevention

- `seenMessageIds` / `seenPartIds` / `seenPermissionIds` / `seenQuestionIds` prevent re-emitting
- `initialSyncDone` prevents emitting historical events on tail startup
- The session ownership model prevents SSE + polling from overlapping

**Status:** ✅ Generally solid. The reasoning delta computation is particularly well-done.

---

## 12. Cross-Cutting: Event Normalization

### 12.1 The Runtime Abstraction Layer

All four backends (CC, OC, CX, Pi) are normalized to a common `BroskiRuntimeEvent` type:

```typescript
type BroskiRuntimeEvent =
  | RuntimeAgentStartedEvent      // Session started
  | RuntimeAgentFinishedEvent     // Session completed
  | RuntimeSessionStateChangedEvent // State changed (busy/idle/compacting)
  | RuntimeAssistantTextDeltaEvent  // Text streaming
  | RuntimeAssistantThinkingDeltaEvent // Thinking streaming
  | RuntimeToolStartedEvent       // Tool invocation
  | RuntimeToolUpdatedEvent       // Tool progress
  | RuntimeToolFinishedEvent      // Tool completed
  | RuntimePermissionRequestedEvent // Permission needed
  | RuntimeUserInputRequestedEvent  // User input needed
  | RuntimeCompactionStartedEvent   // Compaction started
  | RuntimeCompactionFinishedEvent  // Compaction finished
  | RuntimeErrorEvent             // Error
  | RuntimeBackendEvent;          // Backend-specific passthrough
```

Each backend has its own mapper:
- `claude-code-runtime-event-mapper.ts` (263 lines)
- `opencode-runtime-event-mapper.ts` (422 lines)

### 12.2 Common vs Backend-Specific

**Fully normalized (identical across backends):**
- Text deltas (`assistant_text_delta`)
- Thinking deltas (`assistant_thinking_delta`)
- Tool lifecycle (`tool_started/updated/finished`)
- Permission requests (`permission_requested`)
- Session state (`session_state_changed`)
- Errors (`error`)

**Backend-specific (via `backend_event` passthrough):**
- CC: session-init, token-usage, checkpoint-created, elicitation, hooks, subagent invocations
- OC: message.updated, session.diff, todo.updated, PTY events, workspace events, worktree events

### 12.3 Flutter-Side Handling

The Flutter side consumes runtime_events through `runtime_chat_ingest.dart`:
1. **Deduplication**: Event fingerprints prevent double-processing
2. **Backend routing**: `RuntimePermissionRequestedEvent` routes based on `event.backend`
3. **Specialized handlers**: `runtime_permission_handler.dart`, `runtime_cc_metadata_handler.dart`, `oc_stream_handler.dart`

### 12.4 Assessment

The normalization is **well-designed and mostly complete**. The `backend_event` passthrough allows backend-specific features without polluting the common event space. The main gap is that questionnaires aren't fully normalized — CC uses `permission_requested` with `kind: "AskUserQuestion"`, while OC uses `user_input_requested`.

---

## 13. Cross-Cutting: Real-Time Sync Architecture

### 13.1 Three-Layer Design

```
Layer 1: Backend SDK/API (CC query(), OC SSE, CX JSON-RPC, Pi AgentSession)
    ↓
Layer 2: Connector (translates SDK types → internal types)
    ↓
Layer 3: Runtime Event Mapper (normalizes → BroskiRuntimeEvent)
    ↓
Layer 4: Server (routes events to correct WebSocket)
    ↓
Layer 5: Flutter (processes events → ChatMessage UI state)
```

### 13.2 SDK-Initiated vs External

| Aspect | SDK-Initiated | External |
|--------|--------------|----------|
| CC mechanism | In-process AsyncGenerator | JSONL file tail (fsWatch + polling) |
| OC mechanism | SSE global event stream | REST polling (messages + permissions + questions) |
| Latency | <10ms | 150ms-2000ms (adaptive) |
| Permission support | Full (canUseTool callback) | CC: hook system; OC: permission polling |
| Question support | Full | CC: ❌ (hook incomplete); OC: question polling |
| Cost | Low (single connection) | Higher (repeated HTTP calls for OC, disk reads for CC) |

### 13.3 Session View / Watch System

The bridge has a `session_view` system (handlers/session_view.ts) where clients can watch specific sessions:
- `set_view { backend, sessionId, cwd }` — Start watching a session
- `clear_view` — Stop watching
- External tails are started/stopped based on views
- Multiple clients can watch the same session

### 13.4 Event Delivery

The `emitCcStream()` function:
1. Maps CC stream message to runtime_event
2. Sends to session owner (the WebSocket that started the session)
3. Broadcasts to session watchers (other clients watching the same session)

The `enqueueSdkEvent()` function (for OC):
1. Maps OC SDK event to runtime_event
2. Sends to ALL connected sockets (filtered by session ID match)

---

## 14. What Broke in d647e1a

### 14.1 Commit Context

d647e1a ("lots of session related stuff and website") added:
- `cc_hook_installer.ts` (153 lines) — Installs PreToolUse + PermissionRequest hooks
- `cc_permission_hook.ts` (192 lines) — HTTP handler for hook requests
- `cc_routing.ts` update (16 lines) — Routing for hook-based permissions
- `cx_hook_installer.ts` (178 lines) — Same for Codex
- `cx_permission_hook.ts` (170 lines) — Same for Codex
- `oc-external-tail.ts` update (65 lines) — Extended polling

### 14.2 What the Commit Messages Say

- ab0d9f9: "real time sync works for pi"
- c11ffba: "now works for opencode but not the permission prompt thing"
- e19ebfe: "now works for claude code too but not the permission prompt thing"
- d647e1a: "lots of session related stuff" (adds the hook system)

### 14.3 Pi Sync Impact

The commit series focused on adding external tails for all backends. The `pi-external-tail.ts` was also added. No evidence of Pi sync breaking IN these commits (Pi had its own external tail mechanism already).

If Pi sync broke, it's likely due to:
1. Changes in `server.ts` event routing (24 lines changed in d647e1a)
2. The `session_view.ts` refactoring that affects how external tails are started/stopped
3. Timing issues with multiple external tails competing for the same session

### 14.4 CC Permission Regression

The commit notes say CC permissions don't work. This is accurate for EXTERNAL sessions:
- The hook system was added in d647e1a but is a new addition, not a regression
- SDK-initiated permissions were already working and should still work
- If SDK-initiated permissions broke, it would be due to the `cc_routing.ts` changes affecting `cc_permission_response` handling — but the code looks correct

### 14.5 What Actually Broke

Based on code analysis, the most likely breakages are:

1. **CC hook not auto-installing**: The hook installer runs on bridge startup. If the bridge was already running when d647e1a was deployed, the hooks weren't installed until restart.

2. **Race condition in hook waiter matching**: The hook uses `hookRequestId = hook:${sessionId}:${toolUseId}:${timestamp}`. The Flutter app sends `cc_permission_response` with `sessionId` and `toolUseId`. The `resolveHookPermissionByToolUse()` function does a prefix search, which should work. But if the sessionId doesn't match (e.g., different session IDs between hook and SDK), the waiter won't resolve.

3. **oc-external-tail permission polling latency**: The 150ms-2000ms adaptive polling means permissions from external sessions can be delayed, giving the impression they "don't work".

---

## 15. Gap Analysis

### 15.1 Critical Gaps

| Gap | Backend | Severity | Description |
|-----|---------|----------|-------------|
| AskUserQuestion via hooks | CC | **High** | External CC sessions show plain permission prompt instead of questionnaire |
| Hook installation lifecycle | CC | **Medium** | Hooks use hardcoded port/token; stale hooks if bridge restarts |
| Question reject timeout | CC | **Low** | If user ignores AskUserQuestion, 5-min timeout → reject, but no UI indicator |

### 15.2 Missing Features

| Feature | CC | OC | Notes |
|---------|----|----|-------|
| Permission "Always Allow" via hooks | ❌ | N/A | Hooks can't persist PermissionUpdate rules |
| Permission undo (revoke Always Allow) | ❌ | ❌ | No UI to manage persisted rules |
| Question free-text input | ✅ | ✅ | Both support custom text beyond options |
| Question reject feedback | ❌ | ✅ | CC has no reject path for AskUserQuestion; OC has question.reject() |
| Pending request recovery on reconnect | ❌ | ✅ | OC has listPendingPermissions/Questions; CC has no equivalent |
| External session user messages | ✅ | ✅ | Both forward prompts typed in terminal |

### 15.3 Robustness Gaps

| Gap | Description |
|-----|-------------|
| Hook cleanup on crash | If bridge crashes, hooks remain in settings.json. Next CC launch uses stale hooks. |
| External tail startup race | If set_view arrives before external tail initializes, first few events may be lost |
| OC polling cost | Each poll cycle makes 3 HTTP requests (messages + permissions + questions). At 150ms interval, that's 20 requests/second. |
| CC file handle leak | If the JSONL file is deleted while the tail is running, the file handle may leak. The code does have rotation detection but not deletion detection. |

---

## 16. Recommendations

### 16.1 Immediate Fixes (P0)

1. **Fix AskUserQuestion via hooks**: In `cc_permission_hook.ts`, detect `toolName === "AskUserQuestion"` and emit a proper `permission-request` with the full question structure in metadata. The phone already handles `kind: "AskUserQuestion"` correctly.

2. **Add hook heartbeat/revalidation**: On bridge startup, verify the installed hook still points to the correct port/token. On bridge shutdown (graceful), uninstall hooks.

### 16.2 Short-Term Improvements (P1)

3. **Normalize questionnaires**: Create a common `RuntimeQuestionRequestedEvent` (or rename `user_input_requested` to be clearer) that both CC and OC map to. CC maps `AskUserQuestion` → this event. OC maps `question.asked` → this event.

4. **Reduce OC polling cost**: Instead of 3 separate HTTP calls per poll, consider a single endpoint that returns messages + pending permissions + pending questions. Or use a smarter polling strategy (only poll permissions/questions when session is "running").

5. **Add pending request recovery for CC**: On reconnect, check if there's an active `ccPermissionWaiters` entry and re-emit the permission_request event.

### 16.3 Architecture Improvements (P2)

6. **Unify permission response routing**: CC has two waiter systems (SDK + hook). Consider a single waiter registry that handles both.

7. **External tail health monitoring**: Add a health check that verifies external tails are working (e.g., ping/pong or heartbeat events).

8. **CC external tail file management**: Add cleanup for the fsWatch watcher when the JSONL file is deleted. Add stale-session detection (if no writes for 30+ minutes, stop the tail).

---

## Appendix A: File Reference

### Bridge (TypeScript)

| File | Lines | Purpose |
|------|-------|---------|
| `connectors/claude-code.ts` | 3,281 | CC SDK integration (FROZEN) |
| `connectors/opencode.ts` | 1,825 | OC REST client wrapper (FROZEN) |
| `handlers/cc_chat.ts` | 359 | CC chat flow handler |
| `handlers/cc_routing.ts` | 244 | CC message routing + permission response |
| `handlers/cc_permission_hook.ts` | 193 | CC hook-based permission handling |
| `handlers/cc_hook_installer.ts` | 153 | CC hook installation in settings.json |
| `handlers/oc_chat.ts` | 96 | OC chat + permission response |
| `handlers/oc_questions.ts` | 45 | OC question reply/reject |
| `handlers/oc_routing.ts` | 105 | OC message routing |
| `runtime/claude-code-runtime-event-mapper.ts` | 263 | CC → BroskiRuntimeEvent |
| `runtime/opencode-runtime-event-mapper.ts` | 422 | OC → BroskiRuntimeEvent |
| `cc-external-tail.ts` | 730 | CC external session file tail |
| `oc-external-tail.ts` | 414 | OC external session polling |

### Flutter (Dart)

| File | Lines | Purpose |
|------|-------|---------|
| `providers/chat/runtime_chat_ingest.dart` | ~300 | Runtime event subscription + routing |
| `providers/chat/runtime_permission_handler.dart` | 347 | Permission + question handling |
| `providers/chat/runtime_event_reducer.dart` | ~230 | Event → shadow state reducer |
| `providers/chat/runtime_cc_metadata_handler.dart` | ~200 | CC-specific metadata enrichment |
| `providers/chat/oc_stream_handler.dart` | ~300 | OC-specific stream handling |

---

## Appendix B: Message Flow Diagrams

### CC SDK-Initiated Permission Flow
```
Flutter                Bridge                    CC SDK
  │                      │                         │
  │  cc_chat             │                         │
  ├─────────────────────>│  queryClaudeCode()      │
  │                      ├────────────────────────>│
  │                      │                         │
  │                      │  canUseTool(Bash, ...)  │
  │                      │<────────────────────────┤
  │  runtime_event       │                         │
  │  permission_requested│                         │
  │<─────────────────────┤                         │
  │                      │                         │
  │  cc_permission_      │                         │
  │  response: "once"    │                         │
  ├─────────────────────>│  resolve waiter         │
  │                      ├────────────────────────>│ { behavior: "allow" }
  │                      │                         │
  │  runtime_event       │                         │
  │  tool_finished       │                         │
  │<─────────────────────┤  tool executed           │
```

### CC Hook-Initiated Permission Flow (External Sessions)
```
Flutter                Bridge                    CC CLI
  │                      │                         │
  │                      │                         │  User types: "fix bug"
  │                      │                         │
  │                      │  POST /cc-hook          │  Hook fires
  │                      │<────────────────────────┤
  │  runtime_event       │                         │
  │  permission_requested│                         │
  │<─────────────────────┤                         │
  │                      │                         │
  │  cc_permission_      │                         │
  │  response: "once"    │                         │
  ├─────────────────────>│  resolve hook waiter    │
  │                      ├────────────────────────>│  { permissionDecision: "allow" }
  │                      │                         │
```

### OC Permission Flow (SSE)
```
Flutter                Bridge                    OC Server
  │                      │                         │
  │  chat                │                         │
  ├─────────────────────>│  sendPromptAsync()      │
  │                      ├────────────────────────>│
  │                      │                         │
  │                      │  SSE: permission.asked  │
  │                      │<────────────────────────┤
  │  runtime_event       │                         │
  │  permission_requested│                         │
  │<─────────────────────┤                         │
  │                      │                         │
  │  permission_response │                         │
  │  response: "once"    │                         │
  ├─────────────────────>│  respondToPermission()  │
  │                      ├────────────────────────>│
  │                      │                         │
  │                      │  SSE: permission.replied│
  │                      │<────────────────────────┤
```

### OC Question Flow
```
Flutter                Bridge                    OC Server
  │                      │                         │
  │                      │  SSE: question.asked    │
  │                      │<────────────────────────┤
  │  runtime_event       │                         │
  │  user_input_requested│                         │
  │<─────────────────────┤                         │
  │                      │                         │
  │  oc_question_reply   │                         │
  │  { answers: [[...]] }│                         │
  ├─────────────────────>│  replyToQuestion()      │
  │                      ├────────────────────────>│
  │                      │                         │
  │                      │  SSE: question.replied  │
  │                      │<────────────────────────┤
```

---

*End of Analysis Document*
