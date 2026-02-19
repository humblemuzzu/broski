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

## Modular Code Architecture (MANDATORY for all new code)

The codebase has legacy monster files (`server.ts` ~7500 lines, `chat_screen.dart` ~10000 lines). We are NOT doing a full migration right now. But ALL new code MUST follow modular structure. AND when you edit an existing function (bug fix, SDK update, feature change), extract it into its own file at the same time. This is gradual migration — every edit makes the codebase more modular.

**The "Touch It, Move It" Rule:** If you're editing a function that lives in a monster file, extract it to a new file WHILE you edit it. Don't just fix the bug in place — fix AND extract. Two birds, one stone. By the time we do a full migration, most of the work will already be done.

The goal: each file does ONE thing, AI agents only read what they need, bugs are isolated to small files.

### Bridge (TypeScript) — Modular Rules

**New message handlers** — DO NOT add more `case` blocks to `server.ts`. Instead:

1. Create a handler file: `packages/bridge/src/handlers/{agent}_{feature}.ts`
2. Export a single function: `export function handle(message, reply, context)`
3. Import and register it in `server.ts` with ONE line

```typescript
// packages/bridge/src/handlers/cc_plugins.ts
import * as claudeCode from '../connectors/claude-code'
import type { ServerContext } from '../types'

export async function handle(message: any, reply: Function, ctx: ServerContext) {
  switch (message.type) {
    case 'cc_list_plugins': {
      const plugins = await claudeCode.listPlugins(message.cwd)
      reply({ type: 'cc_plugins', data: plugins })
      break
    }
    case 'cc_toggle_plugin': {
      // ...
      break
    }
  }
}

// Then in server.ts, just add:
// import * as ccPlugins from './handlers/cc_plugins'
// In processSingleMessage: if (message.type.startsWith('cc_plugin')) return ccPlugins.handle(message, reply, ctx)
```

**New connector features** — If adding 100+ lines to a connector, create a sub-module:

```
packages/bridge/src/connectors/
  claude-code.ts              ← existing (keep as-is)
  claude-code-plugins.ts      ← new: plugin-specific logic
  claude-code-custom-tools.ts ← new: custom tool logic
  codex.ts                    ← existing
  codex-fs.ts                 ← existing (already modular!)
```

**New types** — Group related types in separate files:

```
packages/bridge/src/types/
  index.ts          ← re-exports everything (backward compatible)
  messages.ts       ← ClientMessage + ServerMessage unions
  claude-code.ts    ← ClaudeCode* types
  codex.ts          ← Codex* types  
  opencode.ts       ← OpenCode* types
  shared.ts         ← shared types (FileAttachment, etc.)
```

### Flutter (Dart) — Modular Rules

**New screens/sheets** — DO NOT add more methods to `chat_screen.dart`. Instead:

```
lib/screens/
  chat_screen.dart         ← existing (keep as-is)
  sheets/
    cc_skills_sheet.dart   ← _showClaudeCodeSkillsSheet() extracted
    cc_plugins_sheet.dart  ← new feature
    cx_model_sheet.dart    ← _showCodexModelSheet() extracted
```

**New widgets** — One widget per file:

```
lib/widgets/
  provider_icon.dart     ← existing
  model_picker.dart      ← new: model selection widget
  permission_dialog.dart ← new: permission request UI
```

**New providers** — Already modular (one file per agent). Keep it that way.

### The Rule

> **If a file is over 500 lines, don't add to it. Create a new file next to it.**
> 
> **If a function is over 50 lines, it probably belongs in its own file.**
> 
> **Name files by what they DO, not what they ARE.** `cc_plugins_handler.ts` not `utils2.ts`.

### Why This Matters

- AI agents read only the file they need (200 lines) instead of the whole monster (7500 lines)
- Bugs are isolated: a broken plugin handler can't crash session management
- Multiple AI agents can work on different features simultaneously without merge conflicts
- You can hand an AI agent ONE file and say "fix this" instead of "find the bug in this 10K line file"

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

## SDK Update System

Broski sits on top of 3 AI SDKs. When they update, the bridge and flutter app need to match. This section tells you how everything is wired so you can update correctly.

### SDK → Bridge → Flutter: The 5-Layer Flow

```
types.ts → server.ts → connector → bridge_service.dart → model → provider → screen
```

| Layer | File | What goes here |
|-------|------|---------------|
| 1. Wire types | `packages/bridge/src/types.ts` | ClientMessage + ServerMessage union members, data types |
| 2. Handler | `packages/bridge/src/server.ts` | `case 'xx_verb_noun':` inside `processSingleMessage()` |
| 3. Connector | `packages/bridge/src/connectors/{agent}.ts` | Exported function that calls the SDK |
| 4. Dart service | `lib/services/bridge_service.dart` | Method that sends WS message + awaits response |
| 5. Dart model | `lib/models/{agent}.dart` | Class with `factory fromJson()` + `toJson()` |
| 6. Provider | `lib/providers/{agent}_provider.dart` | Riverpod provider (FutureProvider or StateNotifier) |
| 7. UI | `lib/screens/chat_screen.dart` | Bottom sheet or inline widget |

