# Repository Guidelines

## What Broski Actually Is (READ THIS BEFORE ANY SECURITY WORK)

Broski is a **mobile app that gives you full remote control of AI coding agents running on your computer**. Think of it as SSH-for-AI-agents from your phone. The entire point is that you can read files, run commands, chat with AI, and manage terminal sessions on your dev machine from anywhere.

### Core features that are INTENTIONAL, not vulnerabilities:
- **PTY / terminal access from the phone.** This is a primary feature. Users open terminal sessions, type commands, see output. Do NOT flag this as a security issue or suggest blocking it.
- **Command execution from the app.** The app sends commands to AI agents (Claude Code, Codex, OpenCode) and to the shell. This is the product. Do NOT suggest removing or restricting command execution.
- **File reading/writing from the phone.** Users browse, read, and edit files on their dev machine through the app. This is intentional.
- **AI agent control.** Users chat with AI agents, approve/reject permission prompts, and manage coding sessions. The bridge is the relay between phone and agents.
- **QR code pairing.** The QR code displayed in the user's terminal contains the auth token + connection info. This is the pairing mechanism (like SSH keys). The QR is only visible on the user's own screen.

### The architecture (so you understand the threat model):
- **Bridge** (`packages/bridge/`) = TypeScript server running on the user's own dev machine. It connects to local AI agents and exposes a WebSocket + HTTP API.
- **Flutter app** (`lib/`) = iOS/Android app that connects to the bridge over TLS WebSocket. Authenticated via token from QR code + cloud session (Convex).
- **Connection methods:** Local WiFi, Tailscale (private mesh VPN), Tailscale Funnel (public HTTPS via .ts.net).
- **Auth layers:** Bridge auth token (from QR), cloud session token (from Convex/RevenueCat entitlement), TLS cert pinning (SHA-256 fingerprint from QR).

### Security context for audits:
- This is a **personal dev tool**, not a multi-tenant SaaS. The user owns both the phone and the machine.
- Bearer token auth is standard for this category (same as VS Code tunnels, ngrok, SSH keys).
- The bridge deliberately has broad filesystem and process access because that is its job.
- Web app (`web-app/`) exists but is NOT launched yet. Bridge serves its static assets without auth (standard SPA behavior) but all API/WS endpoints require auth.
- Compiled production binaries disable all debug flags, force TLS, hardcode entitlement timings, and ignore env overrides that could weaken security.

### What IS worth auditing:
- Auth token lifecycle (rotation, storage, transmission security)
- TLS enforcement and cert pinning correctness
- Path traversal protections (realpath, symlink defense, base path checks)
- License/entitlement bypass attempts
- Input validation and injection (prototype pollution, message size limits)
- Rate limiting and DoS protection

