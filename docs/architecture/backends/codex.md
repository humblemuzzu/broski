# Codex Backend Architecture — Deep Reference

> **Last updated:** 2026-03-31
> **Source of truth:** Codex repo at `reference/codex/`, bridge at `packages/bridge/src/`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [JSON-RPC Protocol](#2-json-rpc-protocol)
3. [Session Lifecycle](#3-session-lifecycle)
4. [Sending a Prompt](#4-sending-a-prompt)
5. [Streaming Response Flow](#5-streaming-response-flow)
6. [Content Types — ThreadItem](#6-content-types--threaditem)
7. [Tool Use Flow](#7-tool-use-flow)
8. [Permission System](#8-permission-system)
9. [User Input / Questions](#9-user-input--questions)
10. [Thinking / Reasoning](#10-thinking--reasoning)
11. [Error Handling](#11-error-handling)
12. [Image / File Input](#12-image--file-input)
13. [Cost / Usage Tracking](#13-cost--usage-tracking)
14. [The app-server Command](#14-the-app-server-command)
15. [Session Resume](#15-session-resume)
16. [Real-time Event Ordering](#16-real-time-event-ordering)
17. [Our Connector Implementation](#17-our-connector-implementation)
18. [Our Wire Protocol — cx_stream](#18-our-wire-protocol--cx_stream)
19. [Differences from SDK-based Backends](#19-differences-from-sdk-based-backends)
20. [Permission & Question Handling — Full Details](#20-permission--question-handling--full-details)
21. [Configuration System](#21-configuration-system)
22. [Multi-Agent Collaboration](#22-multi-agent-collaboration)

---

## 1. Architecture Overview

Codex (by OpenAI) is an AI coding agent. Unlike Claude Code or OpenCode which expose
JavaScript/TypeScript SDKs that you `import`, Codex is a **Rust binary** that exposes a
**JSON-RPC protocol over stdio** via its `app-server` subcommand.

### The Three Layers

```
┌──────────────────────────────────────────────────────────┐
│  Codex Binary (Rust)                                     │
│  codex-rs/app-server/                                    │
│  ┌────────────────┐  ┌────────────────┐                  │
│  │ MessageProcessor│  │ CodexExec      │                  │
│  │ (JSON-RPC)      │  │ (LLM calls)    │                  │
│  └────────────────┘  └────────────────┘                  │
│           ▲ stdio (JSONL)                                │
├───────────┼──────────────────────────────────────────────┤
│  Bridge Connector (TypeScript / Bun)                     │
│  packages/bridge/src/connectors/codex.ts                 │
│  CodexAppServerClient                                    │
│           ▲ WebSocket                                    │
├───────────┼──────────────────────────────────────────────┤
│  Flutter App                                             │
│  lib/providers/chat_provider.dart                        │
│  BridgeService → cx_stream → runtime_event               │
└──────────────────────────────────────────────────────────┘
```

### Key Architecture Decisions

1. **Persistent process.** The app-server runs as a long-lived child process,
   not spawned per-request. It manages multiple threads concurrently.

2. **Bidirectional JSON-RPC.** Both client→server requests AND server→client
   requests exist. The server sends requests for approval prompts.

3. **Notification-based streaming.** Turn progress is delivered via server
   notifications (no `id` field), not as response streaming.

4. **Threads ≠ sessions.** A "thread" is a conversation. Threads persist to
   `~/.codex/sessions/` as `.jsonl` files. Multiple threads can be loaded
   simultaneously in one app-server process.

5. **No SDK dependency at runtime.** Our bridge spawns the `codex` binary
   directly. The TypeScript SDK (`@openai/codex`) exists but uses `codex exec`
   (one-shot, per-turn subprocess), not `app-server` (persistent JSON-RPC).

---

## 2. JSON-RPC Protocol

The protocol is defined in Rust at:
`codex-rs/app-server-protocol/src/protocol/common.rs`

### Message Format

Every message is a single JSON line (JSONL) on stdio.

**Client → Server Request:**
```json
{ "method": "turn/start", "id": 1, "params": { "threadId": "abc", "input": [...] } }
```

**Server → Client Response:**
```json
{ "id": 1, "result": { "turn": { "id": "turn_xyz", "status": "inProgress", "items": [] } } }
```

**Server → Client Notification (no `id`):**
```json
{ "method": "item/agentMessage/delta", "params": { "threadId": "abc", "turnId": "turn_xyz", "itemId": "item_1", "delta": "Hello" } }
```

**Server → Client Request (has `id`, expects response):**
```json
{ "method": "item/commandExecution/requestApproval", "id": 42, "params": { "threadId": "abc", "command": ["rm", "-rf", "/tmp/test"], "cwd": "/project" } }
```

**Client → Server Response (to server request):**
```json
{ "id": 42, "result": { "decision": "accept" } }
```

**Error Response:**
```json
{ "id": 1, "error": { "message": "Thread not found" } }
```

### Complete Client Request Methods

| Wire Name | Params Type | Response Type | Description |
|-----------|-------------|---------------|-------------|
| `initialize` | `InitializeParams` | `InitializeResponse` | Handshake with client info + capabilities |
| `thread/start` | `ThreadStartParams` | `ThreadStartResponse` | Create a new conversation thread |
| `thread/resume` | `ThreadResumeParams` | `ThreadResumeResponse` | Resume an existing thread |
| `thread/fork` | `ThreadForkParams` | `ThreadForkResponse` | Fork a thread at a specific point |
| `thread/archive` | `ThreadArchiveParams` | `ThreadArchiveResponse` | Archive a thread |
| `thread/unarchive` | `ThreadUnarchiveParams` | `ThreadUnarchiveResponse` | Unarchive a thread |
| `thread/list` | `ThreadListParams` | `ThreadListResponse` | List all threads |
| `thread/loaded/list` | `ThreadLoadedListParams` | `ThreadLoadedListResponse` | List currently loaded threads |
| `thread/read` | `ThreadReadParams` | `ThreadReadResponse` | Read thread with full turn history |
| `thread/unsubscribe` | `ThreadUnsubscribeParams` | `ThreadUnsubscribeResponse` | Unsubscribe from thread events |
| `thread/name/set` | `ThreadSetNameParams` | `ThreadSetNameResponse` | Set thread display name |
| `thread/metadata/update` | `ThreadMetadataUpdateParams` | `ThreadMetadataUpdateResponse` | Update thread metadata |
| `thread/compact/start` | `ThreadCompactStartParams` | `ThreadCompactStartResponse` | Manually trigger context compaction |
| `thread/rollback` | `ThreadRollbackParams` | `ThreadRollbackResponse` | Roll back N turns |
| `thread/shellCommand` | `ThreadShellCommandParams` | `ThreadShellCommandResponse` | Run shell command on thread |
| `thread/backgroundTerminals/clean` | `ThreadBackgroundTerminalsCleanParams` | `ThreadBackgroundTerminalsCleanResponse` | Clean background terminals |
| `turn/start` | `TurnStartParams` | `TurnStartResponse` | Submit user input, start a turn |
| `turn/steer` | `TurnSteerParams` | `TurnSteerResponse` | Inject guidance mid-turn |
| `turn/interrupt` | `TurnInterruptParams` | `TurnInterruptResponse` | Interrupt active turn |
| `review/start` | `ReviewStartParams` | `ReviewStartResponse` | Start a code review |
| `model/list` | `ModelListParams` | `ModelListResponse` | List available models |
| `skills/list` | `SkillsListParams` | `SkillsListResponse` | List skills |
| `skills/config/write` | `SkillsConfigWriteParams` | `SkillsConfigWriteResponse` | Enable/disable skill |
| `plugin/list` | `PluginListParams` | `PluginListResponse` | List installed plugins |
| `plugin/read` | `PluginReadParams` | `PluginReadResponse` | Read plugin details |
| `plugin/install` | `PluginInstallParams` | `PluginInstallResponse` | Install plugin |
| `plugin/uninstall` | `PluginUninstallParams` | `PluginUninstallResponse` | Uninstall plugin |
| `app/list` | `AppsListParams` | `AppsListResponse` | List apps/connectors |
| `config/read` | `ConfigReadParams` | `ConfigReadResponse` | Read effective configuration |
| `config/value/write` | `ConfigValueWriteParams` | `ConfigWriteResponse` | Write a config value |
| `config/batchWrite` | `ConfigBatchWriteParams` | `ConfigWriteResponse` | Batch write config values |
| `config/mcpServer/reload` | `Option<()>` | `McpServerRefreshResponse` | Reload MCP servers |
| `configRequirements/read` | `Option<()>` | `ConfigRequirementsReadResponse` | Read config requirements |
| `mcpServerStatus/list` | `ListMcpServerStatusParams` | `ListMcpServerStatusResponse` | List MCP server status |
| `mcpServer/oauth/login` | `McpServerOauthLoginParams` | `McpServerOauthLoginResponse` | Initiate MCP OAuth login |
| `account/read` | `GetAccountParams` | `GetAccountResponse` | Read account info |
| `account/login/start` | `LoginAccountParams` | `LoginAccountResponse` | Start login flow |
| `account/login/cancel` | `CancelLoginAccountParams` | `CancelLoginAccountResponse` | Cancel login |
| `account/logout` | `Option<()>` | `LogoutAccountResponse` | Logout |
| `account/rateLimits/read` | `Option<()>` | `GetAccountRateLimitsResponse` | Read rate limits |
| `command/exec` | `CommandExecParams` | `CommandExecResponse` | One-off sandboxed command |
| `command/exec/write` | `CommandExecWriteParams` | `CommandExecWriteResponse` | Write stdin to exec session |
| `command/exec/terminate` | `CommandExecTerminateParams` | `CommandExecTerminateResponse` | Terminate exec session |
| `command/exec/resize` | `CommandExecResizeParams` | `CommandExecResizeResponse` | Resize exec PTY |
| `feedback/upload` | `FeedbackUploadParams` | `FeedbackUploadResponse` | Upload user feedback |
| `experimentalFeature/list` | `ExperimentalFeatureListParams` | `ExperimentalFeatureListResponse` | List experimental features |
| `experimentalFeature/enablement/set` | params | response | Enable/disable features |
| `collaborationMode/list` | `CollaborationModeListParams` | `CollaborationModeListResponse` | List collab mode presets |
| `externalAgentConfig/detect` | params | response | Detect Claude/Codex configs |
| `externalAgentConfig/import` | params | response | Import external agent configs |
| `fs/readFile` | `FsReadFileParams` | `FsReadFileResponse` | Read file via app-server |
| `fs/writeFile` | `FsWriteFileParams` | `FsWriteFileResponse` | Write file |
| `fs/readDirectory` | `FsReadDirectoryParams` | `FsReadDirectoryResponse` | List directory |
| `fs/getMetadata` | `FsGetMetadataParams` | `FsGetMetadataResponse` | File metadata |
| `fs/watch` | `FsWatchParams` | `FsWatchResponse` | Watch filesystem changes |
| `fs/unwatch` | `FsUnwatchParams` | `FsUnwatchResponse` | Stop watching |
| `fuzzyFileSearch` | `FuzzyFileSearchParams` | `FuzzyFileSearchResponse` | Fuzzy file search |

### Server Request Methods (Server → Client, expects response)

| Wire Name | Params Type | Response Type | Description |
|-----------|-------------|---------------|-------------|
| `item/commandExecution/requestApproval` | `CommandExecutionRequestApprovalParams` | `CommandExecutionRequestApprovalResponse` | Approve shell command |
| `item/fileChange/requestApproval` | `FileChangeRequestApprovalParams` | `FileChangeRequestApprovalResponse` | Approve file changes |
| `item/tool/requestUserInput` | `ToolRequestUserInputParams` | `ToolRequestUserInputResponse` | Request user input |
| `mcpServer/elicitation/request` | `McpServerElicitationRequestParams` | `McpServerElicitationRequestResponse` | MCP elicitation |
| `item/permissions/requestApproval` | `PermissionsRequestApprovalParams` | `PermissionsRequestApprovalResponse` | Request additional permissions |
| `item/tool/call` | `DynamicToolCallParams` | `DynamicToolCallResponse` | Execute client-side tool |
| `account/chatgptAuthTokens/refresh` | params | response | Refresh ChatGPT auth |

### Server Notification Methods

| Wire Name | Payload Type | Description |
|-----------|-------------|-------------|
| `error` | `ErrorNotification` | Fatal error with thread/turn context |
| `thread/started` | `ThreadStartedNotification` | New thread created |
| `thread/status/changed` | `ThreadStatusChangedNotification` | Thread status update |
| `thread/archived` | `ThreadArchivedNotification` | Thread archived |
| `thread/unarchived` | `ThreadUnarchivedNotification` | Thread unarchived |
| `thread/closed` | `ThreadClosedNotification` | Thread closed/unloaded |
| `thread/name/updated` | `ThreadNameUpdatedNotification` | Thread name changed |
| `thread/tokenUsage/updated` | `ThreadTokenUsageUpdatedNotification` | Token usage update |
| `thread/compacted` | `ContextCompactedNotification` | Context compacted (deprecated) |
| `turn/started` | `TurnStartedNotification` | New turn began processing |
| `turn/completed` | `TurnCompletedNotification` | Turn finished |
| `turn/diff/updated` | `TurnDiffUpdatedNotification` | Aggregated diff for turn |
| `turn/plan/updated` | `TurnPlanUpdatedNotification` | Plan steps updated |
| `item/started` | `ItemStartedNotification` | New item in progress |
| `item/completed` | `ItemCompletedNotification` | Item reached terminal state |
| `item/agentMessage/delta` | `AgentMessageDeltaNotification` | Streaming text delta |
| `item/reasoning/summaryTextDelta` | `ReasoningSummaryTextDeltaNotification` | Reasoning summary delta |
| `item/reasoning/summaryPartAdded` | `ReasoningSummaryPartAddedNotification` | New reasoning part |
| `item/reasoning/textDelta` | `ReasoningTextDeltaNotification` | Raw reasoning text delta |
| `item/commandExecution/outputDelta` | `CommandExecutionOutputDeltaNotification` | Command output streaming |
| `item/commandExecution/terminalInteraction` | `TerminalInteractionNotification` | Terminal stdin interaction |
| `item/fileChange/outputDelta` | `FileChangeOutputDeltaNotification` | File change diff delta |
| `item/plan/delta` | `PlanDeltaNotification` | Plan text streaming |
| `item/mcpToolCall/progress` | `McpToolCallProgressNotification` | MCP tool progress |
| `item/autoApprovalReview/started` | notification | Guardian review started |
| `item/autoApprovalReview/completed` | notification | Guardian review completed |
| `command/exec/outputDelta` | `CommandExecOutputDeltaNotification` | One-off command output |
| `serverRequest/resolved` | `ServerRequestResolvedNotification` | Approval resolved |
| `skills/changed` | `SkillsChangedNotification` | Local skills changed |
| `account/updated` | `AccountUpdatedNotification` | Account state changed |
| `account/rateLimits/updated` | notification | Rate limits changed |
| `account/login/completed` | notification | Login completed |
| `app/list/updated` | `AppListUpdatedNotification` | Apps list changed |
| `mcpServer/startupStatus/updated` | notification | MCP server status |
| `mcpServer/oauthLogin/completed` | notification | MCP OAuth completed |
| `fs/changed` | `FsChangedNotification` | Watched file changed |
| `model/rerouted` | `ModelReroutedNotification` | Model was rerouted |
| `configWarning` | `ConfigWarningNotification` | Config warning |
| `deprecationNotice` | `DeprecationNoticeNotification` | Deprecation notice |

### Client Notification Methods

| Wire Name | Description |
|-----------|-------------|
| `initialized` | Sent after `initialize` response, completes handshake |

---

## 3. Session Lifecycle

### Initialization Handshake

Before any conversation, the client must perform a handshake:

```
Client → Server:  { "method": "initialize", "id": 1, "params": {
                      "clientInfo": { "name": "broski", "title": "Broski", "version": "0.1.0" },
                      "capabilities": { "experimentalApi": true }
                    }}

Server → Client:  { "id": 1, "result": {
                      "userAgent": "codex/0.1.2345",
                      "codexHome": "/Users/user/.codex",
                      "platformFamily": "unix",
                      "platformOs": "macos"
                    }}

Client → Server:  { "method": "initialized" }
```

The `experimentalApi: true` capability enables access to experimental features
like `thread/start.dynamicTools`, collaboration modes, and guardian reviews.

### Thread Creation

```
Client → Server:  { "method": "thread/start", "id": 2, "params": {
                      "cwd": "/Users/user/project",
                      "model": "o3-mini",
                      "approvalPolicy": "on-failure",
                      "sandbox": "workspace-write"
                    }}

Server → Client:  { "id": 2, "result": {
                      "thread": {
                        "id": "550e8400-e29b-41d4-a716-446655440000",
                        "preview": "",
                        "ephemeral": false,
                        "modelProvider": "openai",
                        "createdAt": 1711843200,
                        "updatedAt": 1711843200,
                        "status": { "type": "idle" },
                        "cwd": "/Users/user/project",
                        "cliVersion": "0.1.2345",
                        "source": "appServer",
                        "turns": []
                      },
                      "model": "o3-mini",
                      "modelProvider": "openai",
                      "approvalPolicy": "on-failure",
                      "sandbox": { "type": "workspaceWrite", ... },
                      "reasoningEffort": "medium"
                    }}
```

### Thread Resume

```
Client → Server:  { "method": "thread/resume", "id": 3, "params": {
                      "threadId": "550e8400-e29b-41d4-a716-446655440000",
                      "model": "o3-mini"
                    }}

Server → Client:  { "id": 3, "result": {
                      "thread": {
                        "id": "550e8400-...",
                        "turns": [
                          { "id": "turn_1", "items": [...], "status": "completed" },
                          { "id": "turn_2", "items": [...], "status": "completed" }
                        ],
                        ...
                      }
                    }}
```

The resumed thread includes full turn history with all items populated.

### Thread Lifecycle States

Threads have a `ThreadStatus`:
- **Idle** — No turn in progress
- **Active** — Turn in progress, with optional `activeFlags` (e.g., `["compacting"]`)

---

## 4. Sending a Prompt

A prompt is sent via `turn/start`. This is a **request** (has `id`, gets a response).
The actual streaming of results happens via **notifications** (no `id`).

### TurnStartParams

```typescript
type TurnStartParams = {
  threadId: string;              // Required: which thread
  input: UserInput[];            // Required: user's message (text, images, skills, mentions)
  cwd?: string;                  // Override working directory
  approvalPolicy?: AskForApproval;  // Override approval policy
  approvalReviewer?: ApprovalsReviewer;  // Override reviewer
  sandboxPolicy?: SandboxPolicy;     // Override sandbox
  model?: string;                // Override model
  serviceTier?: ServiceTier;     // Override service tier
  effort?: ReasoningEffort;      // Override reasoning effort: "minimal"|"low"|"medium"|"high"|"xhigh"
  summary?: ReasoningSummary;    // Override reasoning summary
  personality?: Personality;     // "none" | "friendly" | "pragmatic"
  outputSchema?: JsonValue;      // JSON Schema for structured output
  collaborationMode?: CollaborationMode;  // Pre-set collab mode
};
```

### UserInput Types

```typescript
type UserInput =
  | { type: "text"; text: string; text_elements: TextElement[] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };
```

### Example: Sending a text prompt

```json
{
  "method": "turn/start",
  "id": 4,
  "params": {
    "threadId": "550e8400-...",
    "input": [
      { "type": "text", "text": "Fix the login bug in auth.ts", "text_elements": [] }
    ],
    "effort": "high"
  }
}
```

### TurnStartResponse

```json
{
  "id": 4,
  "result": {
    "turn": {
      "id": "turn_abc123",
      "items": [],
      "status": "inProgress",
      "error": null
    }
  }
}
```

The turn starts processing asynchronously. Results arrive as notifications.

---

## 5. Streaming Response Flow

After `turn/start` returns, the server emits a sequence of notifications.
All notifications include `threadId` and `turnId` for routing.

### Notification Sequence (typical turn)

```
1. turn/started          → { thread_id, turn: { id, status: "inProgress" } }
2. item/started          → { item: { type: "reasoning", id: "r1", summary: [], content: [] }, threadId, turnId }
3. item/reasoning/summaryTextDelta → { delta: "Analyzing the auth module...", itemId: "r1" }
4. item/completed        → { item: { type: "reasoning", id: "r1", summary: ["..."] } }
5. item/started          → { item: { type: "agentMessage", id: "m1", text: "" } }
6. item/agentMessage/delta → { delta: "I'll fix the", itemId: "m1" }
7. item/agentMessage/delta → { delta: " login bug", itemId: "m1" }
8. item/completed        → { item: { type: "agentMessage", id: "m1", text: "I'll fix the login bug..." } }
9. item/started          → { item: { type: "commandExecution", id: "c1", command: "cat auth.ts", status: "inProgress" } }
10. item/commandExecution/outputDelta → { delta: "const auth = ...", itemId: "c1" }
11. item/completed       → { item: { type: "commandExecution", id: "c1", status: "completed", exitCode: 0 } }
12. item/started         → { item: { type: "fileChange", id: "f1", status: "inProgress" } }
13. item/fileChange/outputDelta → { delta: "--- a/auth.ts\n+++ b/auth.ts\n...", itemId: "f1" }
14. item/completed       → { item: { type: "fileChange", id: "f1", status: "completed", changes: [...] } }
15. turn/diff/updated    → { diff: "aggregated diff for entire turn" }
16. item/started         → { item: { type: "agentMessage", id: "m2", text: "" } }
17. item/agentMessage/delta → { delta: "Done! Fixed the auth bug." }
18. item/completed       → { item: { type: "agentMessage", id: "m2", text: "Done! Fixed the auth bug." } }
19. thread/tokenUsage/updated → { tokenUsage: { total: {...}, last: {...} } }
20. turn/completed       → { turn: { id: "turn_abc123", status: "completed" } }
```

### Key Streaming Properties

- **Items have lifecycle:** `item/started` → zero or more deltas → `item/completed`
- **Multiple items per turn:** A turn can have reasoning, messages, commands, and file changes
- **Text streams via delta:** `item/agentMessage/delta` provides incremental text
- **Command output streams:** `item/commandExecution/outputDelta` provides output
- **Aggregated diff:** `turn/diff/updated` provides the full unified diff across all file changes
- **Plan updates:** `turn/plan/updated` provides step-by-step plan progress

---

## 6. Content Types — ThreadItem

The `ThreadItem` enum represents every possible item in a turn.

### ThreadItem Variants

```typescript
type ThreadItem =
  | { type: "userMessage"; id: string; content: UserInput[] }
  | { type: "hookPrompt"; id: string; fragments: HookPromptFragment[] }
  | { type: "agentMessage"; id: string; text: string; phase?: MessagePhase; memoryCitation?: MemoryCitation }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | { type: "commandExecution"; id: string; command: string; cwd: string; processId?: string;
      source: CommandExecutionSource; status: CommandExecutionStatus;
      commandActions: CommandAction[]; aggregatedOutput?: string;
      exitCode?: number; durationMs?: number }
  | { type: "fileChange"; id: string; changes: FileUpdateChange[]; status: PatchApplyStatus }
  | { type: "mcpToolCall"; id: string; server: string; tool: string;
      status: McpToolCallStatus; arguments: any;
      result?: McpToolCallResult; error?: McpToolCallError; durationMs?: number }
  | { type: "dynamicToolCall"; id: string; tool: string; arguments: any;
      status: DynamicToolCallStatus; contentItems?: any[]; success?: boolean; durationMs?: number }
  | { type: "collabAgentToolCall"; id: string; tool: CollabAgentTool;
      status: CollabAgentToolCallStatus; senderThreadId: string;
      receiverThreadIds: string[]; prompt?: string; ... }
  | { type: "webSearch"; id: string; query: string; action?: WebSearchAction }
  | { type: "imageView"; id: string; path: string }
  | { type: "imageGeneration"; id: string; status: string; revisedPrompt?: string; result: string; savedPath?: string }
  | { type: "enteredReviewMode"; id: string; review: string }
  | { type: "exitedReviewMode"; id: string; review: string }
  | { type: "contextCompaction"; id: string }
```

### CommandExecutionStatus Values
- `"inProgress"` — Command is running
- `"completed"` — Command finished successfully
- `"failed"` — Command failed
- `"needsApproval"` — Waiting for user approval

### PatchApplyStatus Values
- `"completed"` — Patch applied successfully
- `"failed"` — Patch failed

### FileUpdateChange
```typescript
type FileUpdateChange = {
  path: string;
  kind: "add" | "delete" | "update";
};
```

---

## 7. Tool Use Flow

Codex doesn't expose tool calls as abstract "function calls" to the client.
Instead, tools are represented as **ThreadItem types** in the notification stream.

### Command Execution Flow

```
1. item/started   → { item: { type: "commandExecution", id: "cmd1",
                       command: "grep -r 'TODO' src/", cwd: "/project",
                       status: "inProgress", commandActions: [...] } }
2. item/commandExecution/outputDelta → { delta: "src/foo.ts:42: // TODO fix this" }
3. item/commandExecution/outputDelta → { delta: "\nsrc/bar.ts:10: // TODO refactor" }
4. item/completed → { item: { type: "commandExecution", id: "cmd1",
                       status: "completed", exitCode: 0,
                       aggregatedOutput: "src/foo.ts:42: ...", durationMs: 150 } }
```

### File Change Flow (apply_patch)

```
1. item/started   → { item: { type: "fileChange", id: "fc1",
                       changes: [{ path: "src/auth.ts", kind: "update" }],
                       status: "inProgress" } }
2. item/fileChange/outputDelta → { delta: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -10,3 +10,5 @@..." }
3. item/completed → { item: { type: "fileChange", id: "fc1",
                       changes: [{ path: "src/auth.ts", kind: "update" }],
                       status: "completed" } }
4. turn/diff/updated → { diff: "<aggregated diff for all files in turn>" }
```

### MCP Tool Call Flow

```
1. item/started   → { item: { type: "mcpToolCall", id: "mcp1",
                       server: "my-server", tool: "search_docs",
                       arguments: { query: "auth" }, status: "inProgress" } }
2. item/mcpToolCall/progress → { message: "Searching..." }
3. item/completed → { item: { type: "mcpToolCall", id: "mcp1",
                       status: "completed",
                       result: { content: [...], structuredContent: ... } } }
```

### Web Search Flow

```
1. item/started   → { item: { type: "webSearch", id: "ws1",
                       query: "rust async patterns",
                       action: { type: "search", queries: ["rust async patterns"] } } }
2. item/completed → { item: { type: "webSearch", id: "ws1", ... } }
```

---

## 8. Permission System

Codex has a sophisticated approval system. When the agent wants to run a command
or modify files, the app-server may send a **server request** to the client
asking for approval.

### Approval Policies (AskForApproval)

| Policy | Behavior |
|--------|----------|
| `untrusted` | Ask for everything (most restrictive) |
| `on-failure` | Auto-approve, ask only on failures |
| `on-request` | Ask only when agent explicitly requests |
| `never` | Auto-approve everything (least restrictive) |
| `granular` | Fine-grained control: per sandbox, rules, skills, permissions, MCP |

### Command Execution Approval

The server sends `item/commandExecution/requestApproval`:

```json
{
  "method": "item/commandExecution/requestApproval",
  "id": 42,
  "params": {
    "threadId": "550e8400-...",
    "turnId": "turn_abc",
    "itemId": "cmd1",
    "command": ["rm", "-rf", "build/"],
    "cwd": "/Users/user/project",
    "reason": "Cleaning build directory",
    "commandActions": [
      { "type": "unknown", "command": "rm -rf build/" }
    ],
    "proposedExecpolicyAmendment": ["rm", "-rf"],
    "networkApprovalContext": null
  }
}
```

The client responds with a `CommandExecutionApprovalDecision`:

```json
{ "id": 42, "result": { "decision": "accept" } }
```

### Decision Types

| Decision | Behavior |
|----------|----------|
| `accept` | Approve this single command |
| `acceptForSession` | Approve and cache for session |
| `acceptWithExecpolicyAmendment` | Approve and add permanent rule |
| `applyNetworkPolicyAmendment` | Add permanent network rule |
| `decline` | Deny but continue the turn |
| `cancel` | Deny and interrupt the turn |

### File Change Approval

The server sends `item/fileChange/requestApproval`:

```json
{
  "method": "item/fileChange/requestApproval",
  "id": 43,
  "params": {
    "threadId": "550e8400-...",
    "turnId": "turn_abc",
    "itemId": "fc1",
    "changes": [
      { "path": "/Users/user/project/src/auth.ts", "kind": "update" }
    ],
    "grantRoot": null
  }
}
```

Response:
```json
{ "id": 43, "result": { "decision": "accept" } }
```

File change decisions: `accept`, `acceptForSession`, `decline`, `cancel`.

### Permission Request Approval

For additional filesystem or network permissions:

```json
{
  "method": "item/permissions/requestApproval",
  "id": 44,
  "params": {
    "threadId": "550e8400-...",
    "turnId": "turn_abc",
    "itemId": "p1",
    "permissionProfile": {
      "fileSystem": { "read": ["/etc/config"], "write": null },
      "network": { "enabled": true }
    }
  }
}
```

### Guardian (Auto-Approval) System

When `approvalsReviewer` is `"guardianSubagent"`, a sub-agent reviews approval
requests automatically. The app-server sends notifications:

```
item/autoApprovalReview/started  → { review: { status: "inProgress" } }
item/autoApprovalReview/completed → { review: { status: "approved", riskLevel: "low", riskScore: 15, rationale: "..." } }
```

---

## 9. User Input / Questions

Codex can request input from the user via `item/tool/requestUserInput`:

```json
{
  "method": "item/tool/requestUserInput",
  "id": 50,
  "params": {
    "threadId": "550e8400-...",
    "turnId": "turn_abc",
    "itemId": "input1",
    "questions": {
      "api_key": { "prompt": "Please enter your API key:", "type": "text" }
    }
  }
}
```

Client responds:
```json
{
  "id": 50,
  "result": {
    "answers": {
      "api_key": { "answers": ["sk-abc123"] }
    }
  }
}
```

### MCP Elicitation

MCP servers can also request user input via `mcpServer/elicitation/request`:

```json
{
  "method": "mcpServer/elicitation/request",
  "id": 51,
  "params": {
    "threadId": "550e8400-...",
    "serverName": "my-mcp-server",
    "request": { ... }
  }
}
```

---

## 10. Thinking / Reasoning

Codex exposes model reasoning via `Reasoning` ThreadItems and delta notifications.

### Reasoning Item Lifecycle

```
1. item/started → { item: { type: "reasoning", id: "r1", summary: [], content: [] } }
2. item/reasoning/summaryTextDelta → { delta: "Analyzing the codebase...", summaryIndex: 0 }
3. item/reasoning/summaryPartAdded → { summaryIndex: 1 }
4. item/reasoning/summaryTextDelta → { delta: "Found the issue in auth.ts", summaryIndex: 1 }
5. item/completed → { item: { type: "reasoning", id: "r1",
     summary: ["Analyzing the codebase...", "Found the issue in auth.ts"],
     content: ["<raw reasoning text>"] } }
```

### Reasoning Summary vs Content

- `summary` — Human-readable reasoning summaries (array of strings, one per "part")
- `content` — Raw reasoning text (may be filtered/redacted depending on model)

### Reasoning Effort Levels

| Level | Behavior |
|-------|----------|
| `minimal` | Least reasoning |
| `low` | Light reasoning |
| `medium` | Default balanced |
| `high` | Extended reasoning |
| `xhigh` | Maximum reasoning effort |

---

## 11. Error Handling

### Error Notification

The `error` notification is emitted for fatal turn errors:

```json
{
  "method": "error",
  "params": {
    "error": {
      "message": "Context window exceeded",
      "codexErrorInfo": "contextWindowExceeded",
      "additionalDetails": null
    },
    "willRetry": false,
    "threadId": "550e8400-...",
    "turnId": "turn_abc"
  }
}
```

### CodexErrorInfo Types

| Error Code | Description |
|-----------|-------------|
| `contextWindowExceeded` | Token limit hit |
| `usageLimitExceeded` | Usage quota exceeded |
| `serverOverloaded` | API overloaded |
| `httpConnectionFailed` | Network error (includes `httpStatusCode`) |
| `responseStreamConnectionFailed` | SSE stream failed |
| `responseStreamDisconnected` | SSE stream dropped mid-turn |
| `responseTooManyFailedAttempts` | Retries exhausted |
| `internalServerError` | 500 from API |
| `unauthorized` | Auth failure |
| `badRequest` | Invalid request |
| `threadRollbackFailed` | Rollback failed |
| `sandboxError` | Sandbox violation |
| `activeTurnNotSteerable` | Can't steer this turn type |
| `other` | Generic error |

### Turn Failure

A turn can fail in two ways:

1. **`error` notification** — Emitted during the turn
2. **`turn/completed` with `status: "failed"`** — Turn ends with error:

```json
{
  "method": "turn/completed",
  "params": {
    "threadId": "550e8400-...",
    "turn": {
      "id": "turn_abc",
      "status": "failed",
      "error": {
        "message": "Usage limit exceeded",
        "codexErrorInfo": "usageLimitExceeded"
      },
      "items": []
    }
  }
}
```

### JSON-RPC Error Response

Standard JSON-RPC errors on request failures:
```json
{ "id": 5, "error": { "message": "Thread not found" } }
```

---

## 12. Image / File Input

### Sending Images

Images are sent as `UserInput` items in `turn/start`:

```json
{
  "method": "turn/start",
  "id": 10,
  "params": {
    "threadId": "...",
    "input": [
      { "type": "text", "text": "What's in this screenshot?", "text_elements": [] },
      { "type": "localImage", "path": "/tmp/screenshot.png" }
    ]
  }
}
```

Types:
- `localImage` — Path to a local file (Codex reads it)
- `image` — URL to a remote image

### File Mentions

```json
{ "type": "mention", "name": "auth.ts", "path": "/project/src/auth.ts" }
```

### Skill Mentions

```json
{ "type": "skill", "name": "debug-helper", "path": "/Users/user/.codex/skills/debug-helper" }
```

### Image Generation (Output)

Codex can generate images via `imageGeneration` items:
```typescript
{ type: "imageGeneration"; id: string; status: string;
  revisedPrompt?: string; result: string; savedPath?: string }
```

### Image Viewing (Output)

```typescript
{ type: "imageView"; id: string; path: string }
```

---

## 13. Cost / Usage Tracking

### Token Usage Notification

`thread/tokenUsage/updated` is emitted during/after turns:

```json
{
  "method": "thread/tokenUsage/updated",
  "params": {
    "threadId": "550e8400-...",
    "turnId": "turn_abc",
    "tokenUsage": {
      "total": {
        "totalTokens": 15000,
        "inputTokens": 12000,
        "cachedInputTokens": 8000,
        "outputTokens": 3000,
        "reasoningOutputTokens": 500
      },
      "last": {
        "totalTokens": 5000,
        "inputTokens": 4000,
        "cachedInputTokens": 2000,
        "outputTokens": 1000,
        "reasoningOutputTokens": 200
      },
      "modelContextWindow": 128000
    }
  }
}
```

### Turn Completion Usage

The `TurnCompletedNotification` includes the turn with status and accumulated items.

### Rate Limits

Read via `account/rateLimits/read`, updates via `account/rateLimits/updated` notification.

```typescript
type RateLimitSnapshot = {
  remainingTokens: number;
  remainingRequests: number;
  resetTokensAt: string;    // ISO timestamp
  resetRequestsAt: string;  // ISO timestamp
  windows: RateLimitWindow[];
};
```

---

## 14. The app-server Command

### Spawning

Our bridge spawns the Codex binary with the `app-server` subcommand:

```typescript
this.child = spawn(this.codexPath, ["app-server"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});
```

The process communicates via:
- **stdin** — Client writes JSON-RPC requests/notifications (JSONL)
- **stdout** — Server writes JSON-RPC responses/notifications/requests (JSONL)
- **stderr** — Diagnostic logs (not JSON-RPC)

### Binary Location

The `codexPath` defaults to `"codex"` (expects it in PATH). Alternatively,
the TypeScript SDK locates it within `node_modules/@openai/codex-{platform}/vendor/`.

### Process Lifecycle

1. **Spawn** `codex app-server`
2. **Initialize** — Send `initialize` request, wait for response
3. **Notify** `initialized`
4. Process runs indefinitely, handling multiple threads concurrently
5. **Stop** — Kill the child process

### Auto-Restart

Our connector (`CodexAppServerClient`) implements auto-restart on crash:
- Max 3 restart attempts
- Exponential backoff: 2s, 4s, 6s
- `onStatusChange` callback notifies all connected clients
- All pending requests are rejected on exit

### WebSocket Transport (Alternative)

The app-server also supports WebSocket connections (for VS Code):
```
codex app-server --ws-port 8080
```
But our bridge uses stdio exclusively.

---

## 15. Session Resume

### Resume Flow

To continue a previous conversation:

```json
{
  "method": "thread/resume",
  "id": 3,
  "params": {
    "threadId": "550e8400-e29b-41d4-a716-446655440000",
    "model": "o3-mini",
    "cwd": "/project"
  }
}
```

Response includes the thread with full turn history:

```json
{
  "id": 3,
  "result": {
    "thread": {
      "id": "550e8400-...",
      "turns": [
        {
          "id": "turn_1",
          "items": [
            { "type": "userMessage", "id": "u1", "content": [{ "type": "text", "text": "Fix auth bug" }] },
            { "type": "reasoning", "id": "r1", "summary": ["Analyzing..."] },
            { "type": "commandExecution", "id": "c1", "command": "cat auth.ts", "status": "completed" },
            { "type": "fileChange", "id": "f1", "status": "completed", "changes": [...] },
            { "type": "agentMessage", "id": "m1", "text": "Done!" }
          ],
          "status": "completed"
        }
      ]
    }
  }
}
```

### Thread Fork

Fork creates a copy at a specific turn:

```json
{ "method": "thread/fork", "id": 5, "params": { "threadId": "...", "atTurnId": "turn_1" } }
```

### Thread Rollback

Remove the last N turns:

```json
{ "method": "thread/rollback", "id": 6, "params": { "threadId": "...", "numTurns": 2 } }
```

### Session Persistence

Sessions are stored as `.jsonl` files in `~/.codex/sessions/`. Each line is a
structured event: `session_meta`, `event_msg`, `response_item`, `turn_context`.

Our `codex-fs.ts` reads these files directly for listing threads when the
app-server isn't running (offline mode).

---

## 16. Real-time Event Ordering

### Complete Turn Lifecycle (All Possible Events)

```
turn/start (request)
  ↓
turn/started (notification)
  ↓
┌─── Item Loop ───────────────────────────────────┐
│ item/started                                     │
│   ├─ item/agentMessage/delta (text streaming)    │
│   ├─ item/reasoning/summaryTextDelta             │
│   ├─ item/reasoning/summaryPartAdded             │
│   ├─ item/reasoning/textDelta                    │
│   ├─ item/commandExecution/outputDelta           │
│   ├─ item/commandExecution/terminalInteraction   │
│   ├─ item/fileChange/outputDelta                 │
│   ├─ item/mcpToolCall/progress                   │
│   ├─ item/plan/delta                             │
│   ├─ item/autoApprovalReview/started             │
│   └─ item/autoApprovalReview/completed           │
│ item/completed                                   │
│                                                  │
│ [APPROVAL PAUSE - if needed]                     │
│ item/commandExecution/requestApproval (request)  │
│   → client responds with decision                │
│ serverRequest/resolved (notification)            │
│                                                  │
│ [Repeat for more items]                          │
└──────────────────────────────────────────────────┘
  ↓
turn/diff/updated (aggregated diff)
turn/plan/updated (final plan state)
thread/tokenUsage/updated
  ↓
turn/completed (notification)
  ↓
thread/status/changed → idle
```

### Concurrent Events

- Multiple items can be "started" simultaneously (e.g., agent reads multiple files)
- `turn/diff/updated` can fire multiple times as more patches land
- `thread/tokenUsage/updated` can fire multiple times during a turn
- `hook/started` and `hook/completed` interleave with item events

### Interruption

If `turn/interrupt` is called:
```
turn/interrupt (request) → { } (ack)
  ↓
[running items get item/completed with appropriate status]
  ↓
turn/completed → { turn: { status: "interrupted" } }
```

---

## 17. Our Connector Implementation

### CodexAppServerClient (connectors/codex.ts)

The connector is a minimal JSON-RPC client (~330 lines):

```typescript
class CodexAppServerClient {
  // Lifecycle
  async start(): Promise<void>   // Spawn + initialize handshake
  async stop(): Promise<void>    // Kill process

  // Communication
  notify(method: string, params?: unknown): void           // Fire-and-forget
  async request(method: string, params?: unknown): Promise<unknown>  // Request-response

  // Handlers (set by bridge server.ts)
  onNotification: (n: CodexNotification) => void
  onServerRequest: (r: CodexServerRequest) => Promise<unknown>
  onExit: (code, signal) => void
  onError: (error) => void
  onStatusChange: (status) => void
}
```

### Key Design Choices

1. **Single readline interface** — Reads JSONL from stdout line by line
2. **Pending request map** — Tracks in-flight requests by ID with timeouts (120s)
3. **Server request handler** — `onServerRequest` returns a Promise whose resolution
   becomes the JSON-RPC response to the server
4. **Auto-restart** — Up to 3 retries with exponential backoff

### Filesystem Reader (connectors/codex-fs.ts)

For listing sessions when app-server is not running:

```typescript
export async function listThreadsFromFs(cwd?: string): Promise<CodexThread[]>
export async function getThreadFromFs(threadId: string): Promise<CodexThread | null>
export async function getThreadMessagesFromFs(threadId: string): Promise<TranscriptMessage[]>
export async function listProjectsFromFs(): Promise<ProjectSummary[]>
```

These read `.jsonl` session files directly from `~/.codex/sessions/`.

### SQLite Optimization (codex/cx-sqlite.ts)

For fast thread lookup, Codex maintains a SQLite database. Our bridge queries
it for O(1) thread-to-file-path resolution:

```typescript
export function findRolloutPathById(threadId: string): string | null
```

---

## 18. Our Wire Protocol — cx_stream

### Bridge → Flutter Message Flow

Every Codex notification is wrapped and sent to the Flutter app:

```typescript
// Bridge emits:
{ type: "cx_stream", threadId: "550e8400-...", data: CodexStreamMessage }

// Which maps to runtime_event:
{ type: "runtime_event", backend: "codex", data: { ... } }
```

### CodexStreamMessage Types

```typescript
type CodexStreamMessage =
  | { type: "notification"; method: string; params: any }  // Raw app-server notification
  | { type: "request"; requestId: string; method: string; params: any }  // Approval request
  | { type: "error"; message: string; code?: string; details?: any; ... }  // Error
  | { type: "info"; message: string }  // Informational
  | { type: "collab_spawn_begin"; data: ... }  // Multi-agent collab events
  | { type: "collab_spawn_end"; data: ... }
  // ... etc for all collab_* types
```

### Client → Bridge Message Types

| Message Type | Description |
|-------------|-------------|
| `cx_list_projects` | List Codex projects |
| `cx_list_threads` | List threads (with filters) |
| `cx_start_thread` | Create new thread |
| `cx_resume_thread` | Resume existing thread |
| `cx_archive_thread` | Archive a thread |
| `cx_get_thread_messages` | Get thread transcript |
| `cx_chat` | Send prompt (creates thread if needed, starts turn) |
| `cx_abort` | Interrupt active turn |
| `cx_permission_response` | Respond to approval request |
| `cx_user_input_response` | Respond to user input request |
| `cx_thread_fork` | Fork a thread |
| `cx_thread_rollback` | Rollback N turns |
| `cx_model_list` | List available models |
| `cx_skills_list` | List skills |
| `cx_config_read` | Read configuration |
| `cx_config_value_write` | Write config value |
| `cx_mcp_status_list` | List MCP servers |
| `cx_mcp_reload` | Reload MCP config |
| `cx_review_start` | Start code review |
| `cx_account_read` | Read account info |
| `cx_login_start` | Start auth flow |
| `cx_steer` | Steer mid-turn |
| `cx_thread_rename` | Rename thread |
| `cx_thread_compact` | Compact context |
| `cx_apps_list` | List apps |
| `cx_command_exec` | Run one-off command |
| `cx_collaboration_modes` | List collab presets |
| `cx_feedback_upload` | Upload feedback |
| `cx_undo_files` | Undo file changes |

### Bridge → Client Response Types

| Message Type | Description |
|-------------|-------------|
| `cx_threads` | Thread list response |
| `cx_thread` | Single thread detail |
| `cx_thread_created` | New thread created |
| `cx_thread_messages` | Thread transcript |
| `cx_stream` | Streaming event (wraps notifications) |
| `cx_models` | Available models |
| `cx_skills` | Skills list |
| `cx_config` | Configuration |
| `cx_global` | Global notifications (no threadId) |
| `codex_process_status` | Process health status |
| `runtime_event` | Unified runtime event (Phase 4+) |
| `runtime_state` | Runtime state update |

---

## 19. Differences from SDK-based Backends

### Codex vs Claude Code / OpenCode / Pi

| Aspect | Codex | Claude Code / OpenCode / Pi |
|--------|-------|-----------------------------|
| **Transport** | JSON-RPC over stdio | JavaScript SDK `import` |
| **Process Model** | Persistent child process | In-process SDK calls |
| **Streaming** | Server notifications (push) | Event emitters / AsyncGenerators |
| **Tool Calls** | ThreadItem types (command, fileChange, mcpToolCall) | Tool call objects with name/arguments/result |
| **Permissions** | Server → Client JSON-RPC requests | SDK callbacks or events |
| **Session Storage** | `.jsonl` in `~/.codex/sessions/` | `.jsonl` in `~/.claude/projects/` (CC), SQLite (OC), memory (Pi) |
| **Thread Management** | `thread/start`, `thread/resume`, `thread/list` | SDK session management |
| **Configuration** | `config/read`, `config/value/write` JSON-RPC | Config files or environment |
| **Binary** | Rust compiled binary | Node.js / Bun |
| **Multi-Agent** | Built-in `collabAgentToolCall` items | Not built-in |
| **Sandbox** | Kernel-level sandboxing (Linux: landlock, macOS: sandbox-exec) | Process-level |

### Implications for Bridge Architecture

1. **Approval flow is async.** Server sends a request, we create a `Promise`,
   store it in `cxApprovalWaiters`, forward to Flutter, and resolve when
   Flutter sends `cx_permission_response`.

2. **No direct function calls.** Everything goes through `client.request()` or
   `client.notify()` — no way to call Codex functions directly.

3. **Thread-scoped events.** All notifications include `threadId`, allowing
   the bridge to route events to the correct client.

4. **Offline mode is filesystem-based.** When app-server isn't running, we read
   session files directly (`codex-fs.ts`).

---

## 20. Permission & Question Handling — Full Details

### The Approval Pipeline

```
Codex app-server ──[server request]──► Bridge server.ts
                                         │
                                         ├─ Create Promise (cxApprovalWaiters)
                                         ├─ Enrich with cached item data
                                         ├─ emitCxStream({ type: "request", ... })
                                         │       │
                                         │       ▼
                                         │   Flutter app shows approval UI
                                         │       │
                                         │       ▼
                                         │   cx_permission_response / cx_user_input_response
                                         │       │
                                         ├─ Resolve Promise
                                         ├─ Build approval decision
                                         │
Bridge ──[JSON-RPC response]──► Codex app-server
```

### Enrichment

Before forwarding to Flutter, the bridge enriches approval params:

```typescript
const enrichedParams = {
  ...params,
  cachedItem: cxItemCache.get(`${threadId}:${turnId}:${itemId}`),
  threadId, turnId, itemId,
  approvalCommand: params.command,     // From CommandExecutionRequestApprovalParams
  approvalCwd: params.cwd,
  commandActions: params.commandActions,
  networkApprovalContext: params.networkApprovalContext,
  proposedNetworkPolicyAmendments: params.proposedNetworkPolicyAmendments,
  fileChanges: params.fileChanges,     // From FileChangeRequestApprovalParams
  grantRoot: params.grantRoot,
};
```

### Timeout Handling

If no response within 120 seconds, the bridge auto-rejects:

```typescript
const timer = setTimeout(() => {
  cxApprovalWaiters.delete(key);
  resolve({ response: "reject" });
}, PERMISSION_TIMEOUT_MS);
```

### Decision Building

The bridge translates our simplified response to Codex protocol:

| Our Response | Legacy Protocol | v2 Protocol |
|-------------|----------------|-------------|
| `accept` | `{ decision: "approved" }` | `{ decision: "accept" }` |
| `accept_for_session` | `{ decision: "approved" }` | `{ decision: "acceptForSession" }` |
| `accept_with_amendment` | `{ decision: "approved" }` | `{ decision: "acceptWithExecpolicyAmendment", ... }` |
| `reject` | `{ decision: "denied" }` | `{ decision: "decline" }` |
| `reject_and_cancel` | `{ decision: "denied" }` | `{ decision: "cancel" }` |

---

## 21. Configuration System

### Config Layers (Precedence Order, low → high)

1. **MDM** — macOS managed preferences
2. **System** — System-wide config
3. **User** — `~/.codex/config.toml`
4. **Project** — `.codex/` folders in project hierarchy
5. **SessionFlags** — CLI `--config` overrides
6. **LegacyManagedConfig** — `managed_config.toml`

### Reading Config

```json
{
  "method": "config/read",
  "id": 10,
  "params": { "includeLayers": true, "cwd": "/project" }
}
```

Response includes effective config, origins (which layer set each value), and
optional layer details.

### Writing Config

```json
{
  "method": "config/value/write",
  "id": 11,
  "params": {
    "keyPath": "model",
    "value": "o3-mini",
    "mergeStrategy": "replace"
  }
}
```

### Key Config Fields

```typescript
type Config = {
  model?: string;
  reviewModel?: string;
  modelProvider?: string;
  approvalPolicy?: AskForApproval;
  sandboxMode?: SandboxMode;
  sandboxWorkspaceWrite?: SandboxWorkspaceWrite;
  webSearch?: WebSearchMode;        // "disabled" | "cached" | "live"
  profile?: string;
  profiles?: Record<string, ProfileV2>;
  instructions?: string;
  developerInstructions?: string;
  compactPrompt?: string;
  modelReasoningEffort?: ReasoningEffort;
  modelReasoningSummary?: ReasoningSummary;
  modelVerbosity?: Verbosity;
  serviceTier?: ServiceTier;
  apps?: AppsConfig;
  // ... many more
};
```

---

## 22. Multi-Agent Collaboration

### Overview

Codex supports multi-agent collaboration where one agent can spawn, interact
with, and manage sub-agents. This is exposed through `CollabAgentToolCall` items.

### CollabAgentToolCall Item

```typescript
{
  type: "collabAgentToolCall",
  id: string,
  tool: "spawn" | "interact" | "waitForAgents" | "closeAgent" | "resumeAgent",
  status: "inProgress" | "completed" | "failed",
  senderThreadId: string,
  receiverThreadIds: string[],
  prompt?: string,
  model?: string,
  reasoningEffort?: ReasoningEffort,
  agentsStates: Record<string, CollabAgentState>
}
```

### Collaboration Notifications

The bridge receives `collab/*` notifications:

- `collab/spawn/begin` — Agent spawning started
- `collab/spawn/end` — Agent spawned (includes `newThreadId`, `newAgentNickname`)
- `collab/interaction/begin` — Communication with sub-agent started
- `collab/interaction/end` — Communication ended
- `collab/waiting/begin` — Waiting for sub-agents
- `collab/waiting/end` — Sub-agents completed
- `collab/close/begin` — Closing sub-agent
- `collab/close/end` — Sub-agent closed
- `collab/resume/begin` — Resuming sub-agent
- `collab/resume/end` — Sub-agent resumed

### Collaboration Modes

```typescript
type CollaborationMode = {
  mode: "plan" | "default";
  settings: {
    model: string;
    reasoning_effort?: ReasoningEffort;
    developer_instructions?: string;
  };
};
```

Available presets queried via `collaborationMode/list`.

---

## Appendix A: TypeScript SDK (codex exec)

The TypeScript SDK (`@openai/codex`, `reference/codex/sdk/typescript/`)
provides a higher-level API but uses a **different mechanism** than app-server:

```typescript
const codex = new Codex({ apiKey: "..." });
const thread = codex.startThread({ model: "o3-mini", workingDirectory: "/project" });
const result = await thread.run("Fix the bug");
```

Internally, the SDK spawns `codex exec --experimental-json` as a subprocess
per-turn and reads JSONL events from stdout. Each event maps to `ThreadEvent`:

```typescript
type ThreadEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage: Usage }
  | { type: "turn.failed"; error: ThreadError }
  | { type: "item.started"; item: ThreadItem }
  | { type: "item.updated"; item: ThreadItem }
  | { type: "item.completed"; item: ThreadItem }
  | { type: "error"; message: string };
```

**Broski does NOT use this SDK.** We use `codex app-server` (persistent process,
richer protocol) for all Codex communication.

---

## Appendix B: Session File Format (.jsonl)

Each session is stored in `~/.codex/sessions/<uuid>/<uuid>.jsonl`.

Line types:
```
session_meta     → { type: "session_meta", payload: { id, cwd, cli_version, model_provider, git } }
event_msg        → { type: "event_msg", payload: { type: "user_message", message: "..." } }
event_msg        → { type: "event_msg", payload: { type: "agent_reasoning", text: "..." } }
event_msg        → { type: "event_msg", payload: { type: "token_count", ... } }
response_item    → { type: "response_item", payload: { type: "function_call", name, arguments, call_id } }
response_item    → { type: "response_item", payload: { type: "function_call_output", call_id, output } }
response_item    → { type: "response_item", payload: { type: "custom_tool_call", name, input, status } }
response_item    → { type: "response_item", payload: { type: "message", role: "assistant", content: [...] } }
response_item    → { type: "response_item", payload: { type: "reasoning", summary: [...] } }
turn_context     → { type: "turn_context", payload: { ... } }
```

Our `codex-fs.ts` parses this format to reconstruct transcripts when the
app-server is not running (offline mode, session listing).

---

## Appendix C: Hooks System

Codex supports hooks that run at specific lifecycle points:

### Hook Events
- `sessionStart` — Thread created
- `userPromptSubmit` — User sends a message
- `preToolUse` — Before tool execution (can block)
- `postToolUse` — After tool execution
- `stop` — Turn completed

### Hook Notifications

```
hook/started   → { threadId, turnId, run: HookRunSummary }
hook/completed → { threadId, turnId, run: HookRunSummary }
```

```typescript
type HookRunSummary = {
  id: string;
  eventName: "preToolUse" | "postToolUse" | "sessionStart" | "userPromptSubmit" | "stop";
  handlerType: "command" | "prompt" | "agent";
  executionMode: "sync" | "async";
  scope: "thread" | "turn";
  sourcePath: string;
  status: "running" | "completed" | "failed" | "blocked" | "stopped";
  entries: HookOutputEntry[];
};
```

---

## Appendix D: Sandbox Policies

### SandboxPolicy Variants

```typescript
type SandboxPolicy =
  | { type: "dangerFullAccess" }
  | { type: "readOnly"; access: ReadOnlyAccess; networkAccess: boolean }
  | { type: "externalSandbox"; networkAccess: "restricted" | "enabled" }
  | { type: "workspaceWrite";
      writableRoots: string[];
      readOnlyAccess: ReadOnlyAccess;
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean };
```

### SandboxMode (Simplified)

| Mode | Description |
|------|-------------|
| `read-only` | Agent can only read files |
| `workspace-write` | Agent can write within project roots |
| `danger-full-access` | No sandboxing |

---

## Appendix E: File Paths & Locations

| Item | Location |
|------|----------|
| Codex binary | `codex` (in PATH) or `node_modules/@openai/codex-{platform}/vendor/` |
| Session storage | `~/.codex/sessions/` |
| Archived sessions | `~/.codex/archived_sessions/` |
| User config | `~/.codex/config.toml` |
| Project config | `.codex/` folder in project hierarchy |
| Skills | `~/.codex/skills/` (user), `.codex/skills/` (project) |
| Plugins | `~/.codex/plugins/` |
| SQLite database | `~/.codex/codex.db` (contains rollout path index) |

---

*This document was auto-generated from analysis of the Codex codebase
(`reference/codex/`), bridge connector (`packages/bridge/src/connectors/codex.ts`),
bridge handlers (`packages/bridge/src/handlers/codex/`), and Rust protocol
definitions (`codex-rs/app-server-protocol/src/protocol/`).*
