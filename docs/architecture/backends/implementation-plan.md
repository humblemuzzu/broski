# Implementation Plan: Permission, Questionnaire, and Event Channel Fixes

> Date: 2026-03-31
> Status: Ready for implementation
> Inputs: 4 backend architecture docs, 2 cross-cutting analyses, Oracle architectural guidance, source code audit

---

## 1. Executive Summary

### What's broken

Broski has three categories of user interaction during agent execution: binary permission prompts (approve/deny a tool), structured questionnaires (answer questions with options), and Pi's extension UI (in-process dialog promises). These three channels are partially conflated in the current code, causing two concrete bugs and several reliability gaps:

1. **CC AskUserQuestion via hooks doesn't work.** When Claude Code asks a structured question during an *external* terminal session, the hook emits a plain `permission-request`. The Flutter side CAN detect `kind == 'AskUserQuestion'` and show the questionnaire UI, BUT the hook response protocol only carries `permissionDecision: "allow"` — it cannot carry the user's answers back to Claude. Claude gets "approved" with no answers, producing undefined behavior.

2. **No requestId dedup on the Flutter side.** If the same permission or questionnaire event arrives twice (event replay on reconnect, external tail overlap with SSE), the Flutter app shows duplicate prompts. The bridge side deduplicates SDK waiters by key, but the Flutter `_handleRuntimePermissionRequested()` blindly prepends to `state.permissions` without checking for existing `requestId`.

3. **CC hook timeout is 310 seconds.** The `--max-time` in the curl command and the hook `timeout` in `settings.json` are both 310s. If the user doesn't respond, CC's terminal blocks for 5+ minutes before falling back to the terminal dialog. This should be 45 seconds — long enough for a phone unlock + tap, short enough that CC doesn't hang.

4. **Pi extension UI requests are lost on reconnect.** If the phone disconnects while a Pi extension UI dialog is pending, the dialog promise times out (30s default). When the phone reconnects, the pending request is gone. There's no replay mechanism for extension UI requests.

5. **External user messages can duplicate.** When a user types in the Mac terminal and the phone is watching via the external tail, the same user message can arrive through multiple paths (SSE + polling for OC, file tail + SDK events for CC). No content-hash dedup exists.

### What needs to happen

- **P0 (correctness):** Fix AskUserQuestion hook response path, add requestId dedup on Flutter side
- **P1 (reliability):** Reduce hook timeout, add Pi extension UI reconnect persistence, add external user message dedup
- **P2 (polish):** Batch `_projectRuntimeTurn()` calls during burst delivery, add `user-input-request` mapping to CC mapper (for future use)

### Architecture: 3 event channels

The system has three distinct interaction channels. They should remain separate:

| Channel | Semantics | Backends |
|---------|-----------|----------|
| `permission_requested` | Binary approve/reject (Bash, Write, file changes) | CC, OC, CX |
| `user_input_requested` | Structured questions (answers carry data back) | OC (`question.asked`), CX (`requestUserInput`) |
| Extension UI | In-process Promise-based dialogs (select/confirm/input/editor) | Pi only |

CC's `AskUserQuestion` is currently routed through `permission_requested` with special-case detection in Flutter. For SDK-initiated sessions, this works because `canUseTool` can carry `updatedInput` with answers. For hook-initiated sessions, it fundamentally cannot work because the CC hook protocol doesn't support returning structured answers.

### Expected outcome

After P0 fixes: No duplicate permission prompts, AskUserQuestion via hooks degrades gracefully (returns `"ask"` so CC shows its terminal dialog). After P1 fixes: Faster CC hook timeout, Pi extension UI survives reconnect, no duplicate external user messages.

---

## 2. Architecture

### 2.1 The Three Event Channels

```
Channel 1: permission_requested
  Purpose:     Binary decision — allow or deny a tool execution
  Response:    "allow" | "deny" (+ optional "always allow" rules)
  Backends:    CC (canUseTool + hooks), OC (permission.asked), CX (requestApproval)
  Flutter:     _handleRuntimePermissionRequested() → PermissionRequest → permission sheet
  Wire types:  BroskiPermissionRequestedEvent (bridge → app)
               cc_permission_response / permission_response / cx_permission_response (app → bridge)

Channel 2: user_input_requested
  Purpose:     Structured question — user provides typed answers, selections
  Response:    Structured answers (question→answer map, option selections)
  Backends:    OC (question.asked), CX (item/tool/requestUserInput)
  Flutter:     _handleRuntimeUserInputRequested() → QuestionRequest / CodexUserInputRequest
  Wire types:  BroskiUserInputRequestedEvent (bridge → app)
               oc_question_reply / cx_user_input_response (app → bridge)

Channel 3: Extension UI (Pi only)
  Purpose:     In-process Promise — extension blocks on a dialog result
  Response:    Typed per method (string, boolean, cancelled)
  Backends:    Pi only (extensions call uiContext.select/confirm/input/editor)
  Flutter:     pi_extension_ui_request_handler.dart → DetailSheet / AlertDialog
  Wire types:  PiStreamMessage type:"extension-ui-request" (bridge → app)
               pi_extension_ui_response (app → bridge)
```

