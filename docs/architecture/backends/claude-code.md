# Claude Code Backend Architecture

> Deep-dive reference for how Broski integrates with the Claude Code Agent SDK.
> Covers the SDK API, streaming protocol, permission system, tool execution,
> session management, and our bridge connector + Flutter rendering pipeline.

---

## Table of Contents

1. [SDK Architecture Overview](#1-sdk-architecture-overview)
2. [Session Lifecycle](#2-session-lifecycle)
3. [Sending a Prompt](#3-sending-a-prompt)
4. [Streaming Response Flow](#4-streaming-response-flow)
5. [Content Block Types](#5-content-block-types)
6. [Tool Use Flow](#6-tool-use-flow)
7. [Permission System](#7-permission-system)
8. [Questionnaire / User Input (AskUserQuestion)](#8-questionnaire--user-input-askuserquestion)
9. [Stop Reasons](#9-stop-reasons)
10. [Thinking / Extended Thinking](#10-thinking--extended-thinking)
11. [Error Handling](#11-error-handling)
12. [Image & File Input](#12-image--file-input)
13. [Cost Tracking](#13-cost-tracking)
14. [Session Resume & Forking](#14-session-resume--forking)
15. [Real-time Event Ordering](#15-real-time-event-ordering)
16. [Our Connector Implementation](#16-our-connector-implementation)
17. [Our Wire Protocol (cc_stream)](#17-our-wire-protocol-cc_stream)
18. [Flutter-side Event Processing](#18-flutter-side-event-processing)
19. [Known Issues & Edge Cases](#19-known-issues--edge-cases)

---

## 1. SDK Architecture Overview

The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) is a TypeScript (and Python) library
that exposes the same agentic capabilities that power Claude Code — file reading, command execution,
code editing, web search — as a programmable API.

### Core Concepts

| Concept | Description |
|---------|-------------|
| **`query()`** | Primary entry point. Creates an async generator that yields `SDKMessage` objects. |
| **`SDKMessage`** | Union type of ~18 message types (assistant, user, result, stream_event, system, etc.) |
| **`Options`** | Configuration object: model, tools, permissions, hooks, MCP servers, thinking, etc. |
| **`Query` object** | The return value of `query()` — an `AsyncGenerator<SDKMessage>` with extra methods. |
| **Session** | Persistent conversation state stored as JSONL in `~/.claude/projects/<encoded-path>/`. |
| **Tools** | Built-in (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task, AskUserQuestion, etc.) and custom MCP tools. |
| **Hooks** | Callback functions that intercept agent lifecycle events (PreToolUse, PostToolUse, Stop, etc.) |

### Key Exports

```typescript
import {
  query,                    // Main function — creates agentic loop
  listSessions,             // Discover past sessions
  forkSession,              // Fork a session to a new branch
  renameSession,            // Set custom session title
  tool,                     // Create type-safe MCP tool definition
  createSdkMcpServer,       // Create in-process MCP server
} from "@anthropic-ai/claude-agent-sdk";
```

### V1 vs V2 Interface

The SDK offers two interfaces:

- **V1 (stable)**: `query()` returns an `AsyncGenerator`. Multi-turn requires `AsyncIterable<SDKUserMessage>` as prompt. This is what Broski uses.
- **V2 (unstable preview)**: `createSession()` / `resumeSession()` with `send()` / `stream()` patterns. Simpler multi-turn but missing some features (e.g., session forking).

Broski uses V1 exclusively via the streaming input pattern.

---

## 2. Session Lifecycle

### Session Storage

Claude Code stores sessions as JSONL files:
```
~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
```

The project path encoding replaces `/` and spaces with `-`:
```
/Users/me/my repo → -Users-me-my-repo
```

Each line in the JSONL file is a JSON object representing one event (user message, assistant
message, tool result, system event, etc.).

### Session Creation

1. Call `query({ prompt, options })` — SDK spawns a Claude Code subprocess.
2. First message yielded: `SDKSystemMessage` with `subtype: "init"`.
3. This contains: `session_id`, `tools`, `model`, `permissionMode`, `mcp_servers`, `slash_commands`, `skills`, `agents`, `plugins`, `claude_code_version`.
4. The `session_id` is a UUID that identifies this session for resume/fork.

### Session Resume

```typescript
const q = query({
  prompt: "Continue where we left off",
  options: { resume: sessionId }
});
```

The SDK loads the full JSONL transcript, replays the conversation context, and continues. All prior messages are replayed as `SDKUserMessageReplay` (with `isReplay: true`).

### Session Forking

```typescript
const q = query({
  prompt: "Try a different approach",
  options: { resume: sessionId, forkSession: true }
});
```

Creates a new session ID that branches from the original. The original session remains unchanged. The SDK's `forkSession()` function properly remaps message UUIDs to avoid collisions.

### Continue Most Recent

```typescript
const q = query({
  prompt: "Keep going",
  options: { continue: true }
});
```

SDK 0.2.87+: Continues the most recent conversation in the working directory without needing the session ID.

---

## 3. Sending a Prompt

### Simple String Prompt

```typescript
const q = query({
  prompt: "Find and fix the bug in auth.py",
  options: {
    cwd: "/path/to/project",
    model: "sonnet",
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "acceptEdits",
  }
});
```

### Streaming Input (Multi-turn)

For interactive sessions (what Broski uses), pass an `AsyncIterable<SDKUserMessage>`:

```typescript
async function* generateMessages() {
  yield {
    type: "user" as const,
    message: {
      role: "user" as const,
      content: "Analyze this codebase"
    }
  };

  // Yield more messages as user sends them
  yield {
    type: "user" as const,
    message: {
      role: "user" as const,
      content: [
        { type: "text", text: "Review this diagram" },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "..." } }
      ]
    }
  };
}

const q = query({ prompt: generateMessages(), options: { ... } });
```

### Full Options Reference

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `model` | `string` | SDK default | Claude model alias (`sonnet`, `opus`, `haiku`) |
| `allowedTools` | `string[]` | All tools | Restrict available tools |
| `disallowedTools` | `string[]` | `[]` | Explicitly block tools |
| `permissionMode` | `PermissionMode` | `"default"` | `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk` |
| `systemPrompt` | `string \| preset` | minimal | Custom or `{ type: "preset", preset: "claude_code" }` |
| `includePartialMessages` | `boolean` | `false` | Enable `stream_event` messages for real-time deltas |
| `maxTurns` | `number` | unlimited | Cap conversation turns |
| `maxBudgetUsd` | `number` | unlimited | Cap spending |
| `thinking` | `ThinkingConfig` | `{ type: "adaptive" }` | Control extended thinking |
| `effort` | `string` | `"high"` | `low`, `medium`, `high`, `max` |
| `canUseTool` | callback | `undefined` | Permission handler function |
| `hooks` | `Record<HookEvent, ...>` | `{}` | Lifecycle hook callbacks |
| `mcpServers` | `Record<string, config>` | `{}` | MCP server configurations |
| `agents` | `Record<string, AgentDef>` | `undefined` | Subagent definitions |
| `resume` | `string` | `undefined` | Session ID to resume |
| `forkSession` | `boolean` | `false` | Fork when resuming |
| `enableFileCheckpointing` | `boolean` | `false` | Track file changes for undo |
| `settingSources` | `SettingSource[]` | `[]` | Which settings files to load |
| `betas` | `SdkBeta[]` | `[]` | Beta features (e.g., `context-1m-2025-08-07`) |
| `outputFormat` | `{ type: "json_schema", schema }` | `undefined` | Structured output schema |
| `sandbox` | `SandboxSettings` | `undefined` | Sandbox configuration |
| `promptSuggestions` | `boolean` | `false` | Emit predicted next prompts |
| `persistSession` | `boolean` | `true` | Save session to disk |

---

## 4. Streaming Response Flow

When `includePartialMessages: true` (which Broski always enables), the SDK yields both
**stream events** (real-time deltas) and **complete messages** (full assistant turns).

### Message Types Yielded by `query()`

```typescript
type SDKMessage =
  | SDKSystemMessage              // type: "system", subtype: "init"
  | SDKAssistantMessage           // type: "assistant" (complete turn)
  | SDKUserMessage                // type: "user" (tool results, user prompts)
  | SDKUserMessageReplay          // type: "user", isReplay: true
  | SDKPartialAssistantMessage    // type: "stream_event" (real-time deltas)
  | SDKResultMessage              // type: "result" (final outcome)
  | SDKCompactBoundaryMessage     // type: "system", subtype: "compact_boundary"
  | SDKStatusMessage              // type: "system", subtype: "status"
  | SDKHookStartedMessage         // hook lifecycle
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKToolProgressMessage        // type: "tool_progress"
  | SDKAuthStatusMessage          // type: "auth_status"
  | SDKTaskNotificationMessage    // type: "system", subtype: "task_notification"
  | SDKTaskStartedMessage         // type: "system", subtype: "task_started"
  | SDKTaskProgressMessage        // type: "system", subtype: "task_progress"
  | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage      // type: "tool_use_summary"
  | SDKRateLimitEvent             // type: "rate_limit_event"
  | SDKPromptSuggestionMessage;   // type: "prompt_suggestion"
```

### Stream Event Flow (with `includePartialMessages: true`)

```
SDKSystemMessage { type: "system", subtype: "init" }          ← Session init
│
├─ SDKPartialAssistantMessage { type: "stream_event" }
│  ├─ event: { type: "message_start" }                         ← New API turn begins
│  ├─ event: { type: "content_block_start", content_block: { type: "thinking" } }
│  ├─ event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "..." } }
│  ├─ event: { type: "content_block_stop" }                    ← Thinking block done
│  ├─ event: { type: "content_block_start", content_block: { type: "text" } }
│  ├─ event: { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
│  ├─ ...more text deltas...
│  ├─ event: { type: "content_block_stop" }                    ← Text block done
│  ├─ event: { type: "content_block_start", content_block: { type: "tool_use", id: "toolu_...", name: "Read" } }
│  ├─ event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{\"file" } }
│  ├─ ...more JSON deltas...
│  ├─ event: { type: "content_block_stop" }                    ← Tool use block done
│  ├─ event: { type: "message_delta", delta: { stop_reason: "tool_use" } }
│  └─ event: { type: "message_stop" }                          ← API response complete
│
├─ SDKAssistantMessage { type: "assistant" }                   ← Complete turn (all blocks)
│
├─ SDKUserMessage { type: "user" }                             ← Tool result(s)
│  └─ message.content: [{ type: "tool_result", tool_use_id: "toolu_...", content: "..." }]
│
├─ (Next API turn streams similarly...)
│
└─ SDKResultMessage { type: "result" }                         ← Final outcome
   ├─ subtype: "success" | "error_max_turns" | "error_during_execution" | ...
   ├─ total_cost_usd: number
   ├─ usage: { input_tokens, output_tokens, ... }
   ├─ modelUsage: { [model]: { inputTokens, outputTokens, costUSD, ... } }
   ├─ stop_reason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | null
   ├─ num_turns: number
   └─ duration_ms: number
```

---

## 5. Content Block Types

Each `SDKAssistantMessage` contains a `message.content` array with these block types:

### Text Block

```json
{
  "type": "text",
  "text": "Let me look at the auth.py file to find the bug."
}
```

Plain text output from the model. Streamed via `text_delta` events.

### Thinking Block

```json
{
  "type": "thinking",
  "thinking": "The user wants me to fix a bug. Let me start by reading the file..."
}
```

Extended reasoning content. Streamed via `thinking_delta` (or `reasoning_delta`) events.
Only present when thinking is enabled. Not persisted in the final result text.

### Tool Use Block

```json
{
  "type": "tool_use",
  "id": "toolu_01ABC123",
  "name": "Read",
  "input": {
    "file_path": "auth.py"
  }
}
```

Indicates the model wants to call a tool. The `id` is used to correlate with the tool result.
Input is streamed via `input_json_delta` events as partial JSON chunks.

### Tool Result Block (in User Messages)

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01ABC123",
  "content": "def authenticate(user):\n    # ... file contents ..."
}
```

The SDK automatically executes the tool and yields the result as a user message.
The `tool_use_id` links back to the original `tool_use` block.

---

## 6. Tool Use Flow

### Complete Tool Execution Cycle

```
1. Model generates tool_use block
   └─ stream_event: content_block_start { type: "tool_use", id: "toolu_X", name: "Bash" }
   └─ stream_event: content_block_delta { type: "input_json_delta", partial_json: ... }
   └─ stream_event: content_block_stop

2. SDK receives complete assistant message
   └─ SDKAssistantMessage.message.content includes { type: "tool_use", ... }

3. Permission check (if needed)
   └─ canUseTool callback fires → user approves/denies
   └─ OR: permission mode auto-approves (acceptEdits, bypassPermissions)
   └─ OR: hooks intercept (PreToolUse can allow/deny/modify)

4. SDK executes the tool
   └─ tool_progress events emitted for long-running tools
   └─ PostToolUse hooks fire with result

5. Tool result returned as user message
   └─ SDKUserMessage with tool_result block(s)
   └─ user message UUID serves as checkpoint for file undo

6. Model sees result, decides next action
   └─ May generate more text, more tool calls, or end the turn
```

### Built-in Tools

| Tool | Purpose | Permission Level |
|------|---------|-----------------|
| **Read** | Read any file | Auto-approved |
| **Write** | Create/overwrite files | Requires permission (auto in `acceptEdits`) |
| **Edit** | Precise string replacement | Requires permission (auto in `acceptEdits`) |
| **MultiEdit** | Multiple edits in one call | Requires permission (auto in `acceptEdits`) |
| **Bash** | Run terminal commands | Requires permission |
| **Glob** | Find files by pattern | Auto-approved |
| **Grep** | Search file contents | Auto-approved |
| **WebSearch** | Search the web | Auto-approved |
| **WebFetch** | Fetch URL content | Auto-approved |
| **Task** | Spawn subagent | Inherits parent permissions |
| **AskUserQuestion** | Ask clarifying questions | Special handling via `canUseTool` |
| **TodoRead/TodoWrite** | Manage task lists | Auto-approved |
| **NotebookEdit** | Edit Jupyter notebooks | Requires permission |

### Tool Input/Output Types

Every tool has typed input and output schemas. Example for Edit:

```typescript
// Input
type FileEditInput = {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
};

// Output
type FileEditOutput = {
  filePath: string;
  oldString: string;
  newString: string;
  originalFile: string;
  structuredPatch: Array<{
    oldStart: number; oldLines: number;
    newStart: number; newLines: number;
    lines: string[];
  }>;
  userModified: boolean;
  replaceAll: boolean;
  gitDiff?: { filename: string; status: string; additions: number; deletions: number; patch: string };
};
```

---

## 7. Permission System

### Permission Evaluation Order

When Claude requests a tool, the SDK checks in this order:

1. **Hooks** (`PreToolUse`) — can allow, deny, or continue to next step
2. **Permission rules** (from `settings.json`) — deny rules first, then allow, then ask
3. **Permission mode** — `bypassPermissions`, `acceptEdits`, `dontAsk`, `default`
4. **`canUseTool` callback** — the app's runtime handler

### Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | No auto-approvals. Unmatched tools trigger `canUseTool`. |
| `acceptEdits` | Auto-approve file edits (Write, Edit, MultiEdit) + fs ops (mkdir, rm, mv, cp). Other tools still need approval. |
| `bypassPermissions` | All tools auto-approved. Hooks still execute. **Subagents inherit this.** |
| `plan` | No tool execution at all. Claude can only plan. |
| `dontAsk` | Don't prompt — deny if not pre-approved by rules. |

### canUseTool Callback

This is how Broski handles permission requests. The SDK calls this function when a tool
needs approval:

```typescript
canUseTool: async (toolName, input, ctx) => {
  // ctx.signal: AbortSignal (session may be aborted while waiting)
  // ctx.suggestions: PermissionUpdate[] (for "Always Allow" persistence)
  // ctx.blockedPath: string (file that triggered the permission)
  // ctx.decisionReason: string (why this needs approval)
  // ctx.toolUseID: string (unique tool call ID)
  // ctx.agentID: string (if inside a subagent)

  // Return allow or deny:
  return { behavior: "allow", updatedInput: input };
  // OR
  return { behavior: "deny", message: "User rejected", interrupt: true };
}
```

### Permission Response Types

```typescript
type PermissionResult =
  | { behavior: "allow"; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[]; }
  | { behavior: "deny"; message: string; interrupt?: boolean; };
```

When `interrupt: true` on deny, the agent stops rather than trying a different approach.

### PermissionUpdate (Always Allow)

When the SDK provides `suggestions` in the `canUseTool` context, these are
`PermissionUpdate` objects that can persist rules to settings files:

```typescript
type PermissionUpdate =
  | { type: "addRules"; rules: PermissionRuleValue[]; behavior: "allow" | "deny" | "ask"; destination: "userSettings" | "projectSettings" | "localSettings" | "session" }
  | { type: "replaceRules"; ... }
  | { type: "removeRules"; ... }
  | { type: "setMode"; mode: PermissionMode; destination: ... }
  | { type: "addDirectories"; directories: string[]; ... }
  | { type: "removeDirectories"; ... };
```

### Dynamic Permission Mode Changes

The `Query` object supports mid-session changes:

```typescript
await q.setPermissionMode("acceptEdits");  // Loosen permissions
await q.setPermissionMode("plan");          // Switch to plan mode
```

---

## 8. Questionnaire / User Input (AskUserQuestion)

### How It Works

Claude can ask the user clarifying questions via the `AskUserQuestion` tool. This fires the
`canUseTool` callback with `toolName === "AskUserQuestion"`.

### Question Format

```json
{
  "questions": [
    {
      "question": "How should I format the output?",
      "header": "Format",
      "options": [
        { "label": "Summary", "description": "Brief overview" },
        { "label": "Detailed", "description": "Full explanation" }
      ],
      "multiSelect": false
    }
  ]
}
```

Constraints: 1–4 questions, 2–4 options each. `multiSelect` enables multi-select.

### Response Format

Return answers as a mapping of question text → selected label(s):

```typescript
return {
  behavior: "allow",
  updatedInput: {
    questions: input.questions,  // Pass through original questions
    answers: {
      "How should I format the output?": "Summary",
      "Which sections?": "Introduction, Conclusion"  // Comma-separated for multi-select
    }
  }
};
```

### Free-text Input

For custom answers beyond the predefined options, use the user's typed text directly as the
answer value. The SDK passes it through to Claude.

### Limitations

- Not available in subagents spawned via Task tool.
- Each call supports 1–4 questions with 2–4 options each.
- Especially common in `plan` mode where Claude gathers requirements first.

---

## 9. Stop Reasons

The `SDKResultMessage` includes a `stop_reason` field:

| Stop Reason | Meaning |
|-------------|---------|
| `end_turn` | Normal completion. Claude finished generating. |
| `tool_use` | Last output was a tool call. Uncommon in results (tools normally execute first). |
| `max_tokens` | Hit the maximum output token limit. |
| `stop_sequence` | Generated a configured stop sequence. |
| `refusal` | Claude declined the request. Check `message.stop_reason === "refusal"`. |
| `null` | No API response received (error before first request, or replayed session). |

### Result Subtypes

```typescript
type SDKResultMessage =
  | { subtype: "success"; result: string; stop_reason: string | null; ... }
  | { subtype: "error_max_turns"; errors: string[]; stop_reason: string | null; ... }
  | { subtype: "error_during_execution"; errors: string[]; ... }
  | { subtype: "error_max_budget_usd"; errors: string[]; ... }
  | { subtype: "error_max_structured_output_retries"; errors: string[]; ... };
```

---

## 10. Thinking / Extended Thinking

### ThinkingConfig Options

```typescript
type ThinkingConfig =
  | { type: "adaptive" }                           // Default: SDK decides
  | { type: "enabled"; budgetTokens: number }      // Explicit budget
  | { type: "disabled" };                           // No thinking
```

### How Thinking Streams

With `includePartialMessages: true`:

```
content_block_start: { type: "thinking" }
content_block_delta: { type: "thinking_delta", thinking: "Let me analyze..." }
content_block_delta: { type: "thinking_delta", thinking: " the code structure..." }
content_block_stop
```

The connector also handles `reasoning_delta` as an alias for forward compatibility.

### Effort Levels

The `effort` option controls thinking depth:

| Effort | Description |
|--------|-------------|
| `low` | Quick responses, minimal reasoning |
| `medium` | Balanced reasoning |
| `high` | Deep reasoning (default) |
| `max` | Maximum reasoning depth |

### Legacy Thinking Variants (Broski-specific)

Our bridge maps named variants to `budgetTokens`:
- `low` → 4,096 tokens
- `medium` → 16,384 tokens
- `high` → 65,536 tokens
- `max` → SDK default (null)
- `default` → No override (null)

---

## 11. Error Handling

### Assistant Message Errors

```typescript
type SDKAssistantMessageError =
  | "authentication_failed"
  | "billing_error"
  | "rate_limit"
  | "invalid_request"
  | "server_error"
  | "unknown";
```

Present on `SDKAssistantMessage.error` when the API call fails.

### Auth Status Events

```typescript
type SDKAuthStatusMessage = {
  type: "auth_status";
  isAuthenticating: boolean;
  output: string[];
  error?: string;
};
```

Fatal if `error` is present — indicates API key or auth failure.

### Rate Limit Events

```typescript
type SDKRateLimitEvent = {
  type: "rate_limit_event";
  rate_limit_info: {
    status: string;
    resetsAt: number;
    rateLimitType: string;
    utilization: number;
    overageStatus?: string;
    isUsingOverage?: boolean;
    surpassedThreshold?: number;
  };
};
```

### API Retry Events

When the SDK retries a failed API call:

```typescript
// Emitted as: { type: "system", subtype: "api_retry" }
{
  attempt: number;
  max_retries: number;
  retry_delay_ms: number;
  error_status?: number;   // HTTP status code
  error?: string;           // Error message
}
```

### Result Errors

Error results include an `errors` array:

```typescript
{
  type: "result",
  subtype: "error_during_execution",
  errors: ["Error: ENOENT: no such file or directory"],
  is_error: true,
  stop_reason: null
}
```

---

## 12. Image & File Input

### Via Streaming Input (Inline Base64)

```typescript
yield {
  type: "user",
  message: {
    role: "user",
    content: [
      { type: "text", text: "Review this screenshot" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "<base64-encoded-data>"
        }
      }
    ]
  }
};
```

### Broski's Attachment Approach

The Claude Code SDK doesn't have a first-class "attachments" parameter. Broski handles this by:

1. **File paths**: Referenced as `@/path/to/file` in the prompt. Claude uses the Read tool.
2. **Images from mobile**: Written to disk at `<cwd>/.broski/cc-attachments/<timestamp>_<token>_<filename>` and referenced as `@<path>` in the prompt.

```typescript
// Bridge connector: preparePromptWithAttachments()
// Transforms: "Review this code" + [image attachment]
// Into: "Review this code\n---\nAttached context (via Broski):\n- Image: @/path/to/saved.png\n\nIf relevant, use the Read tool on the @paths above."
```

---

## 13. Cost Tracking

### Per-query Cost

Every `SDKResultMessage` includes cumulative cost:

```typescript
{
  type: "result",
  total_cost_usd: 0.0234,        // Total cost for this query() call
  usage: {
    input_tokens: 15000,
    output_tokens: 3000,
    cache_read_input_tokens: 8000,
    cache_creation_input_tokens: 2000,
  },
  modelUsage: {
    "claude-sonnet-4-20250514": {
      inputTokens: 15000,
      outputTokens: 3000,
      cacheReadInputTokens: 8000,
      cacheCreationInputTokens: 2000,
      webSearchRequests: 0,
      costUSD: 0.0234,
      contextWindow: 200000,
      maxOutputTokens: 16384,
    }
  }
}
```

### Deduplication Warning

When Claude uses multiple tools in parallel, multiple `SDKAssistantMessage` objects share the
same `message.id` with identical usage data. Always deduplicate by message ID to avoid
double-counting.

### Context Window Usage

Our connector extracts the last `message`-type iteration from `usage.iterations` to get
accurate current context window occupancy (not cumulative totals):

```typescript
// From the connector:
if (Array.isArray(iterations)) {
  for (let i = iterations.length - 1; i >= 0; i--) {
    if (iterations[i]?.type === "message") {
      lastIterContextTokens = iter.input_tokens + iter.cache_read + iter.cache_creation;
      break;
    }
  }
}
```

---

## 14. Session Resume & Forking

### Resume

```typescript
query({ prompt: "Continue", options: { resume: sessionId } })
```

- Loads full JSONL transcript
- Replays prior messages (emitted as `SDKUserMessageReplay` with `isReplay: true`)
- Re-emits `SDKSystemMessage` init
- Continues conversation with full context

### Fork

```typescript
query({ prompt: "Try differently", options: { resume: sessionId, forkSession: true } })
```

- Creates new session ID
- Copies conversation up to current point (with remapped UUIDs)
- Original session untouched

### Resume at Specific Message

```typescript
query({ prompt: "Redo from here", options: { resume: sessionId, resumeSessionAt: messageUuid } })
```

Resumes from a specific point in the conversation (useful for undo/rewind).

### File Checkpointing & Rewind

When `enableFileCheckpointing: true`, each user message UUID becomes a checkpoint.
Files can be rewound to any checkpoint:

```typescript
// Must be called inside the for-await loop (transport must be ready)
const result = await q.rewindFiles(checkpointUuid);
// Returns: { canRewind: boolean; filesChanged?: string[]; insertions?: number; deletions?: number }
```

---

## 15. Real-time Event Ordering

### Complete Turn Sequence (Typical)

```
1.  SDKSystemMessage          { type: "system", subtype: "init" }
2.  stream_event              message_start
3.  stream_event              content_block_start (thinking)
4.  stream_event              content_block_delta (thinking_delta) × N
5.  stream_event              content_block_stop
6.  stream_event              content_block_start (text)
7.  stream_event              content_block_delta (text_delta) × N
8.  stream_event              content_block_stop
9.  stream_event              content_block_start (tool_use)
10. stream_event              content_block_delta (input_json_delta) × N
11. stream_event              content_block_stop
12. stream_event              message_delta { stop_reason: "tool_use" }
13. stream_event              message_stop
14. SDKAssistantMessage       { type: "assistant" } — complete turn
15. [canUseTool callback]     Permission check (if needed)
16. [tool_progress events]    For long-running tools
17. SDKUserMessage            { type: "user" } — tool result
18. (Repeat 2-17 for next turn...)
19. stream_event              message_delta { stop_reason: "end_turn" }
20. stream_event              message_stop
21. SDKAssistantMessage       { type: "assistant" } — final turn
22. SDKResultMessage          { type: "result", subtype: "success" }
```

### Compaction Sequence

When context grows too large:

```
SDKStatusMessage            { subtype: "status", status: "compacting" }
SDKCompactBoundaryMessage   { subtype: "compact_boundary", compact_metadata: { trigger, pre_tokens } }
(Conversation continues with compacted context)
```

### Subagent/Task Sequence

```
stream_event: tool_use "Task" with { subagent_type: "reviewer", prompt: "..." }
SDKTaskStartedMessage       { subtype: "task_started", task_id: "..." }
SDKTaskProgressMessage      { subtype: "task_progress", task_id: "..." } × N
SDKTaskNotificationMessage  { subtype: "task_notification", task_id: "...", status: "completed" }
SDKUserMessage              tool_result for Task
```

---

## 16. Our Connector Implementation

**File:** `packages/bridge/src/connectors/claude-code.ts` (3,281 lines — FROZEN)

### Architecture

The connector is a module of exported functions (not a class):

```typescript
// Session management
export async function listSessions(cwd?: string): Promise<ClaudeCodeSession[]>
export async function getSession(id: string, cwd?: string): Promise<ClaudeCodeSession | null>
export async function getSessionMessages(id: string, cwd?: string): Promise<ClaudeCodeTranscriptMessage[]>
export async function deleteSession(id: string, cwd?: string): Promise<boolean>
export async function forkSession(id: string, messageId?: string, cwd?: string): Promise<ClaudeCodeSession | null>
export async function renameSession(id: string, name: string, cwd?: string): Promise<ClaudeCodeSession | null>

// Config
export async function getConfig(cwd?: string): Promise<ClaudeCodeConfig>
export async function setConfig(config: Partial<ClaudeCodeConfig>, cwd?: string): Promise<ClaudeCodeConfig>

// Chat
export async function queryClaudeCode(prompt, options, onMessage, onComplete, onError, onPermissionRequest?, onElicitationRequest?): Promise<void>
export async function abortClaudeCode(sessionId: string): Promise<void>

// Mid-session capabilities
export async function setPermissionMode(sessionId: string, mode: string): Promise<boolean>
export async function setModel(sessionId: string, model?: string): Promise<boolean>
export async function rewindToCheckpoint(sessionId, uuid, cwd): Promise<{...}>
export async function stopTask(sessionId, taskId): Promise<boolean>
export async function reconnectMcpServer(sessionId, name): Promise<boolean>
export async function toggleMcpServer(sessionId, name, enabled): Promise<boolean>
export async function setMcpServers(sessionId, servers): Promise<{...}>

// Discovery
export async function listSkills(cwd?: string): Promise<ClaudeCodeSkill[]>
export async function listHooks(cwd?: string): Promise<ClaudeCodeHook[]>
export async function listCommands(cwd?: string): Promise<ClaudeCodeCommand[]>
export async function listAgents(cwd?: string): Promise<ClaudeCodeFilesystemAgent[]>
export async function listMemories(scope?, cwd?): Promise<ClaudeCodeMemoryEntry[]>
export async function getSupportedModels(cwd?): Promise<ClaudeCodeSupportedModel[]>
export async function getAccountInfo(cwd?): Promise<ClaudeCodeAccountInfo>
export async function getMcpServerStatus(cwd?): Promise<ClaudeCodeMcpServerStatus[]>
```

### queryClaudeCode — The Main Chat Function

This is the core function (lines 2219–2978). It:

1. **Builds SDK options** from Broski config + per-query overrides
2. **Sets up `canUseTool`** callback that forwards permission requests to the Flutter app
3. **Sets up `onElicitation`** callback for MCP server auth flows
4. **Calls `query()`** with `includePartialMessages: true`
5. **Iterates the async generator**, translating each `SDKMessage` into a `ClaudeCodeStreamMessage`

### Event Translation (SDK → Broski Wire Protocol)

| SDK Event | Bridge Emission |
|-----------|----------------|
| `system` + `init` | `session-created` + `session-init` |
| `system` + `compact_boundary` | `compact-boundary` |
| `stream_event` + `content_block_start` (text) | `assistant-message-delta` |
| `stream_event` + `content_block_delta` (text_delta) | `assistant-message-delta` |
| `stream_event` + `content_block_delta` (thinking_delta) | `thinking-delta` |
| `stream_event` + `content_block_start` (tool_use) | `tool-call` (status: running) |
| `stream_event` + `content_block_delta` (input_json_delta) | `tool-call` (with partial input) |
| `tool_progress` | `tool-call` (with elapsed time) |
| `user` + `tool_result` | `tool-result` + `checkpoint-created` |
| `assistant` + `error` | `assistant-error` |
| `result` | `token-usage` + `result-complete` + optionally `structured-output` |
| `system` + `task_started` | `task-started` |
| `system` + `task_progress` | `task-progress` |
| `system` + `task_notification` | `task-notification` |
| `tool_use_summary` | `tool-use-summary` |
| `system` + `status` | `status-update` |
| `system` + `hook_*` | `hook-started` / `hook-progress` / `hook-response` |
| `rate_limit_event` | `rate-limit-info` |
| `prompt_suggestion` | `prompt-suggestion` |
| `auth_status` | `auth-status` (fatal if error present) |
| `system` + `api_retry` | `api-retry` |

### Active Session Management

The connector maintains a `Map<string, ActiveSession>` to track running sessions:

```typescript
type ActiveSession = {
  controller: AbortController;   // For aborting
  cwd: string;                    // Working directory
  query?: SDKQuery;               // SDK Query object (for mid-session ops)
  startedAt: number;              // Timestamp
};
```

This enables mid-session operations: `setPermissionMode()`, `setModel()`, `rewindFiles()`,
`stopTask()`, `reconnectMcpServer()`, etc.

### Tool Input Streaming

The connector buffers `input_json_delta` chunks per tool use ID to build partial tool inputs:

```typescript
const toolInputJsonBufferByToolUseId = new Map<string, string>();

// On input_json_delta:
const nextJson = `${buffer.get(toolUseId) ?? ""}${delta.partial_json}`;
buffer.set(toolUseId, nextJson);

try {
  parsedInput = JSON.parse(nextJson);  // Try parsing accumulated JSON
} catch {
  // Not complete yet — emit partial
  parsedInput = { _partialJson: nextJson };
}
```

---

## 17. Our Wire Protocol (cc_stream)

Messages from the bridge to the Flutter app are wrapped as:

```json
{
  "type": "cc_stream",
  "data": { /* ClaudeCodeStreamMessage */ },
  "sessionId": "uuid-string"
}
```

### All 33 Message Types

Our `ClaudeCodeStreamMessage` union has 33 variants. Every variant includes an optional
`parentToolUseId` for hierarchical subagent tracking.

**Session Lifecycle:**
- `session-created` — Session started, includes agent type and model
- `session-init` — Full initialization data (tools, models, MCP servers, account info, etc.)
- `session-state-changed` — `idle` | `running` | `requires_action`

**Streaming Content:**
- `assistant-message` — Complete text block
- `assistant-message-delta` — Incremental text chunk
- `thinking-delta` — Incremental thinking/reasoning chunk

**Tool Execution:**
- `tool-call` — Tool invocation (status: `running` | `completed` | `failed`)
- `tool-result` — Tool execution result (includes raw `toolUseResult` for diffs)
- `tool-use-summary` — AI-generated summary of tool activity
- `local-command-output` — Output from slash commands

**Permissions:**
- `permission-request` — Tool needs user approval (includes suggestions for "Always Allow")

**Checkpoints:**
- `checkpoint-created` — File checkpoint for undo/rewind

**Tasks & Workflows (Agent Teams):**
- `task-started` — Background task launched
- `task-progress` — Task progress update (tokens, tool count)
- `task-notification` — Task completed/failed/stopped

**Subagents:**
- `subagent-invocation` — Task tool detected with subagent type

**Hooks:**
- `hook-started` / `hook-progress` / `hook-response` — Hook lifecycle events

**Metadata:**
- `token-usage` — Token counts, cost, context window, model usage breakdown
- `result-complete` — Final outcome (stop reason, subtype, errors, permission denials)
- `status-update` — Compaction status
- `compact-boundary` — Conversation was compacted (trigger, pre-compaction token count)

**MCP / Extensibility:**
- `elicitation-request` — MCP server needs user input (auth flows)
- `elicitation-complete` — MCP elicitation finished

**Errors & Diagnostics:**
- `assistant-error` — API-level error (auth, billing, rate limit)
- `error` — General error
- `auth-status` — Authentication flow status
- `api-retry` — API call being retried
- `rate-limit-info` — Rate limit details (utilization, reset time, overage)

**Output:**
- `structured-output` — JSON schema-validated output
- `prompt-suggestion` — Predicted next user prompt

---

## 18. Flutter-side Event Processing

### Architecture Overview

```
Bridge WebSocket
    ↓
BridgeService._handleMessage()
    ↓ (cc_stream messages)
RuntimeEvent stream (unified across agents)
    ↓
ChatSessionNotifier._handleRuntimeChatEvent()
    ↓
CcStreamHandler / RuntimeCcMetadataHandler / RuntimeEventReducer
    ↓
ChatMessage list (UI state)
```

### Key Dart Files

| File | Purpose |
|------|---------|
| `lib/models/claude_code/cc_stream_message.dart` | `ClaudeCodeStreamMessage` sealed class (24+ variants) with `fromJson()` |
| `lib/providers/chat/cc_stream_handler.dart` | CC session setup, transcript hydration, raw bridge message handling |
| `lib/providers/chat/runtime_chat_ingest.dart` | Subscribe to `runtimeEvents` stream, deduplicate, route to handlers |
| `lib/providers/chat/runtime_cc_metadata_handler.dart` | CC-specific metadata enrichment (model, errors, permission denials, fast mode) |
| `lib/providers/chat/runtime_event_reducer.dart` | Pure reducer: events → shadow state (streaming text, tool calls, thinking) |

### Event Flow

1. **Bridge emits `cc_stream`** → BridgeService parses, emits as `RuntimeEvent`
2. **`_initializeRuntimeChatIngest()`** subscribes to the events stream
3. **Deduplication** via event fingerprint (prevents duplicate processing)
4. **Gap detection** → triggers recovery if sequence numbers jump
5. **CC-specific routing** in `_handleRuntimeChatEvent()`:
   - `RuntimeAgentStartedEvent` → `_handleRuntimeCcAgentStarted()` (set view, extract model)
   - `RuntimeAgentFinishedEvent` → `_handleRuntimeCcAgentFinished()` (refusal, errors, fast mode)
   - `RuntimeToolStartedEvent` → `_handleRuntimeCcToolStarted()` (TodoWrite, nested tools)
   - `RuntimeToolFinishedEvent` → `_handleRuntimeCcToolFinished()` (extract diffs from `toolUseResult`)
   - `RuntimePermissionRequestedEvent` → shows permission dialog in the chat UI
6. **Event reducer** builds shadow state (accumulated text, thinking, tool calls)
7. **`_projectRuntimeTurn()`** converts shadow state → `ChatMessage` in the messages list

### Permission Request Flow (End-to-End)

```
SDK calls canUseTool()
    ↓
Bridge connector receives request
    ↓
Bridge sends: { type: "cc_permission_request", sessionId, toolUseId, tool, input, ... }
    ↓
Flutter shows permission sheet (tool name, input preview, approve/reject/always)
    ↓
User responds: "once" | "always" | "reject"
    ↓
Flutter sends: { type: "cc_permission_response", sessionId, toolUseId, response, updatedPermissions? }
    ↓
Bridge connector returns { behavior: "allow" | "deny" } to SDK canUseTool callback
    ↓
SDK executes or denies the tool
```

### Transcript Hydration

When opening an existing session, the bridge reads the JSONL file and returns structured messages.
The Flutter side rebuilds the chat UI from these:

```dart
// cc_stream_handler.dart: hydrateClaudeCodeTranscript()
for (final msg in transcriptMessages) {
  if (msg.role == 'user') → add user ChatMessage
  if (msg.role == 'assistant') {
    → extract text, thinking, tool calls
    → match tool results to tool calls via toolUseId
    → extract diffs from toolUseResult (structuredPatch → unified diff)
    → build complete ChatMessage with all parts
  }
}
```

---

## 19. Known Issues & Edge Cases

### 1. Stream Events vs Full Messages

The connector tracks `sawStreamEvents` — if no `stream_event` messages are received (e.g., SDK
version mismatch), it falls back to processing full `SDKAssistantMessage` blocks. This prevents
double-emitting when both are present.

### 2. Parallel Tool Calls with Same Message ID

When Claude uses multiple tools in one turn, all messages share the same `message.id`. The SDK
deduplicates by ID for token counting. Our connector handles this by tracking tool use IDs
independently via `toolUseIdByStreamIndex`.

### 3. ProcessTransport Not Ready

`rewindFiles()` must be called inside the `for await` loop — not before. If called before
the stream starts, it hits "ProcessTransport is not ready for writing" because the CLI
subprocess hasn't finished initializing.

### 4. Permission Request Timeout

If the Flutter app takes too long to respond to a permission request, the SDK's `AbortSignal`
may fire. The connector checks `ctx.signal?.aborted` before processing permission responses.

### 5. Session Path Encoding is Lossy

The encoding replaces both `/` and space with `-`, making it non-reversible. The connector uses
`decodeProjectDirName()` with greedy filesystem verification to reconstruct paths.

### 6. User Message UUID for Checkpoints

File checkpointing relies on user message UUIDs. The connector emits `checkpoint-created` for
every user message with a UUID, even though not all represent actual file state changes.
The Flutter side tracks these for undo/rewind.

### 7. Subagent Messages and parentToolUseId

Messages from subagents include `parent_tool_use_id` which is non-null. The connector
propagates this as `parentToolUseId` on all emitted messages, enabling the Flutter UI to
group subagent activity under the parent tool call.

### 8. MCP Elicitation vs canUseTool

MCP server auth flows use a separate `onElicitation` callback (not `canUseTool`). The SDK
provides `mode: "form" | "url"` and optional `requestedSchema` for structured input.

### 9. Legacy maxThinkingTokens

The `maxThinkingTokens` option is deprecated in favor of `thinking: { type: "enabled", budgetTokens }`.
Our connector converts legacy variants before creating the query. The deprecated
`setMaxThinkingTokens()` method is no longer used.

### 10. Config Persistence

Broski persists CC config to `~/.broski/claude-code-config.json`. Project-scoped settings
(language, releaseChannel, respectGitignore) go to `<project>/.claude/settings.json`.
Both are loaded on bridge restart.

### 11. Rate Limit and Retry Transparency

The SDK emits `rate_limit_event` and `api_retry` messages that our connector forwards to the
Flutter app. This enables the UI to show "Rate limited, retrying in 30s..." instead of
appearing frozen.

### 12. Fast Mode State

SDK 0.2.87+ emits `fast_mode_state: "off" | "cooldown" | "on"` on init and result messages.
Our connector forwards this for UI display (e.g., showing when fast mode is active or cooling down).

---

## Appendix A: SDK Version Compatibility

| Feature | Min SDK Version | Notes |
|---------|----------------|-------|
| Basic query() | 0.1.x | |
| includePartialMessages | 0.1.x | |
| canUseTool callback | 0.1.x | |
| AskUserQuestion tool | 0.1.x | |
| enableFileCheckpointing | 0.2.x | Requires env var |
| Thinking config (structured) | 0.2.42 | Replaces maxThinkingTokens |
| Effort levels | 0.2.42 | |
| Agent option (top-level) | 0.2.42 | |
| persistSession | 0.2.42 | |
| promptSuggestions | 0.2.52 | |
| agentProgressSummaries | 0.2.74 | |
| continue (most recent) | 0.2.87 | |
| forkSession on resume | 0.2.87 | |
| PermissionUpdate suggestions | 0.2.87 | |
| reloadPlugins | 0.2.87 | |
| getContextUsage | 0.2.87 | |
| applyFlagSettings | 0.2.87 | |
| tagSession | 0.2.87 | |

## Appendix B: File Locations

| What | Path |
|------|------|
| SDK docs | `reference/cc-docs/` |
| SDK npm package | `packages/bridge/node_modules/@anthropic-ai/claude-agent-sdk/` |
| Bridge connector | `packages/bridge/src/connectors/claude-code.ts` |
| Supplemental events | `packages/bridge/src/connectors/claude-code/stream-supplemental-events.ts` |
| Model normalization | `packages/bridge/src/connectors/claude-code/model-normalization.ts` |
| Session stats | `packages/bridge/src/connectors/claude-code/cc-session-stats.ts` |
| Wire types | `packages/bridge/src/types.ts` (ClaudeCodeStreamMessage at line 2931) |
| Dart stream model | `lib/models/claude_code/cc_stream_message.dart` |
| Dart CC handler | `lib/providers/chat/cc_stream_handler.dart` |
| Dart runtime ingest | `lib/providers/chat/runtime_chat_ingest.dart` |
| Dart CC metadata | `lib/providers/chat/runtime_cc_metadata_handler.dart` |
| Dart event reducer | `lib/providers/chat/runtime_event_reducer.dart` |
| Session JSONL storage | `~/.claude/projects/<encoded-path>/<session-uuid>.jsonl` |
| Broski CC config | `~/.broski/claude-code-config.json` |
