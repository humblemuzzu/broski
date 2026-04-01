# OpenCode Backend Architecture

> Deep-dive reference for Broski's OpenCode integration.
> Covers the SDK, event system, session lifecycle, tool handling,
> permissions, questions, thinking, and the full wire protocol from
> bridge to Flutter.
>
> **Last updated:** 2026-03-31

---

## Table of Contents

1. [SDK Architecture Overview](#1-sdk-architecture-overview)
2. [Session Lifecycle](#2-session-lifecycle)
3. [Sending a Prompt](#3-sending-a-prompt)
4. [Streaming Response Flow](#4-streaming-response-flow)
5. [Message & Content Types](#5-message--content-types)
6. [Tool Use Flow](#6-tool-use-flow)
7. [Permission System](#7-permission-system)
8. [User Input / Questions](#8-user-input--questions)
9. [Stop Reasons / Completion](#9-stop-reasons--completion)
10. [Thinking / Reasoning](#10-thinking--reasoning)
11. [Error Handling](#11-error-handling)
12. [Image / File Input](#12-image--file-input)
13. [Cost / Usage Tracking](#13-cost--usage-tracking)
14. [Session Resume](#14-session-resume)
15. [Real-time Event Ordering](#15-real-time-event-ordering)
16. [The v2 SDK API](#16-the-v2-sdk-api)
17. [Our Connector Implementation](#17-our-connector-implementation)
18. [Our Wire Protocol](#18-our-wire-protocol)
19. [Known Differences from Claude Code](#19-known-differences-from-claude-code)
20. [Permission & Question Handling Details](#20-permission--question-handling-details)

---

## 1. SDK Architecture Overview

### 1.1 Repository Structure

The OpenCode monorepo lives at `reference/opencode/`. Key packages:

```
packages/
  opencode/       ← Core OpenCode application (Go-style Effect-TS backend)
  sdk/
    js/           ← JavaScript/TypeScript SDK (what Broski uses)
      src/
        index.ts          ← Entry: re-exports client + server
        client.ts         ← createOpencodeClient() — creates REST client
        server.ts         ← createOpencodeServer() — spawns OpenCode process
        gen/              ← Auto-generated from OpenAPI spec (v1 SDK)
          types.gen.ts    ← All type definitions (3905 lines)
          sdk.gen.ts      ← OpencodeClient class with all resource methods
          client.gen.ts   ← Low-level HTTP client
        v2/               ← v2 SDK (what Broski uses: @opencode-ai/sdk/v2)
          index.ts        ← Same exports as parent, re-exports v2 client
          client.ts       ← createOpencodeClient() with workspace support
          server.ts       ← Same server spawner
          gen/
            types.gen.ts  ← v2 types (5166 lines, superset of v1)
            sdk.gen.ts    ← v2 OpencodeClient class
    openapi.json          ← OpenAPI specification (source of truth for codegen)
  app/            ← SolidJS TUI frontend
  plugin/         ← Plugin SDK for extending OpenCode
```

### 1.2 SDK Design Pattern

The SDK is generated from an **OpenAPI specification** using `@hey-api/openapi-ts`.
The client is a thin HTTP wrapper around OpenCode's local REST server:

- **OpenCode Server** runs as a local HTTP server on `http://localhost:4096`
- **SDK Client** calls REST endpoints via `fetch()`
- **SSE (Server-Sent Events)** is used for the real-time event stream at `GET /global/event`
- **WebSocket** is used only for PTY terminal I/O at `GET /pty/{id}/connect`

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });
```

### 1.3 The OpencodeClient Class

The v2 `OpencodeClient` exposes these resource namespaces:

| Namespace     | Description                          | Key Methods                                        |
|---------------|--------------------------------------|----------------------------------------------------|
| `global`      | Global events, health, config        | `event()` (SSE stream), `health()`, `config.get()` |
| `project`     | Project management                   | `list()`, `current()`, `update()`                  |
| `session`     | Session CRUD + messaging             | `create()`, `get()`, `list()`, `prompt()`, `abort()`, `fork()`, `revert()`, `share()`, `summarize()`, `messages()`, `command()`, `shell()`, `diff()`, `todo()`, `status()`, `init()`, `promptAsync()` |
| `config`      | Configuration                        | `get()`, `update()`, `providers()`                 |
| `provider`    | Provider management + OAuth          | `list()`, `auth()`, `oauth.authorize()`, `oauth.callback()` |
| `permission`  | Permission request management        | `list()`, `reply()`                                |
| `question`    | Question/user-input management       | `list()`, `reply()`, `reject()`                    |
| `command`     | Slash commands                       | `list()`                                           |
| `find`        | Search (files, text, symbols)        | `files()`, `text()`, `symbols()`                   |
| `file`        | File operations                      | `list()`, `read()`, `status()`                     |
| `tool`        | Tool introspection                   | `ids()`, `list()`                                  |
| `mcp`         | MCP server management                | `status()`, `add()`, `connect()`, `disconnect()`, `auth.*` |
| `pty`         | PTY terminal sessions                | `list()`, `create()`, `get()`, `update()`, `remove()`, `connect()` |
| `instance`    | Instance lifecycle                   | `dispose()`                                        |
| `vcs`         | Version control                      | `get()`                                            |
| `lsp`         | LSP server status                    | `status()`                                         |
| `formatter`   | Code formatter status                | `status()`                                         |
| `tui`         | TUI control (for plugins)            | `appendPrompt()`, `openHelp()`, `submitPrompt()`, etc. |
| `app`         | Application-level                    | `log()`, `agents()`, `skills()`                    |
| `auth`        | Provider credential management       | `set()`, `remove()`                                |
| `experimental`| Experimental features                | `workspace.*`, `resource.*`, `session.list()`      |
| `worktree`    | Git worktree management              | `list()`, `create()`, `reset()`, `remove()`        |

### 1.4 SDK Imports (What Broski Uses)

```typescript
import {
  type Auth,
  createOpencodeClient,
  type FilePartInput,
  type FilePartSource,
  type GlobalEvent,
  type GlobalSession,
  type McpLocalConfig,
  type McpRemoteConfig,
  type Config as OpenCodeConfig,
  type PermissionRequest as OpenCodePermissionRequest,
  type QuestionRequest as OpenCodeQuestionRequest,
  type Workspace as OpenCodeWorkspace,
  type OpencodeClient,
  type OutputFormat,
  type Part,
  type Project,
  type Session,
  type SessionMessageResponse,
  type TextPartInput,
} from "@opencode-ai/sdk/v2";
```

---

## 2. Session Lifecycle

### 2.1 Create a Session

```typescript
const { data: session } = await client.session.create({
  directory: "/path/to/project",
  title: "Fix auth bug",
  permission: [{ permission: "edit", pattern: "*", action: "allow" }],
  workspaceID: "ws-123",  // optional workspace association
});
// Returns: Session { id, slug, projectID, directory, title, time, ... }
```

**Wire message (Broski → Bridge):**
```json
{ "type": "create_session", "projectPath": "/path/to/project", "title": "Fix auth bug" }
```

### 2.2 List Sessions

```typescript
// Standard list (single project directory)
const { data: sessions } = await client.session.list({
  directory: "/path/to/project",
  roots: true,     // only root sessions (not forks)
  start: 0,        // pagination start
  search: "auth",  // search query
  limit: 50,       // max results
});

// Cross-project list (experimental endpoint)
const { data: sessions } = await client.experimental.session.list({
  cursor: 10,       // cursor-based pagination
  archived: false,   // exclude archived sessions
});
```

Sessions are returned as `Session` objects:
```typescript
type Session = {
  id: string;
  slug: string;           // URL-friendly slug
  projectID: string;
  workspaceID?: string;   // workspace association
  directory: string;
  parentID?: string;      // non-null if forked
  title: string;
  version: string;
  time: {
    created: number;      // Unix timestamp (seconds)
    updated: number;
    compacting?: number;  // non-null while compaction in progress
    archived?: number;    // non-null if archived
  };
  summary?: {
    additions: number;
    deletions: number;
    files: number;
    diffs?: FileDiff[];
  };
  share?: { url: string };
  permission?: PermissionRuleset;
  revert?: {
    messageID: string;
    partID?: string;
    snapshot?: string;
    diff?: string;
  };
};
```

### 2.3 Delete, Update, Fork

```typescript
// Delete
await client.session.delete({ sessionID: id, directory });

// Update (rename, archive)
await client.session.update({
  sessionID: id, directory,
  title: "New name",
  time: { archived: Date.now() }  // or undefined to un-archive
});

// Fork (branch from a message)
const { data: forked } = await client.session.fork({
  sessionID: id, directory,
  messageID: "msg-123",  // fork point (optional)
});
```

### 2.4 Session Status

Sessions have three runtime statuses:

```typescript
type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };
```

These are emitted as `session.status` events and also queryable via `client.session.status()`.

---

## 3. Sending a Prompt

### 3.1 The `session.prompt()` API

This is the primary way to send user messages. It's a **synchronous POST** that returns the final `SessionMessageResponse` when the assistant is done.

```typescript
const { data } = await client.session.prompt({
  sessionID: "ses-abc",
  directory: "/project",
  parts: [
    { type: "text", text: "Fix the login bug" },
    { type: "file", url: "file:///path/to/screenshot.png", mime: "image/png", filename: "screenshot.png" },
  ],
  model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
  agent: "build",       // optional: specific agent
  variant: "extended",  // optional: model variant
  noReply: false,       // if true, don't wait for response
  system: "Custom system instructions",  // optional system prompt override
});
```

**Important:** `session.prompt()` is blocking — it waits for the full LLM response including all tool calls. The bridge calls it as fire-and-forget and relies on the SSE event stream for real-time updates.

### 3.2 The `session.promptAsync()` API

Returns immediately while the session runs in the background:

```typescript
const { data } = await client.session.promptAsync({
  sessionID: "ses-abc",
  directory: "/project",
  parts: [{ type: "text", text: "Refactor the auth module" }],
  format: { type: "json_schema", schema: { ... }, retryCount: 3 },
});
```

### 3.3 Part Types for Input

```typescript
type TextPartInput = {
  id?: string;
  type: "text";
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
};

type FilePartInput = {
  id?: string;
  type: "file";
  mime: string;
  filename?: string;
  url: string;              // file:// URL, data: URL, or http(s) URL
  source?: FilePartSource;  // optional source annotation
};

type AgentPartInput = {
  id?: string;
  type: "agent";
  name: string;
};

type SubtaskPartInput = {
  id?: string;
  type: "subtask";
  prompt: string;
  description: string;
  agent: string;
};
```

### 3.4 Slash Commands

Commands are executed via `session.command()`:

```typescript
await client.session.command({
  sessionID: "ses-abc",
  directory: "/project",
  command: "compact",
  arguments: "",
  agent: "build",
  model: "anthropic/claude-sonnet-4",
});
```

### 3.5 Shell Commands

Direct shell command execution within session context:

```typescript
await client.session.shell({
  sessionID: "ses-abc",
  directory: "/project",
  command: "npm test",
  agent: "build",
  model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
});
```

---

## 4. Streaming Response Flow

### 4.1 The Global SSE Event Stream

OpenCode does NOT stream from the prompt endpoint. Instead, all real-time updates
come through a **single global SSE stream**:

```typescript
const { stream } = await client.global.event({ signal: controller.signal });

for await (const event of stream) {
  // event: GlobalEvent = { directory: string, payload: Event }
  console.log(event.payload.type, event.payload.properties);
}
```

Every event is wrapped in a `GlobalEvent` envelope:

```typescript
type GlobalEvent = {
  directory: string;    // project directory this event belongs to, or "global"
  payload: Event;       // the actual event
};
```

### 4.2 The Event Union (v2 SDK, 40+ event types)

```typescript
type Event =
  // Installation
  | EventInstallationUpdated        // { version }
  | EventInstallationUpdateAvailable // { version }

  // Project
  | EventProjectUpdated             // Project object

  // Server
  | EventServerInstanceDisposed     // { directory }
  | EventServerConnected            // {}
  | EventGlobalDisposed             // {}

  // LSP
  | EventLspClientDiagnostics       // { serverID, path }
  | EventLspUpdated                 // {}

  // Message streaming (the core streaming events)
  | EventMessagePartDelta           // { sessionID, messageID, partID, field, delta }
  | EventMessageUpdated             // { sessionID, info: Message }
  | EventMessageRemoved             // { sessionID, messageID }
  | EventMessagePartUpdated         // { sessionID, part: Part, time }
  | EventMessagePartRemoved         // { sessionID, messageID, partID }

  // Permissions
  | EventPermissionAsked            // PermissionRequest
  | EventPermissionReplied          // { sessionID, requestID, reply }

  // Session lifecycle
  | EventSessionStatus              // { sessionID, status: SessionStatus }
  | EventSessionIdle                // { sessionID }
  | EventSessionCreated             // { sessionID, info: Session }
  | EventSessionUpdated             // { sessionID, info: Session }
  | EventSessionDeleted             // { sessionID, info: Session }
  | EventSessionCompacted           // { sessionID }
  | EventSessionDiff                // { sessionID, diff: FileDiff[] }
  | EventSessionError               // { sessionID?, error? }

  // Questions
  | EventQuestionAsked              // QuestionRequest
  | EventQuestionReplied            // { sessionID, requestID, answers }
  | EventQuestionRejected           // { sessionID, requestID }

  // Todos
  | EventTodoUpdated                // { sessionID, todos: Todo[] }

  // File system
  | EventFileEdited                 // { file }
  | EventFileWatcherUpdated         // { file, event: "add" | "change" | "unlink" }

  // VCS
  | EventVcsBranchUpdated           // { branch? }

  // MCP
  | EventMcpToolsChanged            // { server }
  | EventMcpBrowserOpenFailed       // { mcpName, url }

  // Commands
  | EventCommandExecuted            // { name, sessionID, arguments, messageID }

  // Workspace
  | EventWorkspaceReady             // { name }
  | EventWorkspaceFailed            // { message }

  // PTY
  | EventPtyCreated                 // { info: Pty }
  | EventPtyUpdated                 // { info: Pty }
  | EventPtyExited                  // { id, exitCode }
  | EventPtyDeleted                 // { id }

  // Worktree
  | EventWorktreeReady              // { name, branch }
  | EventWorktreeFailed             // { message }

  // TUI (for plugins, not used by Broski)
  | EventTuiPromptAppend
  | EventTuiCommandExecute
  | EventTuiToastShow
  | EventTuiSessionSelect
```

### 4.3 The Three Core Streaming Events

During a prompt response, these events fire in sequence:

1. **`message.part.updated`** — A new part has been created or updated (text, tool, reasoning, etc.)
2. **`message.part.delta`** — An incremental text delta for a specific part
3. **`message.updated`** — The full message has been updated (tokens, cost, completion status)

The `message.part.delta` event structure:

```typescript
type EventMessagePartDelta = {
  type: "message.part.delta";
  properties: {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;   // which field changed, typically "text"
    delta: string;   // the incremental text
  };
};
```

---

## 5. Message & Content Types

### 5.1 Message Types

OpenCode has exactly two message roles:

```typescript
type UserMessage = {
  id: string;
  sessionID: string;
  role: "user";
  time: { created: number };
  agent: string;
  model: { providerID: string; modelID: string };
  system?: string;
  tools?: Record<string, boolean>;
  variant?: string;
  format?: OutputFormat;
  summary?: { title?: string; body?: string; diffs: FileDiff[] };
};

type AssistantMessage = {
  id: string;
  sessionID: string;
  role: "assistant";
  time: { created: number; completed?: number };
  error?: ProviderAuthError | UnknownError | MessageOutputLengthError
        | MessageAbortedError | StructuredOutputError | ContextOverflowError | ApiError;
  parentID: string;          // the user message this responds to
  modelID: string;
  providerID: string;
  mode: string;              // agent mode (e.g., "build", "plan")
  agent: string;             // agent name
  path: { cwd: string; root: string };
  summary?: boolean;         // true if this is a compaction summary
  cost: number;              // cumulative cost of this API call
  tokens: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  structured?: unknown;      // structured output for json_schema format
  variant?: string;
  finish?: string;           // finish reason (e.g., "stop", "length")
};
```

### 5.2 Part Types (Content Blocks)

Each message contains parts (like Claude's content blocks):

```typescript
type Part =
  | TextPart           // type: "text" — AI-generated text
  | SubtaskPart        // type: "subtask" — spawned sub-agent task
  | ReasoningPart      // type: "reasoning" — thinking/reasoning content
  | FilePart           // type: "file" — attached file (image, code)
  | ToolPart           // type: "tool" — tool invocation
  | StepStartPart      // type: "step-start" — agentic step boundary
  | StepFinishPart     // type: "step-finish" — step completion with tokens
  | SnapshotPart       // type: "snapshot" — filesystem snapshot for undo
  | PatchPart          // type: "patch" — file diff patch
  | AgentPart          // type: "agent" — agent switch marker
  | RetryPart          // type: "retry" — retry attempt marker
  | CompactionPart     // type: "compaction" — compaction marker
```

#### TextPart
```typescript
type TextPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
  synthetic?: boolean;     // generated by the system, not the model
  ignored?: boolean;       // should be ignored in context
  time?: { start: number; end?: number };
  metadata?: Record<string, unknown>;
};
```

#### ToolPart
```typescript
type ToolPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;         // unique tool call ID
  tool: string;           // tool name (e.g., "edit_file", "bash")
  state: ToolState;       // current state
  metadata?: Record<string, unknown>;
};
```

#### ReasoningPart
```typescript
type ReasoningPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;           // reasoning text
  metadata?: Record<string, unknown>;
  time: { start: number; end?: number };
};
```

#### StepFinishPart (per-step cost/token tracking)
```typescript
type StepFinishPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason: string;         // finish reason for this step
  snapshot?: string;      // filesystem snapshot reference
  cost: number;           // cost for this step
  tokens: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
};
```

---

## 6. Tool Use Flow

### 6.1 Tool State Machine

Tools progress through a state machine:

```
pending → running → completed
                  → error
```

```typescript
type ToolStatePending = {
  status: "pending";
  input: Record<string, unknown>;
  raw: string;             // raw input string
};

type ToolStateRunning = {
  status: "running";
  input: Record<string, unknown>;
  title?: string;          // human-readable title
  metadata?: Record<string, unknown>;
  time: { start: number };
};

type ToolStateCompleted = {
  status: "completed";
  input: Record<string, unknown>;
  output: string;          // tool output
  title: string;
  metadata: Record<string, unknown>;
  time: { start: number; end: number; compacted?: number };
  attachments?: FilePart[]; // attached files from tool execution
};

type ToolStateError = {
  status: "error";
  input: Record<string, unknown>;
  error: string;           // error message
  metadata?: Record<string, unknown>;
  time: { start: number; end: number };
};
```

### 6.2 Event Sequence for a Tool Call

1. **`message.part.updated`** with `part.type = "tool"`, `state.status = "pending"`
   - Tool call announced, input is known
2. **`message.part.updated`** with `state.status = "running"`
   - Tool is executing, may have `title` for UI
   - If tool requires permission → `permission.asked` event fires (see §7)
3. **`message.part.updated`** with `state.status = "completed"` or `state.status = "error"`
   - Tool finished, output or error available

### 6.3 Tool Introspection

```typescript
// List all tool IDs (including MCP tools)
const { data: ids } = await client.tool.ids({ directory });
// Returns: string[]  e.g. ["edit_file", "bash", "web_fetch", "mcp_tool_name"]

// List tools with full JSON schema parameters
const { data: tools } = await client.tool.list({
  provider: "anthropic",
  model: "claude-sonnet-4",
  directory
});
// Returns: ToolListItem[] = { id, description, parameters }
```

---

## 7. Permission System

### 7.1 Permission Categories

OpenCode has five permission categories:

| Permission        | Description                                    |
|-------------------|------------------------------------------------|
| `edit`            | File editing (write, create, delete)           |
| `bash`            | Shell command execution                        |
| `webfetch`        | Web fetching / HTTP requests                   |
| `doom_loop`       | Breaking out of stuck loops                    |
| `external_directory` | Accessing directories outside the project   |

Bash permissions can be granular per-command pattern:
```typescript
permission: {
  bash: {
    "*": "ask",                    // default: ask
    "npm test": "allow",          // auto-allow npm test
    "rm -rf *": "deny",           // always deny
  }
}
```

### 7.2 PermissionRequest Event

When a tool needs permission, the SDK emits:

```typescript
type PermissionRequest = {
  id: string;                // unique request ID
  sessionID: string;
  permission: string;        // permission category: "bash", "edit", etc.
  patterns: string[];        // what patterns match (e.g., file paths, commands)
  metadata: Record<string, unknown>;  // full context
  always: string[];          // available "always allow" patterns
  tool?: {
    messageID: string;
    callID: string;          // links to ToolPart.callID
  };
};
```

**Event:** `permission.asked` with `properties: PermissionRequest`

### 7.3 Responding to Permissions

```typescript
await client.permission.reply({
  requestID: "perm-abc",
  directory: "/project",
  reply: "once",            // "once" | "always" | "reject"
  message: "Optional note", // optional user message
});
```

**Responses:**
- `"once"` — Allow this one time
- `"always"` — Add to session permission rules (auto-allow future)
- `"reject"` — Deny the tool call

**Event after reply:** `permission.replied` → `{ sessionID, requestID, reply: "once" | "always" | "reject" }`

### 7.4 Permission Rulesets (Session-Level)

Sessions can have pre-configured permission rulesets:

```typescript
type PermissionRuleset = Array<{
  permission: string;    // "edit", "bash", etc.
  pattern: string;       // glob pattern
  action: "allow" | "deny" | "ask";
}>;
```

Set at session creation or via update:
```typescript
await client.session.create({
  directory,
  permission: [
    { permission: "edit", pattern: "*", action: "allow" },
    { permission: "bash", pattern: "npm *", action: "allow" },
    { permission: "bash", pattern: "*", action: "ask" },
  ],
});
```

### 7.5 Listing Pending Permissions

```typescript
const { data: pending } = await client.permission.list({ directory });
// Returns: PermissionRequest[]
```

---

## 8. User Input / Questions

### 8.1 The Question System

OpenCode has a dedicated "question" system for when the AI needs structured user input.
This is **separate from permissions** — questions are for multi-choice or free-text input
during tool execution (e.g., "Which option do you prefer?").

### 8.2 QuestionRequest Type

```typescript
type QuestionOption = {
  label: string;       // Display text (1-5 words)
  description: string; // Explanation of choice
};

type QuestionInfo = {
  question: string;    // Full question text
  header: string;      // Short label (max 30 chars)
  options: QuestionOption[];  // Available choices
  multiple?: boolean;  // Allow multi-select
  custom?: boolean;    // Allow free-text (default: true)
};

type QuestionRequest = {
  id: string;          // Unique request ID
  sessionID: string;
  questions: QuestionInfo[];  // One or more questions
  tool?: {
    messageID: string;
    callID: string;    // Links to the tool call that triggered this
  };
};
```

### 8.3 Question Events

**Emitted:** `question.asked` → `properties: QuestionRequest`

**Reply:**
```typescript
await client.question.reply({
  requestID: "q-abc",
  directory: "/project",
  answers: [["Option A", "Custom text"]],  // Array of arrays: one per question
});
```

**Reject (dismiss):**
```typescript
await client.question.reject({
  requestID: "q-abc",
  directory: "/project",
});
```

**Events after action:**
- `question.replied` → `{ sessionID, requestID, answers: string[][] }`
- `question.rejected` → `{ sessionID, requestID }`

### 8.4 Answer Format

Each question gets an array of selected answers:
```typescript
type QuestionAnswer = string[];

// For a single-select question: [["selected_label"]]
// For multi-select: [["label_a", "label_b"]]
// For free-text: [["custom user text"]]
// Multiple questions: [["answer_to_q1"], ["answer_to_q2"]]
```

### 8.5 Core Implementation

The question system in OpenCode core uses Effect-TS with deferred promises:

1. Tool calls `Question.ask()` with an array of `QuestionInfo`
2. A `QuestionRequest` is created with a unique ID and stored in pending state
3. `question.asked` event is emitted via the bus
4. The tool's execution is **suspended** via `Deferred.await()`
5. When `question.reply()` is called, the deferred resolves and the tool continues
6. When `question.reject()` is called, the deferred fails with `QuestionRejectedError`

---

## 9. Stop Reasons / Completion

### 9.1 AssistantMessage.finish

The `finish` field on `AssistantMessage` indicates why the response ended:

| Value        | Meaning                                             |
|--------------|-----------------------------------------------------|
| `"stop"`     | Normal completion (model decided to stop)           |
| `"length"`   | Hit output token limit                              |
| `undefined`  | Still in progress or no finish reason reported      |

### 9.2 Session Status Events

- **`session.status`** with `{ type: "busy" }` — Session is actively processing
- **`session.status`** with `{ type: "idle" }` — Session finished processing
- **`session.idle`** — Shorthand event for idle state
- **`session.status`** with `{ type: "retry", attempt, message, next }` — Retrying after error

### 9.3 Abort

```typescript
const { data: success } = await client.session.abort({ sessionID: id, directory });
// Returns: boolean
```

Abort emits `session.idle` or `session.status: idle` after the session stops. The
`AssistantMessage.error` may contain a `MessageAbortedError`:

```typescript
type MessageAbortedError = {
  name: "MessageAbortedError";
  data: { message: string };
};
```

---

## 10. Thinking / Reasoning

### 10.1 ReasoningPart

When models support extended thinking (e.g., Claude with reasoning enabled),
OpenCode emits `ReasoningPart` content:

```typescript
type ReasoningPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
  metadata?: Record<string, unknown>;
  time: { start: number; end?: number };
};
```

### 10.2 Streaming Reasoning

Reasoning content streams via the same `message.part.delta` and `message.part.updated`
events as regular text, but the part type is `"reasoning"`.

**Broski's mapper** (`opencode-runtime-event-mapper.ts`) tracks reasoning part IDs:

1. When a `message.part.updated` arrives with `part.type === "reasoning"`, the part ID
   is added to `ctx.reasoningPartIds`
2. Subsequent `message.part.delta` events for that part ID are emitted as
   `assistant_thinking_delta` instead of `assistant_text_delta`
3. The mapper computes incremental deltas from the full reasoning text to handle
   out-of-order delivery

### 10.3 How Reasoning Differs from Text

| Aspect              | TextPart                    | ReasoningPart                |
|---------------------|-----------------------------|------------------------------|
| `type`              | `"text"`                    | `"reasoning"`                |
| Displayed to user   | Always                      | Collapsible/hidden by default|
| Counted in tokens   | Yes (output)                | Yes (reasoning bucket)       |
| Has delta stream    | Yes (`message.part.delta`)  | Yes (`message.part.delta`)   |
| Runtime event       | `assistant_text_delta`      | `assistant_thinking_delta`   |

---

## 11. Error Handling

### 11.1 Error Types

OpenCode defines these typed errors on `AssistantMessage.error`:

```typescript
type ProviderAuthError = {
  name: "ProviderAuthError";
  data: { providerID: string; message: string };
};

type UnknownError = {
  name: "UnknownError";
  data: { message: string };
};

type MessageOutputLengthError = {
  name: "MessageOutputLengthError";
  data: Record<string, unknown>;
};

type MessageAbortedError = {
  name: "MessageAbortedError";
  data: { message: string };
};

type StructuredOutputError = {       // v2 only
  name: "StructuredOutputError";
  data: { message: string; retries: number };
};

type ContextOverflowError = {        // v2 only
  name: "ContextOverflowError";
  data: { message: string; responseBody?: string };
};

type ApiError = {
  name: "APIError";
  data: {
    message: string;
    statusCode?: number;
    isRetryable: boolean;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
    metadata?: Record<string, string>;
  };
};
```

### 11.2 Session Error Events

The `session.error` event fires when a session-level error occurs:

```typescript
type EventSessionError = {
  type: "session.error";
  properties: {
    sessionID?: string;
    error?: ProviderAuthError | UnknownError | ... | ApiError;
  };
};
```

### 11.3 Retry Mechanism

When an API call fails with a retryable error, OpenCode automatically retries:

- `session.status` with `{ type: "retry", attempt: N, message: "...", next: timestamp }`
- A `RetryPart` is added to the message
- The session continues after the retry succeeds

```typescript
type RetryPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "retry";
  attempt: number;
  error: ApiError;
  time: { created: number };
};
```

---

## 12. Image / File Input

### 12.1 Sending Images

Images are sent as `FilePartInput` with either data URLs or file URLs:

```typescript
// Base64 inline (from mobile app camera/gallery)
parts.push({
  type: "file",
  url: "data:image/png;base64,iVBORw0KGgoAAAA...",
  filename: "screenshot.png",
  mime: "image/png",
});

// File URL (local filesystem)
parts.push({
  type: "file",
  url: "file:///path/to/image.png",
  filename: "image.png",
  mime: "image/png",
});
```

### 12.2 File Attachments

Code files, directories, and other attachments:

```typescript
// Regular file
parts.push({
  type: "file",
  url: "file:///path/to/code.ts",
  filename: "code.ts",
  mime: "text/plain",
});

// Directory (special mime type)
parts.push({
  type: "file",
  url: "file:///path/to/src/",
  filename: "src/",
  mime: "inode/directory",
});
```

### 12.3 File Part Source Annotations

Files can have source annotations linking them to code locations:

```typescript
type FilePartSource =
  | { type: "file"; path: string; text: FilePartSourceText }     // file reference
  | { type: "symbol"; path: string; range: Range; name: string; kind: number; text: FilePartSourceText }  // symbol reference
  | { type: "resource"; clientName: string; uri: string; text: FilePartSourceText }  // MCP resource
```

---

## 13. Cost / Usage Tracking

### 13.1 Per-Message Token Tracking

Each `AssistantMessage` includes cost and token data:

```typescript
{
  cost: 0.0032,              // USD cost for this API call
  tokens: {
    total: 15000,            // total tokens (optional)
    input: 10000,            // input/prompt tokens
    output: 3000,            // output/completion tokens
    reasoning: 2000,         // reasoning/thinking tokens
    cache: {
      read: 5000,            // cache read tokens
      write: 8000,           // cache write tokens
    }
  }
}
```

### 13.2 Per-Step Token Tracking

`StepFinishPart` parts provide per-agentic-step cost breakdown:

```typescript
{
  type: "step-finish",
  reason: "stop",
  cost: 0.0012,
  tokens: {
    input: 5000,
    output: 1500,
    reasoning: 500,
    cache: { read: 3000, write: 4000 }
  }
}
```

### 13.3 Session Context Computation

Broski computes session context in `getSessionContext()`:

- **Total cost:** Sum of `cost` across all assistant messages
- **Context usage:** From the LAST assistant message's tokens (matches OpenCode TUI)
- **Context window:** Looked up from provider model list
- **Formula:** `contextTokens = input + output + reasoning + cache.read + cache.write`

---

## 14. Session Resume

### 14.1 Resuming a Session

To resume a previous session, simply send a new prompt to the same session ID:

```typescript
// Get existing session
const { data: session } = await client.session.get({
  sessionID: "ses-abc",
  directory: "/project"
});

// Send a new message to it
await client.session.prompt({
  sessionID: "ses-abc",
  directory: "/project",
  parts: [{ type: "text", text: "Continue with the next step" }],
});
```

### 14.2 Getting Session History

```typescript
const { data: messages } = await client.session.messages({
  sessionID: "ses-abc",
  directory: "/project",
  limit: 50,          // optional limit
  before: "msg-xyz",  // optional cursor for pagination
});
```

Returns an array of `{ info: Message, parts: Part[] }` objects, newest first.

### 14.3 Session Revert (Undo)

```typescript
// Revert to before a specific message
await client.session.revert({
  sessionID: "ses-abc",
  directory: "/project",
  messageID: "msg-xyz",
  partID: "part-123",   // optional: revert a specific tool call
});

// Undo the revert (restore)
await client.session.unrevert({
  sessionID: "ses-abc",
  directory: "/project",
});
```

---

## 15. Real-time Event Ordering

### 15.1 Typical Prompt → Response Event Sequence

```
1. User sends prompt via session.prompt()
2. session.status → { type: "busy" }
3. message.updated → UserMessage (the user's message is stored)
4. message.updated → AssistantMessage (initial, no tokens yet)
5. message.part.updated → ReasoningPart (if model supports reasoning)
6. message.part.delta → { field: "text", delta: "..." } (reasoning stream)
7. message.part.updated → TextPart (AI's text response starts)
8. message.part.delta → { field: "text", delta: "..." } (text stream)
9. message.part.updated → ToolPart { state: { status: "pending" } }
10. [if permission needed] permission.asked → PermissionRequest
11. [after permission] permission.replied → { reply: "once" }
12. message.part.updated → ToolPart { state: { status: "running" } }
13. message.part.updated → ToolPart { state: { status: "completed" } }
14. message.part.updated → StepFinishPart (step tokens/cost)
15. [loop back to step 7 if more steps needed]
16. message.updated → AssistantMessage (final, with tokens/cost/finish)
17. session.status → { type: "idle" }  or  session.idle
```

### 15.2 Retry Sequence

```
1. session.status → { type: "retry", attempt: 1, message: "Rate limited", next: 1711900000 }
2. message.part.updated → RetryPart { attempt: 1, error: ApiError }
3. [wait until `next` timestamp]
4. session.status → { type: "busy" }
5. [normal response continues]
```

### 15.3 Question Interruption Sequence

```
1. Tool is executing → message.part.updated → ToolPart { status: "running" }
2. Tool needs input → question.asked → QuestionRequest
3. [session stays "busy" while waiting]
4. User replies → question.replied
5. Tool continues → message.part.updated → ToolPart { status: "completed" }
```

---

## 16. The v2 SDK API

### 16.1 v2 vs v1 Differences

Broski uses `@opencode-ai/sdk/v2`. Key differences from v1:

| Aspect                   | v1 SDK                           | v2 SDK                                    |
|--------------------------|----------------------------------|-------------------------------------------|
| Import path              | `@opencode-ai/sdk`               | `@opencode-ai/sdk/v2`                     |
| Session ID param         | `id: string`                     | `sessionID: string` (capital ID)          |
| Permission API           | `postSessionIdPermissionsPermissionId()` | `permission.reply()` + `permission.list()` |
| Question API             | Not available                    | `question.list()`, `question.reply()`, `question.reject()` |
| Workspace support        | Not available                    | `experimental.workspace.*`, `x-opencode-workspace` header |
| Output format            | Not available                    | `OutputFormat` type with `json_schema`    |
| Event stream             | `global.event()`                 | `global.event()` (same, more event types) |
| Session slug             | Not available                    | `session.slug` field                      |
| Session archived         | Not available                    | `session.time.archived`                   |
| Agent part               | No `model` field                 | Has `model` and `command` fields          |
| Error types              | Basic errors                     | + `StructuredOutputError`, `ContextOverflowError` |
| Client config            | `{ directory }`                  | `{ directory, experimental_workspaceID }` |

### 16.2 v2 Method Signatures

All v2 methods follow this pattern:
```typescript
const { data } = await client.namespace.method({
  // All parameters in a single object
  sessionID: "...",
  directory: "...",
  // ... other params
});
```

The `data` field is the typed response. Error responses throw.

### 16.3 Directory Routing

v2 supports routing requests to specific project instances:

```typescript
// Via client config (applies to all requests)
const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  directory: "/path/to/project",            // sent as x-opencode-directory header
  experimental_workspaceID: "ws-abc",       // sent as x-opencode-workspace header
});

// Via per-request parameter (overrides client-level)
const { data } = await client.session.list({ directory: "/other/project" });
```

For GET/HEAD requests, the SDK interceptor moves the directory from headers to query params.

---

## 17. Our Connector Implementation

### 17.1 `OpenCodeConnector` Class

**File:** `packages/bridge/src/connectors/opencode.ts` (1825 lines)

The connector wraps the SDK client and maps SDK types to Broski wire types:

```typescript
class OpenCodeConnector {
  private client: OpencodeClient;
  private baseUrl: string;
  private sessionCache: Map<string, { data: SessionSummary[]; fetchedAt: number }>;

  constructor(options?: { baseUrl?: string; client?: OpencodeClient });
  updateBaseUrl(newBaseUrl: string): void;
  get url(): string;

  // Health
  async isRunning(): Promise<boolean>;
  async getInstanceDirectory(): Promise<string | null>;
  async getHealth(): Promise<{ healthy: boolean; version: string } | null>;

  // Sessions
  async listSessions(directory?: string, options?: OpenCodeSessionListOptions): Promise<SessionSummary[]>;
  async createSession(directory?: string, title?: string, permission?: PermissionRuleset, workspaceID?: string): Promise<SessionSummary>;
  async getSession(sessionId: string, directory?: string): Promise<SessionSummary>;
  async deleteSession(sessionId: string, directory?: string): Promise<boolean>;
  async updateSession(sessionId: string, title?: string, archived?: boolean, directory?: string): Promise<SessionSummary>;
  async forkSession(sessionId: string, messageId?: string, directory?: string): Promise<SessionSummary>;
  async listSessionChildren(sessionId: string, directory?: string): Promise<SessionSummary[]>;

  // Messaging
  async sendPrompt(sessionId: string, content: string, directory?: string, messageId?: string, model?, agent?, fileAttachments?, variant?, noReply?, system?): Promise<unknown>;
  async sendPromptAsync(sessionId: string, content: string, ...): Promise<unknown>;
  async getSessionMessages(sessionId: string, directory?: string, limit?: number, before?: string): Promise<unknown>;
  async abortSession(sessionId: string, directory?: string): Promise<boolean>;

  // Permissions & Questions
  async respondToPermission(requestId: string, response: "once" | "always" | "reject", message?: string, directory?: string): Promise<boolean>;
  async listPendingPermissions(directory?: string): Promise<OpenCodePermissionRequest[]>;
  async listPendingQuestions(directory?: string): Promise<OpenCodeQuestionRequest[]>;
  async replyToQuestion(requestId: string, answers: string[][], directory?: string): Promise<boolean>;
  async rejectQuestion(requestId: string, directory?: string): Promise<boolean>;

  // Event streaming
  async startEventStream(onEvent: (event: GlobalEvent) => void): Promise<AbortController>;

  // ... 50+ more methods for MCP, PTY, VCS, files, tools, providers, etc.
}
```

### 17.2 Session Caching

The connector caches session lists with a 5-second TTL to prevent redundant fetches
during rapid UI updates. Extracted into `connectors/opencode/session-list.ts`.

### 17.3 Event Stream Setup

```typescript
async startEventStream(onEvent: (event: GlobalEvent) => void): Promise<AbortController> {
  const controller = new AbortController();
  const { stream } = await this.client.global.event({ signal: controller.signal });

  void (async () => {
    for await (const event of stream) {
      onEvent(event);
    }
  })();

  return controller;
}
```

The bridge calls this once at startup and routes events through the runtime mapper.

---

## 18. Our Wire Protocol

### 18.1 Legacy Protocol (Deprecated)

Previously, OpenCode SDK events were forwarded directly:

```json
{ "type": "sdk_event", "data": { "directory": "...", "payload": { "type": "message.part.delta", ... } } }
{ "type": "sdk_event_batch", "data": [ ... ] }
```

### 18.2 Phase 4: Unified Runtime Protocol

As of Phase 4, OpenCode events are mapped through the **runtime abstraction layer**
and sent as `runtime_event` messages:

```json
{
  "type": "runtime_event",
  "backend": "opencode",
  "data": {
    "type": "assistant_text_delta",
    "backend": "opencode",
    "timestampMs": 1711900000000,
    "sessionId": "ses-abc",
    "cwd": "/project",
    "delta": "Here is the fix...",
    "seq": 42
  }
}
```

### 18.3 Runtime Event Types (mapped from SDK events)

| SDK Event                    | Runtime Event Type               | What it carries                          |
|------------------------------|----------------------------------|------------------------------------------|
| `session.status` (busy)     | `session_state_changed`          | `state: BroskiRuntimeState`              |
| `session.status` (idle)     | `session_state_changed`          | `state: { isStreaming: false }`          |
| `session.idle`              | `session_state_changed`          | `state: { isStreaming: false }`          |
| `message.part.delta` (text) | `assistant_text_delta`           | `delta: string`                          |
| `message.part.delta` (reasoning) | `assistant_thinking_delta`  | `delta: string`                          |
| `message.part.updated` (reasoning) | `assistant_thinking_delta` | `delta: string` (computed)             |
| `message.part.updated` (tool, pending/running) | `tool_started` or `tool_updated` | `toolName, input, partialOutput` |
| `message.part.updated` (tool, completed/error) | `tool_finished` | `toolName, input, output, isError`     |
| `permission.asked`          | `permission_requested`           | `request: BroskiPermissionRequest`       |
| `question.asked`            | `user_input_requested`           | `request: BroskiUserInputRequest`        |
| `session.error`             | `error`                          | `message, code, details`                 |
| Other events                | `backend_event`                  | `kind: string, payload: unknown`         |

### 18.4 BroskiRuntimeState (Session State)

```typescript
type BroskiRuntimeState = {
  backend: "opencode";
  sessionId?: string;
  cwd?: string;
  isStreaming: boolean;       // true when busy
  isCompacting: boolean;      // true during compaction
  isRetrying: boolean;        // true during retry
  capabilities: {
    canStreamText: true,
    canStreamThinking: true,
    canUseTools: true,
    canPrompt: true,
    canAbort: true,
    canSwitchModel: true,
    canListSessions: true,
    canReadTranscript: true,
    canForkSession: true,
    canCompact: true,
    canRetry: true,
    canRequestUserInput: true,
    canRequestPermissions: true,
    backendExtras: ["workspace-metadata", "todos", "projects"],
  };
};
```

### 18.5 Request Messages (Flutter → Bridge)

Key request message types for OpenCode:

```typescript
// Session management
{ type: "list_sessions", projectPath?, roots?, start?, cursor?, search?, limit?, archived? }
{ type: "create_session", projectPath?, title?, permission?, workspaceID? }
{ type: "get_session", sessionId, projectPath? }
{ type: "delete_session", sessionId, projectPath? }
{ type: "update_session", sessionId, title?, archived?, projectPath? }
{ type: "fork_session", sessionId, messageId?, projectPath? }

// Messaging
{ type: "chat", sessionId, content, projectPath?, model?, agent?, fileAttachments?, variant?, noReply?, system?, format? }
{ type: "abort", sessionId, projectPath? }

// Permissions & Questions
{ type: "permission_response", sessionId, permissionId, response, message?, projectPath? }
{ type: "oc_question_reply", questionId, answers: string[][], projectPath? }
{ type: "oc_question_reject", questionId, projectPath? }

// Session features
{ type: "get_session_messages", sessionId, projectPath?, limit?, before? }
{ type: "summarize_session", sessionId, providerID, modelID, projectPath?, auto? }
{ type: "revert_message", sessionId, messageId, partId?, projectPath? }
{ type: "share_session", sessionId, projectPath? }
{ type: "diff", sessionId, projectPath?, messageId? }

// Other
{ type: "get_session_context", sessionId, projectPath? }
{ type: "get_session_status", projectPath? }
{ type: "list_commands", projectPath? }
{ type: "list_agents", projectPath? }
{ type: "get_config", projectPath? }
{ type: "list_providers", projectPath? }
```

---

## 19. Known Differences from Claude Code

| Feature                    | OpenCode                               | Claude Code                              |
|----------------------------|----------------------------------------|------------------------------------------|
| **Architecture**           | REST API + SSE event stream            | Embedded SDK, in-process streaming       |
| **Streaming**              | Global SSE stream at `/global/event`   | Per-session streaming via SDK callbacks  |
| **Permission model**       | `permission.asked` events + `permission.reply()` | `tool_use_permission` events + callback |
| **User input (questions)** | Dedicated `question.*` system          | `AskUserQuestion` tool                   |
| **Multi-agent**            | Built-in agent system (build, plan, explore, custom) | Subagents via SDK                |
| **Model switching**        | Dynamic via provider system            | Model aliases (sonnet/opus/haiku)        |
| **Session persistence**    | Built-in (SQLite-backed)               | Built-in (filesystem-backed)             |
| **Tool state machine**     | pending → running → completed/error    | SDK content blocks, simpler flow         |
| **Thinking**               | `ReasoningPart` with delta streaming   | `thinking` content blocks                |
| **Cost tracking**          | Per-message + per-step                 | Per-session aggregate                    |
| **MCP servers**            | Built-in management API                | Config-file based                        |
| **PTY terminals**          | Built-in API                           | Not available                            |
| **LSP integration**        | Built-in                               | Not available                            |
| **File watching**          | Built-in                               | Not available                            |
| **Formatter integration**  | Built-in                               | Not available                            |
| **Workspaces/Worktrees**   | Built-in experimental API              | Not available                            |
| **Todos/Plans**            | Built-in API                           | Not available                            |
| **Slash commands**         | Built-in command system                | Not available (CLI commands only)        |

### 19.1 Key Architectural Difference

**OpenCode:** The SDK talks to a separate server process via HTTP. Events come through
a single SSE stream. The bridge starts an event stream listener at startup and routes
events to connected clients.

**Claude Code:** The SDK runs in-process. Each session is a streaming conversation
managed by the SDK. Events come through callbacks on the SDK session object.

### 19.2 Session Ownership

In Broski's bridge, OpenCode has an "ownership" model for sessions:

- When Broski sends a prompt, it records the session as "owned" by that client
- While owned, the external polling tail (for TUI-initiated events) is paused
- When `session.idle` fires, ownership is released
- This prevents duplicate event delivery when both Broski and the TUI are running

---

## 20. Permission & Question Handling Details

### 20.1 Full Permission Flow (End-to-End)

```
Flutter App                    Bridge                         OpenCode Server
    |                            |                                |
    |  chat { sessionId, ... }   |                                |
    |-------------------------->|  connector.sendPrompt()        |
    |                            |------------------------------->|
    |                            |                                |
    |                            |  [SSE: session.status: busy]  |
    |  runtime_event:            |<-------------------------------|
    |  session_state_changed     |                                |
    |<--------------------------|                                |
    |                            |                                |
    |                            |  [SSE: permission.asked]      |
    |  runtime_event:            |<-------------------------------|
    |  permission_requested      |                                |
    |<--------------------------|                                |
    |                            |                                |
    |  permission_response       |                                |
    |  { permissionId, "once" }  |                                |
    |-------------------------->|  connector.respondToPermission()|
    |                            |------------------------------->|
    |                            |                                |
    |                            |  [SSE: permission.replied]    |
    |  runtime_event:            |<-------------------------------|
    |  backend_event             |                                |
    |<--------------------------|                                |
    |                            |                                |
    |                            |  [SSE: tool completed]        |
    |  runtime_event:            |<-------------------------------|
    |  tool_finished             |                                |
    |<--------------------------|                                |
```

### 20.2 Full Question Flow (End-to-End)

```
Flutter App                    Bridge                         OpenCode Server
    |                            |                                |
    |                            |  [SSE: question.asked]        |
    |  runtime_event:            |<-------------------------------|
    |  user_input_requested      |                                |
    |<--------------------------|                                |
    |                            |                                |
    |  oc_question_reply         |                                |
    |  { questionId, answers }   |                                |
    |-------------------------->|  connector.replyToQuestion()   |
    |                            |------------------------------->|
    |                            |                                |
    |                            |  [SSE: question.replied]      |
    |  runtime_event:            |<-------------------------------|
    |  backend_event             |                                |
    |<--------------------------|                                |
```

### 20.3 Permission Mapper Details

The runtime event mapper maps `permission.asked` events:

```typescript
case "permission.asked":
case "permission.updated": {
  return {
    type: "permission_requested",
    backend: "opencode",
    sessionId: permissionSessionId,
    request: {
      requestId: properties.id,           // the permission request ID
      kind: properties.permission,        // "bash", "edit", "webfetch", etc.
      title: properties.title || "Permission required",
      metadata: properties,               // full PermissionRequest object
    },
  };
}
```

### 20.4 Question Mapper Details

```typescript
case "question.asked": {
  return {
    type: "user_input_requested",
    backend: "opencode",
    sessionId,
    request: {
      requestId: properties.id,
      kind: "question",
      title: properties.title || "Input required",
      prompt: properties.prompt || properties.message,
      options: properties.options?.map(String),
      metadata: properties,               // full QuestionRequest object
    },
  };
}
```

### 20.5 Pending Permissions/Questions on Reconnect

When the Flutter app reconnects, it can query for any pending requests:

```typescript
// Bridge handles these
{ type: "list_pending_permissions", projectPath? }  → { type: "pending_permissions", data: PermissionRequest[] }
{ type: "list_pending_questions", projectPath? }    → { type: "pending_questions", data: QuestionRequest[] }
```

This ensures the app doesn't miss permission/question prompts that arrived while disconnected.

---

## Appendix A: OpenCode Configuration

The `Config` type defines the full OpenCode configuration:

```typescript
type Config = {
  theme?: string;
  keybinds?: KeybindsConfig;
  logLevel?: "DEBUG" | "INFO" | "WARN" | "ERROR";
  model?: string;              // format: "provider/model"
  small_model?: string;        // for title generation
  username?: string;
  agent?: {
    plan?: AgentConfig;
    build?: AgentConfig;
    general?: AgentConfig;
    explore?: AgentConfig;
    [key: string]: AgentConfig;
  };
  provider?: Record<string, ProviderConfig>;
  mcp?: Record<string, McpLocalConfig | McpRemoteConfig>;
  permission?: {
    edit?: "ask" | "allow" | "deny";
    bash?: "ask" | "allow" | "deny" | Record<string, "ask" | "allow" | "deny">;
    webfetch?: "ask" | "allow" | "deny";
  };
  tools?: Record<string, boolean>;
  share?: "manual" | "auto" | "disabled";
  snapshot?: boolean;
  experimental?: {
    hook?: { file_edited?, session_completed? };
    chatMaxRetries?: number;
    batch_tool?: boolean;
  };
  // ... more fields
};
```

## Appendix B: Agent System

OpenCode has a built-in multi-agent system:

```typescript
type Agent = {
  name: string;              // e.g., "build", "plan", "explore"
  description?: string;
  mode: "primary" | "subagent" | "all";
  builtIn: boolean;          // true for native agents
  color?: string;            // hex color for UI
  topP?: number;
  temperature?: number;
  permission: {              // per-agent permission overrides
    edit: "ask" | "allow" | "deny";
    bash: Record<string, "ask" | "allow" | "deny">;
  };
  model?: { modelID: string; providerID: string };  // model override
  prompt?: string;           // custom system prompt
  tools: Record<string, boolean>;  // tool enable/disable
  options: Record<string, unknown>;
  maxSteps?: number;         // max agentic iterations
};
```

The default agents are:
- **build** (primary) — Main coding agent, full tool access
- **plan** (primary) — Planning agent, read-only tools
- **explore** (subagent) — Code exploration
- **general** (subagent) — General purpose

## Appendix C: PTY Terminal Integration

OpenCode provides first-class PTY (pseudo-terminal) support:

```typescript
type Pty = {
  id: string;
  title: string;
  command: string;
  args: string[];
  cwd: string;
  status: "running" | "exited";
  pid: number;
};
```

PTY I/O uses WebSocket at `/pty/{id}/connect` — the bridge proxies this
to the Flutter app via its own WebSocket messages.

PTY lifecycle events:
- `pty.created` → `{ info: Pty }`
- `pty.updated` → `{ info: Pty }`
- `pty.exited` → `{ id, exitCode }`
- `pty.deleted` → `{ id }`

---

*End of OpenCode Architecture Document*