### 2.2 CC AskUserQuestion: The Cross-Channel Problem

CC's `AskUserQuestion` is semantically a questionnaire (Channel 2) but is delivered through `canUseTool` (Channel 1's mechanism). This creates an impedance mismatch:

```
SDK-initiated path (WORKS):
  SDK canUseTool("AskUserQuestion", { questions: [...] })
    → cc_chat.ts emits permission-request with tool="AskUserQuestion", input={ questions }
    → mapper: permission_requested with kind="AskUserQuestion"
    → Flutter: detects kind="AskUserQuestion", shows questionnaire UI
    → User answers → cc_permission_response with updatedInput={ questions, answers }
    → canUseTool returns { behavior: "allow", updatedInput: { questions, answers } }
    → Claude receives the answers ✅

Hook-initiated path (BROKEN):
  CC CLI hook fires for "AskUserQuestion" PermissionRequest
    → cc_permission_hook.ts emits permission-request with tool="AskUserQuestion", input={ questions }
    → mapper: permission_requested with kind="AskUserQuestion"
    → Flutter: detects kind="AskUserQuestion", shows questionnaire UI
    → User answers → cc_permission_response with updatedInput={ questions, answers }
    → resolveHookPermissionByToolUse() passes updatedInput
    → Hook returns { hookSpecificOutput: { permissionDecision: "allow", updatedInput: { ... } } }
    → CC CLI reads hook output, sees "allow" — but ignores updatedInput ❌
    → Claude gets "approved" with no answers → undefined behavior
```

**Root cause:** The CC hook protocol for `PermissionRequest` only defines `permissionDecision` and `permissionDecisionReason` as valid return fields. `updatedInput` is not part of the protocol. The CC CLI ignores it.

**Correct fix:** When the hook receives AskUserQuestion, return `permissionDecision: "ask"` immediately (no phone relay). This tells CC to show its normal terminal dialog for the question. The user answers in the terminal. The external tail picks up the result in the JSONL and the phone sees the outcome.

### 2.3 Event Flow — Normalization Point

```
Backend SDK/API
    ↓
Connector (CC: claude-code.ts, OC: opencode.ts, CX: codex.ts, Pi: pi.ts)
    ↓
Stream message (ClaudeCodeStreamMessage, CodexStreamMessage, PiStreamMessage, OC SSE event)
    ↓
Runtime Event Mapper  ← NORMALIZATION HAPPENS HERE
    ↓
BroskiRuntimeEvent (permission_requested | user_input_requested | backend_event | ...)
    ↓
WebSocket → Flutter app
    ↓
runtime_chat_ingest.dart → routes to handler by event type
    ↓
runtime_permission_handler.dart (permissions + questionnaires)
```

Each backend's mapper is responsible for deciding whether an event is Channel 1 or Channel 2. Consumers (Flutter) should not need to re-classify events.

### 2.4 Per-Backend Channel Mapping

| Backend Event | Channel | Runtime Event Type |
|---------------|---------|-------------------|
| CC: canUseTool(Bash/Write/Edit/...) | 1 | `permission_requested` |
| CC: canUseTool(AskUserQuestion) | 1* | `permission_requested` (kind=AskUserQuestion) |
| CC: hook PreToolUse | 1 | `permission_requested` |
| CC: hook PermissionRequest for AskUserQuestion | N/A | Returns `"ask"` immediately |
| OC: permission.asked | 1 | `permission_requested` |
| OC: question.asked | 2 | `user_input_requested` |
| CX: requestApproval (command/file/permission) | 1 | `permission_requested` |
| CX: requestUserInput | 2 | `user_input_requested` |
| CX: mcpServer/elicitation/request | 2 | `user_input_requested` |
| Pi: extension UI confirm (permission-like) | 3 | `backend_event` (extension-ui-request) |
| Pi: extension UI select/input/editor | 3 | `backend_event` (extension-ui-request) |

*CC AskUserQuestion stays on Channel 1 for the SDK path because the `canUseTool` response mechanism supports `updatedInput`. This is pragmatic — moving it to Channel 2 would require a new bridge-to-SDK response path with no user-visible benefit.

---

## 3. P0 Fixes — Detailed Implementation Steps