### Message Naming Conventions

Prefix by agent:
- **OpenCode:** no prefix (`list_sessions`, `chat`) or `oc_` (`oc_list_skills`)
- **Claude Code:** `cc_` (`cc_list_skills`, `cc_chat`, `cc_abort`)
- **Codex:** `cx_` (`cx_chat`, `cx_list_threads`)

Request → Response:
- **List:** `cc_list_skills` → `cc_skills` (response = noun plural)
- **Mutate:** `cc_save_skill` → `cc_skill_saved` (response = noun_past_tense)
- **Stream:** `cc_chat` → `cc_stream` (response = prefix_stream)

### Bridge Handler Pattern (server.ts)

```typescript
case 'xx_list_things': {
  const result = await connector.listThings(message.cwd)
  reply({ type: 'xx_things', data: result })
  break
}
// Errors propagate to outer try/catch → reply({ type: 'error', message: ... })
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

### New Feature Checklist (all 9 steps)

To add `xx_list_widgets` for agent XX:

1. **`types.ts`**: Add `| { type: 'xx_list_widgets'; cwd?: string }` to ClientMessage
2. **`types.ts`**: Add `| { type: 'xx_widgets'; data: XxWidget[]; requestId?: string }` to ServerMessage
3. **`types.ts`**: Define `export type XxWidget = { ... }` if new type
4. **`connectors/xx.ts`**: Add `export async function listWidgets(cwd?: string): Promise<XxWidget[]>`
5. **`server.ts`**: Add `case 'xx_list_widgets': { reply({ type: 'xx_widgets', data: await xx.listWidgets(msg.cwd) }) }`
6. **`lib/models/xx.dart`**: Add `class XxWidget` with `factory fromJson()`
7. **`lib/services/bridge_service.dart`**: Add `Future<List<XxWidget>> xxListWidgets({String? cwd})`
8. **`lib/providers/xx_provider.dart`**: Add `final xxWidgetsProvider = FutureProvider.family<...>`
9. **`lib/screens/chat_screen.dart`**: Add `_showXxWidgetsSheet()` using DetailSheet.show + Consumer

### SDK-Specific Notes

- **Claude Code SDK** (`@anthropic-ai/claude-agent-sdk`): Uses model aliases `sonnet/opus/haiku`. New version of same tier = no code change. New tier = add to `types.ts` model union, `claude_code.dart` enum, `chat_screen.dart` model picker, `claude_code_settings_screen.dart` dropdown.
- **OpenCode SDK** (`@opencode-ai/sdk/v2`): Fully dynamic models from `provider.list()`. SDK returns `{ data, error }` wrapper — always destructure `.data` before using. If SDK types change, fix `connectors/opencode.ts`.
- **Codex** (spawned as `codex app-server` child process): JSON-RPC over stdio. Bridge talks via `request(method, params)` and `notify(method, params)`. If wire protocol changes, update `connectors/codex.ts`.

### Where to find SDK code and docs

| SDK | Source code | API docs | What syncs automatically |
|-----|-----------|----------|--------------------------|
| **Codex** | `reference/codex/sdk/typescript/src/` | In the source itself | `sync-refs.sh` pulls from GitHub |
| **OpenCode** | `reference/opencode/packages/sdk/js/src/` | In the source itself | `sync-refs.sh` pulls from GitHub |
| **Claude Code** | `node_modules/@anthropic-ai/claude-agent-sdk/` (closed source, npm) | `reference/cc-docs/` (manually maintained) | `sync-refs.sh` pulls CHANGELOG + plugins from GitHub. **SDK docs must be manually updated** from https://platform.claude.com/docs/en/agent-sdk/ into `reference/cc-docs/` |

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

## Demo Prompt: "Explain to the X community"

When the user says **"explain to the x community"** (or similar), this is a demo/recording prompt. Follow this sequence:

### Step 1: Generate Visual Activity
Read through several files to create terminal activity for the recording:
- `lib/main.dart`
- `lib/screens/chat_screen.dart`
- `lib/screens/sessions_screen.dart`
- `lib/providers/` (a few files)
- `lib/services/` (a few files)
- `packages/bridge/src/server.ts`
- `docs/mvp/` (a few files)

Read them in parallel batches to show activity. Don't summarize the file contents.

### Step 2: Output User-Focused Pitch
After reading, output a **5-sentence explanation** with a small table. Focus ONLY on:
- The problem users face (AI agents stuck on desktop)
- The solution (control from your phone, anywhere)
- Key user benefits (real-time chat, approve commands, see file changes)
- Works with multiple AI agents

**DO NOT mention:**
- Setup commands (`bunx broski-bridge`, etc.)
- Technical internals (WebSocket, L1/L2 caching, SDK details)
- Architecture diagrams or code structure
- "Open source" — Broski is NOT open source
- Bridge server details

### Example Output Format
```
Broski: Your AI coding agents, in your pocket.

[5 sentences about user value]

| What You Get | Why It Matters |
|--------------|----------------|
| ... | ... |
```

Keep it punchy, user-focused, and demo-friendly.
