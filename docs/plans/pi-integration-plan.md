# Pi Coding Agent Integration Plan — SDK Architecture

> **Broski's 4th AI Backend: `@mariozechner/pi-coding-agent` v0.52.9+**
>
> Status: PLANNING → READY FOR IMPLEMENTATION
> Created: 2026-02-11
> Architecture: **In-process SDK** (same as OpenCode & Claude Code)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Decision: SDK, Not Child Process](#2-architecture-decision)
3. [How All 4 Backends Now Compare](#3-backend-comparison)
4. [Phase 0 — Dependencies & Infrastructure](#4-phase-0)
5. [Phase 1 — Bridge Connector (`connectors/pi.ts`)](#5-phase-1)
6. [Phase 2 — Bridge Types (`types.ts` additions)](#6-phase-2)
7. [Phase 3 — Bridge Message Handlers](#7-phase-3)
8. [Phase 4 — Flutter Models (`models/pi.dart`)](#8-phase-4)
9. [Phase 5 — Flutter Bridge Service Methods](#9-phase-5)
10. [Phase 6 — Riverpod Providers](#10-phase-6)
11. [Phase 7 — Chat Streaming & Message Rendering](#11-phase-7)
12. [Phase 8 — Session Management](#12-phase-8)
13. [Phase 9 — Model & Provider Management](#13-phase-9)
14. [Phase 10 — Skills, Extensions, Commands](#14-phase-10)
15. [Phase 11 — Tool Cards & Themed UI](#15-phase-11)
16. [Phase 12 — Extension UI Forwarding](#16-phase-12)
17. [Phase 13 — Advanced Features (Tree Nav, Compaction, Packages)](#17-phase-13)
18. [Phase 14 — Settings, Config & Polish](#18-phase-14)
19. [Complete Message Protocol](#19-message-protocol)
20. [Complete File Inventory](#20-file-inventory)
21. [Implementation Priority & MVP Scope](#21-implementation-priority)
22. [Risk Register](#22-risk-register)

---

## 1. Executive Summary

Pi (`@mariozechner/pi-coding-agent`) is a minimal, aggressively-extensible terminal coding agent that supports **20+ LLM providers** out of the box. It ships an **in-process TypeScript SDK** with `createAgentSession()`, typed events, session tree management, extension loading, and model registry — everything we need to embed it directly in the bridge, just like we embed the OpenCode SDK and Claude Code SDK.

### Why Pi

- **Multi-provider**: One backend → Anthropic, OpenAI, Google, Mistral, Groq, xAI, OpenRouter, Bedrock, Vertex, and 15+ more. Users authenticate once, get access to all models.
- **Extension ecosystem**: npm/git-installable packages (skills, extensions, prompt templates, themes). Users manage from phone.
- **Branching sessions**: Tree-structured session history with in-place branching — richer than any other backend.
- **Thinking levels**: 6 granularity levels (off → xhigh) across all providers that support reasoning.
- **Clean SDK**: `createAgentSession()` → `session.subscribe()` → `session.prompt()`. That's it.

### Naming Convention

| Item | Value |
|------|-------|
| Wire prefix | `pi_` |
| AgentType wire value | `'pi'` |
| AgentType enum | `AgentType.pi` |
| Connector | `packages/bridge/src/connectors/pi.ts` |
| Flutter models | `lib/models/pi.dart` |
| Flutter provider | `lib/providers/pi_provider.dart` |

---

## 2. Architecture Decision

### Why SDK, not child process

We use **in-process SDKs** for 2 of our 3 existing backends. Codex is the only child process — and that's only because OpenAI doesn't publish an in-process SDK. Pi gives us both options, and the choice is obvious:

| | In-Process SDK | Child Process (RPC) |
|---|---|---|
| **Startup latency** | 0ms (already loaded) | 1-2s per spawn |
| **Crash isolation** | Shares bridge process | Separate process |
| **Type safety** | Full TypeScript types, IDE autocomplete | Parse JSON strings |
| **State access** | `session.model`, `session.messages`, `session.isStreaming` — direct | Send command, wait for response, parse JSON |
| **Event stream** | `session.subscribe(fn)` — typed callbacks | Read stdout line by line, parse JSON |
| **Memory** | Shared heap | Extra Node process per project (~50-100MB) |
| **Process management** | None needed | Spawn, monitor, restart, kill, handle stderr |
| **Extension integration** | Register custom tools, subscribe to events in-process | Relay extension UI requests over stdin/stdout |
| **Session tree API** | `SessionManager.getTree()`, `.branch()`, `.getEntries()` — direct | Not available via RPC, would need filesystem parsing |
| **Our track record** | OpenCode ✅ Claude Code ✅ (proven, stable) | Codex ⚠️ (our most finicky backend) |

**Decision: SDK. No contest.**

The crash-isolation argument is the only point for RPC, and it's weak — we already accept this risk for OpenCode and Claude Code, and Pi is well-tested open-source software.

### Pattern match: Pi SDK ≈ Claude Code SDK

| Aspect | Claude Code SDK | Pi SDK |
|--------|----------------|--------|
| Import | `import { query } from '@anthropic-ai/claude-agent-sdk'` | `import { createAgentSession } from '@mariozechner/pi-coding-agent'` |
| Session creation | `query({ prompt, ... })` returns conversation | `createAgentSession({ cwd, ... })` returns session |
| Streaming | Callback on each event via options | `session.subscribe(event => ...)` |
| Abort | `AbortController` | `session.abort()` |
| State | Tracked manually in our connector | `session.model`, `session.messages`, `session.isStreaming` |
| Sessions | We scan `~/.claude/projects/` filesystem | `SessionManager.list(cwd)` + `SessionManager.open(path)` |
| Models | Fixed tiers (sonnet/opus/haiku) | `modelRegistry.getAvailable()` — dynamic, 20+ providers |
| Tools | SDK handles internally | SDK handles internally (read, bash, edit, write, grep, find, ls) |

---

## 3. Backend Comparison

After Pi integration, all 4 backends:

| Backend | Connection | SDK Import | Session Model | Model Discovery |
|---------|-----------|------------|---------------|-----------------|
| **OpenCode** | In-process SDK | `@opencode-ai/sdk/v2` | Linear, server-managed | Dynamic `provider.list()` |
| **Claude Code** | In-process SDK | `@anthropic-ai/claude-agent-sdk` | Filesystem JSONL, bridge-scanned | Fixed tiers + `getSupportedModels()` |
| **Codex** | Child process (JSON-RPC) | Spawns `codex app-server` | Thread-based, SDK-managed | `model/list` RPC call |
| **Pi** *(new)* | In-process SDK | `@mariozechner/pi-coding-agent` | Tree-structured JSONL, `SessionManager` API | `ModelRegistry.getAvailable()` |

---

## 4. Phase 0 — Dependencies & Infrastructure

### 0.1 Install Pi SDK in Bridge

```bash
cd packages/bridge
npm install @mariozechner/pi-coding-agent
```

This pulls in `@mariozechner/pi-ai` (LLM abstraction with Anthropic/OpenAI/Google/etc SDKs) and `@mariozechner/pi-agent-core` (agent loop). Some deps overlap with what we already have (Anthropic SDK, etc.) — Bun deduplicates.

### 0.2 AgentType Expansion

**`packages/bridge/src/types.ts`** — one line change:
```typescript
export type AgentType = 'opencode' | 'claude-code' | 'codex' | 'pi'
```

**`lib/models/agent_type.dart`** — add `pi` to the enum:
```dart
enum AgentType {
  opencode,
  claudeCode,
  codex,
  pi;

  String get displayName => switch (this) {
    AgentType.opencode => 'OpenCode',
    AgentType.claudeCode => 'Claude Code',
    AgentType.codex => 'Codex',
    AgentType.pi => 'Pi',
  };

  String get description => switch (this) {
    AgentType.opencode => 'Open source AI coding agent',
    AgentType.claudeCode => 'Anthropic Claude Code SDK',
    AgentType.codex => 'OpenAI Codex app-server',
    AgentType.pi => 'Multi-provider coding agent',
  };

  String get wireValue => switch (this) {
    AgentType.opencode => 'opencode',
    AgentType.claudeCode => 'claude-code',
    AgentType.codex => 'codex',
    AgentType.pi => 'pi',
  };

  static AgentType fromWireValue(String value) => switch (value) {
    'claude-code' => AgentType.claudeCode,
    'codex' => AgentType.codex,
    'pi' => AgentType.pi,
    _ => AgentType.opencode,
  };
}
```

Update `AgentsStatus` to include `pi: AgentStatusInfo` field. Update `forType()` switch.

### 0.3 Config Schema

**`packages/bridge/src/config/schema.ts`** — add:
```typescript
pi?: {
  enabled?: boolean
  agentDir?: string          // Override ~/.pi/agent
  defaultProvider?: string   // e.g. 'anthropic'
  defaultModel?: string      // e.g. 'claude-sonnet-4-20250514'
  defaultThinkingLevel?: string // e.g. 'medium'
  extraExtensionPaths?: string[]
}
```

---

## 5. Phase 1 — Bridge Connector

**New file: `packages/bridge/src/connectors/pi.ts`**

This is the core integration layer. It wraps the Pi SDK's `AgentSession` and manages per-project instances — same pattern as our OpenCode connector (`OpenCodeConnector` class with an instance per project).

### Key SDK Imports

```typescript
import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  AuthStorage,
  ModelRegistry,
  DefaultResourceLoader,
  createCodingTools,
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition,
} from '@mariozechner/pi-coding-agent'

import { getModel } from '@mariozechner/pi-ai'

import type {
  Model,
  ThinkingLevel,
  AssistantMessage,
  UserMessage,
  ToolResultMessage,
  AssistantMessageEvent,
} from '@mariozechner/pi-ai'

import type { AgentMessage, AgentEvent } from '@mariozechner/pi-agent-core'
```

### Singleton Services (shared across all projects)

```typescript
// Auth and models are global — one user, one machine
let authStorage: AuthStorage | null = null
let modelRegistry: ModelRegistry | null = null

function getAuthStorage(): AuthStorage {
  if (!authStorage) authStorage = new AuthStorage()
  return authStorage
}

function getModelRegistry(): ModelRegistry {
  if (!modelRegistry) modelRegistry = new ModelRegistry(getAuthStorage())
  return modelRegistry
}
```

### Per-Project Session Manager

```typescript
interface PiInstance {
  session: AgentSession
  resourceLoader: DefaultResourceLoader
  settingsManager: SettingsManager
  unsubscribe: () => void  // event listener cleanup
  cwd: string
  createdAt: number
}

const instances = new Map<string, PiInstance>()

/**
 * Get or create a Pi AgentSession for a project directory.
 * Sessions persist to ~/.pi/agent/sessions/ automatically.
 */
export async function getOrCreateInstance(
  cwd: string,
  onEvent: (event: AgentSessionEvent) => void,
  options?: {
    provider?: string
    model?: string
    thinkingLevel?: ThinkingLevel
    sessionPath?: string  // specific session to open
  }
): Promise<PiInstance> {
  // Return existing if alive
  const existing = instances.get(cwd)
  if (existing) return existing

  const auth = getAuthStorage()
  const registry = getModelRegistry()

  const settingsManager = SettingsManager.create(cwd)

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    settingsManager,
  })
  await resourceLoader.reload()

  // Determine session manager
  let sessionManager: SessionManager
  if (options?.sessionPath) {
    sessionManager = SessionManager.open(options.sessionPath)
  } else {
    // Continue most recent or create new
    sessionManager = SessionManager.continueRecent(cwd)
  }

  // Resolve model
  let model: Model<any> | undefined
  if (options?.provider && options?.model) {
    model = registry.find(options.provider, options.model) ?? undefined
  }
  // If no explicit model, createAgentSession resolves from settings/session/fallback

  const { session, extensionsResult } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: options?.thinkingLevel,
    authStorage: auth,
    modelRegistry: registry,
    sessionManager,
    settingsManager,
    resourceLoader,
  })

  // Subscribe to all events and forward to bridge
  const unsubscribe = session.subscribe(onEvent)

  const instance: PiInstance = {
    session,
    resourceLoader,
    settingsManager,
    unsubscribe,
    cwd,
    createdAt: Date.now(),
  }

  instances.set(cwd, instance)
  return instance
}

/**
 * Dispose a Pi instance for a project.
 */
export function disposeInstance(cwd: string): void {
  const instance = instances.get(cwd)
  if (!instance) return
  instance.unsubscribe()
  instance.session.dispose()
  instances.delete(cwd)
}

/**
 * Dispose ALL Pi instances (bridge shutdown).
 */
export function disposeAll(): void {
  for (const [cwd] of instances) {
    disposeInstance(cwd)
  }
}
```

### Session Listing (static, no instance needed)

```typescript
/**
 * List Pi sessions for a project (or all projects).
 * Uses SessionManager.list() — reads JSONL headers, fast.
 */
export async function listSessions(cwd?: string): Promise<SessionInfo[]> {
  if (cwd) {
    return SessionManager.list(cwd)
  }
  return SessionManager.listAll()
}

/**
 * List available models (requires auth + model registry).
 */
export async function listAvailableModels(): Promise<Model<any>[]> {
  return getModelRegistry().getAvailable()
}

/**
 * Check if Pi SDK is functional (has at least one authenticated provider).
 */
export async function isPiAvailable(): Promise<{ available: boolean; version?: string }> {
  try {
    const models = await getModelRegistry().getAvailable()
    return {
      available: models.length > 0,
      version: '0.52.9', // TODO: import VERSION from pi-coding-agent
    }
  } catch {
    return { available: false }
  }
}
```

### Event Translation (Pi events → Broski stream messages)

```typescript
import type { PiStreamMessage } from '../types'

/**
 * Translate a Pi AgentSessionEvent into our normalized PiStreamMessage.
 * This is what gets sent to Flutter over WebSocket.
 */
export function translateEvent(event: AgentSessionEvent): PiStreamMessage | null {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent-start' }

    case 'agent_end':
      return {
        type: 'agent-end',
        messages: event.messages.map(mapAgentMessage),
      }

    case 'turn_start':
      return { type: 'turn-start' }

    case 'turn_end':
      return {
        type: 'turn-end',
        message: mapAgentMessage(event.message),
        toolResults: event.toolResults.map(mapToolResult),
      }

    case 'message_update': {
      const ame = event.assistantMessageEvent
      if (ame.type === 'text_delta') {
        return { type: 'text-delta', content: ame.delta }
      }
      if (ame.type === 'thinking_delta') {
        return { type: 'thinking-delta', content: ame.delta }
      }
      if (ame.type === 'toolcall_start') {
        const tc = ame.partial.content[ame.contentIndex]
        if (tc && tc.type === 'toolCall') {
          return {
            type: 'tool-call-start',
            toolCallId: tc.id,
            toolName: tc.name,
            args: tc.arguments,
          }
        }
      }
      if (ame.type === 'toolcall_end') {
        return {
          type: 'tool-call-args-done',
          toolCallId: ame.toolCall.id,
          toolName: ame.toolCall.name,
          args: ame.toolCall.arguments,
        }
      }
      if (ame.type === 'done' || ame.type === 'error') {
        return { type: 'message-done', stopReason: ame.type === 'done' ? ame.reason : ame.reason }
      }
      return null // skip other deltas we don't need
    }

    case 'tool_execution_start':
      return {
        type: 'tool-exec-start',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      }

    case 'tool_execution_update':
      return {
        type: 'tool-exec-update',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        partialResult: event.partialResult,
      }

    case 'tool_execution_end':
      return {
        type: 'tool-exec-end',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      }

    case 'auto_compaction_start':
      return { type: 'compaction-start', reason: event.reason }

    case 'auto_compaction_end':
      return {
        type: 'compaction-end',
        aborted: event.aborted,
        willRetry: event.willRetry,
        errorMessage: event.errorMessage,
      }

    case 'auto_retry_start':
      return {
        type: 'retry-start',
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage,
      }

    case 'auto_retry_end':
      return {
        type: 'retry-end',
        success: event.success,
        attempt: event.attempt,
        finalError: event.finalError,
      }

    default:
      return null
  }
}
```

### Message Mapping Helpers

```typescript
function mapAgentMessage(msg: AgentMessage): any {
  if (msg.role === 'user') {
    return {
      role: 'user',
      content: typeof msg.content === 'string' ? msg.content : extractText(msg.content),
      timestamp: msg.timestamp,
    }
  }
  if (msg.role === 'assistant') {
    const am = msg as AssistantMessage
    return {
      role: 'assistant',
      text: extractText(am.content.filter(c => c.type === 'text')),
      thinking: extractThinking(am.content),
      toolCalls: extractToolCalls(am.content),
      model: am.model,
      provider: am.provider,
      usage: am.usage,
      stopReason: am.stopReason,
      timestamp: am.timestamp,
    }
  }
  if (msg.role === 'toolResult') {
    const tr = msg as ToolResultMessage
    return {
      role: 'toolResult',
      toolCallId: tr.toolCallId,
      toolName: tr.toolName,
      content: extractText(tr.content),
      isError: tr.isError,
      timestamp: tr.timestamp,
    }
  }
  // bashExecution, custom, compactionSummary, branchSummary
  return { role: msg.role, ...msg }
}
```

---

## 6. Phase 2 — Bridge Types

**Additions to `packages/bridge/src/types.ts`:**

### ClientMessage additions

```typescript
// Pi Coding Agent messages
| { type: 'pi_chat'; prompt: string; projectPath?: string; fileAttachments?: FileAttachment[]; streamingBehavior?: 'steer' | 'followUp' }
| { type: 'pi_steer'; message: string; projectPath?: string }
| { type: 'pi_follow_up'; message: string; projectPath?: string }
| { type: 'pi_abort'; projectPath?: string }
| { type: 'pi_get_state'; projectPath?: string }
| { type: 'pi_list_models'; projectPath?: string }
| { type: 'pi_set_model'; provider: string; modelId: string; projectPath?: string }
| { type: 'pi_set_thinking_level'; level: string; projectPath?: string }
| { type: 'pi_cycle_thinking_level'; projectPath?: string }
| { type: 'pi_cycle_model'; projectPath?: string }
| { type: 'pi_list_sessions'; projectPath?: string }
| { type: 'pi_new_session'; projectPath?: string }
| { type: 'pi_switch_session'; sessionPath: string; projectPath?: string }
| { type: 'pi_delete_session'; sessionPath: string; projectPath?: string }
| { type: 'pi_get_session_stats'; projectPath?: string }
| { type: 'pi_get_messages'; projectPath?: string }
| { type: 'pi_set_session_name'; name: string; projectPath?: string }
| { type: 'pi_fork'; entryId: string; projectPath?: string }
| { type: 'pi_get_fork_messages'; projectPath?: string }
| { type: 'pi_navigate_tree'; targetId: string; projectPath?: string }
| { type: 'pi_list_commands'; projectPath?: string }
| { type: 'pi_compact'; customInstructions?: string; projectPath?: string }
| { type: 'pi_set_auto_compaction'; enabled: boolean; projectPath?: string }
| { type: 'pi_export_html'; outputPath?: string; projectPath?: string }
| { type: 'pi_get_settings'; projectPath?: string }
| { type: 'pi_set_settings'; settings: Record<string, any>; projectPath?: string }
| { type: 'pi_dispose_instance'; projectPath?: string }
| { type: 'pi_extension_ui_response'; id: string; value?: any; confirmed?: boolean; cancelled?: boolean; projectPath?: string }
```

### ServerMessage additions

```typescript
| { type: 'pi_state'; data: PiStatePayload; requestId?: string }
| { type: 'pi_models'; data: PiModelPayload[]; requestId?: string }
| { type: 'pi_model_set'; data: PiModelPayload; requestId?: string }
| { type: 'pi_thinking_level'; data: { level: string }; requestId?: string }
| { type: 'pi_sessions'; data: PiSessionInfo[]; requestId?: string }
| { type: 'pi_session_created'; data: boolean; requestId?: string }
| { type: 'pi_session_switched'; data: boolean; requestId?: string }
| { type: 'pi_session_deleted'; data: boolean; requestId?: string }
| { type: 'pi_session_stats'; data: any; requestId?: string }
| { type: 'pi_messages'; data: any[]; requestId?: string }
| { type: 'pi_session_name_set'; data: boolean; requestId?: string }
| { type: 'pi_fork_result'; data: { text: string; cancelled: boolean }; requestId?: string }
| { type: 'pi_fork_messages'; data: Array<{ entryId: string; text: string }>; requestId?: string }
| { type: 'pi_tree_navigated'; data: { editorText?: string; cancelled: boolean }; requestId?: string }
| { type: 'pi_commands'; data: PiCommandPayload[]; requestId?: string }
| { type: 'pi_compacted'; data: any; requestId?: string }
| { type: 'pi_auto_compaction_set'; data: boolean; requestId?: string }
| { type: 'pi_export_result'; data: { path: string }; requestId?: string }
| { type: 'pi_settings'; data: Record<string, any>; requestId?: string }
| { type: 'pi_settings_updated'; data: boolean; requestId?: string }
| { type: 'pi_instance_disposed'; data: boolean; requestId?: string }
| { type: 'pi_stream'; data: PiStreamMessage; sessionId?: string }
```

### New types

```typescript
// ============================================================================
// PI CODING AGENT TYPES
// ============================================================================

export type PiStatePayload = {
  model: PiModelPayload | null
  thinkingLevel: string  // 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  isStreaming: boolean
  isCompacting: boolean
  sessionFile: string | null
  sessionId: string
  sessionName: string | null
  autoCompactionEnabled: boolean
  messageCount: number
  pendingMessageCount: number
}

export type PiModelPayload = {
  id: string
  name: string
  provider: string
  api: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  input: string[]   // ['text'] or ['text', 'image']
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export type PiSessionInfo = {
  path: string
  id: string
  cwd: string
  name?: string
  parentSessionPath?: string
  created: number   // unix ms
  modified: number  // unix ms
  messageCount: number
  firstMessage: string
}

export type PiCommandPayload = {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill'
  location?: 'user' | 'project' | 'path'
  path?: string
}

export type PiStreamMessage =
  | { type: 'agent-start' }
  | { type: 'agent-end'; messages: any[] }
  | { type: 'turn-start' }
  | { type: 'turn-end'; message: any; toolResults: any[] }
  | { type: 'text-delta'; content: string }
  | { type: 'thinking-delta'; content: string }
  | { type: 'tool-call-start'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool-call-args-done'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool-exec-start'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool-exec-update'; toolCallId: string; toolName: string; partialResult: any }
  | { type: 'tool-exec-end'; toolCallId: string; toolName: string; result: any; isError: boolean }
  | { type: 'message-done'; stopReason: string }
  | { type: 'compaction-start'; reason: string }
  | { type: 'compaction-end'; aborted: boolean; willRetry: boolean; errorMessage?: string }
  | { type: 'retry-start'; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: 'retry-end'; success: boolean; attempt: number; finalError?: string }
  | { type: 'extension-ui-request'; id: string; method: string; [key: string]: any }
  | { type: 'error'; message: string; code?: string }
```

---

## 7. Phase 3 — Bridge Message Handlers

**New file: `packages/bridge/src/handlers/pi_features.ts`**

Every `pi_*` message routes here. The handler calls the Pi connector directly — no JSON parsing, no subprocess, just function calls on `AgentSession`.

```typescript
import * as pi from '../connectors/pi'
import type { ServerMessage } from '../types'

type Reply = (msg: ServerMessage & { requestId?: string }) => void

export async function handle(
  message: any,
  reply: Reply,
  broadcast: (msg: ServerMessage) => void,
): Promise<boolean> {
  const cwd = message.projectPath ?? message.cwd

  switch (message.type) {
    // ── Chat ────────────────────────────────────────────────────
    case 'pi_chat': {
      const inst = await pi.getOrCreateInstance(cwd, (event) => {
        const streamMsg = pi.translateEvent(event)
        if (streamMsg) broadcast({ type: 'pi_stream', data: streamMsg, sessionId: inst.session.sessionId })
      })

      // Convert file attachments to Pi image format
      const images = (message.fileAttachments ?? [])
        .filter((a: any) => a.mimeType?.startsWith('image/'))
        .map((a: any) => ({ type: 'image' as const, data: a.base64Data, mimeType: a.mimeType }))

      // If already streaming, respect streamingBehavior
      if (inst.session.isStreaming && message.streamingBehavior === 'steer') {
        await inst.session.steer(message.prompt)
      } else if (inst.session.isStreaming && message.streamingBehavior === 'followUp') {
        await inst.session.followUp(message.prompt)
      } else {
        // session.prompt() is async — it resolves when the agent finishes
        // Events stream via subscribe() callback above
        inst.session.prompt(message.prompt, {
          images: images.length > 0 ? images : undefined,
        }).catch(err => {
          broadcast({ type: 'pi_stream', data: { type: 'error', message: err?.message ?? String(err) }, sessionId: inst.session.sessionId })
        })
      }
      reply({ type: 'pi_chat_started' as any, data: true, requestId: message.requestId })
      break
    }

    case 'pi_steer': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      await inst.session.steer(message.message)
      reply({ type: 'pi_steered' as any, data: true, requestId: message.requestId })
      break
    }

    case 'pi_follow_up': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      await inst.session.followUp(message.message)
      reply({ type: 'pi_followed_up' as any, data: true, requestId: message.requestId })
      break
    }

    case 'pi_abort': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      await inst.session.abort()
      reply({ type: 'pi_aborted' as any, data: true, requestId: message.requestId })
      break
    }

    // ── State ───────────────────────────────────────────────────
    case 'pi_get_state': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const s = inst.session
      reply({
        type: 'pi_state',
        data: {
          model: s.model ? pi.mapModel(s.model) : null,
          thinkingLevel: s.thinkingLevel ?? 'off',
          isStreaming: s.isStreaming,
          isCompacting: false, // TODO: track from compaction events
          sessionFile: s.sessionFile ?? null,
          sessionId: s.sessionId,
          sessionName: null, // TODO: from SessionManager
          autoCompactionEnabled: true, // default
          messageCount: s.messages.length,
          pendingMessageCount: 0,
        },
        requestId: message.requestId,
      })
      break
    }

    // ── Models ──────────────────────────────────────────────────
    case 'pi_list_models': {
      const models = await pi.listAvailableModels()
      reply({
        type: 'pi_models',
        data: models.map(pi.mapModel),
        requestId: message.requestId,
      })
      break
    }

    case 'pi_set_model': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const registry = pi.getModelRegistry()
      const model = registry.find(message.provider, message.modelId)
      if (!model) throw new Error(`Model not found: ${message.provider}/${message.modelId}`)
      await inst.session.setModel(model)
      reply({ type: 'pi_model_set', data: pi.mapModel(model), requestId: message.requestId })
      break
    }

    case 'pi_set_thinking_level': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      inst.session.setThinkingLevel(message.level)
      reply({ type: 'pi_thinking_level', data: { level: message.level }, requestId: message.requestId })
      break
    }

    case 'pi_cycle_thinking_level': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const level = inst.session.cycleThinkingLevel()
      reply({ type: 'pi_thinking_level', data: { level: level ?? 'off' }, requestId: message.requestId })
      break
    }

    case 'pi_cycle_model': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const result = await inst.session.cycleModel()
      reply({
        type: 'pi_model_set',
        data: result?.model ? pi.mapModel(result.model) : null,
        requestId: message.requestId,
      })
      break
    }

    // ── Sessions ────────────────────────────────────────────────
    case 'pi_list_sessions': {
      const sessions = await pi.listSessions(cwd)
      reply({
        type: 'pi_sessions',
        data: sessions.map(s => ({
          path: s.path,
          id: s.id,
          cwd: s.cwd,
          name: s.name,
          parentSessionPath: s.parentSessionPath,
          created: s.created.getTime(),
          modified: s.modified.getTime(),
          messageCount: s.messageCount,
          firstMessage: s.firstMessage,
        })),
        requestId: message.requestId,
      })
      break
    }

    case 'pi_new_session': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const cancelled = !(await inst.session.newSession())
      reply({ type: 'pi_session_created', data: !cancelled, requestId: message.requestId })
      break
    }

    case 'pi_switch_session': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const cancelled = !(await inst.session.switchSession(message.sessionPath))
      reply({ type: 'pi_session_switched', data: !cancelled, requestId: message.requestId })
      break
    }

    case 'pi_get_messages': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      reply({
        type: 'pi_messages',
        data: inst.session.messages.map(pi.mapAgentMessage),
        requestId: message.requestId,
      })
      break
    }

    case 'pi_get_session_stats': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const msgs = inst.session.messages
      // Compute stats from messages
      let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheWrite = 0, cost = 0
      for (const m of msgs) {
        if (m.role === 'assistant' && (m as any).usage) {
          const u = (m as any).usage
          inputTokens += u.input ?? 0
          outputTokens += u.output ?? 0
          cacheRead += u.cacheRead ?? 0
          cacheWrite += u.cacheWrite ?? 0
          cost += u.cost?.total ?? 0
        }
      }
      reply({
        type: 'pi_session_stats',
        data: {
          sessionFile: inst.session.sessionFile,
          sessionId: inst.session.sessionId,
          userMessages: msgs.filter(m => m.role === 'user').length,
          assistantMessages: msgs.filter(m => m.role === 'assistant').length,
          toolCalls: msgs.filter(m => m.role === 'toolResult').length,
          totalMessages: msgs.length,
          tokens: { input: inputTokens, output: outputTokens, cacheRead, cacheWrite, total: inputTokens + outputTokens + cacheRead + cacheWrite },
          cost,
        },
        requestId: message.requestId,
      })
      break
    }

    // ── Tree Navigation (Pi-exclusive) ──────────────────────────
    case 'pi_fork': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const result = await inst.session.fork(message.entryId)
      reply({ type: 'pi_fork_result', data: result, requestId: message.requestId })
      break
    }

    case 'pi_navigate_tree': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const result = await inst.session.navigateTree(message.targetId)
      reply({ type: 'pi_tree_navigated', data: result, requestId: message.requestId })
      break
    }

    // ── Commands ────────────────────────────────────────────────
    case 'pi_list_commands': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const loader = inst.resourceLoader
      const skills = loader.getSkills().skills.map(s => ({
        name: `skill:${s.name}`, description: s.description, source: 'skill' as const, path: s.filePath,
      }))
      const prompts = loader.getPrompts().prompts.map(p => ({
        name: p.name, description: p.description, source: 'prompt' as const, path: p.source,
      }))
      // Extension commands from the extensions result — we'd need to track these
      reply({ type: 'pi_commands', data: [...skills, ...prompts], requestId: message.requestId })
      break
    }

    // ── Compaction ──────────────────────────────────────────────
    case 'pi_compact': {
      const inst = await pi.getOrCreateInstance(cwd, () => {})
      const result = await inst.session.compact(message.customInstructions)
      reply({ type: 'pi_compacted', data: result, requestId: message.requestId })
      break
    }

    // ── Export ──────────────────────────────────────────────────
    case 'pi_export_html': {
      // Pi SDK doesn't have direct HTML export via session — it's a CLI feature
      // We'd call the export utility function if available, or shell out
      reply({ type: 'pi_export_result', data: { path: '' }, requestId: message.requestId })
      break
    }

    // ── Cleanup ─────────────────────────────────────────────────
    case 'pi_dispose_instance': {
      pi.disposeInstance(cwd)
      reply({ type: 'pi_instance_disposed', data: true, requestId: message.requestId })
      break
    }

    default:
      return false
  }
  return true
}
```

### Registration in `server.ts` — 5 lines total

```typescript
import * as piFeatures from './handlers/pi_features'

// In processSingleMessage(), add ONE block:
if (message.type.startsWith('pi_')) {
  return piFeatures.handle(message, reply, broadcast)
}

// In getAgentsStatus(), add:
const piStatus = await pi.isPiAvailable()
backends.pi = { available: piStatus.available, version: piStatus.version }

// In shutdown(), add:
pi.disposeAll()
```

---

## 8. Phase 4 — Flutter Models

**New file: `lib/models/pi.dart`**

```dart
/// Pi model (from ModelRegistry.getAvailable())
class PiModel {
  final String id;
  final String name;
  final String provider;
  final String api;
  final int contextWindow;
  final int maxTokens;
  final bool reasoning;
  final List<String> input; // ['text'] or ['text', 'image']
  final PiModelCost cost;

  const PiModel({
    required this.id, required this.name, required this.provider,
    required this.api, required this.contextWindow, required this.maxTokens,
    required this.reasoning, required this.input, required this.cost,
  });

  factory PiModel.fromJson(Map<String, dynamic> json) => PiModel(
    id: json['id'] as String? ?? '',
    name: json['name'] as String? ?? '',
    provider: json['provider'] as String? ?? '',
    api: json['api'] as String? ?? '',
    contextWindow: json['contextWindow'] as int? ?? 0,
    maxTokens: json['maxTokens'] as int? ?? 0,
    reasoning: json['reasoning'] as bool? ?? false,
    input: (json['input'] as List<dynamic>?)?.cast<String>() ?? ['text'],
    cost: PiModelCost.fromJson(json['cost'] as Map<String, dynamic>? ?? {}),
  );

  bool get supportsImages => input.contains('image');
}

class PiModelCost {
  final double input;
  final double output;
  final double cacheRead;
  final double cacheWrite;

  const PiModelCost({this.input = 0, this.output = 0, this.cacheRead = 0, this.cacheWrite = 0});

  factory PiModelCost.fromJson(Map<String, dynamic> json) => PiModelCost(
    input: (json['input'] as num?)?.toDouble() ?? 0,
    output: (json['output'] as num?)?.toDouble() ?? 0,
    cacheRead: (json['cacheRead'] as num?)?.toDouble() ?? 0,
    cacheWrite: (json['cacheWrite'] as num?)?.toDouble() ?? 0,
  );
}

/// Pi session state (from pi_get_state)
class PiState {
  final PiModel? model;
  final PiThinkingLevel thinkingLevel;
  final bool isStreaming;
  final bool isCompacting;
  final String? sessionFile;
  final String sessionId;
  final String? sessionName;
  final bool autoCompactionEnabled;
  final int messageCount;
  final int pendingMessageCount;

  const PiState({
    this.model, this.thinkingLevel = PiThinkingLevel.medium,
    this.isStreaming = false, this.isCompacting = false,
    this.sessionFile, this.sessionId = '', this.sessionName,
    this.autoCompactionEnabled = true, this.messageCount = 0,
    this.pendingMessageCount = 0,
  });

  factory PiState.fromJson(Map<String, dynamic> json) => PiState(
    model: json['model'] != null ? PiModel.fromJson(json['model'] as Map<String, dynamic>) : null,
    thinkingLevel: PiThinkingLevel.fromWireValue(json['thinkingLevel'] as String? ?? 'medium'),
    isStreaming: json['isStreaming'] as bool? ?? false,
    isCompacting: json['isCompacting'] as bool? ?? false,
    sessionFile: json['sessionFile'] as String?,
    sessionId: json['sessionId'] as String? ?? '',
    sessionName: json['sessionName'] as String?,
    autoCompactionEnabled: json['autoCompactionEnabled'] as bool? ?? true,
    messageCount: json['messageCount'] as int? ?? 0,
    pendingMessageCount: json['pendingMessageCount'] as int? ?? 0,
  );
}

/// Pi thinking levels (6 levels, richer than any other backend)
enum PiThinkingLevel {
  off, minimal, low, medium, high, xhigh;

  String get wireValue => name;
  String get displayName => switch (this) {
    PiThinkingLevel.off => 'Off',
    PiThinkingLevel.minimal => 'Minimal',
    PiThinkingLevel.low => 'Low',
    PiThinkingLevel.medium => 'Medium',
    PiThinkingLevel.high => 'High',
    PiThinkingLevel.xhigh => 'Max',
  };
  static PiThinkingLevel fromWireValue(String v) =>
    PiThinkingLevel.values.firstWhere((e) => e.name == v, orElse: () => PiThinkingLevel.medium);
}

/// Pi session info (from pi_list_sessions)
class PiSessionInfo {
  final String path;
  final String id;
  final String cwd;
  final String? name;
  final String? parentSessionPath;
  final DateTime created;
  final DateTime modified;
  final int messageCount;
  final String firstMessage;

  const PiSessionInfo({
    required this.path, required this.id, required this.cwd,
    this.name, this.parentSessionPath,
    required this.created, required this.modified,
    required this.messageCount, required this.firstMessage,
  });

  factory PiSessionInfo.fromJson(Map<String, dynamic> json) => PiSessionInfo(
    path: json['path'] as String? ?? '',
    id: json['id'] as String? ?? '',
    cwd: json['cwd'] as String? ?? '',
    name: json['name'] as String?,
    parentSessionPath: json['parentSessionPath'] as String?,
    created: DateTime.fromMillisecondsSinceEpoch(json['created'] as int? ?? 0),
    modified: DateTime.fromMillisecondsSinceEpoch(json['modified'] as int? ?? 0),
    messageCount: json['messageCount'] as int? ?? 0,
    firstMessage: json['firstMessage'] as String? ?? '',
  );
}

/// Pi command (slash command, skill, or prompt template)
class PiCommand {
  final String name;
  final String? description;
  final String source; // 'extension', 'prompt', 'skill'
  final String? location;
  final String? path;

  const PiCommand({required this.name, this.description, required this.source, this.location, this.path});

  factory PiCommand.fromJson(Map<String, dynamic> json) => PiCommand(
    name: json['name'] as String? ?? '',
    description: json['description'] as String?,
    source: json['source'] as String? ?? 'extension',
    location: json['location'] as String?,
    path: json['path'] as String?,
  );
}

/// Pi session stats
class PiSessionStats {
  final String? sessionFile;
  final String sessionId;
  final int userMessages;
  final int assistantMessages;
  final int toolCalls;
  final int totalMessages;
  final PiTokenUsage tokens;
  final double cost;

  const PiSessionStats({
    this.sessionFile, this.sessionId = '',
    this.userMessages = 0, this.assistantMessages = 0,
    this.toolCalls = 0, this.totalMessages = 0,
    this.tokens = const PiTokenUsage(), this.cost = 0,
  });

  factory PiSessionStats.fromJson(Map<String, dynamic> json) => PiSessionStats(
    sessionFile: json['sessionFile'] as String?,
    sessionId: json['sessionId'] as String? ?? '',
    userMessages: json['userMessages'] as int? ?? 0,
    assistantMessages: json['assistantMessages'] as int? ?? 0,
    toolCalls: json['toolCalls'] as int? ?? 0,
    totalMessages: json['totalMessages'] as int? ?? 0,
    tokens: PiTokenUsage.fromJson(json['tokens'] as Map<String, dynamic>? ?? {}),
    cost: (json['cost'] as num?)?.toDouble() ?? 0,
  );
}

class PiTokenUsage {
  final int input;
  final int output;
  final int cacheRead;
  final int cacheWrite;
  final int total;

  const PiTokenUsage({this.input = 0, this.output = 0, this.cacheRead = 0, this.cacheWrite = 0, this.total = 0});

  factory PiTokenUsage.fromJson(Map<String, dynamic> json) => PiTokenUsage(
    input: json['input'] as int? ?? 0,
    output: json['output'] as int? ?? 0,
    cacheRead: json['cacheRead'] as int? ?? 0,
    cacheWrite: json['cacheWrite'] as int? ?? 0,
    total: json['total'] as int? ?? 0,
  );
}

/// Pi stream message (normalized from bridge)
class PiStreamMessage {
  final String type;
  final Map<String, dynamic> raw;
  const PiStreamMessage({required this.type, required this.raw});

  factory PiStreamMessage.fromJson(Map<String, dynamic> json) =>
    PiStreamMessage(type: json['type'] as String? ?? 'unknown', raw: json);

  String? get textDelta => type == 'text-delta' ? raw['content'] as String? : null;
  String? get thinkingDelta => type == 'thinking-delta' ? raw['content'] as String? : null;
  bool get isAgentStart => type == 'agent-start';
  bool get isAgentEnd => type == 'agent-end';
  bool get isError => type == 'error';
  String? get errorMessage => type == 'error' ? raw['message'] as String? : null;
}
```

---

## 9. Phase 5 — Flutter Bridge Service Methods

Add to `lib/services/bridge_service.dart` (following existing patterns):

```dart
// ═══════════════════════════════════════════════════════════════
// PI CODING AGENT
// ═══════════════════════════════════════════════════════════════

Future<PiState> piGetState({String? projectPath}) async { /* _waitFor('pi_state') */ }

void piChat({required String prompt, String? projectPath, List<FileAttachment>? fileAttachments, String? streamingBehavior}) { /* fire-and-forget */ }
void piSteer({required String message, String? projectPath}) { /* fire-and-forget */ }
void piFollowUp({required String message, String? projectPath}) { /* fire-and-forget */ }
void piAbort({String? projectPath}) { /* fire-and-forget */ }

Future<List<PiModel>> piListModels({String? projectPath}) async { /* _waitFor('pi_models') */ }
Future<PiModel> piSetModel({required String provider, required String modelId, String? projectPath}) async { /* _waitFor('pi_model_set') */ }
Future<String> piSetThinkingLevel({required String level, String? projectPath}) async { /* _waitFor('pi_thinking_level') */ }
Future<String> piCycleThinkingLevel({String? projectPath}) async { /* _waitFor('pi_thinking_level') */ }

Future<List<PiSessionInfo>> piListSessions({String? projectPath}) async { /* _waitFor('pi_sessions') */ }
Future<void> piNewSession({String? projectPath}) async { /* _waitFor('pi_session_created') */ }
Future<void> piSwitchSession({required String sessionPath, String? projectPath}) async { /* _waitFor('pi_session_switched') */ }
Future<List<dynamic>> piGetMessages({String? projectPath}) async { /* _waitFor('pi_messages') */ }
Future<PiSessionStats> piGetSessionStats({String? projectPath}) async { /* _waitFor('pi_session_stats') */ }

Future<List<PiCommand>> piListCommands({String? projectPath}) async { /* _waitFor('pi_commands') */ }
Future<void> piCompact({String? customInstructions, String? projectPath}) async { /* _waitFor('pi_compacted') */ }

Stream<PiStreamMessage> get piStreamMessages =>
  _socket.messages.where((m) => m['type'] == 'pi_stream')
    .map((m) => PiStreamMessage.fromJson(m['data'] as Map<String, dynamic>? ?? {}));
```

---

## 10. Phase 6 — Riverpod Providers

**New file: `lib/providers/pi_provider.dart`**

```dart
final piStateProvider = FutureProvider.family<PiState, String?>((ref, projectPath) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.piGetState(projectPath: projectPath);
});

final piModelsProvider = FutureProvider<List<PiModel>>((ref) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.piListModels();
});

final piSessionsProvider = FutureProvider.family<List<PiSessionInfo>, String?>((ref, projectPath) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.piListSessions(projectPath: projectPath);
});

final piCommandsProvider = FutureProvider.family<List<PiCommand>, String?>((ref, projectPath) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.piListCommands(projectPath: projectPath);
});

final piSessionStatsProvider = FutureProvider.family<PiSessionStats, String?>((ref, projectPath) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.piGetSessionStats(projectPath: projectPath);
});
```

---

## 11. Phase 7 — Chat Streaming & Message Rendering

### ChatSessionState additions

```dart
class ChatSessionState {
  // ... existing fields ...

  // Pi support
  final bool isPi;
  final String? piSessionId;
  final String? piCwd;
  final PiModel? piModel;
  final PiThinkingLevel piThinkingLevel;
  final PiTokenUsage? piTokenUsage;
  final bool piIsStreaming;
}
```

### Stream listener in ChatProvider

```dart
void _initPiStreamListener() {
  _piStreamSub = _bridge.piStreamMessages.listen((msg) {
    switch (msg.type) {
      case 'agent-start':
        state = state.copyWith(piIsStreaming: true);
      case 'text-delta':
        _appendOrUpdateAssistantText(msg.textDelta!);
      case 'thinking-delta':
        _appendOrUpdateThinking(msg.thinkingDelta!);
      case 'tool-exec-start':
        _addToolCall(
          name: msg.raw['toolName'] as String,
          toolCallId: msg.raw['toolCallId'] as String,
          input: msg.raw['args'] as Map<String, dynamic>? ?? {},
          status: 'running',
        );
      case 'tool-exec-end':
        _completeToolCall(
          toolCallId: msg.raw['toolCallId'] as String,
          result: msg.raw['result'],
          isError: msg.raw['isError'] as bool? ?? false,
        );
      case 'agent-end':
        state = state.copyWith(piIsStreaming: false);
        _refreshPiState();
      case 'compaction-start':
        state = state.copyWith(isCompacting: true);
      case 'compaction-end':
        state = state.copyWith(isCompacting: false);
      case 'retry-start':
        _addRetryIndicator(msg.raw);
      case 'error':
        _addErrorMessage(msg.errorMessage ?? 'Unknown Pi error');
        state = state.copyWith(piIsStreaming: false);
    }
  });
}
```

### Message role mapping

| Pi `AgentMessage.role` | Broski `ChatMessage` | Card widget |
|------------------------|---------------------|-------------|
| `user` | User bubble | `MessageBubble` |
| `assistant` (text) | Assistant bubble | `MessageBubble` |
| `assistant` (thinking) | Thinking block | `CompactThinkingCard` |
| `assistant` (toolCall) | Tool call card | `CompactToolCard` / `CompactEditCard` / `CompactWriteCard` |
| `toolResult` | Attached to tool call | Part of `CompactToolCard` detail sheet |
| `bashExecution` | System code block | `CompactToolCard` with bash styling |
| `compactionSummary` | Divider | Compact divider widget |
| `branchSummary` | System note | Info banner |
| `custom` | Extension message | Muted system message |

---

## 12. Phase 8 — Session Management

### Session listing uses `SessionManager.list()`

The bridge connector calls `SessionManager.list(cwd)` directly — typed, fast, no filesystem parsing needed. Returns `SessionInfo[]` with path, id, cwd, name, messageCount, firstMessage, created, modified.

### Session operations via `AgentSession`

| Operation | SDK Call |
|-----------|---------|
| New session | `session.newSession()` |
| Switch session | `session.switchSession(path)` |
| Fork from point | `session.fork(entryId)` → creates new session file |
| Navigate tree | `session.navigateTree(targetId)` → in-place branch |
| Get fork points | Access via `SessionManager` tree API |
| Get all messages | `session.messages` (direct property access) |

### Session tree (Pi-exclusive feature)

Pi sessions are trees, not linear lists. We can build a tree navigator:

**New file: `lib/screens/sheets/pi_tree_sheet.dart`** — visual tree of session branches with tap-to-navigate.

---

## 13. Phase 9 — Model & Provider Management

### Pi's multi-provider model registry

`ModelRegistry.getAvailable()` returns all models across all authenticated providers. This is the richest model list of any backend.

**New file: `lib/screens/sheets/pi_model_sheet.dart`**

```dart
// Group models by provider, show ProviderIcon for each group
// Each model tile shows: name, context window, reasoning badge, cost
// Tap to select → bridge.piSetModel(provider, modelId)
```

### Thinking level

Pi supports 6 levels: off, minimal, low, medium, high, xhigh. Expose as a tappable chip in the input bar that cycles on tap.

### Provider icon coverage

Our existing `ProviderIcon` widget already covers all of Pi's providers (anthropic, openai, google, mistral, groq, xai, openrouter, etc.). No changes needed.

---

## 14. Phase 10 — Skills, Extensions, Commands

### Commands list

`DefaultResourceLoader` gives us skills, prompt templates, and extension commands. The bridge handler assembles these from `loader.getSkills()` and `loader.getPrompts()`.

To execute a command: send `pi_chat` with prompt `'/commandname args'` — Pi expands it internally.

### Extension management

Read `~/.pi/agent/extensions/` and `.pi/extensions/` for installed extensions. For Pi Packages, the bridge could call `pi install`/`pi remove` via a PTY session.

**New file: `lib/screens/pi_packages_screen.dart`** (future phase)

---

## 15. Phase 11 — Tool Cards & Themed UI

### Zero changes to tool_style.dart

Pi's built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) are already pattern-matched by our existing `ToolStyle.getToolType()`:

| Pi Tool | Matched Pattern | ToolType | Card |
|---------|----------------|----------|------|
| `read` | `name.contains('read')` | `ToolType.read` | `CompactToolCard` |
| `write` | `name.contains('write')` | `ToolType.write` | `CompactWriteCard` |
| `edit` | `name.contains('edit')` | `ToolType.edit` | `CompactEditCard` |
| `bash` | `name.contains('bash')` | `ToolType.bash` | `CompactToolCard` |
| `grep` | `name.contains('grep')` | `ToolType.search` | `CompactToolCard` |
| `find` | `name.contains('find')` | `ToolType.search` | `CompactToolCard` |
| `ls` | `name.contains('ls')` | `ToolType.search` | `CompactToolCard` |

Extension-registered tools will fall through to `ToolType.unknown` or match by name patterns. **This just works.**

### Pi-specific UI elements in chat input bar

When `agentType == AgentType.pi`:
- **Model chip**: Shows `piState.model.name`, tappable → model picker sheet
- **Thinking badge**: Shows level, tappable → cycles level
- **Context bar**: `tokens.total / model.contextWindow` as LinearProgressIndicator
- **Provider icon**: `ProviderIcon(providerId: piState.model.provider)`

---

## 16. Phase 12 — Extension UI Forwarding

Pi extensions can request user interaction via `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.input()`. The SDK fires these as events we'd need to handle.

**In-process approach**: Since we're using the SDK, we can register an inline extension that intercepts these:

```typescript
// In the connector, when creating the session:
const loader = new DefaultResourceLoader({
  extensionFactories: [
    (piApi) => {
      // This extension bridges Pi's extension UI to Broski
      piApi.on('tool_call', async (event, ctx) => {
        // We can intercept tool calls here if needed for permission prompts
      })
    },
  ],
})
```

For dialog methods, we'd need to implement a custom `ExtensionUIContext` adapter that forwards requests to Flutter. This is a deeper integration that can be a post-MVP feature.

**MVP approach**: Extensions run with their default behavior (auto-timeout dialogs). We add full Extension UI forwarding in a later phase.

---

## 17. Phase 13 — Advanced Features

### Session tree visualization

Pi's unique feature. `SessionManager.getTree()` returns a `SessionTreeNode[]` structure. We render this as a visual timeline with branch points. Tapping a branch point calls `session.navigateTree(targetId)`.

### Compaction controls

```dart
// Power sheet actions when Pi is active:
ListTile(title: 'Compact Session', onTap: () => bridge.piCompact(projectPath: cwd)),
SwitchListTile(title: 'Auto-Compaction', value: state.autoCompactionEnabled, onChanged: ...),
```

### HTML export

Pi SDK doesn't expose `export_html` directly as a session method — it's in the print/interactive modes. We can either:
1. Import the export utility from the SDK internals
2. Or skip this initially (MVP: no export for Pi)

### Pi Package management

Future: browse, install, remove, update Pi Packages from the app.

---

## 18. Phase 14 — Settings, Config & Polish

### Pi settings screen

**New file: `lib/screens/pi_settings_screen.dart`**

| Setting | Widget | Bridge Action |
|---------|--------|--------------|
| Default provider | Dropdown | `pi_set_settings` |
| Default model | Model picker | `pi_set_settings` |
| Default thinking level | Segmented control | `pi_set_settings` |
| Auto-compaction | Switch | `pi_set_auto_compaction` |
| Extensions path | Text field | `pi_set_settings` |
| Installed extensions | List | Read-only display |
| Pi version | Label | From `agents_status` |

### Agent backend screen

Add Pi card to `lib/screens/ai_backend_screen.dart` with provider count, model count, and auth status.

### Provider icon

Add to `lib/widgets/provider_icon.dart`:
```dart
'pi': _ProviderInfo('π', Color(0xFF7C3AED)),  // purple brand color
```

---

## 19. Complete Message Protocol

### Client → Bridge

| Message | Purpose |
|---------|---------|
| `pi_chat` | Send prompt (with optional images, streaming behavior) |
| `pi_steer` | Interrupt mid-stream with new instruction |
| `pi_follow_up` | Queue message for after agent finishes |
| `pi_abort` | Cancel current operation |
| `pi_get_state` | Get session state (model, thinking, streaming, counts) |
| `pi_list_models` | Get all available models across all providers |
| `pi_set_model` | Switch to specific provider/model |
| `pi_set_thinking_level` | Set thinking level |
| `pi_cycle_thinking_level` | Cycle to next thinking level |
| `pi_cycle_model` | Cycle to next model |
| `pi_list_sessions` | List sessions for project |
| `pi_new_session` | Start fresh session |
| `pi_switch_session` | Load different session |
| `pi_delete_session` | Delete session file |
| `pi_get_messages` | Get all messages in current session |
| `pi_get_session_stats` | Get token usage and cost stats |
| `pi_set_session_name` | Set display name for session |
| `pi_fork` | Fork session from entry point |
| `pi_get_fork_messages` | List available fork points |
| `pi_navigate_tree` | In-place tree navigation |
| `pi_list_commands` | List skills, prompts, extension commands |
| `pi_compact` | Manual compaction |
| `pi_set_auto_compaction` | Toggle auto-compaction |
| `pi_export_html` | Export session to HTML |
| `pi_get_settings` | Read Pi settings |
| `pi_set_settings` | Write Pi settings |
| `pi_dispose_instance` | Clean up Pi instance for project |

### Bridge → Client

All `pi_*` responses follow existing patterns (type + data + requestId).

`pi_stream` carries normalized `PiStreamMessage` events for real-time chat rendering.

---

## 20. Complete File Inventory

### Bridge — New Files (4 files, ~900 lines total)

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `packages/bridge/src/connectors/pi.ts` | SDK connector: session management, auth, models, event translation | ~450 |
| `packages/bridge/src/handlers/pi_features.ts` | All `pi_*` message handlers | ~350 |
| *(total bridge additions to types.ts)* | Types, stream messages | ~100 |

### Bridge — Modified Files (3 files, ~20 lines each)

| File | Change |
|------|--------|
| `packages/bridge/src/types.ts` | Add `'pi'` to AgentType, add `pi_*` to ClientMessage/ServerMessage, add Pi types |
| `packages/bridge/src/server.ts` | Import pi handlers, add `pi_` routing (~3 lines), add to `getAgentsStatus()` (~5 lines), add `disposeAll()` to shutdown |
| `packages/bridge/src/config/schema.ts` | Add `pi` config section |

### Flutter — New Files (7 files, ~1800 lines total)

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `lib/models/pi.dart` | All Pi data models | ~300 |
| `lib/providers/pi_provider.dart` | Riverpod providers | ~100 |
| `lib/screens/pi_settings_screen.dart` | Pi settings | ~250 |
| `lib/screens/sheets/pi_model_sheet.dart` | Model picker grouped by provider | ~200 |
| `lib/screens/sheets/pi_commands_sheet.dart` | Skills, prompts, extension commands | ~180 |
| `lib/screens/sheets/pi_tree_sheet.dart` | Session tree navigator | ~300 |
| `lib/screens/pi_packages_screen.dart` | Package management (future) | ~300 |

### Flutter — Modified Files (8 files, ~30-80 lines each)

| File | Change |
|------|--------|
| `lib/models/agent_type.dart` | Add `pi` enum, update `AgentsStatus` |
| `lib/services/bridge_service.dart` | Add ~15 `pi*` methods |
| `lib/providers/chat_provider.dart` | Add Pi stream listener, state fields |
| `lib/screens/chat_screen.dart` | Pi input bar (model chip, thinking badge, context bar) |
| `lib/screens/ai_backend_screen.dart` | Pi backend card |
| `lib/screens/sessions_screen.dart` | Pi session list support |
| `lib/screens/settings_screen.dart` | Link to Pi settings |
| `lib/widgets/provider_icon.dart` | Add `'pi'` entry |

---

## 21. Implementation Priority

### MVP (get Pi chatting first)

1. **Phase 0** — AgentType + dependency install
2. **Phase 1** — Connector (`connectors/pi.ts`) — the core SDK integration
3. **Phase 2** — Types additions
4. **Phase 3** — Message handlers (chat, abort, state, models)
5. **Phase 4** — Flutter models
6. **Phase 5** — Bridge service methods (chat, state, models)
7. **Phase 6** — Providers
8. **Phase 7** — Chat streaming UI + tool cards (already work)

**MVP result**: User can select Pi as backend, pick a model, chat, see streaming text + thinking + tool calls, abort, switch models.

### Post-MVP (full feature parity)

9. **Phase 8** — Session management
10. **Phase 9** — Model picker with provider grouping
11. **Phase 10** — Commands/skills UI
12. **Phase 11** — Tool cards (zero work) + Pi-specific input bar elements

### Future

13. **Phase 12** — Extension UI forwarding
14. **Phase 13** — Tree navigation, compaction, export
15. **Phase 14** — Settings, packages, polish

---

## 22. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Pi SDK package is large (pulls in multiple AI SDKs) | Certain | Low | Server-side only, bundle size irrelevant. Bun deduplicates shared deps. |
| No authenticated providers on first run | High | Medium | Show clear "configure providers" screen. Users can run `/login` in a PTY session. |
| Pi SDK API changes between versions | Low | High | Pin version in package.json, test before upgrading |
| Extension crashes in-process | Low | Medium | Pi handles extension errors gracefully (`extension_error` events). We can catch + log. |
| Memory usage with multiple Pi instances | Medium | Medium | Lazy creation, idle timeout disposal (same as OpenCode) |
| Overlapping Anthropic/OpenAI deps with existing bridge deps | Medium | Low | Bun handles this via deduplication. If conflicts, pin versions. |
| Pi session format incompatible after update | Very Low | Medium | Pi auto-migrates session files on load |