### Fix 1: CC Hook — AskUserQuestion Returns "ask" Immediately

**Problem:** Hook receives AskUserQuestion, relays to phone, phone answers, but answers can't reach Claude because the hook protocol doesn't support `updatedInput`.

**File:** `packages/bridge/src/handlers/cc_permission_hook.ts`

**Current code (lines 54-85):**
```typescript
const hookEventName = body?.hook_event_name;
// Handle PreToolUse (tool execution) and PermissionRequest (permission dialogs incl. AskUserQuestion)
if (hookEventName !== "PreToolUse" && hookEventName !== "PermissionRequest") {
    // For other hook types, return empty (don't interfere)
    return jsonResponse({});
}

const toolName = typeof body.tool_name === "string" ? body.tool_name : "unknown";
const toolInput = body.tool_input ?? {};
const sessionId = typeof body.session_id === "string" ? body.session_id : "";
const toolUseId = typeof body.tool_use_id === "string" ? body.tool_use_id : randomUUID();
const cwd = typeof body.cwd === "string" ? body.cwd : "";

// ... (hookRequestId, emitCcStream, wait for response)

ctx.emitCcStream(sessionId, {
    type: "permission-request",
    sessionId,
    toolUseId,
    tool: toolName,
    input: typeof toolInput === "object" && toolInput !== null ? (toolInput as Record<string, unknown>) : {},
    title: formatToolDescription(toolName, toolInput),
    description: formatToolDescription(toolName, toolInput),
} as ClaudeCodeStreamMessage);
```