### What is NOT a vulnerability (stop flagging these):
- PTY/terminal access existing at all
- Command execution from the app
- File read/write from the app
- QR code containing the auth token (it's the pairing mechanism)
- Bridge having access to AI agent credentials (it's the relay, that's its job)
- Localhost proxy to dev server ports (authenticated, loopback-only)

## Project Structure & Module Organization
- `lib/` holds the Flutter application code (currently `lib/main.dart`).
- `test/` contains Flutter tests (see `test/widget_test.dart`).
- `docs/` stores project documentation, with `docs/mvp/` as the current MVP reference.
- Platform folders like `android/`, `ios/`, `macos/`, `linux/`, `windows/`, and `web/` contain native build targets.
- `web-ui-cc/` is an auxiliary web UI workspace; keep changes scoped if you touch it.

## Build, Test, and Development Commands
- `flutter pub get` installs Dart/Flutter dependencies.
- `flutter run` starts the app on a connected device or simulator.
- `flutter run -d chrome` runs the app in a web browser.
- `flutter test` runs the full Flutter test suite.
- `flutter analyze` runs static analysis using `analysis_options.yaml`.
- `dart format .` formats all Dart files in the repo.

## Coding Style & Naming Conventions
- Follow standard Flutter/Dart style: 2-space indentation and trailing commas where it improves formatting.
- Use `UpperCamelCase` for types, `lowerCamelCase` for variables/functions, and `snake_case.dart` for files.
- Keep widgets small and composable; prefer extracting reusable UI into separate widgets.
- Lint rules come from `analysis_options.yaml` via `flutter_lints`.

## ⛔ MODULAR CODE ARCHITECTURE — MANDATORY (READ BEFORE ANY CODE CHANGE)

> **STOP. If you skip this section and dump code into a monster file, you WILL be asked to redo the work. Read this section completely before writing any code.**

### Why This Exists

The codebase has legacy monster files that are 5,000–12,000+ lines. Every time an AI agent adds "just one more method" to these files, it makes debugging harder, creates merge conflicts, and forces the next AI agent to read 12K lines of context to make a 10-line change. **We are doing gradual migration: every edit makes the codebase more modular, not less.**

### 🚫 MONSTER FILE REGISTRY — DO NOT ADD LINES TO THESE FILES

These files are FROZEN. Do NOT add new methods, new case blocks, new widgets, or new functions to them. If you need to touch a frozen file for ANY reason (bug fix, SDK update, feature change), you MUST extract the code you're changing into a new file and replace the original with a 1-line call to the new file. See extraction recipes below.

**Flutter (Dart) — FROZEN files:**

| File | Lines | What it has | Where new code goes instead |
|------|-------|-------------|---------------------------|
| `lib/screens/chat_screen.dart` | 12,315 | 80+ methods, all sheets/dialogs/builders | `lib/screens/sheets/`, `lib/screens/dialogs/`, `lib/widgets/chat/` |
| `lib/screens/sessions_screen.dart` | 6,327 | Session list, new session sheet, filter UI | `lib/screens/sessions/`, `lib/widgets/sessions/` |
| `lib/services/bridge_service.dart` | 5,023 | 281 methods for all agents | `lib/services/bridge/` split by agent |
| `lib/providers/chat_provider.dart` | 4,520 | ChatSessionState + ChatSessionNotifier | `lib/providers/chat/` split by concern |
| `lib/screens/onboarding_screen.dart` | 4,314 | All onboarding steps in one widget | `lib/screens/onboarding/` one file per step |
| `lib/models/claude_code.dart` | 2,759 | 30+ model classes | `lib/models/claude_code/` split by domain |
| `lib/widgets/permission_rules_sheet.dart` | 1,650 | Full sheet + item widgets | Extract item widgets to separate files |
| `lib/services/storage_service.dart` | 1,756 | All caching methods | `lib/services/storage/` split by agent |

**Bridge (TypeScript) — FROZEN files:**

| File | Lines | What it has | Where new code goes instead |
|------|-------|-------------|---------------------------|
| `packages/bridge/src/server.ts` | 8,324 | 234 case handlers | `packages/bridge/src/handlers/{domain}.ts` |
| `packages/bridge/src/connectors/claude-code.ts` | 2,987 | All CC connector logic | `packages/bridge/src/connectors/claude-code/` |
| `packages/bridge/src/connectors/opencode.ts` | 1,938 | All OC connector logic | `packages/bridge/src/connectors/opencode/` |
| `packages/bridge/src/types.ts` | 1,730 | All type definitions | `packages/bridge/src/types/` split by agent |

### ✅ The "Touch It, Move It" Rule (MANDATORY)

When you touch ANY function in a frozen file (bug fix, SDK update, feature change), you MUST extract it to a new file. Never fix in place — always extract to a new file, fix it there, and replace the original method body with a 1-line call to the new file (so nothing breaks). This is how we gradually migrate without a risky big-bang rewrite.

**How it works:**
1. You need to fix `_showCodexSettingsSheet()` in `chat_screen.dart`
2. Create `lib/screens/sheets/cx_settings_sheet.dart`
3. Move the entire method there as a standalone function/widget
4. Fix the bug in the new file
5. In `chat_screen.dart`, replace the old method body with a one-line call to the new file
6. Done — the bug is fixed AND the codebase is more modular

### 📋 Extraction Recipes (Copy These Patterns)

**ALREADY WORKING EXAMPLES — use these as templates:**
- `lib/screens/sheets/cx_model_sheet.dart` (154 lines) — extracted from chat_screen.dart ✅
- `lib/screens/sheets/cx_apps_sheet.dart` (156 lines) — extracted from chat_screen.dart ✅
- `lib/screens/sheets/git_branch_sheet.dart` (106 lines) — extracted from chat_screen.dart ✅
- `packages/bridge/src/handlers/git/` (10 files, clean separation) — extracted from server.ts ✅
- `packages/bridge/src/handlers/codex_features.ts` (306 lines) — extracted from server.ts ✅

---

#### Recipe 1: Extract a `_show*Sheet()` from `chat_screen.dart`

**Before** (method lives inside `_ChatScreenState`):
```dart
// Inside chat_screen.dart — 200 lines of sheet code
void _showCodexSettingsSheet() {
  DetailSheet.show(context: context, title: 'Settings', child: Consumer(...));
}
```

**After** — create `lib/screens/sheets/cx_settings_sheet.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
// ... other imports

/// Shows the Codex settings sheet. Extracted from chat_screen.dart.
void showCxSettingsSheet(BuildContext context) {
  DetailSheet.show(
    context: context,
    title: 'Codex Settings',
    initialSize: 0.6,
    child: Consumer(builder: (context, ref, _) {
      // All the sheet logic here — ref.watch, ref.read all work inside Consumer
      return Column(...);
    }),
  );
}
```

**In `chat_screen.dart`** — replace the old method:
```dart
void _showCodexSettingsSheet() => showCxSettingsSheet(context);
```

**Key point:** `Consumer` gives you `ref` inside the sheet, so you don't need to pass providers as parameters. This makes extraction trivial.

---

#### Recipe 2: Extract a menu handler from `chat_screen.dart`

**Create `lib/screens/chat/cc_menu_handler.dart`:**
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Handles Claude Code overflow menu actions. Extracted from chat_screen.dart.
void handleClaudeCodeMenuAction(
  BuildContext context,
  WidgetRef ref,
  String value,
) {
  switch (value) {
    case 'compact': // ...
    case 'share': // ...
  }
}
```

**In `chat_screen.dart`:**
```dart
void _handleClaudeCodeMenuAction(String value) =>
    handleClaudeCodeMenuAction(context, ref, value);
```

---

#### Recipe 3: Extract a case handler from `server.ts`

**Create `packages/bridge/src/handlers/cc_sessions.ts`:**
```typescript
import type { ServerContext } from '../types'

export async function handle(
  message: any,
  reply: (msg: any) => void,
  ctx: ServerContext,
) {
  switch (message.type) {
    case 'cc_list_sessions': {
      const sessions = await ctx.claudeCode.listSessions(message.cwd)
      reply({ type: 'cc_sessions', data: sessions, requestId: message.requestId })
      break
    }
    case 'cc_get_session': {
      // ...
      break
    }
    default:
      return false // signal: not handled
  }
  return true // signal: handled
}
```

**In `server.ts` — add ONE line to the routing:**
```typescript
import * as ccSessions from './handlers/cc_sessions'
// In processSingleMessage, before the giant switch:
if (message.type.startsWith('cc_') && message.type.includes('session')) {
  if (await ccSessions.handle(message, reply, ctx)) return
}
```

---

#### Recipe 4: Extract bridge_service.dart methods by agent

**Create `lib/services/bridge/bridge_claude_code.dart`:**
```dart
import 'package:broski/services/bridge_service.dart';

/// Claude Code bridge methods. Extension on BridgeService.
extension BridgeClaudeCode on BridgeService {
  Future<List<CCSomething>> ccListSomething({String? cwd}) async {
    // Use this._socket, this._waitFor, this._generateRequestId — all accessible via extension
  }
}
```

**In `bridge_service.dart`** — just add the import (extension methods auto-attach):
```dart
// At top of bridge_service.dart:
export 'bridge/bridge_claude_code.dart';
```

---

#### Recipe 5: Extract a widget builder from any screen

**Create `lib/widgets/chat/input_bar.dart`:**
```dart
class ChatInputBar extends ConsumerWidget {
  final TextEditingController controller;
  final VoidCallback onSend;
  // ... other params
  
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Extracted from _buildInputBarWithParams()
  }
}
```

---

### 🏗️ Planned Modular Structure (Where Things Should Live)

**Flutter — Target structure:**
```
lib/
  screens/
    chat_screen.dart            ← FROZEN: only build() + routing to extracted code
    sessions_screen.dart        ← FROZEN: same pattern
    sheets/                     ← ✅ Already exists, keep adding here
      cc_tools_sheet.dart       ← extract from chat_screen._showClaudeCodeToolsSheet()
      cc_skills_sheet.dart      ← extract from chat_screen._showClaudeCodeSkillsSheet()
      cc_hooks_sheet.dart       ← extract from chat_screen._showClaudeCodeHooksSheet()
      cc_mcp_sheet.dart         ← extract from chat_screen._showClaudeCodeMcpSheet()
      cc_commands_sheet.dart    ← extract from chat_screen._showClaudeCodeCommandsSheet()
      cc_model_sheet.dart       ← extract from chat_screen._showClaudeCodeModelSheet()
      cx_settings_sheet.dart    ← extract from chat_screen._showCodexSettingsSheet()
      cx_config_sheet.dart      ← extract from chat_screen._showCodexConfigSheet()
      cx_auth_sheet.dart        ← extract from chat_screen._showCodexAuthSheet()
      cx_feedback_sheet.dart    ← extract from chat_screen._showCodexFeedbackSheet()
      cx_mcp_sheet.dart         ← extract from chat_screen._showCodexMcpSheet()
      cx_model_sheet.dart       ← ✅ Already extracted
      cx_apps_sheet.dart        ← ✅ Already extracted
      cx_skills_sheet_content.dart ← ✅ Already extracted
      git_panel_sheet.dart      ← ✅ Already extracted
    dialogs/
      share_dialog.dart         ← extract from chat_screen._showShareDialog()
      rename_dialog.dart        ← extract from chat_screen._showRenameSessionDialog()
      fork_dialog.dart          ← extract from chat_screen._showForkDialog()
      help_dialog.dart          ← extract from chat_screen._showHelpDialog()
      timeline_dialog.dart      ← extract from chat_screen._showTimelineDialog()
      models_dialog.dart        ← extract from chat_screen._showModelsDialog()
    chat/
      cc_menu_handler.dart      ← extract from chat_screen._handleClaudeCodeMenuAction()
      cx_menu_handler.dart      ← extract from chat_screen._handleCodexMenuAction()
      message_actions.dart      ← extract fork/revert/rewind methods
      session_actions.dart      ← extract share/compact/export methods
      transcript_actions.dart   ← extract copy/export/share transcript methods
    pi/
      pi_extension_ui_request_handler.dart ← ✅ Already modular (253 lines)
    sessions/
      new_session_sheet.dart    ← extract _NewSessionContent from sessions_screen
      session_row.dart          ← extract session row items
      session_filters.dart      ← extract filter sheet
    onboarding/
      step_*.dart               ← one file per onboarding step
  services/
    bridge_service.dart         ← FROZEN: core only (auth, dispatch, shared utils)
    pi_bridge_service.dart      ← ✅ Pi has its own service file (624 lines — watch it, split if grows)
    bridge/
      bridge_opencode.dart      ← OC methods as extension on BridgeService
      bridge_claude_code.dart   ← CC methods as extension on BridgeService
      bridge_codex.dart         ← CX methods as extension on BridgeService
      bridge_pty.dart           ← PTY methods as extension on BridgeService
      bridge_files.dart         ← File operations as extension on BridgeService
      bridge_mcp.dart           ← MCP methods as extension on BridgeService
  providers/
    chat_provider.dart          ← FROZEN: core state + dispatch only
    chat/
      cc_stream_handler.dart    ← CC event processing extracted
      oc_stream_handler.dart    ← OC event processing extracted
      cx_stream_handler.dart    ← CX event processing extracted
      message_builder.dart      ← Message construction logic
  models/
    claude_code.dart            ← FROZEN: keep as-is for now
    claude_code/
      cc_config.dart            ← when adding new CC model classes, put here
      cc_session.dart           ← when adding new CC session types, put here
    pi.dart                     ← ✅ Pi models (495 lines — clean, keep as-is)
