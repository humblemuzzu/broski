# Pi Backend Architecture — Deep Reference

> Last updated: 2026-03-31
> Source of truth: `reference/pi-mono/`, `packages/bridge/src/connectors/pi.ts` + `connectors/pi/`, `packages/bridge/src/handlers/pi_features.ts` + `handlers/pi_*.ts`
>
> **SDK note (2026):** the Pi SDK moved from the `@mariozechner/*` scope to `@earendil-works/pi-coding-agent|pi-ai|pi-agent-core`, pinned with `chord` and `pi-durable` at **1.4.0**, and the removed `AuthStorage` / `ModelRegistry` were replaced by `ModelRuntime`. Where a section below still names the old scope or `ModelRegistry`, read it as the historical API — the bridge uses `ModelRuntime` (`connectors/pi/pi-model-runtime.ts`). The connector and handler were also split: `connectors/pi.ts` is now a 41-line facade over `connectors/pi/` (32 modules), and `handlers/pi_features.ts` is a 48-line router over `handlers/pi_*.ts`. Sections 22 and 25 list the functions and messages, which still exist, spread across those modules.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Package Structure — Pi Monorepo](#2-package-structure--pi-monorepo)
3. [The Agent Core (`pi-agent-core`)](#3-the-agent-core-pi-agent-core)
4. [The AI Layer (`pi-ai`)](#4-the-ai-layer-pi-ai)
5. [The Coding Agent (`pi-coding-agent`)](#5-the-coding-agent-pi-coding-agent)
6. [AgentSession — The Core Session Class](#6-agentsession--the-core-session-class)
7. [AgentSessionEvent — Every Event Type](#7-agentsessionevent--every-event-type)
8. [Sending a Prompt — The Full API](#8-sending-a-prompt--the-full-api)
9. [Streaming Response Flow — Event Sequence](#9-streaming-response-flow--event-sequence)
10. [Content Types — Text, Thinking, Tool Calls, Tool Results](#10-content-types--text-thinking-tool-calls-tool-results)
11. [Tool System](#11-tool-system)
12. [Extension UI System](#12-extension-ui-system)
13. [Permission System — beforeToolCall / afterToolCall](#13-permission-system--beforetoolcall--aftertoolcall)
14. [ModelRuntime — Model Discovery and Selection](#14-modelruntime--model-discovery-and-selection)
15. [Thinking / Reasoning Levels](#15-thinking--reasoning-levels)
16. [Error Handling and Auto-Retry](#16-error-handling-and-auto-retry)
17. [Compaction — Context Window Management](#17-compaction--context-window-management)
18. [Image / File Input](#18-image--file-input)
19. [Cost / Usage Tracking](#19-cost--usage-tracking)
20. [Session Management](#20-session-management)
21. [Steering and Follow-Up Messages](#21-steering-and-follow-up-messages)
22. [Our Bridge Connector — `connectors/pi.ts`](#22-our-bridge-connector--connectorspits)
23. [Our Extension UI Bridge — `pi_extension_ui.ts`](#23-our-extension-ui-bridge--pi_extension_uits)
24. [Our Wire Protocol — `PiStreamMessage`](#24-our-wire-protocol--pistreammessage)
25. [Our Handler — `handlers/pi_features.ts`](#25-our-handler--handlerspi_featurests)
26. [Our Flutter / Dart Side](#26-our-flutter--dart-side)
27. [Runtime Event Mapping](#27-runtime-event-mapping)
28. [Event Flow Diagram — Prompt to Completion](#28-event-flow-diagram--prompt-to-completion)
29. [External Session Tailing](#29-external-session-tailing)
30. [Bash Execution](#30-bash-execution)
31. [Session Tree — Forking and Navigation](#31-session-tree--forking-and-navigation)

---

## 1. Architecture Overview

Pi is a modular AI coding agent built as a TypeScript monorepo at `reference/pi-mono/`. Broski integrates Pi as one of its supported backends alongside Claude Code, OpenCode, and Codex.

The data flow from the user's phone to Pi and back:

```
Flutter App  ←→  WebSocket  ←→  Bridge Server  ←→  Pi SDK (in-process)  ←→  LLM API
```

Pi runs **in-process** within the bridge — there is no separate Pi process. The bridge imports `@earendil-works/pi-coding-agent` directly (through the `connectors/pi/` modules), creates `AgentSession` instances, and subscribes to their event streams.

### Key architectural decisions:

- **Event-driven**: Pi emits a stream of `AgentSessionEvent` objects. The bridge subscribes to these events, translates them to `PiStreamMessage` wire format, then maps those to normalized `BroskiRuntimeEvent` objects broadcast to clients.
- **Extension-first permissions**: Pi is "yolo" by default — all tools execute without asking. Permission checks are added via extensions that hook `beforeToolCall`.
- **Multi-model**: Pi supports any LLM provider via its `pi-ai` abstraction. Models and credentials come from a `ModelRuntime` (`ModelRuntime.create()`), which reads the agent dir (`~/.pi/agent/auth.json`, `models.json`) and covers both API keys and OAuth/subscription logins.
- **Session persistence**: Every message is written to a JSONL file. Sessions can be resumed, forked, and navigated as a tree.

---

## 2. Package Structure — Pi Monorepo

```
reference/pi-mono/
├── packages/
│   ├── agent/           ← pi-agent-core: low-level Agent class + agent loop
│   ├── ai/              ← pi-ai: LLM abstraction layer (models, streaming, providers)
│   ├── coding-agent/    ← pi-coding-agent: high-level AgentSession, tools, extensions, SDK
│   ├── tui/             ← pi-tui: Terminal UI components (not used by Broski)
│   ├── web-ui/          ← Web UI frontend (not used by Broski)
│   ├── mom/             ← Multi-agent orchestration (not used by Broski directly)
│   └── pods/            ← Pod/container tooling (not used by Broski directly)
├── scripts/
├── biome.json
├── tsconfig.base.json
└── package.json
```

**Packages used by Broski bridge:**
- `@earendil-works/pi-agent-core` — `Agent`, `AgentEvent`, `AgentMessage`, `AgentTool`, `ThinkingLevel`
- `@earendil-works/pi-ai` — `Model`, `streamSimple`, `AssistantMessage`, `AssistantMessageEvent`, content types
- `@earendil-works/pi-coding-agent` — `AgentSession`, `createAgentSession`, `SessionManager`, `ModelRuntime`, `SettingsManager`, `DefaultResourceLoader`, tools, extensions

---

## 3. The Agent Core (`pi-agent-core`)

**Package:** `packages/agent/src/`

### Agent Class (`agent.ts`)

The `Agent` is the low-level execution engine. It holds:

```typescript
interface AgentState {
  systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool<any>[];
  messages: AgentMessage[];        // Full conversation history
  isStreaming: boolean;
  streamMessage: AgentMessage | null;  // Partial message during streaming
  pendingToolCalls: Set<string>;
  error?: string;
}
```

**Key methods:**

| Method | Purpose |
|--------|---------|
| `prompt(input)` | Start a new conversation turn. Accepts string, AgentMessage, or AgentMessage[] |
| `continue()` | Resume from current context (retries, queued messages) |
| `steer(message)` | Queue a message for injection between tool calls |
| `followUp(message)` | Queue a message for after the agent finishes |
| `abort()` | Cancel current operation via AbortController |
| `waitForIdle()` | Returns a promise that resolves when agent finishes |
| `subscribe(fn)` | Listen to AgentEvent stream. Returns unsubscribe function |
| `reset()` | Clear all state |

### AgentMessage Type

```typescript
type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
// Where Message = UserMessage | AssistantMessage | ToolResultMessage
```

Messages are the union of standard LLM messages plus custom messages added via declaration merging. The coding-agent adds `BashExecutionMessage`, `CustomMessage`, `BranchSummaryMessage`, and `CompactionSummaryMessage`.

### AgentEvent Type

```typescript
type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };
```

### The Agent Loop (`agent-loop.ts`)

The agent loop is the core execution cycle:

```
runAgentLoop(prompts, context, config, signal)
  ├── emit: agent_start
  ├── emit: turn_start
  ├── emit: message_start (for each prompt message)
  ├── emit: message_end (for each prompt message)
  └── runLoop():
       ├── OUTER LOOP (follow-ups):
       │   ├── INNER LOOP (tool calls + steering):
       │   │   ├── emit: turn_start (if not first turn)
       │   │   ├── Process pending steering messages (emit message_start/end for each)
       │   │   ├── streamAssistantResponse() → AssistantMessage
       │   │   │   ├── emit: message_start (partial)
       │   │   │   ├── emit: message_update (for each streaming event)
       │   │   │   └── emit: message_end (final)
       │   │   ├── If error/aborted: emit turn_end, agent_end, return
       │   │   ├── If tool calls:
       │   │   │   ├── executeToolCalls() (parallel or sequential)
       │   │   │   │   ├── emit: tool_execution_start
       │   │   │   │   ├── prepareToolCall() → beforeToolCall hook
       │   │   │   │   ├── executePreparedToolCall()
       │   │   │   │   │   ├── emit: tool_execution_update (partial results)
       │   │   │   │   │   └── emit: tool_execution_end
       │   │   │   │   ├── finalizeExecutedToolCall() → afterToolCall hook
       │   │   │   │   └── emit: message_start, message_end (toolResult)
       │   │   │   └── Add results to context
       │   │   ├── emit: turn_end
       │   │   └── Poll getSteeringMessages() → loop if messages
       │   └── Poll getFollowUpMessages() → continue outer loop if messages
       └── emit: agent_end
```

### Tool Execution Modes

```typescript
type ToolExecutionMode = "sequential" | "parallel";
```

- **`"parallel"` (default)**: Tool calls are prepared sequentially (so `beforeToolCall` runs in order), then allowed tools execute concurrently. Results are still emitted in source order.
- **`"sequential"`**: Each tool call is fully prepared, executed, and finalized before the next.

### AgentTool Interface

```typescript
interface AgentTool<TParameters extends TSchema, TDetails = any> extends Tool<TParameters> {
  label: string;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}

interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];  // Result content
  details: T;                                // Tool-specific structured details
}
```

---

## 4. The AI Layer (`pi-ai`)

**Package:** `packages/ai/src/`

### Content Types

```typescript
interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}

interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;  // Safety filter redaction
}

interface ImageContent {
  type: "image";
  data: string;      // base64 encoded
  mimeType: string;  // "image/jpeg", "image/png", etc.
}

interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;  // Google-specific
}
```

### AssistantMessage

```typescript
interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: Provider;
  model: string;
  responseId?: string;
  usage: Usage;
  stopReason: StopReason;  // "stop" | "length" | "toolUse" | "error" | "aborted"
  errorMessage?: string;
  timestamp: number;
}
```

### Usage / Cost Tracking

```typescript
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

### AssistantMessageEvent (Streaming Protocol)

These are the raw streaming events from the LLM provider:

```typescript
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: "done"; reason: "stop" | "length" | "toolUse"; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

### Model Interface

```typescript
interface Model<TApi extends Api> {
  id: string;
  name: string;
  api: TApi;                    // "anthropic-messages", "openai-responses", etc.
  provider: Provider;           // "anthropic", "openai", "google", etc.
  baseUrl: string;
  reasoning: boolean;           // Supports thinking/reasoning?
  input: ("text" | "image")[];  // Supported input modalities
  cost: { input, output, cacheRead, cacheWrite };  // $/million tokens
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: OpenAICompletionsCompat | OpenAIResponsesCompat;
}
```

### Supported APIs

Pi supports these LLM API protocols:
- `anthropic-messages` — Anthropic Claude
- `openai-completions` — OpenAI-compatible completions
- `openai-responses` — OpenAI responses API
- `openai-codex-responses` — Codex-specific
- `google-generative-ai` — Google Gemini
- `google-vertex` — Vertex AI
- `bedrock-converse-stream` — AWS Bedrock
- `mistral-conversations` — Mistral
- And others (Azure, xAI, Groq, etc.)

### streamSimple()

The core function that calls LLM providers:

```typescript
function streamSimple<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream;
```

The `SimpleStreamOptions` adds `reasoning?: ThinkingLevel` and `thinkingBudgets` on top of base `StreamOptions`.

---

## 5. The Coding Agent (`pi-coding-agent`)

**Package:** `packages/coding-agent/src/`

This is the high-level package that ties everything together. Key exports:

```typescript
// Session management
export { AgentSession, AgentSessionEvent, createAgentSession };
export { SessionManager, SessionInfo };

// Auth and models
export { ModelRuntime };  // replaced the removed AuthStorage / ModelRegistry

// Settings
export { SettingsManager };

// Resources (skills, prompts, context files, extensions)
export { DefaultResourceLoader };

// Tools
export { createCodingTools, createBashTool, createEditTool, createReadTool, createWriteTool, ... };

// Extensions
export { ExtensionRunner, ExtensionUIContext, ExtensionFactory, ... };

// Version
export { VERSION };
```

### createAgentSession() — The Factory Function

This is what the bridge calls to create Pi instances:

```typescript
async function createAgentSession(options: CreateAgentSessionOptions): Promise<CreateAgentSessionResult>;

interface CreateAgentSessionOptions {
  cwd?: string;
  agentDir?: string;
  modelRuntime?: ModelRuntime;
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
  scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;
  tools?: Tool[];
  customTools?: ToolDefinition[];
  resourceLoader?: ResourceLoader;
  sessionManager?: SessionManager;
  settingsManager?: SettingsManager;
}
```

What it does:
1. Creates/loads `ModelRuntime`, `SettingsManager`, `SessionManager`
2. Creates `DefaultResourceLoader` and loads skills, prompts, context files, extensions
3. Resolves the model (from options, session restore, or settings default)
4. Creates an `Agent` instance with `convertToLlm`, `streamFn`, `transformContext`
5. Restores messages if resuming a session
6. Creates `AgentSession` wrapping the `Agent`
7. Discovers and loads extensions

### Built-in Tools

Pi ships with these coding tools:

| Tool | Description |
|------|-------------|
| `read` | Read file contents |
| `bash` | Execute shell commands |
| `edit` | Edit files with diff-based patches |
| `write` | Write complete files |
| `grep` | Search file contents |
| `find` | Find files by pattern |
| `ls` | List directory contents |

Default active set: `[read, bash, edit, write]`

---

## 6. AgentSession — The Core Session Class

**File:** `packages/coding-agent/src/core/agent-session.ts` (3269 lines)

`AgentSession` wraps `Agent` and adds:
- Session persistence (JSONL)
- Extension system integration
- Model and thinking level management
- Compaction (manual and automatic)
- Bash execution
- Session switching and forking (tree)
- Auto-retry on errors

### Key Properties

```typescript
class AgentSession {
  readonly agent: Agent;
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;

  // Read-only state accessors
  get model(): Model<any> | undefined;
  get thinkingLevel(): ThinkingLevel;
  get isStreaming(): boolean;
  get isCompacting(): boolean;
  get isRetrying(): boolean;
  get sessionFile(): string | undefined;
  get sessionId(): string;
  get sessionName(): string | undefined;
  get messages(): AgentMessage[];
  get steeringMode(): "all" | "one-at-a-time";
  get followUpMode(): "all" | "one-at-a-time";
  get pendingMessageCount(): number;
  get retryAttempt(): number;
  get autoCompactionEnabled(): boolean;
  get autoRetryEnabled(): boolean;
  get isBashRunning(): boolean;
  get hasPendingBashMessages(): boolean;
}
```

### Key Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `prompt` | `(text: string, options?: PromptOptions)` | Send a message. Handles extensions, skill expansion, queue routing |
| `steer` | `(text: string, images?: ImageContent[])` | Queue steering message (interrupt between tool calls) |
| `followUp` | `(text: string, images?: ImageContent[])` | Queue follow-up message (after agent finishes) |
| `abort` | `()` | Cancel current operation |
| `subscribe` | `(listener) => unsubscribe` | Listen to AgentSessionEvent stream |
| `setModel` | `(model: Model<any>)` | Change model, validates auth |
| `cycleModel` | `(direction?)` | Cycle to next/previous model |
| `setThinkingLevel` | `(level: ThinkingLevel)` | Set thinking level, clamps to model capabilities |
| `cycleThinkingLevel` | `()` | Cycle to next thinking level |
| `newSession` | `(options?)` | Start fresh session |
| `switchSession` | `(sessionPath: string)` | Switch to existing session |
| `fork` | `(entryId: string)` | Branch conversation at entry |
| `navigateTree` | `(targetId, options)` | Navigate to branch point |
| `compact` | `(customInstructions?)` | Manually compact context |
| `reload` | `()` | Reload resources (skills, prompts, extensions) |
| `bindExtensions` | `(bindings)` | Bind UI context and command actions for extensions |
| `sendCustomMessage` | `(message, options?)` | Send custom extension message |
| `executeBash` | `(command, options?)` | Execute bash command in agent context |
| `getSessionStats` | `()` | Get token usage, cost, message counts |
| `exportToHtml` | `(outputPath?)` | Export session as HTML |
| `exportToJsonl` | `(outputPath?)` | Export session as JSONL |
| `dispose` | `()` | Cleanup listeners and resources |

---

## 7. AgentSessionEvent — Every Event Type

`AgentSessionEvent` extends `AgentEvent` with session-specific events:

```typescript
type AgentSessionEvent =
  | AgentEvent                          // All 10 core events
  | { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
  | { type: "compaction_end"; reason: "manual" | "threshold" | "overflow";
      result: CompactionResult | undefined; aborted: boolean;
      willRetry: boolean; errorMessage?: string }
  | { type: "auto_retry_start"; attempt: number; maxAttempts: number;
      delayMs: number; errorMessage: string }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string };
```

### Complete Event Catalog (14 events)

| Event | Source | When |
|-------|--------|------|
| `agent_start` | Agent | Agent begins processing prompt |
| `agent_end` | Agent | Agent finishes all work (messages: new messages) |
| `turn_start` | Agent | New LLM turn begins |
| `turn_end` | Agent | LLM turn ends (message + toolResults) |
| `message_start` | Agent | Any message begins (user, assistant, toolResult) |
| `message_update` | Agent | Assistant message streaming delta (contains assistantMessageEvent) |
| `message_end` | Agent | Any message finalized |
| `tool_execution_start` | Agent | Tool begins executing |
| `tool_execution_update` | Agent | Tool streaming partial result |
| `tool_execution_end` | Agent | Tool finished (result + isError) |
| `compaction_start` | Session | Compaction begins |
| `compaction_end` | Session | Compaction finished/failed/aborted |
| `auto_retry_start` | Session | Auto-retry begins (with delay info) |
| `auto_retry_end` | Session | Auto-retry finished (success or failure) |

---

## 8. Sending a Prompt — The Full API

### PromptOptions

```typescript
interface PromptOptions {
  expandPromptTemplates?: boolean;   // Default: true
  images?: ImageContent[];
  streamingBehavior?: "steer" | "followUp";  // Required if currently streaming
  source?: InputSource;              // "interactive" | "extension" | "rpc"
}
```

### What `AgentSession.prompt()` Does

1. **Extension commands**: If text starts with `/` and matches a registered extension command, execute it immediately and return
2. **Input event**: Emit `input` event to extensions — they can transform or handle the input
3. **Skill expansion**: Expand `/skill:name` to full skill content
4. **Template expansion**: Expand file-based prompt templates
5. **Streaming check**: If agent is streaming, queue via `steer()` or `followUp()` based on `streamingBehavior`
6. **Flush bash messages**: Append any pending bash execution messages
7. **Validate model**: Ensure model is selected and has auth
8. **Pre-prompt compaction**: Check if context needs compacting
9. **Build messages**: Create user message with text + images + pending custom messages
10. **Extension before_agent_start**: Let extensions modify messages/system prompt
11. **Call `agent.prompt(messages)`**: Starts the agent loop
12. **Wait for retry**: If auto-retry triggers, wait for it to complete

### From the Bridge

```typescript
// In pi_features.ts, case "pi_chat":
void instance.session.prompt(prompt, {
  images: extractImages(attachments),
  streamingBehavior,  // "steer" or "followUp" if streaming
  source: "rpc",
}).catch((error) => {
  broadcastPiStreamMessage(broadcast, cwd, sessionId, {
    type: "error",
    message: error.message,
  });
});
reply({ type: "pi_chat_started", data: true, requestId });
```

Note: `prompt()` is fire-and-forget (`void`). The bridge replies immediately with `pi_chat_started`. All subsequent events come via the event stream.

---

## 9. Streaming Response Flow — Event Sequence

For a simple text-only response (no tool calls):

```
1. agent_start
2. turn_start
3. message_start   (user message)
4. message_end     (user message)
5. message_start   (assistant message — partial)
6. message_update  (text_delta: "Hello")
7. message_update  (text_delta: " world")
8. message_update  (text_delta: "!")
9. message_end     (assistant message — final, with usage)
10. turn_end       (message: assistant, toolResults: [])
11. agent_end      (messages: [user, assistant])
```

For a response with tool calls:

```
1.  agent_start
2.  turn_start
3.  message_start   (user)
4.  message_end     (user)
5.  message_start   (assistant — partial)
6.  message_update  (thinking_delta: "Let me read...")
7.  message_update  (text_delta: "I'll read the file")
8.  message_update  (toolcall_start: read)
9.  message_update  (toolcall_delta: '{"path":')
10. message_update  (toolcall_end: {id, name:"read", args:{path:"..."}})
11. message_end     (assistant — final with stopReason: "toolUse")
12. tool_execution_start  (toolCallId, toolName:"read", args)
13. tool_execution_update (partial file content)
14. tool_execution_end    (full result, isError: false)
15. message_start   (toolResult)
16. message_end     (toolResult)
17. turn_end        (message: assistant, toolResults: [toolResult])
18. turn_start      (new turn — agent continues with tool result context)
19. message_start   (assistant — new response)
20. message_update  (text_delta: "The file contains...")
21. message_end     (assistant — stopReason: "stop")
22. turn_end        (message: assistant, toolResults: [])
23. agent_end       (messages: [user, assistant, toolResult, assistant])
```

---

## 10. Content Types — Text, Thinking, Tool Calls, Tool Results

### In AssistantMessage.content

An assistant message's `content` is `(TextContent | ThinkingContent | ToolCall)[]`. Multiple blocks can appear in sequence:

```typescript
// Example: thinking + text + tool call
content: [
  { type: "thinking", thinking: "Let me analyze the code..." },
  { type: "text", text: "I'll read the configuration file." },
  { type: "toolCall", id: "tc_1", name: "read", arguments: { path: "config.ts" } },
]
```

### In ToolResultMessage

```typescript
interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];  // Result text (or images)
  details?: unknown;                         // Structured data (tool-specific)
  isError: boolean;
  timestamp: number;
}
```

### How the Bridge Maps These

The bridge's `pi-events.ts` extracts these for the wire:

```typescript
// Assistant message → wire
{
  role: "assistant",
  text: extractText(content),        // Join all TextContent
  thinking: extractThinking(content), // Join all ThinkingContent
  toolCalls: extractToolCalls(content), // Array of {id, name, arguments}
  model, provider, usage, stopReason, timestamp,
}

// Tool result → wire
{
  role: "toolResult",
  toolCallId, toolName,
  content: extractText(content),     // Join text blocks
  details,
  isError, timestamp,
}
```

---

## 11. Tool System

### Tool Definition

In the coding-agent extension system:

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: TSchema;  // JSON Schema via TypeBox
  execute: (
    toolCallId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback,
  ) => Promise<AgentToolResult<any>>;
  promptSnippet?: string;          // Added to system prompt when tool is active
  promptGuidelines?: string[];     // Additional guidelines for system prompt
}
```

### Tool Lifecycle

1. **Registration**: Tools are registered via `AgentSession._buildRuntime()` — from built-in tools, extension tools, and custom SDK tools
2. **System prompt**: Active tool names control which tool snippets go into the system prompt
3. **LLM call**: Tools are passed as `context.tools` to the LLM
4. **Tool call**: LLM returns `toolCall` content blocks in assistant message
5. **beforeToolCall hook**: Extensions can block execution (`{ block: true, reason: "..." }`)
6. **Execution**: `tool.execute(toolCallId, validatedArgs, signal, onUpdate)` runs
7. **afterToolCall hook**: Extensions can modify the result
8. **Result**: `ToolResultMessage` is added to context for next LLM turn

### Bridge Tool Management

The bridge exposes tool management via the `pi_tools` handler:

```typescript
// pi_list_tools → pi_tools (all tools with active status)
// pi_set_active_tools → pi_tools_set (activate/deactivate tools by name)
// pi_get_thinking_capabilities → pi_thinking_capabilities
```

---

## 12. Extension UI System

Pi extensions can interact with the user via a `ExtensionUIContext` interface. In the Broski bridge, this is implemented by `pi_extension_ui.ts` which relays UI requests to the Flutter app.

### ExtensionUIContext Interface

```typescript
interface ExtensionUIContext {
  select(title: string, options: string[], opts?): Promise<string | undefined>;
  confirm(title: string, message: string, opts?): Promise<boolean>;
  input(title: string, placeholder?: string, opts?): Promise<string | undefined>;
  editor(title: string, prefill?: string, opts?): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage(message?: string): void;
  setWidget(key: string, content: string[] | undefined, options?): void;
  setTitle(title: string): void;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  setToolsExpanded(expanded: boolean): void;
  // ... and more (some no-ops in bridge mode)
}
```

### Dialog Methods (Bidirectional)

Four methods require a response from the Flutter app:

| Method | Wire `method` | Request Fields | Response |
|--------|--------------|----------------|----------|
| `select` | `"select"` | `title`, `options`, `timeout?` | `value: string` or `cancelled: true` |
| `confirm` | `"confirm"` | `title`, `message`, `timeout?` | `confirmed: boolean` or `cancelled: true` |
| `input` | `"input"` | `title`, `placeholder?`, `timeout?` | `value: string` or `cancelled: true` |
| `editor` | `"editor"` | `title`, `prefill?`, `timeout?` | `value: string` or `cancelled: true` |

### Notification Methods (Fire-and-Forget)

These do not wait for a response:

| Method | Wire `method` | Fields |
|--------|--------------|--------|
| `notify` | `"notify"` | `message`, `notifyType?: "info" | "warning" | "error"` |
| `setStatus` | `"setStatus"` | `statusKey`, `statusText` |
| `setTitle` | `"setTitle"` | `title` |
| `setWidget` | `"setWidget"` | `widgetKey`, `widgetLines: string[]`, `widgetPlacement?` |
| `pasteToEditor` | `"paste_to_editor"` | `text` |
| `setEditorText` | `"set_editor_text"` | `text` |
| `setToolsExpanded` | `"set_tools_expanded"` | `expanded: boolean` |

### How the Bridge Relays These

**`pi_extension_ui.ts`** creates a `PiExtensionUiBridge`:

1. Extension calls `uiContext.select("Pick an option", ["A", "B", "C"])`
2. Bridge creates a pending promise with a UUID
3. Emits a `PiStreamMessage`:
   ```json
   { "type": "extension-ui-request", "id": "uuid", "method": "select",
     "title": "Pick an option", "options": ["A", "B", "C"] }
   ```
4. This flows through `translateEvent()` → `broadcastPiStreamMessage()` → `runtime_event` → Flutter app
5. Flutter shows a bottom sheet / dialog
6. User picks "B"
7. Flutter sends `pi_extension_ui_response`:
   ```json
   { "type": "pi_extension_ui_response", "id": "uuid", "value": "B" }
   ```
8. Handler calls `pi.respondToExtensionUi(cwd, { id, value: "B" })`
9. The pending promise resolves with `"B"`
10. Extension continues execution

**Timeout**: Default 30 seconds. On timeout, the promise resolves with the fallback value (undefined for select/input/editor, false for confirm).

**Abort**: If the agent is aborted, the signal triggers cleanup and resolves with fallback.

---

## 13. Permission System — beforeToolCall / afterToolCall

Pi is **yolo by default** — all tools execute without asking permission. Permission checks are added via extensions.

### How Extensions Add Permissions

```typescript
// In an extension:
export default function myPermissionExtension({ on }) {
  on("tool_call", async (event) => {
    // event: { toolName, toolCallId, input }
    if (event.toolName === "bash" && isDangerous(event.input)) {
      const confirmed = await ctx.ui.confirm(
        "Dangerous command",
        `Run: ${event.input.command}?`
      );
      if (!confirmed) {
        return { block: true, reason: "User denied bash execution" };
      }
    }
    return undefined; // Allow
  });
}
```

### Hook Execution Flow

1. Agent loop calls `config.beforeToolCall(context, signal)`
2. This calls `extensionRunner.emitToolCall(event)`
3. Extension handlers run — can return `{ block: true, reason }` to prevent execution
4. If blocked, an error tool result is created and returned to the LLM
5. After execution, `config.afterToolCall(context, signal)` runs
6. Extensions can modify the result: replace `content`, `details`, or `isError`

### BeforeToolCallContext

```typescript
interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;           // Validated arguments
  context: AgentContext;
}
```

### AfterToolCallContext

```typescript
interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: AgentToolCall;
  args: unknown;
  result: AgentToolResult<any>;
  isError: boolean;
  context: AgentContext;
}
```

---

## 14. ModelRuntime — Model Discovery and Selection

> Historical: this section used to describe `ModelRegistry`, created from an `AuthStorage`. The SDK now exposes `ModelRuntime`, created with `ModelRuntime.create()`.

### Architecture

```
pi-ai (models.generated.ts)     ←  Static model definitions with costs, context windows
        ↓
ModelRuntime (coding-agent)      ←  Discovers which models have usable credentials
        ↓
agent dir (~/.pi/agent/)         ←  auth.json (API keys + OAuth), models.json
```

### ModelRuntime API

```typescript
class ModelRuntime {
  static create(options?): Promise<ModelRuntime>;
  getModels(providerId?): readonly Model<Api>[];         // All known models
  getModel(providerId, modelId): Model<Api> | undefined;
  getAvailableSnapshot(): readonly Model<Api>[];         // Models with configured auth
  getError(): string | undefined;
  isUsingOAuth(providerId: string): boolean;
  isUsingSubscription(providerId: string): boolean;
  listCredentials(options?): Promise<readonly CredentialInfo[]>;
  checkAuth(providerId: string, options?): Promise<AuthCheck | undefined>;
  getProviderAuthStatus(providerId: string): AuthStatus;
  refresh(options?): Promise<ModelsRefreshResult>;
}
```

### Bridge Model API

```typescript
// Connector (connectors/pi/pi-model-runtime.ts):
function ensurePiModelRuntime(): Promise<ModelRuntime>;
function refreshPiModelRuntime({ network? }): Promise<void>;   // re-reads auth.json, models.json, models-store.json
function availableModels(): Promise<readonly Model<Api>[]>;     // refresh + getAvailable(): `pi --list-models`
function allCatalogueModels(): Promise<readonly Model<Api>[]>;
function listAvailableModels(): Promise<PiModelPayload[]>;
function listAllModels(): Promise<PiModelPayload[]>;
function listConfiguredProviders(): Promise<string[]>;
function refreshModels(): Promise<void>;                        // fetch newer catalogs, like `pi update --models`
function findModel(provider, modelId): Promise<Model<any> | undefined>;
function mapPiModel(model: Model<any>, authenticated?): PiModelPayload;
```

### Freshness: the catalogue is read, never cached by us

Pi's catalogue is four files that change under a long-running bridge: the catalog bundled with the
SDK, `models-store.json` (the pi.dev overlay `pi update --models` writes), `models.json` (custom
providers) and `auth.json` (what is usable). `ModelRuntime.create()` reads them once, so
`refresh({ allowNetwork: false })` runs before every listing — measured at 4–13 ms on a machine with
45 providers — and `refresh({ allowNetwork: true })` is reserved for `pi_refresh_models`, which is
the CLI's own network refresh. Refreshes are serialised, so a listing during one cannot interleave
with it.

`getAvailable()` (awaited) is the listing API, not `getAvailableSnapshot()`: it is what
`pi --list-models` prints, and it re-checks availability instead of serving the snapshot from the
last pass. On this machine the bridge and the CLI list the identical 589 models.

### Selection: `enabledModels` is resolved by the SDK

`connectors/pi/pi-model-catalogue.ts` reads `SettingsManager.create(cwd).getEnabledModels()` — global
`~/.pi/agent/settings.json` merged with the project's `.pi/settings.json`, exactly as the CLI does —
and resolves each entry with the SDK's `resolveModelScopeWithDiagnostics(patterns, runtime)`, the
`--models` / `/scoped-models` resolution, so `provider/id`, bare ids, globs and `:<thinking level>`
suffixes behave identically. An entry that resolves to nothing is reported as one muted row carrying
its pattern rather than dropped. The same module reports the default model with Pi's own priority:
the saved default, then the first model in scope, then the first model Pi can run.

### The `pi_models` reply

```typescript
{ type: "pi_models",
  data: PiModelPayload[],            // every model Pi can run here (the CLI's list)
  selected: PiSelectedModelPayload[], // enabledModels, in the user's order
  defaultModel: PiDefaultModelPayload | null,
  requestId?: string }

type PiSelectedModelPayload = {
  pattern: string;                   // the entry as saved
  label: string;                     // the model's name, or the pattern when nothing matched
  provider: string | null;           // null when nothing matched
  modelId: string | null;
  thinkingLevel: ThinkingLevel | null; // the level the entry pinned, if any
  available: boolean;                // false: in the catalogue but no credential, or stale
};

type PiDefaultModelPayload = { provider: string; modelId: string; thinkingLevel: ThinkingLevel };
```

`pi_models_refreshed` carries the same four fields. The `runtime_models` broadcast adds
`backendData.selectedOrder` / `backendData.selectedThinkingLevel` to the summaries of selected models.

### PiModelPayload (Wire Format)

```typescript
type PiModelPayload = {
  id: string;
  name: string;
  provider: string;
  api: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: string[];        // ["text"] or ["text", "image"]
  cost: { input, output, cacheRead, cacheWrite };
  authenticated: boolean;
  isOAuth: boolean;
};
```

---

## 15. Thinking / Reasoning Levels

### ThinkingLevel Type

```typescript
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
```

- **`"off"`**: No thinking content generated
- **`"minimal"` through `"high"`**: Increasing thinking budget
- **`"xhigh"`**: Only supported by specific models (GPT-5.2+, Opus 4.6+)

### Level Cycling

```typescript
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
const THINKING_LEVELS_WITH_XHIGH: ThinkingLevel[] = [...THINKING_LEVELS, "xhigh"];
```

`cycleThinkingLevel()` wraps around. If the model doesn't support thinking, only `["off"]` is available.

### Level Clamping

When switching models, the thinking level is clamped:
- If the new model supports xhigh: all levels available
- If reasoning but not xhigh: levels `off` through `high`
- If no reasoning: forced to `"off"`

### Bridge API

```
pi_set_thinking_level → pi_thinking_level  (set specific level)
pi_cycle_thinking_level → pi_thinking_level  (cycle to next)
```

---

## 16. Error Handling and Auto-Retry

### Error Events

When the LLM returns an error, the assistant message has `stopReason: "error"` and `errorMessage`. The agent loop emits `turn_end` then `agent_end`.

### Auto-Retry

After `agent_end`, if the last assistant message has a retryable error (overloaded, rate limit, server error), AgentSession starts auto-retry:

1. Emit `auto_retry_start` with `{ attempt, maxAttempts, delayMs, errorMessage }`
2. Wait `delayMs` (with exponential backoff)
3. Remove the error message from conversation history
4. Call `agent.continue()` to retry
5. On success: emit `auto_retry_end` with `{ success: true, attempt }`
6. On failure: emit `auto_retry_end` with `{ success: false, attempt, finalError }`

### Bridge API

```
pi_set_auto_retry → pi_auto_retry_set  (enable/disable)
pi_abort_retry → pi_retry_aborted     (cancel in-progress retry)
```

---

## 17. Compaction — Context Window Management

### What Compaction Does

When the context grows too large (threshold or overflow), compaction:
1. Takes all conversation history
2. Generates a summary using the LLM
3. Replaces old messages with the summary
4. Persists the compaction entry to the session file

### Compaction Triggers

| Trigger | When | Auto-Retry After? |
|---------|------|-------------------|
| `"manual"` | User calls `compact()` | No |
| `"threshold"` | Context exceeds configured threshold | No |
| `"overflow"` | LLM returns context overflow error | Yes (auto-retry with compacted context) |

### Events

```
compaction_start → { reason: "manual" | "threshold" | "overflow" }
compaction_end → { reason, result?, aborted, willRetry, errorMessage? }
```

### Bridge API

```
pi_compact → pi_compacted                  (manual compact)
pi_set_auto_compaction → pi_auto_compaction_set  (enable/disable threshold)
pi_abort_compaction → pi_compaction_aborted      (cancel in-progress)
```

---

## 18. Image / File Input

### How Images Reach Pi

1. Flutter attaches files as `FileAttachment` with `base64Data` and `mimeType`
2. Bridge's `extractImages()` filters image attachments:
   ```typescript
   const images = attachments
     .filter(a => a.mimeType?.startsWith("image/") && a.base64Data)
     .map(a => ({ type: "image", data: a.base64Data!, mimeType: a.mimeType! }));
   ```
3. Passed to `session.prompt(text, { images })`
4. Added as `ImageContent` in the user message's content array

### Tagged Paths

Non-image file attachments are converted to `@path` references:

```typescript
const taggedPaths = attachments
  .filter(a => !a.base64Data && typeof a.path === "string")
  .map(a => a.path.trim());

// Appended to prompt:
// "Referenced project paths:\n@src/main.ts\n@config.json"
```

---

## 19. Cost / Usage Tracking

### Per-Message Usage

Every `AssistantMessage` contains a `usage` field:

```typescript
{
  input: 1234,        // Input tokens
  output: 567,        // Output tokens
  cacheRead: 890,     // Cache read tokens
  cacheWrite: 123,    // Cache write tokens
  totalTokens: 2814,
  cost: {
    input: 0.001234,  // $ (model.cost.input / 1M * tokens)
    output: 0.00567,
    cacheRead: 0.000890,
    cacheWrite: 0.000123,
    total: 0.007917,
  }
}
```

### Session Statistics

```typescript
interface SessionStats {
  sessionFile: string | undefined;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: { input, output, cacheRead, cacheWrite, total };
  cost: number;
  contextUsage?: ContextUsage;
}
```

### Bridge API

```
pi_get_session_stats → pi_session_stats
```

---

## 20. Session Management

### Session Storage

Sessions are stored as JSONL files in `~/.pi/agent/sessions/`. Each line is a `SessionEntry`:

```typescript
type SessionEntry =
  | SessionHeader          // Version, cwd
  | SessionMessageEntry    // User/assistant/toolResult messages
  | ModelChangeEntry       // Model switch
  | ThinkingLevelChangeEntry
  | CompactionEntry        // Compaction summary
  | BranchSummaryEntry     // Branch summarization
  | CustomMessageEntry     // Extension custom messages
  | SessionInfoEntry       // Name, parent session
  | FileEntry              // File snapshots
  | CustomEntry            // Extension custom entries
```

### SessionManager API

```typescript
class SessionManager {
  static create(cwd: string, sessionDir?: string): SessionManager;
  static continueRecent(cwd: string): SessionManager;
  static open(sessionPath: string): SessionManager;
  static list(cwd: string): Promise<SessionInfo[]>;
  static listAll(): Promise<SessionInfo[]>;
  static inMemory(): SessionManager;

  getSessionFile(): string | undefined;
  getSessionId(): string;
  getSessionName(): string | undefined;
  buildSessionContext(): SessionContext;  // Reconstruct messages from entries
  getBranch(): SessionEntry[];           // Current branch entries
  getEntries(): SessionEntry[];          // All entries
  newSession(options?): void;
  appendMessage(message: Message): void;
  appendCompaction(summary, firstKeptEntryId, tokensBefore, details?, fromExtension?): void;
  // ... many more
}
```

### Bridge Session API

| Client Message | Response | Description |
|----------------|----------|-------------|
| `pi_list_sessions` | `pi_sessions` | List all sessions (optionally filtered by cwd) |
| `pi_list_projects` | `pi_projects` | List unique project paths with last-opened times |
| `pi_new_session` | `pi_session_created` | Create new session |
| `pi_switch_session` | `pi_session_switched` | Switch to existing session |
| `pi_delete_session` | `pi_session_deleted` | Delete session file |
| `pi_set_session_name` | `pi_session_name_set` | Rename session |
| `pi_get_messages` | `pi_messages` | Get all messages in current session |

### PiSessionInfo (Wire Format)

```typescript
type PiSessionInfo = {
  path: string;          // JSONL file path
  id: string;            // Session UUID
  cwd: string;           // Working directory
  name?: string;         // Display name
  parentSessionPath?: string;
  created: number;       // Epoch ms
  modified: number;      // Epoch ms
  messageCount: number;
  firstMessage: string;  // Preview text
  summary?: { additions: number; deletions: number; files: number };
  subagentToolCount?: number;  // Task/oracle/finder/... tool invocations
};
```

---

## 21. Steering and Follow-Up Messages

### Steering

Steering messages are injected **between tool calls** — after the current assistant turn finishes its tool executions but before the next LLM call. This lets users redirect the agent mid-task.

```
User: "Fix the bug in auth.ts"
Agent: [thinking] [text: "I'll read..."] [toolCall: read auth.ts]
   ← tool executing →
User (steer): "Also check the test file"  ← queued
   ← tool finishes →
   ← steering message injected →
Agent: [new turn, sees both instructions]
```

### Follow-Up

Follow-up messages are processed **after the agent would otherwise stop** — when there are no more tool calls and no steering messages. This is for chaining tasks.

### Queue Modes

```typescript
type QueueMode = "all" | "one-at-a-time";
```

- **`"all"`**: All queued messages are delivered at once
- **`"one-at-a-time"`**: Only the first queued message is delivered per turn

### Bridge API

```
pi_steer → pi_steered                    (queue steering message)
pi_follow_up → pi_followed_up             (queue follow-up message)
pi_set_steering_mode → pi_steering_mode_set
pi_set_follow_up_mode → pi_follow_up_mode_set
```

---

## 22. Our Bridge Connector — `connectors/pi.ts`

**File:** `packages/bridge/src/connectors/pi.ts` (36-line facade) + `packages/bridge/src/connectors/pi/` (18 modules, 2,598 lines)

`pi.ts` is a thin re-export facade. Instance management and the bridge API now live in `connectors/pi/`: `pi-instance.ts`, `pi-instance-types.ts`, `pi-session-lifecycle.ts`, `pi-session-queries.ts`, `pi-session-state.ts`, `pi-session-info.ts`, `pi-session-stats.ts`, `pi-session-list-cache.ts`, `pi-single-flight.ts`, `pi-model-runtime.ts`, `pi-events.ts`, `pi-external-tail.ts`, `pi-ui-theme.ts`, `pi-extension-binding.ts`, `pi-subagent-registry.ts`, `pi-subagent-extraction.ts`, `pi-session-enrich.ts`, `pi-cwd.ts`.

### Instance Management

Pi instances are keyed by normalized `cwd` path:

```typescript
const instances = new Map<string, PiInstance>();

type PiInstance = {
  session: AgentSession;
  resourceLoader: DefaultResourceLoader;
  settingsManager: SettingsManager;
  listeners: Set<PiEventListener>;
  extensionUiBridge: PiExtensionUiBridge;
  unsubscribe: () => void;
  cwd: string;
  createdAt: number;
};
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `getOrCreateInstance(cwd, options)` | Get existing or create new Pi instance |
| `getInstance(cwd)` | Non-creating getter |
| `disposeInstance(cwd)` | Teardown instance |
| `addEventListener(cwd, listener)` | Subscribe to events for a cwd |
| `respondToExtensionUi(cwd, response)` | Forward extension UI response |
| `listSessions(cwd?)` | List sessions, enrich with diff stats |
| `listProjects()` | List unique project paths |
| `listAvailableModels()` | Get authenticated models |
| `isPiAvailable()` | Check availability |
| `deleteSession(path)` | Safe session deletion |
| `translateEvent(event)` | Map `AgentSessionEvent` → `PiStreamMessage` |
| `mapStatePayload(instance)` | Snapshot current session state |
| `mapModel(model)` | Map `Model` → `PiModelPayload` |

### Instance Creation Flow (`buildInstance`)

1. Create `SettingsManager.create(cwd)`
2. Create `DefaultResourceLoader` and `reload()`
3. Create `SessionManager` (continue recent or open specific path)
4. Resolve model from options or registry
5. Call `createAgentSession({ cwd, model, thinkingLevel, authStorage, modelRegistry, sessionManager, settingsManager, resourceLoader })`
6. Create `PiExtensionUiBridge` that emits synthetic stream events
7. Bind extensions with `session.bindExtensions({ uiContext, commandContextActions, onError })`
8. Subscribe to session events and broadcast to listeners

---

## 23. Our Extension UI Bridge — `pi_extension_ui.ts`

**File:** `packages/bridge/src/connectors/pi_extension_ui.ts` (335 lines)

### How It Works

The bridge creates a `PiExtensionUiBridge` that implements `ExtensionUIContext`:

```typescript
function createPiExtensionUiBridge(
  emitStreamMessage: (message: PiStreamMessage) => void
): PiExtensionUiBridge;
```

For dialog methods (`select`, `confirm`, `input`, `editor`):
1. Generate a UUID request ID
2. Create a Promise with resolve/reject stored in a `pending` Map
3. Emit an `extension-ui-request` stream message
4. Set a timeout (default 30s) — resolves with fallback on expiry
5. When Flutter responds, `resolveResponse()` resolves the promise

For notification methods (`notify`, `setStatus`, `setTitle`, `setWidget`, etc.):
- Emit immediately as `extension-ui-request` messages — no response expected

### Not Supported in Bridge Mode

These methods are no-ops:
- `setWorkingMessage()` — not surfaced to mobile
- `setFooter()` — not supported
- `setHeader()` — not supported
- `setEditorComponent()` — not supported
- `custom()` — returns undefined
- `onTerminalInput()` — no terminal in bridge
- `getEditorText()` — returns empty string
- `getAllThemes()`, `getTheme()`, `setTheme()` — not supported

---

## 24. Our Wire Protocol — `PiStreamMessage`

**File:** `packages/bridge/src/types/pi.ts`

### Complete PiStreamMessage Union

```typescript
type PiStreamMessage =
  | { type: "agent-start" }
  | { type: "agent-end"; messages: any[] }
  | { type: "turn-start" }
  | { type: "turn-end"; message: any; toolResults: any[] }
  | { type: "message-start"; message: any }
  | { type: "message-end"; message: any }
  | { type: "text-delta"; content: string }
  | { type: "thinking-delta"; content: string }
  | { type: "tool-call-start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool-call-args-done"; toolCallId: string; toolName: string; args: any }
  | { type: "tool-exec-start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool-exec-update"; toolCallId: string; toolName: string; args?: any; partialResult: any }
  | { type: "tool-exec-end"; toolCallId: string; toolName: string; result: any;
      details?: any; isError: boolean }
  | { type: "message-done"; stopReason: string }
  | { type: "compaction-start"; reason: string }
  | { type: "compaction-end"; aborted: boolean; willRetry: boolean; errorMessage?: string }
  | { type: "retry-start"; attempt: number; maxAttempts: number; delayMs: number;
      errorMessage: string }
  | { type: "retry-end"; success: boolean; attempt: number; finalError?: string }
  | { type: "extension-ui-request"; id: string; method: string; [key: string]: any }
  | { type: "error"; message: string; code?: string }
  | { type: "bash-output"; content: string }
  | { type: "external-user-message"; content: string; timestamp: number };
```

### Translation Table (AgentSessionEvent → PiStreamMessage)

**File:** `packages/bridge/src/connectors/pi/pi-events.ts`

| AgentSessionEvent | PiStreamMessage | Notes |
|-------------------|-----------------|-------|
| `agent_start` | `agent-start` | |
| `agent_end` | `agent-end` | Messages are mapped via `mapAgentMessage()` |
| `turn_start` | `turn-start` | |
| `turn_end` | `turn-end` | Message + toolResults mapped |
| `message_start` | `message-start` | Full message object |
| `message_end` | `message-end` | Full message object |
| `message_update` (text_delta) | `text-delta` | `{ content: delta }` |
| `message_update` (thinking_delta) | `thinking-delta` | `{ content: delta }` |
| `message_update` (toolcall_start) | `tool-call-start` | `{ toolCallId, toolName, args }` |
| `message_update` (toolcall_end) | `tool-call-args-done` | `{ toolCallId, toolName, args }` |
| `message_update` (done/error) | `message-done` | `{ stopReason }` |
| `tool_execution_start` | `tool-exec-start` | |
| `tool_execution_update` | `tool-exec-update` | Text extracted from partial result |
| `tool_execution_end` | `tool-exec-end` | Text + details extracted from result |
| `compaction_start` | `compaction-start` | `{ reason }` |
| `compaction_end` | `compaction-end` | `{ aborted, willRetry, errorMessage? }` |
| `auto_retry_start` | `retry-start` | Full retry info |
| `auto_retry_end` | `retry-end` | Success/failure info |
| `__pi_bridge_stream__` | *(passthrough)* | Synthetic events from extension UI bridge |

---

## 25. Our Handler — `handlers/pi_features.ts`

**File:** `packages/bridge/src/handlers/pi_features.ts` (48-line router) + `packages/bridge/src/handlers/pi_*.ts` (21 files)

`pi_features.ts` is now a small router; the handlers live in `handlers/`: `pi_chat.ts`, `pi_stream_bridge.ts`, `pi_stream_delivery.ts`, `pi_session_lifecycle.ts`, `pi_session_data.ts`, `pi_session_messages.ts`, `pi_message_helpers.ts`, `pi_models.ts`, `pi_settings.ts`, `pi_tools.ts`, `pi_bash.ts`, `pi_tree.ts`, `pi_labels.ts`, `pi_abort.ts`, `pi_custom_message.ts`, `pi_state_events.ts`, `pi_external_tail_sync.ts`, `pi_extension_ui_requests.ts`, `pi_subagent_messages.ts` (plus the router itself and `pi_durable.ts`).

### Sub-Handlers

The main handler delegates to specialized sub-handlers first:

```typescript
if (await piTools.handle(message, reply)) return true;    // pi_list_tools, pi_set_active_tools, ...
if (await piAbort.handle(message, reply)) return true;    // pi_abort_compaction, pi_abort_branch_summary, pi_abort_bash
if (await piBash.handle(message, reply, broadcast)) return true;  // pi_execute_bash
if (await piLabels.handle(message, reply)) return true;   // pi_list_labels, pi_set_label, pi_remove_label
if (await piTree.handle(message, reply)) return true;     // pi_get_tree
if (await piCustomMessage.handle(message, reply)) return true;  // pi_send_custom_message
```

### Complete Message Catalog

| Client → Bridge | Bridge → Client | Description |
|-----------------|-----------------|-------------|
| `pi_chat` | `pi_chat_started` | Start prompt (fire-and-forget streaming) |
| `pi_steer` | `pi_steered` | Queue steering message |
| `pi_follow_up` | `pi_followed_up` | Queue follow-up message |
| `pi_abort` | `pi_aborted` | Abort current operation |
| `pi_set_steering_mode` | `pi_steering_mode_set` | Set steering queue mode |
| `pi_set_follow_up_mode` | `pi_follow_up_mode_set` | Set follow-up queue mode |
| `pi_set_auto_retry` | `pi_auto_retry_set` | Enable/disable auto-retry |
| `pi_abort_retry` | `pi_retry_aborted` | Cancel in-progress retry |
| `pi_get_state` | `pi_state` | Get full session state |
| `pi_list_models` | `pi_models` | List available models |
| `pi_set_model` | `pi_model_set` | Set model |
| `pi_set_thinking_level` | `pi_thinking_level` | Set thinking level |
| `pi_cycle_thinking_level` | `pi_thinking_level` | Cycle thinking level |
| `pi_cycle_model` | `pi_model_set` | Cycle model |
| `pi_list_sessions` | `pi_sessions` | List sessions |
| `pi_list_projects` | `pi_projects` | List projects |
| `pi_new_session` | `pi_session_created` | Create new session |
| `pi_switch_session` | `pi_session_switched` | Switch session |
| `pi_delete_session` | `pi_session_deleted` | Delete session |
| `pi_get_session_stats` | `pi_session_stats` | Get stats |
| `pi_get_messages` | `pi_messages` | Get messages |
| `pi_set_session_name` | `pi_session_name_set` | Rename session |
| `pi_fork` | `pi_fork_result` | Fork at entry |
| `pi_get_fork_messages` | `pi_fork_messages` | Get fork points |
| `pi_navigate_tree` | `pi_tree_navigated` | Navigate tree |
| `pi_list_commands` | `pi_commands` | List skills/prompts/commands |
| `pi_compact` | `pi_compacted` | Manual compact |
| `pi_set_auto_compaction` | `pi_auto_compaction_set` | Enable/disable |
| `pi_export_html` | `pi_export_result` | Export HTML |
| `pi_export_jsonl` | `pi_export_result` | Export JSONL |
| `pi_import_jsonl` | `pi_jsonl_imported` | Import JSONL |
| `pi_get_system_prompt` | `pi_system_prompt` | Get system prompt |
| `pi_get_settings` | `pi_settings` | Get settings |
| `pi_set_settings` | `pi_settings_updated` | Apply settings |
| `pi_dispose_instance` | `pi_instance_disposed` | Teardown instance |
| `pi_extension_ui_response` | `pi_extension_ui_responded` | Respond to extension UI request |
| `pi_list_tools` | `pi_tools` | List tools |
| `pi_set_active_tools` | `pi_tools_set` | Set active tools |
| `pi_get_thinking_capabilities` | `pi_thinking_capabilities` | Get thinking info |
| `pi_execute_bash` | `pi_bash_result` | Execute bash command |
| `pi_abort_bash` | `pi_bash_aborted` | Abort bash |
| `pi_abort_compaction` | `pi_compaction_aborted` | Abort compaction |
| `pi_abort_branch_summary` | `pi_branch_summary_aborted` | Abort summary |
| `pi_list_labels` | `pi_labels` | List labels |
| `pi_set_label` | `pi_label_set` | Set label |
| `pi_remove_label` | `pi_label_removed` | Remove label |
| `pi_get_tree` | `pi_tree` | Get session tree |
| `pi_send_custom_message` | `pi_custom_message_sent` | Send custom message |
| `pi_get_last_assistant_text` | `pi_last_assistant_text` | Get last response |
| `pi_get_queue_state` | `pi_queue_state` | Get pending messages |

### Stream Bridge

The handler maintains a stream bridge per cwd that subscribes to Pi events and broadcasts them:

```typescript
async function ensureStreamBridge(cwd: string, broadcast: Broadcast, force = false): Promise<void>;
```

When an event arrives:
1. `pi.translateEvent(event)` → `PiStreamMessage | null`
2. `mapPiStreamToRuntimeEvent(streamMessage, ctx)` → `BroskiRuntimeEvent | null`
3. `broadcast({ type: "runtime_event", backend: "pi", data: runtimeEvent })`
4. On `agent-end`/`agent-start`/`error`: also broadcast `runtime_state` with fresh state snapshot

---

## 26. Our Flutter / Dart Side

### PiBridgeService (`lib/services/pi_bridge_service.dart`, 713 lines)

Request-response service using WebSocket. Every method:
1. Generates a request ID with `pi_req_` prefix
2. Sends the message via WebSocket
3. Awaits the expected response type with 30s timeout

Key methods mirror the bridge handler: `chat()`, `steer()`, `followUp()`, `abort()`, `listModels()`, `setModel()`, `setThinkingLevel()`, `listSessions()`, `newSession()`, `switchSession()`, `fork()`, `navigateTree()`, `respondToExtensionUi()`, etc.

### Pi Models (`lib/models/pi.dart`, 728 lines)

Complete Dart model classes:

| Class | Purpose |
|-------|---------|
| `PiModel` | Model with provider, cost, capabilities |
| `PiModelCost` | Per-token costs |
| `PiThinkingLevel` | Enum with wireValue/displayName |
| `PiState` | Full session state snapshot |
| `PiSessionInfo` | Session metadata |
| `PiCommand` | Skill/prompt/extension command |
| `PiForkMessage` | Fork point with entryId/text |
| `PiTokenUsage` | Token counts |
| `PiContextUsage` | Context window usage |
| `PiSessionStats` | Session statistics |
| `PiTreeNavigateResult` | Navigation result |
| `PiStreamMessage` | Raw stream message with type-safe accessors |
| `PiTool` | Tool info with active status |
| `PiThinkingCapabilities` | Available thinking levels |
| `PiQueueState` | Pending steering/follow-up |
| `PiBashResult` | Bash execution result |
| `PiLabel` | Entry label/bookmark |
| `PiTreeNode` | Session tree node |
| `PiSessionTree` | Full tree with nodes and leaf position |

### Stream Processing

Pi events flow through the unified runtime event system. The Flutter app receives `runtime_event` messages with `backend: "pi"` and processes them in the unified runtime provider alongside Claude Code, OpenCode, and Codex events.

---

## 27. Runtime Event Mapping

**File:** `packages/bridge/src/runtime/pi-runtime-event-mapper.ts`

PiStreamMessages are mapped to normalized `BroskiRuntimeEvent` types:

| PiStreamMessage | BroskiRuntimeEvent | Payload |
|-----------------|-------------------|---------|
| `agent-start` | `agent_started` | `sourceType: "agent-start"` |
| `agent-end` | `agent_finished` | `sourceType, messages` |
| `turn-start` | `null` (skipped) | a model call inside the run |
| `turn-end` | `null` (skipped) | a model call inside the run |
| `agent-settled` | `null` (skipped) | repeats `agent-end`; the `runtime_state` it triggers is the post-run snapshot |
| `text-delta` | `assistant_text_delta` | `delta: content` |
| `thinking-delta` | `assistant_thinking_delta` | `delta: content` |
| `tool-exec-start` | `tool_started` | `toolCallId, toolName, input: args` |
| `tool-exec-update` | `tool_updated` | `toolCallId, toolName, partialOutput` |
| `tool-exec-end` | `tool_finished` | `toolCallId, toolName, output, isError, details` |
| `compaction-start` | `compaction_started` | `reason` |
| `compaction-end` | `compaction_finished` | `aborted, willRetry, errorMessage?` |
| `retry-start` | `retry_started` | `attempt, maxAttempts, delayMs, errorMessage` |
| `retry-end` | `retry_finished` | `success, attempt, finalError?` |
| `error` | `error` | `message, code?` |
| `extension-ui-request` | `backend_event` | `kind: "extension-ui-request", payload` |
| `external-user-message` | `backend_event` | `kind: "external-user-message"` |
| `bash-output` | (not currently mapped) | |
| `tool-call-start` | `null` (skipped) | |
| `tool-call-args-done` | `null` (skipped) | |
| `message-start/end/done` | `null` (skipped) | |

Events are then enriched with `seq`, `streamId`, `turnId` by `enrichRuntimeEvent()` before broadcast.

---

## 28. Event Flow Diagram — Prompt to Completion

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FLUTTER APP                                                                  │
│                                                                              │
│  User types "Fix the bug" → pi_chat { prompt: "Fix the bug" }               │
│         ←  pi_chat_started { data: true }                                    │
│                                                                              │
│  ┌──── runtime_event stream ────────────────────────────────────────────┐    │
│  │  agent_started { sourceType: "agent-start" }                        │    │
│  │  assistant_thinking_delta { delta: "Let me look at..." }            │    │
│  │  assistant_text_delta { delta: "I'll read " }                       │    │
│  │  assistant_text_delta { delta: "the file." }                        │    │
│  │  tool_started { toolName: "read", toolCallId: "tc_1" }             │    │
│  │  tool_updated { partialOutput: "line 1..." }                        │    │
│  │  tool_finished { output: "full content...", isError: false }        │    │
│  │  assistant_text_delta { delta: "Found the bug..." }                 │    │
│  │  tool_started { toolName: "edit", toolCallId: "tc_2" }             │    │
│  │  tool_finished { output: "File edited", isError: false }            │    │
│  │  assistant_text_delta { delta: "I fixed the bug..." }               │    │
│  │  agent_finished { sourceType: "agent-end" }                         │    │
│  │                                                                      │    │
│  │  runtime_state { isStreaming: false, messageCount: 6 }              │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  Meanwhile, if an extension needs input:                                     │
│  │  backend_event { kind: "extension-ui-request",                      │    │
│  │    payload: { id: "uuid", method: "confirm", title: "Run rm -rf?"}} │    │
│  │                                                                      │    │
│  User taps "Approve" → pi_extension_ui_response { id: "uuid",              │
│                          confirmed: true }                                    │
│         ← pi_extension_ui_responded { data: true }                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 29. External Session Tailing

Pi sessions running in the terminal (not through Broski) can be observed via **external tailing**.

**File:** `packages/bridge/src/connectors/pi/pi-external-tail.ts`

When the app opens a Pi session that isn't bridge-owned:
1. Resolve the session's JSONL file path
2. Start a file watcher on the JSONL file
3. Parse new lines as they're appended
4. Convert session entries to `PiStreamMessage` events
5. Broadcast as runtime events

This enables reading Pi sessions running in the TUI from the phone.

### Bridge API

```typescript
syncPiExternalTail(sessionId, broadcast, debugRts, logDebug);  // Start tailing
stopPiExternalTail(sessionId);   // Stop tailing
stopAllPiExternalTails();        // Stop all
```

---

## 30. Bash Execution

Pi supports executing bash commands in the agent's context (separate from the agent's own bash tool usage).

### Bridge API

```
pi_execute_bash → pi_bash_result
pi_abort_bash → pi_bash_aborted
```

### PiBashResult

```typescript
{
  output: string;
  exitCode: number | null;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;  // If output was truncated, path to full output
  error?: string;
}
```

Bash commands can also emit intermediate `bash-output` stream messages for live output.

---

## 31. Session Tree — Forking and Navigation

Pi sessions support branching via the session tree. Every user message creates a potential fork point.

### Forking

```
pi_get_fork_messages → pi_fork_messages  // Get available fork points
pi_fork → pi_fork_result                 // Fork at specific entry
```

`fork(entryId)` creates a new branch from that point, preserving the parent branch.

### Tree Navigation

```
pi_get_tree → pi_tree             // Get full tree structure
pi_navigate_tree → pi_tree_navigated  // Navigate to branch point
```

### Labels / Bookmarks

```
pi_list_labels → pi_labels         // List all labels
pi_set_label → pi_label_set        // Set label on entry
pi_remove_label → pi_label_removed // Remove label
```

### Tree Structure

```typescript
// PiTreeNode (wire format)
{
  id: string;         // Entry ID
  parentId?: string;  // Parent entry ID
  type: string;       // "message", "compaction", "branch_summary"
  timestamp: string;
  label?: string;
  role?: string;      // "user", "assistant" (for messages)
  text?: string;      // Preview text
  childCount: number; // >1 = fork point
}
```

---

## Appendix: PiStatePayload — Complete State Snapshot

This is the full state transmitted via `pi_get_state` and `runtime_state`:

```typescript
type PiStatePayload = {
  model: PiModelPayload | null;
  thinkingLevel: string;
  isStreaming: boolean;
  isCompacting: boolean;
  isRetrying: boolean;
  sessionFile: string | null;
  sessionId: string;
  sessionName: string | null;
  steeringMode: "all" | "one-at-a-time";
  followUpMode: "all" | "one-at-a-time";
  autoCompactionEnabled: boolean;
  autoRetryEnabled: boolean;
  messageCount: number;
  pendingMessageCount: number;
  isBashRunning: boolean;
  hasPendingBashMessages: boolean;
  retryAttempt: number;
};
```

State is broadcast on `agent-start`, `agent-end`, and `error` events to keep the client authoritative.
