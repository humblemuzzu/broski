# Claude Code on the contract: the plan

Status: plan, written 2026-11-01 on `main` at `6ce0895`, after the SDK moved from 0.2.92 to **0.3.316** (bundled CLI 2.1.316).
Goal: Claude Code becomes a contract backend (`packages/bridge/src/backends/claude-code/`) that rides the generic app (`lib/agent/`) exactly as Pi does, reaches parity with the old `cc_*` path, and then the old path is deleted.

This file is the single plan from start to finish: what we know, what we decided, what we still have to prove, what gets built in which order, by whom, and how we know each step is done.

## 0. Sources

| Source | What it is |
|---|---|
| `research/01-process-lifecycle-controls-testing.md` | Process model, `Options`, `Query`, control protocol, auth, packaging, offline testing |
| `research/02-messages-streaming-tools.md` | Every `SDKMessage`, stream events, every built-in tool, usage, the SDK → contract event map |
| `research/03-interactions-permissions-hooks.md` | `canUseTool`, AskUserQuestion, plan mode, elicitation, dialogs, hooks, sandbox, terminal asks |
| `research/04-sessions-transcripts-subagents-terminal.md` | Transcripts on disk, the session API, fork/rewind, subagents, terminal sessions |
| `research/05-config-surfaces.md` | `Settings` (every key), MCP, plugins, skills, commands, memory, agents, output styles |
| `research/06-contract-and-architecture.md` | The adapter author's manual: `AgentBackend`, data model, ops recipe, 29 conformance rules, app rendering, registration |
| `research/07-old-path-parity-inventory.md` | Every feature, message, hidden behaviour and file of the old Claude Code path |
| `research/08-spike.md` | Step 1: Q1–Q13 answered by tests against the real CLI offline, the SDK facts verified twice, and the plan changes applied below |
| `docs/architecture/contract/research/claude-code.md` | Phase 1 research (SDK 0.3.312); still right in most places, corrected by the files above |

Order of truth when they disagree: the installed SDK (`node_modules/@anthropic-ai/claude-agent-sdk/*.d.ts`, `sdk.mjs`) → the changelogs (`reference/cc-sdk-CHANGELOG.md`, `reference/claude-code/CHANGELOG.md`) → live docs (code.claude.com) → the research files → the local docs mirror (`reference/cc-docs/`, dated 2026-01-01, stale).

## 1. Where we stand

**Done before this plan**
- SDK pinned at `0.3.316` (`packages/bridge/package.json`). Bridge `typecheck`, `biome` and `bun test` (2,423 pass, 0 fail) are green on it; one test needed `requestId` added to its fake `canUseTool`/elicitation options.
- The contract already knows Claude Code: `BackendId` has `claude-code`, `ClaudeCodeOp = RewindFilesOp`, `layers.ts` already allows `@anthropic-ai/claude-agent-sdk` under `backends/claude-code/`. **No contract change is needed to register a first adapter.** (06 §9)

**Broken right now, and why it matters first**
- **A compiled bridge cannot start Claude Code at all.** 0.3.x has no `cli.js`; it spawns a native `claude` binary resolved from the optional package, which `bun build --compile` cannot resolve. The old path has no `pathToClaudeCodeExecutable` and no `extractFromBunfs` (07 §5, 01 §2.3). Dev (`bun run`) works. **No compiled release until Step 1 lands.**

**What the old path is** (07): ~55 user-visible features, 60 `cc_*` + 8 `unified_*` messages, ~13,000 lines of bridge code and ~12,000 lines of app code, with known bugs (the session-path encoder, a session-id path traversal in delete, memory read from directories the CLI never uses, `releaseChannel` written to a key that does not exist, a settings writer that empties a file with a trailing comma, a 10-minute permission timeout, rename/tag that never show).

## 2. The facts that shape the design

Each one is cited in the research files; they are listed here because every lane must know them.