```

**Bridge — Target structure:**
```
packages/bridge/src/
  server.ts                     ← FROZEN: routing only, delegates to handlers
  handlers/
    git/                        ← ✅ Already extracted and working
    codex_features.ts           ← ✅ Already extracted
    pi_features.ts              ← ✅ Already modular (428 lines, from feature/pi-integration)
    cc_sessions.ts              ← extract CC session case blocks
    cc_config.ts                ← extract CC config case blocks
    cc_skills.ts                ← extract CC skills case blocks
    oc_sessions.ts              ← extract OC session case blocks
    oc_config.ts                ← extract OC config case blocks
    cx_sessions.ts              ← extract CX session case blocks
    file_ops.ts                 ← extract read_file, find_files, etc.
    mcp_handler.ts              ← extract all mcp_* case blocks
    pty_handler.ts              ← extract all pty_* case blocks
    session_handler.ts          ← extract shared session case blocks
  connectors/
    claude-code.ts              ← FROZEN: keep as-is for now
    claude-code/
      cc-plugins.ts             ← when adding new CC features, put here
      cc-hooks.ts               ← when adding new CC features, put here
    opencode.ts                 ← FROZEN: keep as-is for now
    codex.ts                    ← existing
    codex-fs.ts                 ← ✅ Already modular
    pi.ts                       ← 675 lines, watch this — split if it grows past 800
    pi_extension_ui.ts          ← ✅ Already modular (279 lines)
  types/
    index.ts                    ← re-exports everything (backward compatible)
    messages.ts                 ← ClientMessage + ServerMessage unions
    claude-code.ts              ← CC-specific types
    codex.ts                    ← CX-specific types
    opencode.ts                 ← OC-specific types
    pi.ts                       ← ✅ Already split out on feature/pi-integration
    shared.ts                   ← shared types