**New code — insert after line 65 (after `const cwd = ...`), before hookRequestId generation:**
```typescript
// AskUserQuestion via hooks: the hook protocol can't carry structured answers
// back to Claude. Return "ask" immediately so CC shows its terminal dialog.
// The user answers in the terminal; the external tail picks up the result.
if (toolName === "AskUserQuestion") {
    if (ctx.DEBUG_RTS) {
        ctx.logDebug(`[CC Hook] AskUserQuestion detected — returning "ask" (hook can't carry answers)`);
    }
    return jsonResponse({
        hookSpecificOutput: {
            hookEventName: hookEventName,
            permissionDecision: "ask",
            permissionDecisionReason: "AskUserQuestion requires terminal interaction (Broski hook limitation)",
        },
    });
}
```

**Why:** The CC hook protocol's response format for `PermissionRequest` events only supports `permissionDecision` and `permissionDecisionReason`. There is no mechanism to inject `updatedInput` (the user's answers) back into the tool execution. Returning `"ask"` tells CC to fall back to its normal terminal dialog, which handles AskUserQuestion natively. The user answers in the terminal, and the external tail (cc-external-tail.ts) picks up the tool result from the JSONL, so the phone still sees the outcome.

**Verification:**
1. Start bridge + external CC session
2. Trigger AskUserQuestion (e.g., `claude "help me choose a framework"` in plan mode)
3. Verify: CC terminal shows the question dialog (not blank/hanging)
4. Verify: Phone does NOT show a permission prompt for AskUserQuestion
5. Verify: After answering in terminal, phone sees the updated conversation via external tail

---

### Fix 2: Flutter — RequestId Dedup for Permissions

**Problem:** If the same permission request arrives twice (event replay, external tail overlap), two identical permission prompts appear in the UI.

**File:** `lib/providers/chat/runtime_permission_handler.dart`

**Current code (lines 13-28):**
```dart
void _handleRuntimePermissionRequested(
  RuntimePermissionRequestedEvent event,
) {
  final request = event.request;
  final requestId = request.requestId ?? '';
  if (requestId.isEmpty) return;

  // Determine session ID
  final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';

  // CC AskUserQuestion: special permission that becomes a QuestionRequest
  if (event.backend == AgentType.claudeCode &&
      request.kind == 'AskUserQuestion') {
    _handleCcAskUserQuestion(event, sessionId);
    return;
  }
```

**New code — add dedup check after `requestId.isEmpty` check (insert after line 18):**
```dart
void _handleRuntimePermissionRequested(
  RuntimePermissionRequestedEvent event,
) {
  final request = event.request;
  final requestId = request.requestId ?? '';
  if (requestId.isEmpty) return;

  // Dedup: skip if we already have a pending permission with this requestId
  if (state.permissions.any((p) => p.id == requestId)) return;

  // Determine session ID
  final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';

  // CC AskUserQuestion: special permission that becomes a QuestionRequest
  if (event.backend == AgentType.claudeCode &&
      request.kind == 'AskUserQuestion') {
    _handleCcAskUserQuestion(event, sessionId);
    return;
  }
```

**Why:** Without this check, event replay on reconnect (the bridge's `runtime-replay-buffer.ts` replays buffered events tagged with `replayed: true`) or overlapping external tail + SSE paths can produce duplicate permission entries in `state.permissions`. Each duplicate renders as a separate permission prompt in the chat UI.

**Verification:**
1. Connect phone, trigger a permission request (e.g., CC Bash command)
2. Before responding, disconnect and reconnect the phone
3. Verify: Only one permission prompt appears, not two
4. Verify: Responding to the permission works normally

---

### Fix 3: Flutter — RequestId Dedup for User Input Requests

**Problem:** Same dedup issue for `user_input_requested` events (OC questions, CX user input).

**File:** `lib/providers/chat/runtime_permission_handler.dart`

**Current code (lines 188-204):**
```dart
void _handleRuntimeUserInputRequested(RuntimeUserInputRequestedEvent event) {
  final request = event.request;
  final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';

  if (event.backend == AgentType.codex) {
    // CX user input → set cxPendingUserInput
    final requestId = request.requestId ?? '';
    if (requestId.isEmpty) return;
    final metadata = request.metadata ?? <String, dynamic>{};
    final cxRequest = CodexUserInputRequest.fromJson(
      requestId,
      sessionId,
      metadata,
    );
    state = state.copyWith(cxPendingUserInput: cxRequest);
    return;
  }

  if (event.backend == AgentType.opencode) {
    // OC question → set pendingQuestion
    _handleOcQuestionFromRuntime(event, sessionId);
    return;
  }
}
```

**New code — add dedup checks:**
```dart
void _handleRuntimeUserInputRequested(RuntimeUserInputRequestedEvent event) {
  final request = event.request;
  final sessionId = event.sessionId ?? state.effectiveSessionId ?? '';

  if (event.backend == AgentType.codex) {
    final requestId = request.requestId ?? '';
    if (requestId.isEmpty) return;
    // Dedup: skip if we already have pending CX input with this requestId
    if (state.cxPendingUserInput?.requestId == requestId) return;
    final metadata = request.metadata ?? <String, dynamic>{};
    final cxRequest = CodexUserInputRequest.fromJson(
      requestId,
      sessionId,
      metadata,
    );
    state = state.copyWith(cxPendingUserInput: cxRequest);
    return;
  }

  if (event.backend == AgentType.opencode) {
    _handleOcQuestionFromRuntime(event, sessionId);
    return;
  }
}
```

The OC path already has dedup at line 231:
```dart
// Check for duplicates
if (state.pendingQuestion?.id == requestId) return;
```

**Also add dedup to `_handleCcAskUserQuestion`** — insert at line 173 (before `if (parsedQuestions.isNotEmpty)`):
```dart
    // Dedup: skip if we already have a pending question with this requestId
    if (state.pendingQuestion?.id == (request.requestId ?? '')) return;

    if (parsedQuestions.isNotEmpty) {
```

**Why:** CX `cxPendingUserInput` doesn't have a dedup check. If the Codex binary sends the same `requestUserInput` twice (or it's replayed), the state gets overwritten — which is mostly harmless but can cause UI flicker. The CC AskUserQuestion path also lacks dedup and could show duplicate questionnaire prompts.

**Verification:**
1. Trigger an OC question, disconnect/reconnect — verify no duplicate
2. Trigger a CX user input request, disconnect/reconnect — verify no duplicate
3. Trigger CC AskUserQuestion (SDK path), verify no duplicate on reconnect

---

## 4. P1 Fixes — Detailed Implementation Steps

### Fix 4: Reduce CC Hook Timeout from 310s to 45s

**Problem:** The CC hook `--max-time` is 310 seconds. If the user doesn't respond on the phone, the CC terminal blocks for 5+ minutes before CC shows its fallback terminal dialog. Users think CC is frozen.

**Files to change:**
- `packages/bridge/src/handlers/cc_hook_installer.ts` (hook command + timeout field)
- `packages/bridge/src/handlers/cc_permission_hook.ts` (waiter timeout)

**File 1: `cc_hook_installer.ts`**

**Current code (line 50-51):**
```typescript
const hookEntry: Record<string, unknown> = {
    hooks: [
        {
            type: "command",
            command: hookCommand,
        },
    ],
    timeout: 310, // 5 min + 10s buffer (must exceed HOOK_PERMISSION_TIMEOUT_MS)
};
```

**New code:**
```typescript
const hookEntry: Record<string, unknown> = {
    hooks: [
        {
            type: "command",
            command: hookCommand,
        },
    ],
    timeout: 50, // 45s hook timeout + 5s buffer
};
```

**Current code (line 146):**
```typescript
`RESP=$(curl -s --max-time 310 -X POST "http://127.0.0.1:${port}/cc-hook"`,
```

**New code:**
```typescript
`RESP=$(curl -s --max-time 45 -X POST "http://127.0.0.1:${port}/cc-hook"`,
```

**File 2: `cc_permission_hook.ts`**

**Current code (line 19):**
```typescript
const HOOK_PERMISSION_TIMEOUT_MS = 300_000; // 5 minutes
```

**New code:**
```typescript
const HOOK_PERMISSION_TIMEOUT_MS = 40_000; // 40 seconds (curl times out at 45s)
```

**Why:** 45 seconds is enough time to: unlock phone (2s) + open app (3s) + read the prompt (5s) + tap approve/deny (2s) = ~12s. A 45s timeout gives 3x margin. If the user doesn't respond in 45s, they're not going to — CC should fall back to its terminal dialog. The current 310s timeout makes CC appear frozen.

The `HOOK_PERMISSION_TIMEOUT_MS` (40s) must be less than `--max-time` (45s) so the bridge responds before curl times out. The hook `timeout` in settings.json (50s) must exceed `--max-time` so CC doesn't kill the hook before curl finishes.

**Verification:**
1. Start bridge, trigger CC hook permission
2. Don't respond on phone — verify CC shows terminal dialog within ~50 seconds (not 5+ minutes)
3. Respond on phone within 45s — verify it works normally
4. Check `~/.claude/settings.json` has `timeout: 50` (not 310)

---

### Fix 5: Pi Extension UI — Record Pending Requests for Reconnect

**Problem:** If the phone disconnects while a Pi extension UI dialog (select/confirm/input) is pending, the user reconnects and sees nothing. The dialog was a Promise on the bridge side that timed out after 30s.

**File:** `packages/bridge/src/connectors/pi_extension_ui.ts`

**Current behavior:** When the phone disconnects, the pending Promise continues waiting. After the 30s timeout, it resolves with the fallback value. The extension continues with a "no answer" result. When the phone reconnects, there's nothing to show.

**What to add:** Track pending extension UI requests in a list. When a watcher (phone) reconnects, replay the pending requests.

**New code — add to `pi_extension_ui.ts`:**

After the `pending` Map declaration (line 28), add:
```typescript
/** Returns a snapshot of all pending requests for replay on reconnect. */
const getPendingRequests = (): PiStreamMessage[] => {
    const result: PiStreamMessage[] = [];
    for (const [id, entry] of pending) {
        // We stored the original stream message in a parallel map
        const msg = pendingMessages.get(id);
        if (msg) result.push(msg);
    }
    return result;
};

// Track the original stream messages for replay
const pendingMessages = new Map<string, PiStreamMessage>();
```

In the `createDialogPromise` function, after `pending.set(id, request)` and before the `emitStreamMessage` call, add:
```typescript
// Store the stream message for replay on reconnect
const streamMsg: PiStreamMessage = {
    type: "extension-ui-request",
    id,
    method,
    ...payload,
} as PiStreamMessage;
pendingMessages.set(id, streamMsg);
```

In the `cleanup` function, add:
```typescript
pendingMessages.delete(id);
```

Add `getPendingRequests` to the returned `PiExtensionUiBridge` object:
```typescript
export type PiExtensionUiBridge = {
    uiContext: any;
    resolveResponse: (response: PiExtensionUiResponseInput) => boolean;
    getPendingRequests: () => PiStreamMessage[];
    dispose: () => void;
};
```

**File 2:** `packages/bridge/src/handlers/pi_features.ts`

In the `ensureStreamBridge` function (or wherever watchers are registered), after registering a new watcher, replay pending extension UI requests:

```typescript
// After a new watcher (phone) connects, replay any pending extension UI requests
const pendingUiRequests = instance?.extensionUi?.getPendingRequests?.() ?? [];
for (const msg of pendingUiRequests) {
    // Re-emit through the same pipeline so the phone shows the dialog
    broadcast({
        type: "runtime_event",
        backend: "pi",
        data: {
            type: "backend_event",
            backend: "pi",
            timestampMs: Date.now(),
            kind: "extension-ui-request",
            payload: msg,
        },
    });
}
```

**Why:** Pi's extension UI is the permission mechanism for Pi. If a dialog is pending and the phone reconnects, the user should see it again. Without this, the extension silently gets the fallback value (usually `undefined` or `false`), which can cause the extension to skip important steps.

**Verification:**
1. Start a Pi session that triggers an extension UI dialog (e.g., a confirm prompt)
2. Disconnect the phone while the dialog is showing
3. Reconnect within 30 seconds
4. Verify: The dialog reappears on the phone
5. Verify: Responding to the replayed dialog resolves the original Promise

---

### Fix 6: External User Message Dedup

**Problem:** When a user types in the Mac terminal and the phone is watching, the same user message can arrive via multiple paths. For OC: SSE event + polling both fire. For CC: JSONL tail may re-process lines after fsWatch fires multiple times.

**File:** `lib/providers/chat/runtime_chat_ingest.dart`

**Current code (lines 124-128):**
```dart
// External user message — prompt typed on Mac terminal, show it on phone
if (event case RuntimeBackendEvent()
    when event.kind == 'external-user-message') {
  _handleExternalUserMessage(event);
}
```

**New code — add a content-hash dedup set:**

Add a field to the class/extension (in `ChatSessionNotifier` or as a local):
```dart
// In the class state or as an instance field:
final _seenExternalUserMessages = <String>{};
```

Then modify the handler:
```dart
if (event case RuntimeBackendEvent()
    when event.kind == 'external-user-message') {
  // Dedup by content hash + timestamp bucket (16ms window)
  final payload = event.payload;
  final content = payload is Map ? (payload['content'] ?? '').toString() : '';
  final bucket = (event.timestampMs ~/ 16000); // 16-second buckets
  final dedupKey = '${content.hashCode}:$bucket';
  if (_seenExternalUserMessages.contains(dedupKey)) return;
  _seenExternalUserMessages.add(dedupKey);
  // Prevent unbounded growth — prune old entries periodically
  if (_seenExternalUserMessages.length > 200) {
    _seenExternalUserMessages.clear();
  }
  _handleExternalUserMessage(event);
}
```

**Why:** External user messages are synthesized from backend-specific detection (JSONL parsing, SSE events, polling). Multiple detection mechanisms can fire for the same user message within a short window. A content hash + timestamp bucket identifies duplicates without false positives across different messages.

**Verification:**
1. Open an OC session on phone, type a message in the OC TUI
2. Verify: Phone shows the user message exactly once (not twice)
3. Type rapidly — verify no duplicates

---

## 5. P2 Fixes — Detailed Implementation Steps

### Fix 7: Batch `_projectRuntimeTurn()` Calls During Burst Delivery

**Problem:** During JSONL catch-up (session resume, external tail initial sync), hundreds of events arrive in quick succession. Each triggers `_projectRuntimeTurn()`, which rebuilds a ChatMessage and triggers a UI rebuild. This causes jank on mobile.

**File:** `lib/providers/chat/runtime_chat_ingest.dart`

**Approach:** Debounce `_projectRuntimeTurn()` with a 16ms timer (one frame at 60fps). During bursts, accumulate the latest `RuntimeChatTurnState` and project once per frame.

**Current code (line 56):**
```dart
_projectRuntimeTurn(next);
```

**New code:**
```dart
_scheduleRuntimeTurnProjection(next);
```

Add a new method:
```dart
Timer? _runtimeProjectionTimer;
RuntimeChatTurnState? _pendingProjectionTurn;

void _scheduleRuntimeTurnProjection(RuntimeChatTurnState turn) {
  _pendingProjectionTurn = turn;
  _runtimeProjectionTimer ??= Timer(const Duration(milliseconds: 16), () {
    _runtimeProjectionTimer = null;
    final pending = _pendingProjectionTurn;
    if (pending != null) {
      _pendingProjectionTurn = null;
      _projectRuntimeTurn(pending);
    }
  });
}
```

Also apply the same debounce to the state handler's `_projectRuntimeTurn` call (line 156):
```dart
_scheduleRuntimeTurnProjection(next);
```

**Why:** On mobile, each `_projectRuntimeTurn()` call triggers `_addMessage()` or `_updateMessage()` which notifies Riverpod listeners and rebuilds the chat list. During a burst of 100+ events (JSONL catch-up), this means 100+ UI rebuilds in a few hundred milliseconds. A 16ms debounce coalesces these into one rebuild per frame.

**Verification:**
1. Resume a large CC session (100+ turns)
2. Profile with Flutter DevTools — verify frame times stay under 16ms during catch-up
3. Verify final state is identical (all messages rendered correctly)

---

### Fix 8: Add `user-input-request` Mapping to CC Runtime Event Mapper

**Problem:** The CC runtime event mapper has no case for a `user-input-request` stream message type. If we ever want to emit CC questionnaires as `user_input_requested` instead of `permission_requested`, the mapper needs to handle it.

**File:** `packages/bridge/src/runtime/claude-code-runtime-event-mapper.ts`

**Add case before the default backend_event cases (before line 245):**

```typescript
// Future: CC questionnaires via user-input-request (not currently emitted by SDK path,
// but reserved for when we move AskUserQuestion to Channel 2)
case "user-input-request":
    return {
        ...baseEvent("user_input_requested", eventContext, {
            sourceType: streamMessage.type,
        }),
        ...(streamMessage.toolUseId ? { toolCallId: streamMessage.toolUseId } : {}),
        request: {
            requestId: streamMessage.toolUseId,
            kind: "AskUserQuestion",
            title: streamMessage.title || "Question from Claude",
            metadata: {
                tool: "AskUserQuestion",
                input: streamMessage.input,
            },
        },
    };
```

**Also add the type to the ClaudeCodeStreamMessage union** in `packages/bridge/src/types.ts`:

Find the `ClaudeCodeStreamMessage` type and add:
```typescript
| {
    type: "user-input-request";
    sessionId?: string;
    toolUseId?: string;
    tool: string;
    input: Record<string, unknown>;
    title?: string;
    description?: string;
}
```

**Why:** This is a no-op change — nothing currently emits `user-input-request` for CC. But it reserves the mapping so that if the CC SDK later supports a proper questionnaire channel (or if we decide to move AskUserQuestion to Channel 2 for SDK-initiated sessions), the mapper is ready.

**Verification:** Verify that the build succeeds and no existing behavior changes. This is a dead code path until it's wired up.

---

### Fix 9: OC Polling Optimization (Conditional)

**Problem:** The OC external tail polls `getSessionMessages()`, `listPendingPermissions()`, and `listPendingQuestions()` in every cycle — 3 HTTP requests per poll. At 150ms active rate, that's 20 requests/second.

**Approach:** Only poll permissions and questions when the session status is "running". When idle, skip permission/question polling entirely.

**This fix depends on OC adding a combined endpoint or the existing polling cost being measured as actually problematic. Defer until measured.**

No code change specified — this is tracked as a future optimization.

---

## 6. Per-Backend Feature Matrix

### Current State

| Feature | Claude Code | OpenCode | Pi | Codex |
|---------|:-----------:|:--------:|:--:|:-----:|
| Permission (SDK-initiated) | ✅ canUseTool | ✅ SSE permission.asked | ✅ Extension UI confirm | ✅ JSON-RPC requestApproval |
| Permission (external session) | ✅ Hook (PreToolUse) | ✅ Polling listPendingPermissions | N/A¹ | ⚠️ Hook (deny only) |
| Questionnaire (SDK-initiated) | ✅ AskUserQuestion via canUseTool | ✅ SSE question.asked | ✅ Extension UI select/input | ✅ requestUserInput |
| Questionnaire (external session) | ❌→✅² Returns "ask" | ✅ Polling listPendingQuestions | N/A¹ | ❌ Not applicable³ |
| Permission dedup (Flutter) | ❌→✅ | ✅ (OC has it) | N/A | ❌→✅ |
| Question dedup (Flutter) | ❌→✅ | ✅ | N/A | ❌→✅ |
| Real-time streaming | ✅ | ✅ | ✅ | ✅ |
| Tool display | ✅ | ✅ | ✅ | ✅ |

¹ Pi sessions outside the bridge use the external tail, but Pi has no built-in permission system — it's yolo by default.
² After Fix 1: hook returns `"ask"` for AskUserQuestion so CC shows terminal dialog. Not broken, graceful degradation.
³ Codex's `requestUserInput` is a JSON-RPC server request that only fires in the persistent app-server process, not through hooks.

### Target State (After All Fixes)

| Feature | Claude Code | OpenCode | Pi | Codex |
|---------|:-----------:|:--------:|:--:|:-----:|
| Permission (SDK-initiated) | ✅ | ✅ | ✅ | ✅ |
| Permission (external session) | ✅ Hook | ✅ Polling | N/A | ⚠️ Hook (deny only) |
| Questionnaire (SDK-initiated) | ✅ AskUserQuestion | ✅ question.asked | ✅ Extension UI | ✅ requestUserInput |
| Questionnaire (external session) | ✅ Graceful fallback | ✅ Polling | ✅ Replay on reconnect | N/A |
| Permission dedup (Flutter) | ✅ | ✅ | N/A | ✅ |
| Question dedup (Flutter) | ✅ | ✅ | N/A | ✅ |
| Hook timeout | ✅ 45s | N/A | N/A | N/A |
| Extension UI reconnect | N/A | N/A | ✅ | N/A |

---

## 7. Testing Plan

### 7.1 P0 Test Scenarios

**Fix 1: CC AskUserQuestion via hooks**

| # | Scenario | Expected |
|---|----------|----------|
| 1 | External CC session, Claude asks AskUserQuestion | CC terminal shows question dialog, phone does NOT show permission prompt |
| 2 | SDK-initiated CC session, Claude asks AskUserQuestion | Phone shows questionnaire UI, user answers, Claude receives answers |
| 3 | External CC session, normal tool (Bash) | Phone shows permission prompt, user approves, CC proceeds |
| 4 | Bridge not running, CC asks AskUserQuestion | Hook curl fails, CC shows terminal dialog (graceful degradation) |

**Fix 2-3: RequestId dedup**

| # | Scenario | Expected |
|---|----------|----------|
| 5 | CC permission, disconnect/reconnect phone | One permission prompt, not two |
| 6 | CX approval, disconnect/reconnect phone | One approval prompt, not two |
| 7 | OC question, rapid SSE + polling overlap | One questionnaire, not two |
| 8 | CC AskUserQuestion, disconnect/reconnect | One questionnaire, not two |
| 9 | Normal permission, respond "approve" | Permission disappears, tool executes |
| 10 | Two DIFFERENT permissions in sequence | Both appear correctly |

### 7.2 P1 Test Scenarios

**Fix 4: CC hook timeout**

| # | Scenario | Expected |
|---|----------|----------|
| 11 | Hook fires, user doesn't respond | CC terminal dialog appears within ~50s |
| 12 | Hook fires, user responds in 10s | Permission resolves normally |
| 13 | Bridge restart | `~/.claude/settings.json` updated with new port/token, timeout=50 |

**Fix 5: Pi extension UI reconnect**

| # | Scenario | Expected |
|---|----------|----------|
| 14 | Extension UI confirm pending, phone disconnects and reconnects within 30s | Dialog reappears |
| 15 | Extension UI select pending, phone disconnects for >30s | Timeout fires, extension gets fallback, no dialog on reconnect |
| 16 | No pending requests, phone reconnects | No spurious dialogs |

**Fix 6: External user message dedup**

| # | Scenario | Expected |
|---|----------|----------|
| 17 | Type message in OC TUI, phone watching | Message appears once |
| 18 | Type message in CC terminal, phone watching | Message appears once |
| 19 | Rapid typing (5 messages in 2s) | Each message appears exactly once |

### 7.3 Edge Cases

| # | Edge case | Test |
|---|-----------|------|
| 20 | Permission response after bridge restart | Waiter is gone; verify no crash, permission re-asked on next tool call |
| 21 | Two phones watching same CC session | Both see permission prompt; first response wins, second is no-op |
| 22 | AskUserQuestion with empty questions array | Should not show questionnaire (empty parsedQuestions check) |
| 23 | Hook with very long command (>10KB) | Curl POST succeeds, permission prompt truncates display |
| 24 | Codex permission + CX user input at same time | Both show, responding to one doesn't affect the other |

---

## 8. File Change Summary

| File | Change Type | Priority | Description |
|------|-------------|----------|-------------|
| `packages/bridge/src/handlers/cc_permission_hook.ts` | Modify | **P0** | Add AskUserQuestion early-return with `permissionDecision: "ask"` |
| `lib/providers/chat/runtime_permission_handler.dart` | Modify | **P0** | Add requestId dedup for permissions (line 19), CX user input (line 195), CC AskUserQuestion (line 173) |
| `packages/bridge/src/handlers/cc_hook_installer.ts` | Modify | **P1** | Reduce `timeout` from 310 to 50, `--max-time` from 310 to 45 |
| `packages/bridge/src/handlers/cc_permission_hook.ts` | Modify | **P1** | Reduce `HOOK_PERMISSION_TIMEOUT_MS` from 300000 to 40000 |
| `packages/bridge/src/connectors/pi_extension_ui.ts` | Modify | **P1** | Add `pendingMessages` Map, `getPendingRequests()`, store/clean stream messages |
| `packages/bridge/src/handlers/pi_features.ts` | Modify | **P1** | Replay pending extension UI requests on watcher registration |
| `lib/providers/chat/runtime_chat_ingest.dart` | Modify | **P1** | Add `_seenExternalUserMessages` dedup set for external-user-message events |
| `lib/providers/chat/runtime_chat_ingest.dart` | Modify | **P2** | Add `_scheduleRuntimeTurnProjection()` debounce for `_projectRuntimeTurn()` |
| `packages/bridge/src/runtime/claude-code-runtime-event-mapper.ts` | Modify | **P2** | Add `user-input-request` case (dead code, future-proofing) |
| `packages/bridge/src/types.ts` | Modify | **P2** | Add `user-input-request` variant to `ClaudeCodeStreamMessage` union |

**Total files changed:** 7 (P0: 2, P1: 4, P2: 2, with overlap)
**Total new files:** 0
**Estimated line changes:** ~80 insertions, ~10 modifications
