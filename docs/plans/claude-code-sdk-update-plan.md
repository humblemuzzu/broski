# Claude Code SDK Update — Complete Implementation Plan

> **SDK:** `@anthropic-ai/claude-agent-sdk` 0.2.86 → 0.2.87 (Claude Code 2.1.87)  
> **Date:** 2026-03-30  
> **Scope:** Bridge types, connector, handlers, Flutter models, services, providers, UI  
> **Estimated effort:** 5–7 sessions across 4 phases

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Phase 1: Type Fixes & Bridge Plumbing](#2-phase-1-type-fixes--bridge-plumbing)
3. [Phase 2: Context Usage Dashboard](#3-phase-2-context-usage-dashboard)
4. [Phase 3: Settings Management & Session Enhancements](#4-phase-3-settings-management--session-enhancements)
5. [Phase 4: Permission UX & Quality of Life](#5-phase-4-permission-ux--quality-of-life)
6. [What We're NOT Doing (and Why)](#6-what-were-not-doing-and-why)
7. [File-by-File Change Manifest](#7-file-by-file-change-manifest)

---

## 1. Executive Summary

### Current State
- SDK: v0.2.87 installed, connector uses 33+ Options, all 22 SDKMessage types handled
- 53 bridge handlers ↔ 53 Flutter bridge methods — perfect parity
- All Query methods wired except 3 new ones
- Types 95% aligned — minor drift on HookEvents and session metadata

### What's New in the SDK (worth implementing)

| Feature | SDK API | User Impact | Phase |
|---------|---------|-------------|-------|
| **Context Usage Dashboard** | `Query.getContextUsage()` | See exactly what's eating your context window | 2 |
| **Mid-Session Settings** | `Query.applyFlagSettings()` | Toggle fast mode, effort, memory from mobile | 3 |
| **Session Tagging** | `tagSession()` standalone | Organize sessions with tags | 3 |
| **Enhanced Session Info** | `SDKSessionInfo.customTitle/firstPrompt/tag` | Richer session list | 3 |
| **Permission Suggestions Relay** | `CanUseTool.title/displayName/description` | Better permission prompt UX | 4 |
| **Per-Model Cost Tracking** | `SDKResultMessage.modelUsage` | See cost per model in multi-model sessions | 4 |
| **Task Budget** | `Options.taskBudget` | Set token budgets for agent tasks | 4 |
| **Message Priority** | `SDKUserMessage.priority` | Queue messages for background agents | 4 |

### What's Already Working (just needs type fixes)

| Feature | Status | Fix Needed |
|---------|--------|------------|
| Session state changes | Bridge emits `session-state-changed` | Add to `ClaudeCodeStreamMessage` type union |
| API retry info | Bridge emits `api-retry` | Add to `ClaudeCodeStreamMessage` type union |
| All 22 stream events | Handled in connector | 2 missing from TS type union |
| 6 missing HookEvent types | Bridge passes strings generically | Add to `ClaudeCodeHookEvent` type |
| `supportsAutoMode` on models | SDK sends it | Add to `ClaudeCodeSupportedModel` type |

---

## 2. Phase 1: Type Fixes & Bridge Plumbing

> **Goal:** Fix type drift, add missing fields, wire new SDK APIs through bridge  
> **Estimated effort:** 1 session  
> **No UI changes — pure bridge/types work**

### 2.1 Fix `ClaudeCodeStreamMessage` Type Union

**File:** `packages/bridge/src/types.ts`  
**What:** Add 2 missing stream event types to the union that the bridge already emits but aren't in the type

```typescript
// ADD to ClaudeCodeStreamMessage union:

// Session state change — authoritative idle/running/requires_action signal
| {
    type: "session-state-changed";
    state: "idle" | "running" | "requires_action";
  }

// API retry info — emitted when API request fails with retryable error  
| {
    type: "api-retry";
    attempt: number;
    maxRetries: number;
    retryDelayMs: number;
    errorStatus: number | null;
    error: string;
  }
```

### 2.2 Fix `ClaudeCodeHookEvent` — Add 6 Missing Events

**File:** `packages/bridge/src/types.ts`

```typescript
// ADD to ClaudeCodeHookEvent union:
| "StopFailure"
| "PostCompact"  
| "TaskCreated"
| "InstructionsLoaded"
| "CwdChanged"
| "FileChanged"
```

**File:** `lib/models/claude_code/cc_hook.dart`

```dart
// ADD to ClaudeCodeHookEvent enum:
stopFailure,
postCompact,
taskCreated,
instructionsLoaded,
cwdChanged,
fileChanged,
```

### 2.3 Add `supportsAutoMode` to Model Info

**File:** `packages/bridge/src/types.ts` — `ClaudeCodeSupportedModel`

```typescript
supportsAutoMode?: boolean;
```

**File:** `packages/bridge/src/connectors/claude-code/model-normalization.ts`

```typescript
// In normalizeSupportedModels, add:
supportsAutoMode: m.supportsAutoMode,
```

**File:** `lib/models/claude_code/cc_model.dart` — `ClaudeCodeSupportedModel`

```dart
final bool? supportsAutoMode;
```

### 2.4 Add Missing Session Metadata Fields

**File:** `packages/bridge/src/types.ts` — `ClaudeCodeSession`

```typescript
// ADD:
customTitle?: string;   // User-set title via /rename
firstPrompt?: string;   // First meaningful user prompt
tag?: string;           // User-set tag
fileSize?: number;      // JSONL file size in bytes
```

**File:** `lib/models/claude_code/cc_session.dart`

```dart
// ADD:
final String? customTitle;
final String? firstPrompt;  
final String? tag;
final int? fileSize;
```

### 2.5 Add Missing Task Started Fields

**File:** `packages/bridge/src/types.ts` — `task-started` in `ClaudeCodeStreamMessage`

```typescript
// ADD to task-started type:
workflowName?: string;  // meta.name from workflow script
prompt?: string;        // task prompt text
```

**File:** `packages/bridge/src/connectors/claude-code/stream-supplemental-events.ts`

```typescript
// In task_started handler, add:
workflowName: msg.workflow_name,
prompt: msg.prompt,
```

**File:** `lib/models/claude_code/cc_stream_message.dart` — `CCTaskStarted`

```dart
// ADD:
final String? workflowName;
final String? prompt;
```

### 2.6 Add Missing Subagent Fields

**File:** `packages/bridge/src/types.ts` — `ClaudeCodeSubagent`

```typescript
// ADD:
initialPrompt?: string;  // Auto-submitted as first user turn
```

**File:** `lib/models/claude_code/cc_subagent.dart`

```dart
// ADD:
final String? initialPrompt;
```

### 2.7 Wire `cc_get_context_usage` Endpoint

**New file:** `packages/bridge/src/handlers/cc_context_usage.ts`

```typescript
import { getActiveQuery } from '../connectors/claude-code';

export async function handle(message: any, reply: (msg: any) => void): Promise<boolean> {
  switch (message.type) {
    case 'cc_get_context_usage': {
      const sessionId = message.sessionId;
      const query = getActiveQuery(sessionId);
      if (!query) {
        reply({ type: 'cc_context_usage', data: null, error: 'No active session', requestId: message.requestId });
        return true;
      }
      try {
        const usage = await query.getContextUsage();
        reply({ type: 'cc_context_usage', data: usage, requestId: message.requestId });
      } catch (err: any) {
        reply({ type: 'cc_context_usage', data: null, error: err.message, requestId: message.requestId });
      }
      return true;
    }
    default: return false;
  }
}
```

**Route in:** `packages/bridge/src/handlers/cc_routing.ts` — add 1-line import + route

### 2.8 Wire `cc_apply_settings` Endpoint

**New file:** `packages/bridge/src/handlers/cc_settings.ts`

```typescript
export async function handle(message: any, reply: (msg: any) => void): Promise<boolean> {
  switch (message.type) {
    case 'cc_apply_settings': {
      const sessionId = message.sessionId;
      const query = getActiveQuery(sessionId);
      if (!query) {
        reply({ type: 'cc_settings_applied', error: 'No active session', requestId: message.requestId });
        return true;
      }
      try {
        await query.applyFlagSettings(message.settings);
        reply({ type: 'cc_settings_applied', requestId: message.requestId });
      } catch (err: any) {
        reply({ type: 'cc_settings_applied', error: err.message, requestId: message.requestId });
      }
      return true;
    }
    default: return false;
  }
}
```

### 2.9 Wire `cc_tag_session` Endpoint

**New file:** `packages/bridge/src/handlers/cc_tag_session.ts`

```typescript
import { tagSession } from '@anthropic-ai/claude-agent-sdk';

export async function handle(message: any, reply: (msg: any) => void): Promise<boolean> {
  switch (message.type) {
    case 'cc_tag_session': {
      try {
        await tagSession(message.sessionId, message.tag ?? null, { dir: message.cwd });
        reply({ type: 'cc_session_tagged', requestId: message.requestId });
      } catch (err: any) {
        reply({ type: 'cc_session_tagged', error: err.message, requestId: message.requestId });
      }
      return true;
    }
    default: return false;
  }
}
```

### 2.10 Wire `taskBudget` Option Through cc_chat

**File:** `packages/bridge/src/types.ts` — `ClientMessage` cc_chat type

```typescript
// ADD to cc_chat message:
taskBudget?: { total: number };
```

**File:** `packages/bridge/src/handlers/cc_chat.ts`

```typescript
// In queryClaudeCode options construction, add:
if (message.taskBudget) {
  opts.taskBudget = message.taskBudget;
}
```

### 2.11 Wire `priority` Field on cc_chat Messages

**File:** `packages/bridge/src/types.ts` — `ClientMessage` cc_chat type

```typescript
// ADD:
priority?: 'now' | 'next' | 'later';
```

Pass through to the SDK's `SDKUserMessage.priority` when using `streamInput()`.

### 2.12 Forward Permission Request Title/DisplayName/Description

**File:** `packages/bridge/src/connectors/claude-code.ts` — `canUseTool` callback

Currently we forward `toolName`, `input`, `suggestions`, `blockedPath`, `decisionReason`, `toolUseID`, `agentID`. 

**Add forwarding of:**
```typescript
title: options.title,           // "Claude wants to read foo.txt"
displayName: options.displayName, // "Read file" 
description: options.description, // "Claude will have read/write access to ~/Downloads"
```

**File:** `packages/bridge/src/types.ts` — `permission-request` stream type

```typescript
// ADD:
title?: string;
displayName?: string;
description?: string;
```

### 2.13 Add `PermissionDecisionClassification` to Permission Responses

**File:** `packages/bridge/src/types.ts` — cc_permission_response

```typescript
// ADD:
decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject';
```

**File:** `packages/bridge/src/handlers/cc_routing.ts` — permission response handler

```typescript
// When constructing PermissionResult, add:
decisionClassification: msg.decisionClassification,
```

### 2.14 Forward `modelUsage` from Result Messages

**File:** `packages/bridge/src/types.ts` — `token-usage` stream type

```typescript
// ADD (already have totalCostUsd, usage):
modelUsage?: Record<string, ClaudeCodeModelUsage>;
```

**File:** `packages/bridge/src/connectors/claude-code.ts` — result handler

```typescript
// Forward modelUsage in token-usage stream event:
modelUsage: result.modelUsage,
```

### 2.15 Add Types to types.ts

**File:** `packages/bridge/src/types.ts`

Add new ClientMessage types:
```typescript
| { type: 'cc_get_context_usage'; sessionId: string; requestId?: string }
| { type: 'cc_apply_settings'; sessionId: string; settings: Record<string, unknown>; requestId?: string }
| { type: 'cc_tag_session'; sessionId: string; tag?: string | null; cwd?: string; requestId?: string }
```

Add new ServerMessage types:
```typescript
| { type: 'cc_context_usage'; data: unknown; error?: string; requestId?: string }
| { type: 'cc_settings_applied'; error?: string; requestId?: string }
| { type: 'cc_session_tagged'; error?: string; requestId?: string }
```

---

## 3. Phase 2: Context Usage Dashboard

> **Goal:** Build the "Context Health" feature — a sheet showing exactly what's in the context window  
> **Estimated effort:** 1–2 sessions  
> **Bridge done in Phase 1, this is Flutter-only**

### 3.1 Flutter Bridge Method

**New file:** `lib/services/bridge/bridge_cc_context.dart` (extension on BridgeService)

```dart
extension BridgeClaudeCodeContext on BridgeService {
  Future<CCContextUsage?> ccGetContextUsage({required String sessionId}) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'cc_get_context_usage',
      'sessionId': sessionId,
      'requestId': requestId,
    });
    final response = await waitForResponse('cc_context_usage', requestId: requestId);
    if (response['error'] != null) return null;
    final data = response['data'] as Map<String, dynamic>?;
    if (data == null) return null;
    return CCContextUsage.fromJson(data);
  }
}
```

### 3.2 Flutter Model

**New file:** `lib/models/claude_code/cc_context_usage.dart`

```dart
/// Context window usage breakdown from Claude Code SDK.
class CCContextUsage {
  final List<CCContextCategory> categories;
  final int totalTokens;
  final int maxTokens;
  final double percentage;
  final String model;
  final List<CCMemoryFileUsage> memoryFiles;
  final List<CCMcpToolUsage> mcpTools;
  final List<CCAgentUsage> agents;
  final CCSlashCommandUsage? slashCommands;
  final CCSkillUsage? skills;
  final int? autoCompactThreshold;
  final bool isAutoCompactEnabled;
  final CCMessageBreakdown? messageBreakdown;
  final CCApiUsage? apiUsage;
  
  // ... factory fromJson, all sub-types below
}

class CCContextCategory {
  final String name;
  final int tokens;
  final String color;
  final bool? isDeferred;
}

class CCMemoryFileUsage {
  final String path;
  final String type;
  final int tokens;
}

class CCMcpToolUsage {
  final String name;
  final String serverName;
  final int tokens;
  final bool? isLoaded;
}

class CCAgentUsage {
  final String agentType;
  final String source;
  final int tokens;
}

class CCSlashCommandUsage {
  final int totalCommands;
  final int includedCommands;
  final int tokens;
}

class CCSkillUsage {
  final int totalSkills;
  final int includedSkills;
  final int tokens;
  final List<CCSkillFrontmatter> skillFrontmatter;
}

class CCSkillFrontmatter {
  final String name;
  final String source;
  final int tokens;
}

class CCMessageBreakdown {
  final int toolCallTokens;
  final int toolResultTokens;
  final int attachmentTokens;
  final int assistantMessageTokens;
  final int userMessageTokens;
  final List<CCToolCallBreakdown> toolCallsByType;
}

class CCToolCallBreakdown {
  final String name;
  final int callTokens;
  final int resultTokens;
}

class CCApiUsage {
  final int inputTokens;
  final int outputTokens;
  final int cacheCreationInputTokens;
  final int cacheReadInputTokens;
}
```

### 3.3 Riverpod Provider

**New file:** `lib/providers/cc_context_usage_provider.dart`

```dart
final ccContextUsageProvider = FutureProvider.family<CCContextUsage?, String>(
  (ref, sessionId) async {
    final bridge = ref.watch(bridgeServiceProvider);
    if (bridge == null) return null;
    return bridge.ccGetContextUsage(sessionId: sessionId);
  },
);
```

### 3.4 Context Usage Sheet UI

**New file:** `lib/screens/sheets/cc_context_usage_sheet.dart`

```
┌─────────────────────────────────────────┐
│ Context Usage                     ⟳ 78% │
├─────────────────────────────────────────┤
│                                         │
│ ████████████████████░░░░░░  156K/200K   │
│                                         │
│ ▍ System Prompt     12,400 tokens   6%  │
│ ▍ Messages          89,200 tokens  45%  │
│ ▍ Tool Results      34,100 tokens  17%  │
│ ▍ MCP Tools          8,900 tokens   4%  │
│ ▍ Memory Files       6,200 tokens   3%  │
│ ▍ Skills             3,100 tokens   2%  │
│ ▍ Agents             2,000 tokens   1%  │
│                                         │
│ ─── Memory Files ───────────────────    │
│ 📄 CLAUDE.md (Project)     2,400 tokens │
│ 📄 conventions.md (User)   1,800 tokens │
│ 📄 memory-01.md (Auto)     2,000 tokens │
│                                         │
│ ─── MCP Tools ──────────────────────    │
│ 🔧 github/create_pr         340 tokens  │
│ 🔧 github/list_issues       280 tokens  │
│ 🔧 slack/send_message       180 tokens  │
│ ◌  jira/get_ticket (deferred)  0 tokens │
│                                         │
│ ─── Message Breakdown ──────────────    │
│ 💬 User messages         12,400 tokens  │
│ 🤖 Assistant messages    45,200 tokens  │
│ 🔧 Tool calls           15,100 tokens  │
│ 📎 Tool results         19,000 tokens  │
│ 📁 Attachments           2,500 tokens  │
│                                         │
│ ─── Top Tool Consumers ─────────────    │
│ Read     3,200 call + 12,100 result     │
│ Bash     4,500 call +  4,200 result     │
│ Grep     2,100 call +  1,800 result     │
│                                         │
│ ─── API Usage ──────────────────────    │
│ Input: 156K  Output: 23K  Cache: 89K    │
│                                         │
│ ⚡ Auto-compact: ON at 80% (160K)       │
│ 📊 Model: claude-sonnet-4-6             │
└─────────────────────────────────────────┘
```

**Design notes:**
- Use `DetailSheet.show()` with `initialSize: 0.7`
- Color-coded bar at top (reuse colors from SDK `categories[].color`)
- Collapsible sections for memory files, MCP tools, message breakdown
- Pull-to-refresh calls `ccGetContextUsage()` again
- Show auto-compact threshold as a marker on the progress bar
- Tap on a memory file → offer to view/delete it

**Components to reuse:**
- `DetailSheet` — existing sheet container
- `SectionHeader` — existing section divider
- `TokenCountBadge` — create small reusable widget for `"12,400 tokens"` display
- `LinearPercentIndicator` — existing package for progress bar
- `Consumer` for Riverpod ref access inside sheet

### 3.5 Entry Point in Chat Screen

**File:** `lib/screens/chat_screen.dart` — add 1-line call in CC overflow menu

```dart
// In _handleClaudeCodeMenuAction or overflow menu builder:
case 'context_usage':
  showCCContextUsageSheet(context);
  break;
```

**File:** `lib/screens/sheets/cc_context_usage_sheet.dart` — public function

```dart
void showCCContextUsageSheet(BuildContext context) {
  DetailSheet.show(
    context: context,
    title: 'Context Usage',
    initialSize: 0.7,
    child: Consumer(builder: (context, ref, _) {
      // ... provider watch + UI
    }),
  );
}
```

---

## 4. Phase 3: Settings Management & Session Enhancements

> **Goal:** Let users manage CC settings from mobile + richer session metadata  
> **Estimated effort:** 2 sessions

### 4.1 Mid-Session Settings — Flutter Bridge

**New file:** `lib/services/bridge/bridge_cc_settings.dart`

```dart
extension BridgeClaudeCodeSettings on BridgeService {
  Future<bool> ccApplySettings({
    required String sessionId,
    required Map<String, dynamic> settings,
  }) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'cc_apply_settings',
      'sessionId': sessionId,
      'settings': settings,
      'requestId': requestId,
    });
    final response = await waitForResponse('cc_settings_applied', requestId: requestId);
    return response['error'] == null;
  }
}
```

### 4.2 Quick Settings Sheet UI

**New file:** `lib/screens/sheets/cc_quick_settings_sheet.dart`

```
┌─────────────────────────────────────────┐
│ Quick Settings                          │
├─────────────────────────────────────────┤
│                                         │
│ ─── Performance ────────────────────    │
│                                         │
│ ⚡ Fast Mode                    [OFF]   │
│   Skip thinking for simple tasks        │
│                                         │
│ 🧠 Effort Level                         │
│   ○ Low  ◐ Medium  ● High              │
│                                         │
│ 💭 Extended Thinking            [ON]    │
│   Let Claude reason step-by-step        │
│                                         │
│ ─── Features ───────────────────────    │
│                                         │
│ 💡 Prompt Suggestions           [ON]    │
│   Suggest next prompt after each turn   │
│                                         │
│ 🧠 Auto Memory                 [ON]    │
│   Remember important context            │
│                                         │
│ 💤 Background Consolidation     [OFF]   │
│   Periodically organize memories        │
│                                         │
│ ─── Output ─────────────────────────    │
│                                         │
│ 🌐 Language               [Default]    │
│                                         │
│ 📝 Output Style           [concise]    │
│                                         │
│                                         │
│        [ Apply Changes ]                │
└─────────────────────────────────────────┘
```

**Behavior:**
- Each toggle calls `ccApplySettings()` immediately (no save button needed for toggles)
- Effort level uses segmented control
- Language/Output Style use dropdown pickers
- Settings that require session restart show a note
- Fast mode toggle shows `FastModeState` feedback (`off`/`cooldown`/`on`)

**Settings mapped to SDK `applyFlagSettings()` keys:**

| UI Control | Settings Key | Type |
|------------|-------------|------|
| Fast Mode toggle | `fastMode` | `boolean` |
| Effort segmented control | `effortLevel` | `'low' \| 'medium' \| 'high'` |
| Thinking toggle | `alwaysThinkingEnabled` | `boolean` |
| Prompt Suggestions toggle | `promptSuggestionEnabled` | `boolean` |
| Auto Memory toggle | `autoMemoryEnabled` | `boolean` |
| Background Consolidation toggle | `autoDreamEnabled` | `boolean` |
| Language dropdown | `language` | `string` |
| Output Style dropdown | `outputStyle` | `string` |

### 4.3 Session Tagging — Flutter Bridge

**New file:** `lib/services/bridge/bridge_cc_tag.dart`

```dart
extension BridgeClaudeCodeTag on BridgeService {
  Future<bool> ccTagSession({
    required String sessionId,
    String? tag,
    String? cwd,
  }) async {
    final requestId = generateRequestId();
    sendMessage({
      'type': 'cc_tag_session',
      'sessionId': sessionId,
      'tag': tag,
      'cwd': cwd,
      'requestId': requestId,
    });
    final response = await waitForResponse('cc_session_tagged', requestId: requestId);
    return response['error'] == null;
  }
}
```

### 4.4 Session Tag UI

Add to session row long-press menu / session detail:

```
┌──────────────────────────────┐
│ 🏷️ Tag Session               │
├──────────────────────────────┤
│                              │
│ Quick tags:                  │
│ [⭐ Important] [🐛 Bug Fix]  │
│ [✨ Feature] [🔧 Refactor]   │
│ [📝 Review] [🚀 Deploy]     │
│                              │
│ Custom: [____________]       │
│                              │
│ [Clear Tag]    [Apply]       │
└──────────────────────────────┘
```

Add tag display to session list items (small chip next to title).

### 4.5 Enhanced Session List with New Metadata

**Update session list to show:**
- `customTitle` — if present, show as primary title (instead of auto-generated)
- `firstPrompt` — show as subtitle (truncated)
- `tag` — show as colored chip
- Keep our existing enrichments: `isBackground`, `hasSubagentActivity`, `summary` (diff stats)

**Session list row layout:**
```
┌─────────────────────────────────────────┐
│ 🏷️ bug-fix                              │
│ Fix authentication flow  ← customTitle   │
│ "The login redirect is broken whe..."    │
│   ← firstPrompt                          │
│ main • claude-sonnet-4-6 • 2h ago       │
│ +42 -18 • 3 files                        │
└─────────────────────────────────────────┘
```

### 4.6 Populate New Session Fields from Bridge

**File:** `packages/bridge/src/connectors/claude-code.ts` — `listSessions()` and `getSession()`

For sessions returned by our manual JSONL parsing, also check for custom-title lines and tag lines in the JSONL file (these are written by the SDK's `renameSession()` and `tagSession()`).

OR — hybrid approach:
1. Call SDK's `listSessions({ dir: cwd })` for basic metadata (has `customTitle`, `firstPrompt`, `tag`, `gitBranch`)
2. Enrich with our JSONL parsing for `isBackground`, `hasSubagentActivity`, `subagentName`, `summary` (diff stats)

**Recommended: Hybrid approach.** SDK handles the metadata extraction we do manually (~200 lines saved), our enrichment adds the value-add fields the SDK doesn't provide.

```typescript
// In listSessions():
import { listSessions as sdkListSessions } from '@anthropic-ai/claude-agent-sdk';

// 1. Get SDK metadata
const sdkSessions = await sdkListSessions({ dir: cwd, limit: 100 });

// 2. Create lookup map
const sdkMap = new Map(sdkSessions.map(s => [s.sessionId, s]));

// 3. For each session, merge SDK metadata with our enrichment
for (const session of sessions) {
  const sdk = sdkMap.get(session.id);
  if (sdk) {
    session.customTitle = sdk.customTitle;
    session.firstPrompt = sdk.firstPrompt;
    session.tag = sdk.tag;
    session.fileSize = sdk.fileSize;
    // Keep our fields: isBackground, hasSubagentActivity, summary
  }
}
```

---

## 5. Phase 4: Permission UX & Quality of Life

> **Goal:** Better permission prompts, cost tracking, and polish  
> **Estimated effort:** 1–2 sessions

### 5.1 Enhanced Permission Prompts

**Current permission prompt:**
```
┌──────────────────────────────┐
│ Claude wants to use: Bash    │
│                              │
│ Command: npm install lodash  │
│                              │
│ [Reject] [Allow] [Always]   │
└──────────────────────────────┘
```

**New permission prompt with SDK fields:**
```
┌──────────────────────────────────────┐
│ Run shell command                    │
│  ← displayName                       │
│                                      │
│ Claude wants to execute a shell      │
│ command in the project directory.     │
│  ← title                             │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ $ npm install lodash             │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Claude will have shell access in     │
│ ~/projects/my-app                    │
│  ← description                       │
│                                      │
│ [Reject] [Allow Once] [Always Allow] │
└──────────────────────────────────────┘
```

**Flutter changes:**
- `CCPermissionRequest` model: add `title`, `displayName`, `description` fields
- Permission dialog: use `displayName` as sheet title, `title` as prompt text, `description` as subtitle
- "Always Allow" sends back `updatedPermissions` with the SDK's `suggestions`

### 5.2 Permission Suggestions — Persistent Rules

**What this enables:** When user taps "Always Allow," the SDK's permission suggestions create a persistent rule in `.claude/settings.json` so the same tool pattern is never prompted again.

**Bridge change:** Already forwarding `hasSuggestions` flag. Need to:
1. Forward the actual `PermissionUpdate[]` array (not just the boolean flag)
2. When Flutter sends back `cc_permission_response` with `response: 'always'`, include `updatedPermissions` from the suggestions

**File:** `packages/bridge/src/types.ts` — `permission-request` stream type

```typescript
// ADD:
suggestions?: Array<{
  type: 'addRules' | 'replaceRules' | 'removeRules' | 'setMode' | 'addDirectories' | 'removeDirectories';
  rules?: Array<{ toolName: string; ruleContent?: string }>;
  behavior?: 'allow' | 'deny' | 'ask';
  destination: 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg';
}>;
```

**Flutter change:**
- Store suggestions in `CCPermissionRequest` model
- When user taps "Always Allow," send suggestions back as `updatedPermissions`
- Show which rule will be created (e.g., "Allow Bash(npm *) in project settings")

### 5.3 Per-Model Cost Tracking

**What this enables:** In multi-model sessions (Opus for complex, Sonnet for simple), show cost breakdown per model.

**Flutter model update:** `CCTokenUsage` already has `totalCostUsd`. Add:

```dart
class CCModelUsage {
  final String modelId;
  final int inputTokens;
  final int outputTokens;
  final int cacheReadInputTokens;
  final int cacheCreationInputTokens;
  final int webSearchRequests;
  final double costUsd;
  final int contextWindow;
  final int maxOutputTokens;
}
```

**UI addition in token usage display:**
```
┌──────────────────────────────────────┐
│ Session Cost: $0.47                  │
├──────────────────────────────────────┤
│ claude-sonnet-4-6         $0.32      │
│   In: 45K  Out: 12K  Cache: 89K     │
│                                      │
│ claude-haiku-4-6          $0.15      │
│   In: 23K  Out: 8K   Cache: 12K     │
│                                      │
│ Web searches: 3                      │
└──────────────────────────────────────┘
```

### 5.4 Task Budget Support

**Flutter bridge method:**
```dart
// Add to ccChat parameters:
int? taskBudgetTokens,

// In message construction:
if (taskBudgetTokens != null) 'taskBudget': {'total': taskBudgetTokens},
```

**UI:** Add in agent teams / subagent settings:
```
┌──────────────────────────────────┐
│ Task Budget                      │
│                                  │
│ Max tokens per agent task:       │
│ [     50,000      ] tokens       │
│                                  │
│ ℹ️ Agents will pace their work   │
│   and wrap up before the limit   │
└──────────────────────────────────┘
```

### 5.5 Session State Indicator

**What this enables:** Show a reliable "Claude is thinking / idle / needs input" indicator.

Currently we infer state from stream events. The `session-state-changed` event gives us an authoritative signal.

**Flutter:** Already have the stream type (after Phase 1 fix). Add to chat provider:

```dart
// In CC stream handler:
case 'session-state-changed':
  final state = msg['state'] as String?;
  // Update session state: 'idle', 'running', 'requires_action'
  _updateSessionState(sessionId, state);
  break;
```

**UI:** Use for:
- Input bar state (disable when `running`, show "Waiting for your input" when `requires_action`)
- Status indicator dot: 🟢 idle, 🟡 running, 🔴 requires_action
- Stop showing typing indicator — use state directly

### 5.6 API Retry Display

**What this enables:** When Claude hits a rate limit or transient error, show retry status.

```
┌──────────────────────────────────────┐
│ ⏳ API retry (attempt 2/3)           │
│    Retrying in 4s...                 │
│    Error: rate_limit (429)           │
└──────────────────────────────────────┘
```

**Flutter:** Already have the stream type (after Phase 1 fix). Add inline status message in chat.

---

## 6. What We're NOT Doing (and Why)

| Feature | Why Skip |
|---------|----------|
| **V2 Session API** (`unstable_v2_*`) | Marked `@alpha`, API will change. Not worth building on. Monitor for stabilization. |
| **`spawnClaudeCodeProcess`** | Infrastructure-level. Users don't spawn custom CC processes from mobile. |
| **`hooks` option (programmatic)** | We read hooks from filesystem. Programmatic hooks are for embedded SDK use, not mobile UI. |
| **`seedReadState()`** | SDK-internal concern for snip/compact edge case. Users never need this. |
| **`toolConfig.askUserQuestion.previewFormat`** | Only one config option (`html` vs `markdown`). Low impact. Add later if askUserQuestion becomes more common. |
| **`continue` option** | Our UX already lets users pick sessions to resume. `continue` is a CLI convenience that doesn't fit mobile flow. |
| **`debug`/`debugFile`** | Dev-only debugging. Not for end users. |
| **Enterprise-only settings** (`allowManagedHooksOnly`, `strictKnownMarketplaces`, `blockedMarketplaces`, `sshConfigs`, `channelsEnabled`) | Enterprise/Teams features. Our users are individual developers. Add when we have enterprise customers. |
| **`strictMcpConfig`** | Internal validation flag. No user benefit. |
| **Replace manual session parsing entirely** | Our JSONL parsing provides `isBackground`, `hasSubagentActivity`, `subagentName`, diff stats (`summary`). SDK's `listSessions()` doesn't provide these. Hybrid approach is better. |
| **Plugin marketplace management** | Plugins are managed in CLI settings files. Exposing marketplace browsing in mobile is complex and low-priority. We already show/toggle installed plugins. |
| **Worktree settings UI** | Worktrees are a CLI power-user feature. Settings are in `.claude/settings.json`. No mobile UI needed yet. |

---

## 7. File-by-File Change Manifest

### Phase 1: Type Fixes & Bridge Plumbing

| File | Action | Lines Changed |
|------|--------|---------------|
| `packages/bridge/src/types.ts` | EDIT: Add 2 stream types, 6 hook events, model/session/subagent fields, 3 new ClientMessage/ServerMessage types, permission fields | ~80 lines added |
| `packages/bridge/src/handlers/cc_context_usage.ts` | CREATE: New handler for `cc_get_context_usage` | ~30 lines |
| `packages/bridge/src/handlers/cc_settings.ts` | CREATE: New handler for `cc_apply_settings` | ~30 lines |
| `packages/bridge/src/handlers/cc_tag_session.ts` | CREATE: New handler for `cc_tag_session` | ~25 lines |
| `packages/bridge/src/handlers/cc_routing.ts` | EDIT: Add 3 import + route lines | ~6 lines |
| `packages/bridge/src/handlers/cc_chat.ts` | EDIT: Wire `taskBudget` and `priority` | ~8 lines |
| `packages/bridge/src/connectors/claude-code.ts` | EDIT: Forward permission title/displayName/description, forward modelUsage | ~15 lines |
| `packages/bridge/src/connectors/claude-code/stream-supplemental-events.ts` | EDIT: Add `workflowName`/`prompt` to task-started | ~4 lines |
| `packages/bridge/src/connectors/claude-code/model-normalization.ts` | EDIT: Add `supportsAutoMode` | ~2 lines |
| `lib/models/claude_code/cc_hook.dart` | EDIT: Add 6 enum values | ~12 lines |
| `lib/models/claude_code/cc_model.dart` | EDIT: Add `supportsAutoMode` | ~5 lines |
| `lib/models/claude_code/cc_session.dart` | EDIT: Add `customTitle`, `firstPrompt`, `tag`, `fileSize` | ~20 lines |
| `lib/models/claude_code/cc_stream_message.dart` | EDIT: Add `CCSessionStateChanged`, `CCApiRetry` sealed classes, add fields to `CCTaskStarted` | ~40 lines |
| `lib/models/claude_code/cc_subagent.dart` | EDIT: Add `initialPrompt` | ~5 lines |

### Phase 2: Context Usage Dashboard

| File | Action | Lines Changed |
|------|--------|---------------|
| `lib/models/claude_code/cc_context_usage.dart` | CREATE: Full model with 10+ sub-types | ~200 lines |
| `lib/services/bridge/bridge_cc_context.dart` | CREATE: Extension with `ccGetContextUsage()` | ~25 lines |
| `lib/providers/cc_context_usage_provider.dart` | CREATE: FutureProvider | ~15 lines |
| `lib/screens/sheets/cc_context_usage_sheet.dart` | CREATE: Full UI sheet | ~350 lines |
| `lib/screens/chat_screen.dart` | EDIT: 1-line call to `showCCContextUsageSheet(context)` | ~2 lines |

### Phase 3: Settings Management & Session Enhancements

| File | Action | Lines Changed |
|------|--------|---------------|
| `lib/services/bridge/bridge_cc_settings.dart` | CREATE: Extension with `ccApplySettings()` | ~25 lines |
| `lib/services/bridge/bridge_cc_tag.dart` | CREATE: Extension with `ccTagSession()` | ~25 lines |
| `lib/screens/sheets/cc_quick_settings_sheet.dart` | CREATE: Quick settings sheet UI | ~300 lines |
| `lib/screens/chat_screen.dart` | EDIT: 1-line call to `showCCQuickSettingsSheet(context)` | ~2 lines |
| `packages/bridge/src/connectors/claude-code.ts` | EDIT: Hybrid session listing (SDK + enrichment) | ~40 lines |
| Session list UI files | EDIT: Show `customTitle`, `firstPrompt`, `tag` | ~30 lines |

### Phase 4: Permission UX & Quality of Life

| File | Action | Lines Changed |
|------|--------|---------------|
| `lib/models/claude_code/cc_stream_message.dart` | EDIT: Enhanced `CCPermissionRequest` with title/displayName/description/suggestions | ~25 lines |
| `lib/models/claude_code/cc_model_usage.dart` | CREATE: `CCModelUsage` model | ~40 lines |
| Permission dialog/sheet UI | EDIT: Use new fields, implement "Always Allow" with rules | ~80 lines |
| Token usage display | EDIT: Show per-model breakdown | ~50 lines |
| Chat provider | EDIT: Handle `session-state-changed` for state management | ~20 lines |
| Chat screen status | EDIT: Use session state for indicators | ~15 lines |

### Summary

| Metric | Count |
|--------|-------|
| **New bridge handler files** | 3 |
| **New Flutter model files** | 2 |
| **New Flutter service extensions** | 3 |
| **New Flutter UI sheets** | 2 |
| **New Flutter providers** | 1 |
| **Edited files** | ~20 |
| **Total new lines** | ~1,400 |
| **Total edited lines** | ~350 |

### Implementation Order

```
Phase 1 (1 session):
  1. types.ts fixes (stream union, hook events, model/session/subagent fields)
  2. New handlers (cc_context_usage, cc_settings, cc_tag_session)
  3. Connector edits (permission fields, modelUsage, task-started fields)
  4. Flutter model updates (all Dart model files)
  
Phase 2 (1-2 sessions):
  5. cc_context_usage.dart model
  6. bridge_cc_context.dart service
  7. cc_context_usage_provider.dart
  8. cc_context_usage_sheet.dart UI
  
Phase 3 (2 sessions):
  9. bridge_cc_settings.dart + bridge_cc_tag.dart services
  10. cc_quick_settings_sheet.dart UI
  11. Hybrid session listing in connector
  12. Session list UI enhancements
  
Phase 4 (1-2 sessions):
  13. Permission prompt UI enhancement
  14. Per-model cost tracking
  15. Session state indicator
  16. API retry display
  17. Task budget UI
```

---

## Appendix A: SDK Version Reference

```
Installed: @anthropic-ai/claude-agent-sdk@0.2.87
Claude Code CLI: 2.1.87
sdk.d.ts: 4,265 lines
Previous: 0.2.86
Latest available: 0.2.87

Key version milestones:
- 0.2.42: ThinkingConfig, EffortLevel
- 0.2.52: promptSuggestions
- 0.2.74: agentProgressSummaries
- 0.2.87: Current (getContextUsage, applyFlagSettings, tagSession, etc.)
```

## Appendix B: Type Comparison Quick Reference

| SDK Type | Our Type | Match? |
|----------|----------|--------|
| `ModelInfo` | `ClaudeCodeSupportedModel` | ⚠️ Missing `supportsAutoMode` |
| `ModelUsage` | `ClaudeCodeModelUsage` | ✅ Full match |
| `SDKRateLimitInfo` | `ClaudeCodeRateLimitInfo` | ✅ Functional match |
| `ThinkingConfig` | `ClaudeCodeThinkingOption` | ✅ Match |
| `EffortLevel` | `ClaudeCodeEffort` | ✅ Match |
| `FastModeState` | String literal | ✅ Match |
| `SDKSessionInfo` | `ClaudeCodeSession` | ⚠️ Missing 4 fields |
| `AgentDefinition` | `ClaudeCodeSubagent` | ⚠️ Missing `initialPrompt` |
| `HookEvent` | `ClaudeCodeHookEvent` | ⚠️ Missing 6 events |
| `PermissionMode` | `ClaudeCodePermissionMode` | ✅ Match |
| `SdkBeta` | `ClaudeCodeBeta` | ✅ Match |
| `McpServerStatus` | `ClaudeCodeMcpServerStatus` | ✅ Full match |
| `AccountInfo` | `ClaudeCodeAccountInfo` | ✅ Match (string covers new providers) |
| `SandboxSettings` | `ClaudeCodeSandboxSettings` | ✅ Match |
| `SlashCommand` | `ClaudeCodeCommand` | ✅ Ours is richer |

## Appendix C: New Bridge Messages Summary

| Direction | Message Type | Handler | Purpose |
|-----------|-------------|---------|---------|
| Client→Bridge | `cc_get_context_usage` | `cc_context_usage.ts` | Get context window breakdown |
| Bridge→Client | `cc_context_usage` | — | Context usage response |
| Client→Bridge | `cc_apply_settings` | `cc_settings.ts` | Apply settings mid-session |
| Bridge→Client | `cc_settings_applied` | — | Settings applied confirmation |
| Client→Bridge | `cc_tag_session` | `cc_tag_session.ts` | Tag/untag a session |
| Bridge→Client | `cc_session_tagged` | — | Tag operation confirmation |