```

### 🔢 Hard Limits

| Metric | Limit | Action |
|--------|-------|--------|
| New file | < 400 lines | If approaching 400, split further |
| New function | < 50 lines | Extract helper functions |
| Adding to a FROZEN file | 0 new methods/cases | Create a new file, add a 1-line call |
| Editing a FROZEN file | Must extract while editing | Fix in a new file, replace original with 1-line call |

### ✅ Pre-Completion Checklist (VERIFY BEFORE YOU FINISH)

Before you consider your task done, check ALL of these:

- [ ] **Did I add any new method/function to a FROZEN file?** → If yes, extract it NOW to a new file.
- [ ] **Did I add more than 10 lines to any file over 500 lines?** → If yes, extract the changed section to a new file.
- [ ] **Is my new file under 400 lines?** → If no, split it.
- [ ] **Can I describe what my new file does without using "and"?** → If no, it has multiple responsibilities — split it.
- [ ] **Did I update imports in the parent file?** → The FROZEN file should import and delegate, not contain the logic.

## Testing Guidelines
- Tests use `flutter_test`; write new tests in `test/` with `*_test.dart` naming.
- Prefer `testWidgets` for UI behavior and keep tests deterministic.
- Run a single test file with `flutter test test/your_file_test.dart` when iterating.

## Commit & Pull Request Guidelines
- Git history is minimal, so use short, imperative commit subjects (e.g., “Add connection screen”).
- Keep commits focused on one logical change.
- PRs should include a brief summary, testing notes, and screenshots for UI changes.
- Link related issues or documentation updates when applicable.

## Documentation & Specs
- Treat `docs/mvp/` as the source of truth for requirements and update it when behavior changes.

### Don't use mgrep use your own file search and read or whatever tools but not mgrep

## SDK Integration Rules

### Use SDK types. Don't cast `as any` when the SDK exports a proper type.

If the SDK exports a type for a message, response, or content block — import it and use it. Casting `as any` hides breaking changes. When the SDK renames a field, TypeScript catches it at compile time with real types but silently returns `undefined` at runtime with `as any`.

### Don't write fallbacks for old SDK response formats.

When the current SDK returns `{ data: [...] }`, don't also handle the old format with `result?.data ?? result ?? []`. That middle `?? result` is dead code for an SDK version we no longer use. Trust the current SDK's response shape.

| Situation | Do this | Not this |
|-----------|---------|----------|
| SDK exports `SDKAssistantMessage` with `.message.content` | `import type { SDKAssistantMessage }` and use it | `(block as any).text` |
| Codex v2 returns `{ data: [...], nextCursor }` | `result.data` | `result?.data ?? result ?? []` |
| OpenCode SDK call with `{ responseStyle: 'data' }` | Use the typed return value directly | `(result as any) ?? []` |
| Filesystem read might fail | `try { readdir() } catch { return [] }` ← this is fine | — |
| JSON from WebSocket might have null fields | `json['name'] as String? ?? ''` ← this is fine | — |
| Bridge unreachable, show cached data | Offline cache fallback ← this is fine | — |

**The test:** If your `??` or `as any` exists because "the SDK used to return something different" — remove it. If it exists because "the runtime operation can genuinely fail" — keep it.

## SDK Update System

Broski sits on top of 4 AI SDKs. When they update, the bridge and flutter app need to match. This section tells you how everything is wired so you can update correctly.

### SDK → Bridge → Flutter: The 5-Layer Flow

```
types.ts → server.ts → connector → bridge_service.dart → model → provider → screen
```

| Layer | File (MODULAR — create new files!) | What goes here |
|-------|------|---------------|
| 1. Wire types | `packages/bridge/src/types.ts` (or `types/{agent}.ts`) | ClientMessage + ServerMessage union members, data types |
| 2. Handler | **`packages/bridge/src/handlers/{agent}_{feature}.ts`** ← NEW FILE | Handler function. Only add a 1-line route in server.ts |
| 3. Connector | `packages/bridge/src/connectors/{agent}.ts` (or `connectors/{agent}/{feature}.ts` if FROZEN) | Exported function that calls the SDK |
| 4. Dart service | **`lib/services/bridge/bridge_{agent}.dart`** ← EXTENSION FILE | Method as extension on BridgeService |
| 5. Dart model | `lib/models/{agent}.dart` (or `models/{agent}/{feature}.dart` if FROZEN) | Class with `factory fromJson()` + `toJson()` |
| 6. Provider | `lib/providers/{agent}_provider.dart` | Riverpod provider (FutureProvider or StateNotifier) |
| 7. UI | **`lib/screens/sheets/{agent}_{feature}_sheet.dart`** ← NEW FILE | Sheet/dialog. Only add a 1-line call in chat_screen.dart |

### Message Naming Conventions

Prefix by agent:
- **OpenCode:** no prefix (`list_sessions`, `chat`) or `oc_` (`oc_list_skills`)
- **Claude Code:** `cc_` (`cc_list_skills`, `cc_chat`, `cc_abort`)
- **Codex:** `cx_` (`cx_chat`, `cx_list_threads`)
- **Pi:** `pi_` (`pi_chat`, `pi_abort`, `pi_list_models`)

Request → Response:
- **List:** `cc_list_skills` → `cc_skills` (response = noun plural)
- **Mutate:** `cc_save_skill` → `cc_skill_saved` (response = noun_past_tense)
- **Stream:** `cc_chat` → `cc_stream` (response = prefix_stream)

### Bridge Handler Pattern (NEW FILE in handlers/, NOT in server.ts)

```typescript
// packages/bridge/src/handlers/xx_things.ts  ← CREATE THIS FILE
import type { ServerContext } from '../types'