**Process**
1. One `query()` is one OS process. A **string prompt is one-shot** (stdin closes at run end). A long-lived session needs an `AsyncIterable` prompt that never ends, and exactly one consumer loop (01 §3).
2. `options.env` **replaces** the environment. The SDK adds `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, `CLAUDE_AGENT_SDK_VERSION`, `CLAUDE_CODE_SDK_READS_SESSION_STATE=1`, deletes `NODE_OPTIONS` (01 §2.2).
3. Executable resolution never looks at `PATH`: `pathToClaudeCodeExecutable`, else the optional package. No SDK↔CLI version check exists anywhere (01 §2.4).
4. `close()` is stdin EOF → 2 s → SIGTERM → 5 s → SIGKILL. No control request has a timeout (01 §3.4).
5. `permissionMode` omitted is **not** `default`; `settingSources` omitted loads **all** sources. Always pass the mode (01 fact 9/10, 03 T13).

**Runs and events**
6. `result` ends a **turn**, not a run. One run can hold several turns (queued input, background task wake-ups). `system/init` repeats every turn. `session_state_changed{idle}` is the authoritative "settled" signal and needs `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`; `idle` and `result` can arrive in either order (02 §3).
7. Streamed assistant messages carry **one block each**; there is no block id. `blockId = <message.id>:<index>`. Per-message `usage` is a placeholder; real numbers are on `result.modelUsage`/`total_cost_usd` (cumulative per process, never summed) (02 §4, §6).
8. Tool results arrive as `user` messages with a structured `tool_use_result` (the tool's Output object). Bash has **no exit code**. Images in tool results arrive as inline base64 (02 §5).
9. Stream events cover the main thread only; subagent work arrives as complete messages with `parent_tool_use_id`/`agent_id`, text only with `forwardSubagentText` (02 §4.4).
10. Retraction is real: `retracted_message_uuids` and `supersedes` (02 fact 11).

**Asks**
11. `canUseTool` has **no timeout** — good, it matches "no automatic answers". But the SDK **auto-declines** elicitations when `onElicitation` is absent, `permissionPrompts:'none'` auto-denies, the CLI cancels an unanswered user dialog after its deadline, and AskUserQuestion can auto-resolve on idle if the user turned that on. Returning `null` from a callback blocks forever (03 T1–T8).
12. AskUserQuestion and ExitPlanMode arrive through `canUseTool`. AskUserQuestion answers are keyed by **question text**, multi-select joined (03 Q4).
13. `reinitialize()`/`initialize` redeliver pending asks; callbacks must be idempotent per `requestId` (03 T9).

**Sessions**
14. The session API is **pure in-process file I/O**. `listSessions`/`getSessionInfo` read 64 KiB head + 64 KiB tail per file; `getSessionMessages` walks the live `parentUuid` chain, and above 5 MiB scans only what follows the last compaction. `getSubagentMessages` reads the whole subagent file (04 §3, §8).
15. `listSessions` sorts mtime desc, then `sessionId` **descending** on ties (corrected in Step 3, `foundation/session_order.test.ts`; research 04 said ascending); paging is offset-only, oldest-first for messages. Matching `claude --resume` needs `includeProgrammatic:false`, which also hides every SDK-made session — Broski's own (04 §3).
16. The project directory is the cwd with **every non-alphanumeric character** replaced by `-`, hashed past 200 chars, under `$CLAUDE_CONFIG_DIR`. The old encoder is wrong (04 §2.1).
17. `rewindFiles` restores **files only**, needs a **live** `Query` with `enableFileCheckpointing`. Forks copy no checkpoints. There is no conversation rewind in the SDK; "resume from a message" is a fork (04 §4).
18. Terminal sessions: **no attach, no lock, no pid file**. `bridge.d.ts` is claude.ai Remote Control. A terminal session is a file to tail; taking it over safely means forking it (04 §7).

**Config**
19. Config is **files**. `resolveSettings()` reads the whole cascade with provenance, no session needed. The only SDK write is `updateSettings` with two keys. Settings files are strict JSON: a parse error makes the CLI **skip the whole file** (05 facts 1–6).
20. MCP enable/disable lives in `~/.claude.json`, not `settings.json`; `setMcpServers` touches only dynamic servers. Plugins are enabled by `enabledPlugins`; the SDK cannot install one. Memory is CLAUDE.md at fixed paths; no memory API (05 §4–§8).

## 3. Decisions

D1–D29 are this plan's. Lanes number their own decisions in their reserved range (§9). Each decision is final unless Step 1's spike or an owner answer (§4) overturns it; a decision that changes is rewritten here, never silently.

### Hosting

**D1. One live host per open session, outliving `OpenSession`.** A host owns one `query()` with an open `AsyncIterable` inbox and one consumer loop. `OpenSession.close()` detaches the sink only (conformance rule 25: close aborts nothing, a pending ask survives to the next open). The host's process ends when the host is idle **and** detached, after the adapter's idle grace (30 s), and on `dispose()`.

**D2. The session id is ours from the start.** A new session passes a fresh UUID as `Options.sessionId`, so the contract `SessionRef` exists when `open` resolves, before any `system/init`. Resume passes `resume`. Fork uses `forkSession()` (pure file I/O) then resumes the fork.

**D3. Executable: an injected path, embedded in compiled builds.** The adapter never resolves the binary: its factory takes `cliPath`. The server layer computes it once (`server/claude-cli-path.ts`): in dev, the optional package's `claude`; in a compiled bridge, the per-target binary embedded with `with { type: "file" }` and `extractFromBunfs()`; a bridge config key `claudeCode.cliPath` overrides both. After the first `initialize`, the host compares `initializationResult().claude_code_version` with the `claudeCodeVersion` baked in at build time and reports a mismatch as a `status()` warning. The old connector gets the same path, so the old path also works in compiled builds until it is deleted. As built in Step 1: `scripts/build.sh` embeds the binary through a generated `src/_claude_cli_embed.ts` registered in `server/claude-cli-embedded.ts`; extraction runs lazily on **first use** (it re-reads the whole ~310 MB file at each bridge start, ≈150 ms and a ~310 MB transient), a found path is kept and a miss is retried; a build skips a target whose optional package is not installed (`bun install --os='*' --cpu='*'` installs all); `windows-x64` is not built. A compiled darwin-arm64 bridge is 440.5 MB (130.5 MB without the CLI).

**D4. Environment.** `env = { ...bridge login-shell env, CLAUDE_AGENT_SDK_CLIENT_APP: "broski/<version>", CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" }`. `CLAUDE_CODE_ENTRYPOINT` stays the SDK's `sdk-ts` (claiming `cli` would be a lie the CLI may act on).

**D5. Fixed options for every host.** `includePartialMessages: true`, `forwardSubagentText: true`, `agentProgressSummaries: true`, `enableFileCheckpointing: true`, `permissionMode` always explicit, `allowDangerouslySkipPermissions: true` (only so the user can switch to bypass later; the mode stays `default` unless chosen), no `supportedDialogKinds` and no `onUserDialog` (so the CLI emits no dialogs; see the note below), `onElicitation` always set, `canUseTool` always set, `settingSources` omitted (CLI parity), `systemPrompt: {type:"preset", preset:"claude_code"}`. `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` (D4) is mandatory: without it no `session_state_changed` arrives (Q2). The `refusal_fallback_prompt` dialog is **not** declared: no offline test can reach it (Q13), and conformance rule 23 tests every declared interaction kind, so the adapter does not declare `choice`. Undeclared, the CLI degrades to its classic refusal (an error result that ends the turn), which D31 maps to an error outcome. **Never** `permissionPrompts:"none"`, never `perTaskStopAffordance` (so Stop kills background tasks too, matching "abort ends the run"), never a string prompt, never `persistSession:false`, never `sessionStore`.

**D6. Catalogue reads without a session use a probe.** Models, commands, agents and account come from the `initialize` answer. With no host for the cwd, the adapter starts a probe `query()` with an empty inbox, awaits `initializationResult()`, and closes it. The answer is cached per cwd (memory + `~/.broski/claude-code/catalog.json`), invalidated by `catalog_invalidated`, `commands_changed`, a model refresh op, or 24 h. A live host's own `initialize` refreshes the cache. `prewarm()`/`claim()` stay unused (alpha).

### Runs, input, settings

**D7. Run boundaries.** `run_started` when the adapter dispatches a prompt (`prompt`/`queue`) or when the first frame of a turn arrives with no send pending (`system`). `run_finished` on `session_state_changed{idle}`, and on nothing else (Q2): `idle` arrives after the last `result`, not between turns the CLI chains without a human send (queued `later` input, a background agent's wake-up turn), and it waits for background agents. The `queued_turn_count == 0` fallback is wrong (a wake-up turn follows a result with `0`) and is not used. An ask moves the session to `requires_action` and back to `running`. Outcome per D31.

**D8. Steer goes to the CLI; queue stays in the adapter.** `promptModes: ["start","steer","queue"]`. Steer pushes the message now with `priority: "next"` (folded into the running turn beside the next tool result: one result, both uuids). Queue holds the input in an adapter-owned queue, shown through `queue_changed`, cancellable (`cancelQueued`), and pushed when the run settles; the CLI's own `later` queue batches sends into one turn (`"B\nC"`) and cannot show or cancel items one by one (Q3, Q4). Stop sends `interrupt({cancelQueued:true})` through a typed wrapper (`sdk.d.ts:2952` declares no parameter); it kills background agents too (intended), and queued input comes back to the composer as `input_returned`.

**D9. Every prompt is human-stamped.** `origin: {kind:"human"}`, a fresh `uuid` per send, mapped to the contract `clientRequestId`. The prompt ledger dedupes per `clientRequestId`; the result's `user_message_uuids` closes the loop.

**D10. Input shapes.** Images go as base64 `image` blocks in `message.content` (never written into the repo, unlike the old path). A file mention becomes `@<path>` in the text (the CLI attaches the file). An agent mention becomes `@agent-<name>`, which is a request to the model, not a forced invocation (Q10). `PromptInput.command` becomes `/<name> <args>`. `terminal_slash_commands` are never listed.

**D11. Models and thinking.** `listModels` from `ModelInfo`. The thinking control is the effort level: `ThinkingSpec.options` = the model's `supportedEffortLevels` as given (every built-in model offers `low…max`, Q11); the model list is built into the CLI (not fetched), so `refresh_models` re-runs the probe but cannot add models; a retired id is silently remapped, so the model shown is `init.model`; `setThinking` = `applyFlagSettings({effortLevel})`; `setModel` = `Query.setModel`; `modelSwitch: "next_request"`. Budget-style thinking is not offered (lost, as the contract README §15 already says).

**D12. Modes.** One axis, `permissions`: `default`, `acceptEdits`, `plan`, `auto` (listed only when the model `supportsAutoMode`), `dontAsk`, `bypassPermissions` (description warns). `setMode` = `setPermissionMode`. A new session starts in the mode the phone asked for, else `default`; a project `defaultMode` that `filterEscalatingDefaultMode` drops is not used.

### Asks

**D13. Asks map as research 03 §4 says, with the adapter holding what the contract cannot.**
- `canUseTool` → `tool_permission`. Options: **allow once**, **deny once** (both always present, so the lock screen works), allow for this session and allow always (one option per `suggestions` entry, each option's `PermissionUpdate[]` kept in the adapter by option id, never in the contract), deny and stop (`interrupt:true`). `suppressAlwaysAllowRule` hides the persistent options; `defaultToNo` sets the deny default; `requiresUserInteraction` sets `deliberate`. `title`/`description` from the SDK are the prompt text.
- AskUserQuestion → `questions` (question id = index, `allowCustom: true`, `required: true`); the answer is rebuilt as `updatedInput {questions, answers}` keyed by question text.
- ExitPlanMode → `plan_approval` with the plan from `input.plan` (the CLI also passes `planFilePath`; there are no suggestions); approve = allow (with the edited plan when edited, which reaches the model and sets `planWasEdited`, and the chosen next mode, D25); reject = deny with the feedback, and the session stays in plan mode (Q6).
- AskUserQuestion carries `requiresUserInteraction: true` → `deliberate`; an allow without `answers` reads to the model as "The user did not answer the questions."
- Elicitation form → `form` (flat JSON Schema only; a nested schema is declined with a notice, never answered silently); empty schema → `confirm`; url → `external_url`, resolved by `elicitation_complete`.

**D14. No timers that answer.** No adapter timeout on any ask. The CLI's own withdrawal (`control_cancel_request`, signal abort) → `interaction_resolved{withdrawn}`; a CLI dialog deadline → `expired`. A redelivered `requestId` maps to the same interaction. The old 10-minute waiter is not ported. **A callback never throws:** a throw is an automatic denial ("Tool permission request failed: …", Q7), so an adapter failure inside a callback is caught and the interaction stays raised for a human.

### Store

**D15. The SDK reads sessions; the adapter only orders and pages.** No hand-written JSONL parsing for lists or history, and no path encoding: rows come from `listSessions`/`getSessionInfo`, history from `getSessionMessages`. The adapter owns the cursor: `(lastModified, sessionId)` for lists (stable on an unchanged list, so pages concatenate — rule 5), and a per-session index `{size, mtimeMs, count}` so a newest-first transcript page becomes an SDK `offset`/`limit` read. A list page costs at most `limit + 32` lite reads.

**D16. Session rows.** `title.source`: `customTitle` → `user`; `summary === firstPrompt` → `first_prompt`; else `generated`. `status` is live for a hosted session, `unknown` otherwise. `archived` is always false (`archive` absent). `origin` comes from the owner journal (D17), not the row (the row has no entrypoint).

**D17. Which sessions are listed.** Default: every session `listSessions` returns, `includeProgrammatic: true` (owner question OQ1). Broski records the ids it creates in `~/.broski/claude-code/owned.jsonl` (bounded), so `origin` is `broski` for its own and `external` for the rest.

**D18. Transcript items.** Mapping per 04 §9.2: `user_message`, `block` (`messageId` = `message.id`), `tool_call`, `tool_result` (diffs from `structuredPatch`/`gitDiff`), `notice`, `compaction`, `run_boundary` (from `system/turn_duration`). `idStability: "stable"` (entry uuids). Images in history are `ImageRef`s read back by `readAttachment` (`<uuid>:<blockIndex>`). `model_change` is not produced (unreachable through the SDK reader; accepted loss).

**D19. Mutations.** `rename` = `renameSession`. `fork` = `forkSession` (`position: "through"` = `upToMessageId`; `before` = the previous chain item). `delete` = move the transcript and its `<id>/` directory to the OS trash (owner question OQ5); never the old raw `unlink(join(dir, id))`.

**D20. Subagents are child sessions.** Child ref `"<sessionId>/<agentId>"`, `parent{kind:"subagent"}`, listed by `listSubagents` + the `.meta.json` sidecar, read by `getSubagentMessages`. Live: the parent's `Agent` tool call gets `tool_updated{child_session}`; while a child is open, its forwarded messages go to its sink.

**D21. Terminal sessions are watched, never written.** `externalLive: false` at first. A session whose file changed in the last 10 s and that this bridge does not host opens **watch-only** (`controllable: false`) with a live read-only tail: one watcher per project directory, positional reads, translation as 04 §7 (rec. 4). "Continue here" is a fork (D19). Once the tail produces correct `run_started{external}`…`run_finished` (proved by rule 27 with a second `query()` process writing the same session), `externalLive` turns true.

### Ops and config

**D22. Config surfaces are a small set of generic ops, not one op per old screen.** Every config change lands where the CLI reads it. Conventions in §8.
- `config_files` — lists the CLI's own config files for a cwd: settings (user/project/local), `.mcp.json`, CLAUDE.md files (user/project/local), auto memory, agents, commands, skills, output styles; each row has scope, path, existence, editability and format. Managed files are read-only.
- `config_file` — reads one file; with `change {text, revision}` writes it: compare-and-swap on the revision, strict JSON validation for JSON files (a file that does not parse is refused, never replaced), atomic write, realpath under the expected base. Creating a new command/skill/agent is a `config_file` write to a new path the listing offered.
- `settings_overview` — read-only `resolveSettings()` with provenance: effective permission rules by source, model/effort, sandbox summary, MCP approvals, enabled plugins, managed keys with their policy origin, parse errors, and the account.
- `mcp_servers` — live status per server; actions enable/disable (writes the per-project list in `~/.claude.json` and calls `toggleMcpServer`) and reconnect.
- `plugins` — rows from `system/init` plugins + `plugin_errors` + `enabledPlugins`; action enable/disable writes `enabledPlugins` in local settings and calls `reloadPlugins`. Installing from a marketplace is out of scope.
- `tasks` — background tasks of a session (`background_tasks_changed`, `task_*`), with stop (`stopTask`).
- `context_usage` — `getContextUsage({detail:"summary"})` as rows.
Reused existing ops: `rewind_files`, `session_settings` (fast mode, prompt suggestions, auto memory, 1M context, output style choice, language), `changed_files`, `refresh_models`.

**D23. Rewind.** `rewind_files` runs on the session's host (a resume with an empty inbox when none is running, closed in `finally`). `dryRun` first; the app shows the files and counts before the real call.

**D24. Prompt suggestions.** A new extension kind `prompt_suggestion{text}`; the composer shows it as a tappable hint.

**D25. Plan approval chooses the next mode.** `plan_approval` requests may carry `modeOptions` (axis values) and the reply may carry `modeAfter`; the adapter sends it as `updatedPermissions: [{type:"setMode", mode, destination:"session"}]`. Confirmed by the spike (Q6).

**D26. Terminal asks (optional lane, owner question OQ2).** A `PermissionRequest` hook of type `http` in the user's settings, pointing at the bridge's loopback TLS listener, token in a header, URL pinned with `allowedHttpHookUrls`, installed and removed by an explicit setting. The bridge's receiver hands the ask to the adapter (factory port), which raises it on the session through a new core call that pins a session open with no client (`BridgeCore.hold`), so keep-open, notifications and lock-screen answers work as for any ask. This is the only part of the plan that changes the core.

### Testing and rollout

**D27. Tests run a real CLI against a scripted Anthropic endpoint.** `helpers/scripted-anthropic-server.ts` (Messages SSE for text, thinking, tool_use; `count_tokens`; `models`; records every request; fails on any other path) and `helpers/claude-home.ts` (temp `CLAUDE_CONFIG_DIR` and `HOME`, the off-switches: `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `DISABLE_AUTOUPDATER`, `DISABLE_GROWTHBOOK`, `DO_NOT_TRACK`, a dead `HTTPS_PROXY`). The conformance driver uses them. Fast unit tests inject a fake `query` the way `cc-query-harness.ts` does. **No test ever reads or writes the real `~/.claude`**; a guard throws if `CLAUDE_CONFIG_DIR` resolves to it.

**D28. Behind a config flag until cutover.** `contract-backends.ts` registers Claude Code only when the bridge config has `"claudeCode": {"contract": true}` (a compiled binary ignores env flags). While the flag is off, nothing changes for users. While it is on, the app shows the new backend as a separate choice (D29) so one session is never driven by both paths.

**D30. Custom tools stay (OQ3).** Broski's own custom tools (a user-defined tool with an HTTP, script or built-in handler, served to Claude through an in-process SDK MCP server, `custom-tools.ts`) are handed to the adapter by the server layer through a factory port (`customTools`: the MCP server config for a session, plus list/read/write/test of definitions). The adapter never imports `custom-tools.ts`. The editor becomes two ops: `custom_tools` (an `ActionList`: rows are tools, actions test and delete; a test's output goes in `note`) and `custom_tool` (a definition as JSON text with `revision`, the same rules as `config_file`). The tool names stay `mcp__broski-custom-tools__<name>`.

**D31. Outcome precedence (Q3).** A result maps by `terminal_reason` first: `aborted_streaming`/`aborted_tools` → `aborted`, even though `subtype` is `error_during_execution` and `is_error` is true. A refusal (`success` + `is_error: true` + `stop_reason: "refusal"`) is an error outcome, never `completed`. Research 02 §3.3 ("an abort is a success subtype") is wrong.

**D32. The Step 1 test bed is the contract for CLI behaviour.** Real-CLI tests use `helpers/scripted-anthropic-server.ts` (with the proxy trap and side-request routing: subagent, `/compact` summary, title) and `helpers/claude-home.ts` (with `CLAUDE_CODE_TMPDIR`), and each asserts zero escapes. The spike tests under `__tests__/claude-code/spike/` stay as the regression suite for every SDK pin bump; the frame fixtures (`__tests__/claude-code/fixtures/frames/`) are re-recorded with `CC_SPIKE_RECORD=1` after a bump and the diff reviewed. `scripts/cc-spike/linux-test.sh` runs the suite in a CI-like Linux container.

**D33. Session reads run under the right config dir.** The SDK session functions (`listSessions`, `getSessionMessages`, `forkSession`, …) read the **bridge process's** `CLAUDE_CONFIG_DIR` at call time, not a query's `env`. The adapter passes `dir` (the project path) and must make the config dir explicit for tests without mutating `process.env` across concurrently running tests (Step 3 decides the mechanism). Fork "through" an interrupted turn uses its `[Request interrupted by user]` entry.

**D34. `updateSettings` reformats the file** (2-space, keys reordered, every key and `$schema` kept; `effortLevel` lands under `modelSettings.<model>`). It is used only for its two allowlisted keys; every other config write goes through `config_file` (D22) with its own writer.

**D35. One resolver.** `server/claude-cli-path.ts` is the only place that finds the binary: `claudeCode.cliPath` (if a file) → embedded (compiled) → optional package (dev, the SDK's candidate order incl. musl); a value, never a throw. The old connector gets it through `connectors/claude-code/executable.ts` (set in `serve.ts`); the doctor reports source, path and `claude --version`.

**D29. App selection.** During the flag period the contract selection is stored as `contract:claude-code`, so it never collides with the legacy `claude-code` wire, and the picker shows it when `backends.list` has it. At cutover a one-shot migration turns a stored legacy `claude-code` into the contract selection, and `AgentType.claudeCode` is deleted.

## 4. Owner questions

Answered by the owner on 2026-11-01: **OQ1 list all · OQ2 keep · OQ3 keep · OQ4 yes · OQ5 trash · OQ6 embed · OQ7 drop · OQ8 yes.** The "Recommendation" column is now the decision.

| # | Question | Recommendation |
|---|---|---|
| OQ1 | List SDK and `claude -p` sessions too, or only what `claude --resume` shows? | **List all** (`includeProgrammatic: true`), mark origin. Hiding SDK sessions hides Broski's own. |
| OQ2 | Keep answering terminal `claude` permission prompts on the phone (D26)? It writes a hook into `~/.claude/settings.json`. | **Keep**, as an explicit setting (default on for users who had it), in the optional lane after v1. |
| OQ3 | Keep Broski custom tools (the in-process MCP server with HTTP/script handlers and its editor screens)? | Decide by usage. If kept: the server layer passes the MCP config into the adapter (`extraMcpServers`), and the editor becomes ops. If not: drop, approved. |
| OQ4 | Replace the old structured sandbox editor and the Broski-only knobs (append system prompt, max budget, max turns, agent-teams env) with `settings_overview` + raw settings editing? | **Yes**; keep only the 1M-context toggle as a `session_settings` entry. |
| OQ5 | Delete a session: move to the OS trash, or delete permanently like the CLI? | **Trash**, as Pi does. |
| OQ6 | Compiled bridge: embed the ~310 MB `claude` per target, or require the user's own `claude`? | **Embed**, with `claudeCode.cliPath` as the override. |
| OQ7 | Drop the `windows-x64` build target (Windows is unsupported, and embedding makes it expensive)? | **Drop.** |
| OQ8 | Offer `bypassPermissions` on the phone? | **Yes**, with a warning in the mode's description (parity). |

## 5. Things the spike must prove (Step 1)

Each is a small offline experiment with the real bundled CLI, the scripted endpoint and a temp config dir. The answers go into `research/08-spike.md`, and any decision they overturn is rewritten in §3.

| Q | Question | Decides |
|---|---|---|
| Q1 | Does the CLI run a full turn offline (API key + `ANTHROPIC_BASE_URL` + off-switches), with no request outside `/v1/messages`, `count_tokens`, `models`? | D27, the whole test plan |
| Q2 | With `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` over stdio: does `idle` arrive every turn, before or after `result`, and does it wait for background agents? | D7 |
| Q3 | `interrupt()` mid-text and mid-tool: `result.subtype`, `terminal_reason`, `aborted` flags, background-task kill, receipt contents. | D7, D8 |
| Q4 | Is `command_lifecycle` emitted, and under what condition? | D8 (confirms the adapter-owned queue) |
| Q5 | Order of a block's `assistant` frame vs its `content_block_stop`. | mapping lane |
| Q6 | ExitPlanMode: approve with `updatedInput.plan` edited; approve with a `setMode` update; deny with feedback (stays in plan?). | D13, D25 |
| Q7 | What the CLI does with an error `control_response` to `can_use_tool`. | D14 (what never to send) |
| Q8 | `updateSettings` keeps other keys and formatting? | config ops |
| Q9 | `resumeSessionAt` fork point per turn shape (completed, interrupted, end-turn tool). | D19 |
| Q10 | `@path` and agent mentions through a streamed user message. | D10 |
| Q11 | `supportedModels()` contents offline: effort levels, auto-mode flags. | D11, D12 |
| Q12 | `bun build --compile` with the embedded binary: build size, extraction, spawn, signature, first-start time. | D3 |
| Q13 | Can the scripted endpoint drive every conformance scenario: a refusal with a fallback model (dialog), an MCP elicitation (a stdio test server in the temp dir), a 529 retry, a slow `/compact`, a subagent? | which interaction kinds and features the adapter may declare |

## 6. Steps, in order

```
1  spike + packaging                      (1 delegate, serial)
2  contract additions, protocol 1.4       (1 delegate, serial)
3  foundation: interfaces only            (1 delegate, serial)       ← owner questions answered before this
4  lanes A–H in worktrees                 (8 delegates, parallel)
5  integration behind the flag            (1 delegate, then me)
6  three reviews → one fixer → sweep      ┐ parallel
7  app wiring                             ┘
8  on-device checklist                    (owner)
9  parity audit → cutover + deletion      (chads, then 1 delegate)
10 two final reviews → fixer → verify     → push only when the owner says
```

### Step 1 — Spike and packaging — **done** (`f89b2dc`…`9c5108f`; answers in `research/08-spike.md`; real-CLI tests green on macOS, linux/arm64 and emulated linux/amd64)

One delegate, on `main` in a worktree `cc/spike`.
- `helpers/scripted-anthropic-server.ts` and `helpers/claude-home.ts` (D27), with their own tests.
- Answer Q1–Q13 with small tests or scripts, and write `research/08-spike.md` with the evidence.
- `server/claude-cli-path.ts` (D3), used by the old connector (`query-options.ts` passes `pathToClaudeCodeExecutable`); `scripts/build.sh` embeds the per-target binary and drops `windows-x64` if OQ7 says so.

**Exit:** a compiled darwin-arm64 bridge runs an old-path Claude Code turn; the offline turn test passes in CI (Linux and macOS); full bridge suite green.

### Step 2 — Contract additions (protocol 1.4) — **done** (`32a1b2d`…; the shapes as built are in §8 and contract README §13; the minor is `ADDED_IN_MINOR.configOps`)

One delegate, serial, the only step that edits shared contract files. Following the recipe in 06 §4.3, with `ADDED_IN_MINOR.claudeCode = 4`:
- New op kinds and result shapes: `config_files`, `config_file`, `settings_overview`, `mcp_servers`, `plugins`, `tasks`, `context_usage` (shapes per §8), each in `OP_ADDED_IN`, `fakeOpResult`, `exampleCall`, the negative suite, and `panelFor` with a real panel or a placeholder.
- `ClaudeCodeOp` gains those plus `session_settings`, `changed_files`, `refresh_models` (the existing schemas; the kinds stay shared).
- `ExtensionKind` gains `prompt_suggestion` (D24).
- `PlanApprovalRequest.modeOptions?` and `PlanApprovalReply.modeAfter?` (D25), with `answerProblem` and its Dart port and fixtures.
- The custom tools ops `custom_tools` and `custom_tool` (D30).
- The core call `BridgeCore.hold(ref)` / `release(ref)` (D26): pins a session open with no client, so keep-open, the observer feed, notifications and lock-screen answers apply to an ask raised by a terminal session. Core README rule added, `mutate:core` covers it.
- `bun run contract:gen`, the Dart ports regenerated, the minor gating checks at each send place.

**Exit:** `contract:check`, `check:layers`, `mutate:core`, bridge suite, `flutter analyze`, `flutter test`, `check_agent_core`, `mutate_agent_core --check`, `dart format` all green.

### Step 3 — Foundation — **done** (`f829b83`…`86556b9`; `STEP-3-INTERFACES.md`, adapter `README.md` with D36–D39; owner-side choices: `plan: false` accepted (D38: the CLI's default models have no todo tools), the watch-only answer gap goes to Step 3b)

### Step 3b — Answers on watch-only sessions (runs beside the lanes) — **done** (`35ad4e3`, `b0365dc`, `a200e61`, docs after them)

Step 3 found that the core refuses any answer on a session without `control` (`core/controlled.ts`, `core/bridge-answer.ts`), which is exactly the terminal-ask case (D26). One delegate, serial on shared files: an `OpenSession` may offer answering without offering control; the core routes `interaction.answer` and `BridgeCore.answer` to it; the session capabilities say so, so the app shows and answers the ask on a watch-only session while the composer stays hidden; conformance, negative tests, `mutate:core`, the Dart side and the READMEs follow. Lane G wires terminal asks after it merges.

As built: `OpenSession.answer?(answer)` on a session without `control` (contract README §5 rule 14), `sessionAnswerer(open)` picks control or it, `SessionCapabilities.answer` derived from it and added to 1.4 (`ADDED_IN_MINOR.watchedAnswers`; cut for an older client, whose answer on such a session stays `unsupported`). The core routes `interaction.answer` (viewer only, `core/answering.ts`) and `BridgeCore.answer` (no attach) to it through the desk; every other control request on it stays `unsupported` (core README §21). Conformance rule 31 and the driver's optional `watchedAsk()`; the fake opens one with `seed({external: true, answerable: true})`. The app shows Answer by `AgentSessionState.answerable`; the composer stays hidden. For lane G: `openWatchOnly` returns an `OpenSession` with `answer` (and still no `control`) when the hook is installed, routes it to the pending hook decision, refuses `closed` after `close` and `stale` once resolved, emits `interaction_requested`/`interaction_resolved`, and the conformance driver implements `watchedAsk`. A reply that stops the run (`cancel{stopRun: true}`, an option that `stopsRun`) reaches it like any reply: lane G decides whether the hook's `interrupt` honours it, and offers only the options it can honour (core README §21 rule 7).

One delegate, serial: interfaces only under `backends/claude-code/`, nothing registered. The layout in §7 with every file's exported types and signatures, `ports.ts` (the seams between store, live, mapping, ui and ops, so lanes build apart), `traits.ts` (the declared capabilities, final once Q13 is answered), the conformance driver skeleton, and `README.md` with D1–D29 and the lane ranges.

**Exit:** `typecheck` and `check:layers` green; every lane's input is a type in `ports.ts`, not a guess.

### Step 4 — Lanes

One Sonnet delegate per lane, each in its own worktree (`git worktree add ../broski-cc-<lane> -b cc/<lane> <step-3 commit>`), each owning only its files, committing after each finished piece. No lane edits the contract, the core, `ports.ts`, `traits.ts` or another lane's directory; a lane that needs a port change stops and reports.

| Lane | Owns | Builds | Exit test |
|---|---|---|---|
| **A · Store** | `store/` | list paging and cursor (D15), rows (D16), owner journal (D17), transcript index and pages (D18), attachments, rename/fork/delete-to-trash (D19), child sessions (D20) | rules 5–8 against fixture transcripts in a temp config dir, including a 50 MB file and a 500-session project |
| **B · Mapping** | `mapping/` | pure functions: stream blocks, assistant/tool frames, tool titles, file changes, tool-result images, usage, outcomes, compaction, retry, retraction, system frames, conversation reset, rate limit, prompt suggestion | table tests from recorded frames (the spike's recordings), every `SDKMessage` variant covered or listed as ignored |
| **C · Catalogue** | `models/`, `modes.ts`, `commands.ts`, `process/probe.ts`, `status.ts` | probe and cache (D6), models and thinking (D11), modes (D12), commands (skills marked, terminal-only hidden), status (binary found, version, auth, policy failures) | rules 1–4, 20 (catalogue parts), 21; status cases for missing binary, signed out, policy refusal |
| **D · Live session** | `live/`, `process/` (except probe) | host and registry (D1), options and env (D4, D5), inbox, run tracker (D7), prompt desk and steer (D8, D9), adapter queue, input building (D10), settings switching, abort, compaction (`/compact`), shutdown | rules 10–19, 22, 24–26 against the real CLI |
| **E · Asks** | `ui/` | the ask desk (D13, D14): permissions with option payloads, questions, plan approval with `modeAfter`, form/confirm/url elicitation, refusal dialog, redelivery dedupe | rule 23 for every declared kind; a test that no ask resolves without an answer, a cancel or a CLI withdrawal |
| **F · Ops** | `ops/` | the ops of D22, D23 and D30 behind the conventions of §8, plus the custom-tools port wiring | rule 9; per-op tests in a temp config dir, including a refused write of invalid JSON and a revision conflict |
| **G · Terminal** | `terminal/`, `server/cc-terminal-hook.ts` | project watcher, tail, translation, watch-only sessions, "continue here" by fork (D21); the terminal permission hook (D26): install/remove behind the setting, the loopback receiver, the asks raised through `BridgeCore.hold` | a second CLI process writing a session shows live on a watch-only open; rule 27 once declared |
| **H · App** | `lib/agent/ui/panels/`, composer hint | the generic `ActionListView` and `ConfigFileEditor` panels (§8), the prompt-suggestion chip, the plan-approval mode picker | widget tests with the scripted bridge; `check_agent_core`; `mutate_agent_core --check` |

### Step 5 — Integration

One delegate assembles `backend.ts` and `factory.ts`, registers behind the flag (D28), and makes all 29 conformance rules pass. Then I merge lanes one at a time: after each merge, regenerate the contract output (never resolve generated files by hand), rerun every check, and re-run any failure on `main` before believing or dismissing it. The cross-lane checklist:
- A finished run flips the catalogue row `running → idle`, so the run-done notification fires and opens the right chat.
- A pending ask reaches the daemon feed, and a lock-screen allow/deny answers it.
- A subagent's live work shows under its parent and in its own child chat.
- A watch-only session turns controllable after "continue here", and the phone's fork opens.
- Every op is reachable from the More sheet or the item menu, and every result renders.
- Offline cache shows a CC session list and transcript read-only.

### Step 6 — Reviews and fixes

Three `review_code` runs in parallel: SDK correctness (opus), contract correctness, robustness/security/slop. One Opus fixer takes every finding, adds a test that fails without each fix, commits as it goes, and writes `reviews/FIXES.md` with mutation evidence. A cheap chad sweep afterwards checks for: `as any`, deep SDK imports, any timer near an ask, any read of the real `~/.claude` in tests, string prompts, `permissionPrompts`, `null` returned from a callback.

### Step 7 — App wiring (parallel with Step 6)

The selection storage and migration (D29), the picker entry during the flag period, and the parity audit of reachability: every PARITY row in §10 is reachable from the normal tabs, picker, chat menus or More sheet. No dev-only entry points.

### Step 8 — On-device checklist (owner)

Real Mac, real `~/.claude`, real phone, over LAN and relay, with the flag on:
- The session list matches `claude --resume` (plus SDK sessions, per OQ1), and paging works on a large project.
- Streaming text and thinking; Stop mid-text and mid-tool; steer mid-run; queue and cancel a queued message.
- Permission prompt (once / session / always / deny / deny and stop); AskUserQuestion with multi-select and free text; plan approval with a mode; an MCP elicitation (form and URL).
- Rewind a turn's files; fork from a message; a subagent live and in history; stop a background task.
- Config: edit CLAUDE.md, add a command, toggle an MCP server and a plugin, and check that each change lands where the CLI reads it (`claude` in a terminal sees it).
- A terminal `claude` session shows live watch-only; "continue here" forks it.
- Run-done notification and tapping it; a lock-screen answer; offline viewing.
- A 50 MB transcript opens and pages.
- A compiled bridge build (D3) does all of the above.

### Step 9 — Parity audit, cutover, deletion

Chads re-check every row of §10 against the running code; each must be **done** or **dropped, approved**. Then one change: remove the flag, serve Claude Code by default, migrate the stored selection, and delete the old path (07 §6: connector, handlers, `cc_*` types and routes, runtime mapper, external tail, the old app screens, models, providers, services, sheets and widgets, the old tests, and the docs that describe them; the AGENTS.md runtime-abstraction section shrinks to what is left). Gates: full bridge, Flutter and `link_dart` suites, the perf budget, and a repo-wide search for `cc_`, `claudeCode`, `ClaudeCode`, `claude-code` including `website/`, `reference/` scripts and native folders.

### Step 10 — Final reviews and push

Two strict `review_code` runs over the whole range, one Opus fixer, a final verification. Push only when the owner says.

## 7. Layout

```
packages/bridge/src/backends/claude-code/
  factory.ts  backend.ts  traits.ts  ports.ts  services.ts  status.ts
  ids.ts  cursor.ts  bounds.ts  rejections.ts  catalog-feed.ts  owned.ts
  modes.ts  commands.ts
  process/   options.ts  env.ts  inbox.ts  probe.ts  version-check.ts
  live/      registry.ts  host.ts  consumer.ts  run-tracker.ts  prompt-desk.ts
             queue.ts  settings.ts  live-state.ts  abort.ts  compaction.ts  shutdown.ts  child-router.ts
  mapping/   stream-blocks.ts  assistant.ts  tool-calls.ts  tool-results.ts  tool-titles.ts
             file-changes.ts  images.ts  usage.ts  outcome.ts  compaction.ts  retry.ts
             retraction.ts  system-frames.ts  user-input.ts
  models/    catalog.ts  catalog-cache.ts  thinking.ts
  store/     list.ts  list-cursor.ts  rows.ts  info.ts  transcript-index.ts  transcript-page.ts
             items.ts  attachments.ts  mutations.ts  trash.ts  children.ts
  ui/        desk.ts  permission.ts  questions.ts  plan.ts  elicitation.ts  dialogs.ts
  ops/       rewind-files.ts  session-settings.ts  changed-files.ts  refresh-models.ts
             config-files.ts  config-file.ts  config-paths.ts  settings-overview.ts
             mcp-servers.ts  plugins.ts  tasks.ts  context-usage.ts
  terminal/  project-watch.ts  tail.ts  jsonl-lines.ts  translate.ts  watch-only.ts  (hook-asks.ts, OQ2)

packages/bridge/src/server/        claude-cli-path.ts, contract-backends.ts (flag), cc-terminal-hook.ts (OQ2)
packages/bridge/src/__tests__/     claude-code/*.test.ts, helpers/scripted-anthropic-server.ts, helpers/claude-home.ts
lib/agent/ui/panels/               action_list_view.dart, config_file_editor.dart (+ registry entries)
docs/architecture/backends/claude-code/
  PLAN.md  README.md (decisions, traps, gaps, as built)  research/  reviews/
```

Every file under 400 lines, every function under 50, one concept per file (AGENTS.md hard limits).

## 8. Conventions every lane follows

- **Op shapes** (as built in Step 2, `contract/action-list.ts`). An op that lists things with actions answers `{kind, list: ActionList}`, `ActionList = {rows[{id, title, subtitle?, status?{label, tone: neutral|ok|busy|warning|error}, group?, badges[], actions[{id, label, destructive}]}], omitted, note?}`. Its change is `ActionListChange{rowId, actionId}` (unknown row `not_found`, action not offered `invalid_input`). `mcp_servers`, `plugins`, `tasks`, `custom_tools`, `context_usage` (no actions) and `settings_overview` (no actions) use it; the app renders all of them with one `ActionListView`. Each op keeps its own `kind`.
- **File ops** (`contract/editable-file.ts`). `config_file` and `custom_tool` answer `{kind, file: EditableFile}`, `EditableFile = {id, path, scope, format: json|markdown|text, exists, text, revision, editable, truncated, problems[]}`; the change is `write{text, revision}` or `delete{revision}`; a stale revision is `stale`, an unparsable JSON write is `invalid_input`, a managed file is `unsupported`; a `truncated` file is never `editable`. The answer's `file.id` addresses the file from then on, also a new one not yet written. An id the backend never named is `not_found`. Conformance rule 30 checks the four refusals.
- **Scoping.** Live state by `sessionId` (`mcp_servers`, `tasks`, `context_usage`), files and configuration by `cwd`, canonical through the core's directory policy (`config_files`, `config_file`, `settings_overview`, `plugins` with an optional `sessionId`), the bridge's own tools by neither (`custom_tools`, `custom_tool`).
- **One helper per job.** `rejected(code, message)` in `rejections.ts`, `clip()` in `bounds.ts`, `childRef()`/`parseChildRef()` in `ids.ts`, `encodeCursor()`/`decodeCursor()` in `cursor.ts`. No lane writes its own copy.
- **SDK access.** Only through the `ClaudeSdk` port (`ports.ts`), so unit tests inject a fake and the conformance driver injects the real SDK. Import SDK types, never `as any`, never deep paths.
- **Bounds.** Every string, list and map from the SDK is clipped to `limits.ts` before it enters a contract value.
- **Commits.** After each finished piece, staging files by path. Deletes with `trash`.
- **Failures.** A failing test is re-run on `main` before it is believed or blamed on the worktree.
- **Docs.** Each lane appends its decisions to the adapter README in its range, with the evidence.

## 9. Decision number ranges

Plan D1–D30 · Step 1 spike D31–D35 (taken) · Lane A D40–D49 · B D50–D59 · C D60–D69 · D D70–D79 · E D80–D89 · F D90–D99 · G D100–D109 · H D110–D119 · integration D120–D129 · fixes D130+.

## 10. Parity map

Every user-visible feature of the old path (07 §1) → where it lives on the contract. `contract` = existing contract feature; `op` = an op of D22; `new` = a Step 2 addition; `drop?` = dropped only with owner approval.

| Old feature | New home |
|---|---|
| Sessions tab, project grouping, search, sort, title filters | contract: sessions tab and projects (`lib/agent`); search/filters are app-side (check the contract list view has them; if not, app lane H adds them generically) |
| Session previews, subagent rows, orphan subagent dirs | contract: rows (D16) and child sessions (D20) |
| Diff-stat badges on rows | drop? (they read every whole transcript at list time); `changed_files` per session instead |
| Active/working pill | contract: `status` from live hosts |
| Rename, delete | contract: `rename`, `delete` (D19); rename now shows (custom title read back) |
| Open session, load earlier, big transcripts | contract: `readTranscript` pages (D15, D18) |
| Tool results and diffs in history, hidden command echoes | contract: transcript items (D18) |
| Subagent transcript | contract: child sessions (D20) |
| Offline transcript, prefetch | contract: the app's offline cache |
| Copy/export transcript | app-side, generic |
| Modified files sidebar | op: `changed_files` |
| Streamed text, thinking, tool cards by tool, todos | contract: blocks, tools, `plan_updated` (mapping lane B) |
| Compaction divider, retry banner, errors, refusal line | contract: compaction, retry, `error`, `notice` |
| Token usage / cost, context bar | contract: `usage_updated`; op: `context_usage` |
| Structured output | contract: `notice` (rare; no UI in old app beyond raw text) |
| Hook activity cards | drop? (needs `includeHookEvents`; noise on a phone) |
| Background task cards, stop task | op: `tasks`; contract: `child_session` progress |
| Tool-use summaries, files persisted | contract: `notice` |
| Rate-limit info | contract: `extension{rate_limit}` |
| Prompt suggestions | new: `extension{prompt_suggestion}` (D24) |
| Auth status, local command output | contract: `status()` issues; `notice` |
| Subagent attribution and live progress | contract: `parentToolCallId`, `child_session`, `progress` |
| External (terminal) session live view, external user prompt | lane G: watch-only tail (D21) |
| Reconnect replay | contract: the core's event log and snapshot |
| Send prompt, attachments (images, files), @agent, slash autocomplete, built-in slash commands | contract: `prompt` with attachments, mentions, `command` (D10); app-local commands stay app-side |
| Queued message (one slot) | contract: `queue` with N items and cancel (D8) — better than parity |
| Resume from this message | contract: `fork` at the message, then prompt (D19) |
| Stop, stop while an ask is pending, offline stop | contract: `abort` + `cancelRunLocally()` |
| Model picker, 1M context toggle | contract: `setModel`; op: `session_settings` toggle |
| Thinking mode/variant, effort, fast mode, quick settings | contract: `setThinking` (effort, D11); op: `session_settings` (fast mode, prompt suggestions, auto memory) |
| Permission-mode chip incl. plan, bypass | contract: modes axis (D12) |
| Allowed/disallowed tools lists | op: `config_file` on settings (`permissions.allow/deny`) + `settings_overview` |
| SDK approval prompt, always-allow rules, rich prompt text | contract: `tool_permission` (D13) |
| Terminal-session approval (loopback hook) | lane G optional: D26 (OQ2) |
| Pending approvals after reconnect | contract: snapshot interactions |
| Lock-screen approval | contract: feed tap (plain allow/deny options, D13) |
| AskUserQuestion sheet, reject | contract: `questions` (D13) |
| MCP elicitation (URL, form), completion | contract: `form`/`external_url`/`confirm` (D13) |
| Undo turn's file changes, checkpoint counter | op: `rewind_files` (D23); the item menu on a user message |
| Fork session, fork from a message | contract: `fork` |
| Fork-on-resume, continue-latest (API only, no UI) | drop? (no UI existed) |
| Custom subagent definitions editor | op: `config_files`/`config_file` on `.claude/agents` |
| Filesystem agents list, active subagent per turn | op: `config_files`; contract: agent mention |
| Subagent task sessions view | contract: child sessions |
| Agent teams toggle | drop? (teams never run under the SDK, 04 fact 13) |
| Commands list/editor | op: `config_files`/`config_file` on `.claude/commands`; contract: `listCommands` |
| Skills list/editor | op: `config_files`/`config_file` on `.claude/skills`; contract: `listCommands` (`kind: skill`) |
| Plugins list, toggle, add/remove path, reload | op: `plugins`; add/remove local path → `config_file` on settings; drop? for Broski's own plugin-path config |
| Hooks list/editor | op: `config_file` on settings (`hooks`), listing via `settings_overview` |
| MCP editor (`.mcp.json`), status, reconnect, toggle, set servers | op: `config_file` on `.mcp.json`; op: `mcp_servers` |
| claude.ai MCP servers toggle | op: `config_file` on settings (`disableClaudeAiConnectors`) |
| Memory screen | op: `config_files`/`config_file` on CLAUDE.md and auto memory — fixes the old wrong-directory bug |
| Custom tools (list, editor, test) | D30: ops `custom_tools`, `custom_tool`; served to every session through the `customTools` port |
| CC settings screen (system prompt, budget, turns, language, gitignore, release channel) | OQ4; `language` and `respectGitignore` via `session_settings`/settings file; `releaseChannel` dropped (not a real key) |
| Sandbox screen | OQ4: `settings_overview` + `config_file` |
| Context usage sidebar, session init snapshot sidebar | op: `context_usage`, `settings_overview` |
| Account card | op: `settings_overview` (account section) |
| Subscription usage (Claude plan windows) | unchanged: `get_subscription_usage` is not a `cc_*` message and survives cutover |
| Availability / sign-in hint | contract: `status()` |
| File watchers refreshing lists | contract: `catalog_invalidated` from the adapter's config watcher (lane F) |

## 11. Risks

| Risk | Mitigation |
|---|---|
| The CLI needs the network even with the off-switches, so offline tests fail | Q1 first. If it fails: conformance on the fake `query` harness, and one tagged real-network smoke test run by hand. |
| `session_state_changed{idle}` is not emitted or not reliable | Q2; the fallback rule in D7. |
| A 310 MB binary per compiled target is too heavy | OQ6; the `cliPath` override; drop unsupported targets. |
| Writing the user's config files breaks them | strict JSON validation, compare-and-swap revisions, atomic writes, refusing managed files, tests with broken files (D22, §8). |
| Two writers on one session file (phone and terminal) | watch-only for recently written sessions, "continue here" by fork (D21). |
| The CLI changes its frames between versions | exact pin; unknown frames ignored and logged once; the version check (D3); a pin bump is a deliberate change with the spike tests re-run. |
| Lanes collide in shared files | Step 2 and Step 3 own every shared file; lanes own directories; conventions in §8. |
| Parity gaps found after deletion | deletion only in Step 9, after the audit and the on-device checklist. |