export async function handle(message: any, reply: (msg: any) => void, ctx: ServerContext): Promise<boolean> {
  switch (message.type) {
    case 'xx_list_things': {
      const result = await ctx.xxConnector.listThings(message.cwd)
      reply({ type: 'xx_things', data: result, requestId: message.requestId })
      return true
    }
    default: return false
  }
}

// In server.ts — add ONLY these 2 lines:
// import * as xxThings from './handlers/xx_things'
// if (await xxThings.handle(message, reply, ctx)) return  ← add in processSingleMessage
```

### Flutter Bridge Service Patterns

```dart
// REQUEST/RESPONSE (returns data):
Future<List<Thing>> xxListThings({String? cwd}) async {
  final requestId = _generateRequestId();
  _socket.send({'type': 'xx_list_things', 'requestId': requestId, if (cwd != null) 'cwd': cwd});
  final response = await _waitFor('xx_things', requestId: requestId);
  final data = response['data'] as List<dynamic>? ?? [];
  return data.map((item) => Thing.fromJson(item as Map<String, dynamic>)).toList();
}

// FIRE-AND-FORGET (streaming):
void xxChat({required String prompt, ...}) {
  _socket.send({'type': 'xx_chat', 'prompt': prompt, ...});
}

// STREAM LISTENER:
Stream<XxStreamMessage> get xxStreamMessages =>
    _socket.messages.where((m) => m['type'] == 'xx_stream')
        .map((m) => XxStreamMessage.fromJson(m['data'] ?? {}));
```

### Flutter Model Pattern

```dart
class Thing {
  final String name;
  final String? description;
  const Thing({required this.name, this.description});
  factory Thing.fromJson(Map<String, dynamic> json) {
    return Thing(
      name: json['name'] as String? ?? '',         // defensive: ?? default
      description: json['description'] as String?, // nullable: no default
    );
  }
  Map<String, dynamic> toJson() => {
    'name': name,
    if (description != null) 'description': description,  // omit nulls
  };
}
// Enums always have: wireValue, fromWireValue(String), displayName
// Sealed classes use switch-on-type for polymorphic fromJson()
```

### Riverpod Provider Patterns

| Use Case | Provider Type |
|----------|--------------|
| Read-only list (parameterized) | `FutureProvider.family<List<T>, String?>` |
| Mutable CRUD list | `StateNotifierProvider` wrapping `AsyncValue<List<T>>` |
| Config with edits | `StateNotifierProvider` wrapping `AsyncValue<T>` |
| Streaming chat state | `StateNotifierProvider` wrapping plain state class |
| Simple filter | `StateProvider<T>` |

StateNotifier always: `load()` checks `_connection.isOfflineMode` → cache fallback. On success: cache via `_storage.cacheX()`. On error: fall back to `_storage.getCachedX()`.

### Bottom Sheet UI Pattern

```dart
void _showXxThingsSheet() {
  DetailSheet.show(
    context: context,
    title: 'Things',
    initialSize: 0.5,
    child: Consumer(builder: (context, ref, _) {
      final cwd = ref.watch(chatSessionProvider).cwd;
      final thingsAsync = ref.watch(xxThingsProvider(cwd));
      return thingsAsync.when(
        data: (items) => Column(children: items.map((i) => ListTile(
          dense: true,
          title: Text(i.name),
          subtitle: i.description != null ? Text(i.description!) : null,
        )).toList()),
        loading: () => CircularProgressIndicator(),
        error: (e, _) => Text('Error: $e'),
      );
    }),
  );
}
```

### New Feature Checklist (all 9 steps — MODULAR VERSION)

To add `xx_list_widgets` for agent XX:

1. **`types.ts`** (or `types/xx.ts` if it exists): Add `| { type: 'xx_list_widgets'; cwd?: string }` to ClientMessage
2. **`types.ts`** (or `types/xx.ts`): Add `| { type: 'xx_widgets'; data: XxWidget[]; requestId?: string }` to ServerMessage
3. **`types.ts`** (or `types/xx.ts`): Define `export type XxWidget = { ... }` if new type
4. **`connectors/xx.ts`** (or `connectors/xx/xx-widgets.ts` if connector is FROZEN): Add `export async function listWidgets(cwd?: string): Promise<XxWidget[]>`
5. **`handlers/xx_widgets.ts`** ← ⚠️ NEW FILE, not server.ts! Create handler file, add 1-line import+route in server.ts
6. **`lib/models/xx.dart`** (or `lib/models/xx/xx_widget.dart` if model file is FROZEN): Add `class XxWidget` with `factory fromJson()`
7. **`lib/services/bridge/bridge_xx.dart`** ← ⚠️ Extension file, not bridge_service.dart! Add method as extension on BridgeService
8. **`lib/providers/xx_provider.dart`**: Add `final xxWidgetsProvider = FutureProvider.family<...>`
9. **`lib/screens/sheets/xx_widgets_sheet.dart`** ← ⚠️ NEW FILE, not chat_screen.dart! Then in chat_screen.dart add only: `void _showXxWidgetsSheet() => showXxWidgetsSheet(context);`

### SDK-Specific Notes

- **Claude Code SDK** (`@anthropic-ai/claude-agent-sdk`): Uses model aliases `sonnet/opus/haiku`. New version of same tier = no code change. New tier = add to `types.ts` model union, `claude_code.dart` enum, model picker, settings dropdown.
- **OpenCode SDK** (`@opencode-ai/sdk/v2`): Fully dynamic models from `provider.list()`. SDK returns `{ data, error }` wrapper — always destructure `.data` before using. If SDK types change, fix `connectors/opencode.ts`.
- **Codex** (spawned as `codex app-server` child process): JSON-RPC over stdio. Bridge talks via `request(method, params)` and `notify(method, params)`. If wire protocol changes, update `connectors/codex.ts`.
- **Pi** (`@mariozechner/pi-coding-agent` npm + `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`): Event-driven `AgentSession` with `AgentSessionEvent` streaming. Dynamic models via `ModelRegistry`. Connector: `connectors/pi.ts`. Has extension UI bridge (`pi_extension_ui.ts`) for dialog/confirm/select prompts relayed to the app. Handler already modular: `handlers/pi_features.ts`.

### Where to find SDK code and docs

| SDK | Source code | API docs | What syncs automatically |
|-----|-----------|----------|--------------------------|
| **Codex** | `reference/codex/sdk/typescript/src/` | In the source itself | `sync-refs.sh` pulls from GitHub |
| **OpenCode** | `reference/opencode/packages/sdk/js/src/` | In the source itself | `sync-refs.sh` pulls from GitHub |
| **Claude Code** | `node_modules/@anthropic-ai/claude-agent-sdk/` (closed source, npm) | `reference/cc-docs/` (manually maintained) | `sync-refs.sh` pulls CHANGELOG + plugins from GitHub. **SDK docs must be manually updated** from https://platform.claude.com/docs/en/agent-sdk/ into `reference/cc-docs/` |
| **Pi** | `reference/pi-mono/packages/coding-agent/src/` (main), also `packages/ai/src/` and `packages/agent/src/` | In the source + `packages/coding-agent/docs/` | npm: `@mariozechner/pi-coding-agent`. Source ref for types/events/tools |

**Claude Code SDK docs** (`reference/cc-docs/`): These are manually copied from the Claude platform docs website. Key files:
- `01-overview.md` through `06-migration-guide.md` — core SDK reference
- `guides/*.md` — 20 guides covering streaming, permissions, hooks, sessions, MCP, subagents, plugins, etc.
- When working on the Claude Code bridge connector, READ these docs for the latest API patterns

> **⚠️ TRUST ORDER FOR CLAUDE CODE SDK (read this before any SDK work):**
>
> **First: make sure the SDK is up to date!** Run `cd packages/bridge && npm update @anthropic-ai/claude-agent-sdk` before comparing types. We got burned comparing against stale `0.1.76` when latest was `0.2.34` — the docs were right, our package was old.
>
> Once the SDK package is current, these three sources should agree. If they don't:
>
> 1. 🥇 **`reference/cc-docs/`** — official API docs manually copied from https://platform.claude.com/docs/en/agent-sdk/. Best for types, patterns, and how-to guides. This is the **primary reference** for SDK work.
> 2. 🥈 **Installed SDK `.d.ts` files** (`packages/bridge/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`) — the actual compiled types. Use to **verify** when docs seem wrong or incomplete. If docs and `.d.ts` disagree and the package is current, trust `.d.ts` (docs may not have been updated yet for a recent release).
> 3. 🥉 **`reference/claude-code/` CHANGELOG** — tells you what's new in the **Claude Code CLI app**, NOT necessarily the Agent SDK npm package. Features sometimes land in the CLI first. Relevant for filesystem features (hooks files, agent `.md` files, memory dirs, `.claude/` structure) since we read/write those directly.
>
> **Rule of thumb:** cc-docs for learning, `.d.ts` for verifying, CHANGELOG for CLI-only features.

### SDK Sync Workflow

1. Run `./reference/sync-refs.sh --all` — pulls all SDK repos + auto-generates diff report
2. Report saved to `reference/YYYY-MM-DD_HHMM_sdk-diff.md`
3. Report has 4 parts: SDK changes (categorized), your code inventory (dynamic), conventions, AI instructions
4. State tracked in `reference/.sdk-state` (last-synced commit per SDK)
5. Hand report to AI agent or just say "I synced the SDKs, update bridge + flutter"
