# The Claude Code adapter

The contract backend for Claude Code (`packages/bridge/src/backends/claude-code/`). It implements `AgentBackend`
(`src/contract/backend.ts`, [contract README](../../contract/README.md) §5) on `@anthropic-ai/claude-agent-sdk`
**0.3.330** (exact pin), whose package names the CLI it was released with: `claudeCodeVersion` **2.1.330**. It drives
the `claude` the user installed; the bridge carries no Claude Code binary. It is registered in every bridge
(`server/contract-backends.ts`) and passes all 28 conformance rules against the real CLI
(`src/__tests__/claude-code/conformance/`).

It serves no ops, custom tools, hook activities or prompt suggestions: the phone is not where those are managed.

Evidence below cites the installed SDK (`sdk.d.ts`, `sdk.mjs` of 0.3.330), the hooks reference
(<https://code.claude.com/docs/en/hooks>), and the tests that hold each fact to the real CLI. Decisions are numbered
D1–D31; the code cites them by these numbers.

**Contents.** [1 Layout](#1-layout) · [2 Process and hosting](#2-process-and-hosting) ·
[3 Runs and input](#3-runs-and-input) · [4 Asks](#4-asks) · [5 Mapping](#5-mapping-sdk-frames-to-contract-events) ·
[6 Store](#6-store) · [7 Terminal sessions](#7-terminal-sessions-and-the-hook) · [8 Capabilities](#8-capabilities) ·
[9 Tests](#9-tests) · [10 Limits](#10-limits-and-known-gaps)

## 1. Layout

```
backends/claude-code/
  factory.ts        claudeCodeBackendFactory(options) → BackendFactory
  backend.ts        the AgentBackend over the parts; dispose order
  services.ts       the factory's options and the services every part shares
  traits.ts         CLAUDE_CODE_TRAITS (D30)
  ports.ts, ports/  the seams between the parts
  ids.ts cursor.ts bounds.ts json.ts rejections.ts catalog-feed.ts phone-text.ts trash.ts
  permission-modes.ts modes.ts commands.ts status.ts open-session.ts owned.ts
  sdk/              the ClaudeSdk port over the SDK (D6), command_lifecycle and interrupt typing
  process/          the CLI's env, a host's options, the open inbox, the probe, the version check, the bypass rule
  models/           the catalogue: models, startup refusals, the cache, the config watch
  live/             one host per hosted session: the CLI process, runs, queue, Stop, settings, children
  mapping/          SDK frames → contract events
  ui/               the ask desk: permissions, questions, forms, plan approval
  store/            sessions, history, forks and titles read from the CLI's files
  terminal/         a terminal claude's session: tail, watch-only sessions, the hook installer and its asks
  files/            strict, atomic edits of a user's JSON file

src/server/
  claude-cli-path.ts       which claude the bridge runs (D3)
  claude-code-backend.ts   the factory options production passes; EXPECTED_CLAUDE_CLI_VERSION
  claude-code-wiring.ts    the hook receiver and the factory, from claudeCode.terminalAsks
  claude-code-hooks.ts     the hook installed into, or removed from, the user's settings after listen
  cc-terminal-hook.ts      the hook's receiver behind the loopback listener
src/tls-loopback.ts        the loopback certificate a terminal claude trusts (D29)
src/doctor/checks/claude-cli.ts   the doctor's check of the same binary
```

## 2. Process and hosting

### D1. One host per open session, outliving `OpenSession`

A host (`live/host.ts`) owns one `query()` whose prompt is an `AsyncIterable` inbox that stays open between runs
(`process/inbox.ts`; a string prompt would close stdin at the end of the first run), and one consumer loop over its
frames (`live/consumer.ts`). `OpenSession.close()` detaches the sink only: contract rule 24 (close aborts nothing, an
ask pending at close is in the next open's snapshot). The process ends when the host is idle (no run, ask,
compaction, retry or queued input) **and** detached, after a 30 s grace (`live/shutdown.ts` `IDLE_GRACE_MS`), and at
`dispose()`. A process that ended while the host lives is started again on the next need, resuming the session.

### D2. The session id is ours from the start

A new session passes a fresh UUID as `Options.sessionId`, so its `SessionRef` exists when `open` resolves, before
any `system/init`; a stored one passes `resume`. A restarted process resumes once the CLI wrote the file.

### D3. The user's `claude`, found once, as a value

`server/claude-cli-path.ts` is the only place that finds it: the bridge config key `claudeCode.cliPath` when it
names a file, else `claude` on `PATH`. By then `PATH` is the user's login shell's: `serve.ts` applies the login-shell
environment (`platform/shell-env.ts`) before it builds the Claude Code wiring, and the factory resolves the path when
the backend starts. The answer is a value (`CliLocation`): no binary is an `error` issue in `status()` with
`usable: false` and a fix text, and every read that needs the CLI is rejected `backend_error`; nothing throws. The
doctor runs the same resolver and `claude --version` in a scratch home. The SDK spawns `pathToClaudeCodeExecutable`
directly unless it ends in `.js`/`.mjs`/`.ts`/`.tsx`/`.jsx` (`sdk.mjs` `Qtt`), so a native binary, a symlink to one
(the native installer's `~/.local/bin/claude`) and an npm shim all run as the terminal runs them.

`EXPECTED_CLAUDE_CLI_VERSION` is the SDK package's `claudeCodeVersion`. The CLI's `initialize` answer names its own
version, and a different one is a `warning` issue in `status()` that names both (`process/version-check.ts`); the
session stays usable, since the user's CLI updates on its own schedule.

### D4. The CLI's environment

`Options.env` replaces the whole environment, so every CLI gets the bridge's login-shell environment plus
`CLAUDE_AGENT_SDK_CLIENT_APP=broski/<version>`, `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` (without it no
`session_state_changed` arrives, and runs could not end, D8) and `CLAUDE_CODE_STARTUP_FAILURE_RESULTS=1` (a known
startup refusal arrives as a `result` carrying `startup_failure_reason`, not stderr alone; `sdk.d.ts`
`SDKResultError.startup_failure_reason`). `CLAUDE_CODE_ENTRYPOINT` and `CLAUDE_AGENT_SDK_VERSION` are dropped when
inherited from a terminal `claude`, so the SDK stamps its own (`process/env.ts`).

### D5. The options of every host

`process/options.ts`: `cwd`, `env` (D4), `pathToClaudeCodeExecutable` (D3), `permissionMode` always explicit
(omitted is not `default`), `includePartialMessages` (text and thinking deltas), `forwardSubagentText` (a subagent's
text, D20), `agentProgressSummaries`, `systemPrompt: {type: "preset", preset: "claude_code"}` (the CLI's own prompt,
as the terminal has it), `canUseTool` and `onElicitation` (D15), `sessionId` or `resume` (D2), and `model` / `effort`
when the person chose them. `allowDangerouslySkipPermissions` is passed only where `process/bypass.ts` allows it
(D13). When `bridgeTools.notify` is enabled and the installed CLI version is at least `EXPECTED_CLAUDE_CLI_VERSION`,
each host also attaches Broski's loopback HTTP MCP server (`server/claude-code-mcp.ts`, `live/mcp-hold.ts`) via
`mcpServers` + `mcpServersDelivery: "initialize"` + `allowedTools: ["mcp__broski__broski_notify"]` (exposing only
`broski_notify`, never duplicating native `AskUserQuestion` or `ExitPlanMode`, and rebinding its lease across
`conversation_reset`). Never set: `settingSources` (the user's settings load as in the terminal),
`persistSession: false`, `sessionStore`, `permissionPrompts`, `hooks`.

`agentProgressSummaries` costs a little: the CLI forks a running subagent's conversation about every 30 s for a
summary, a small billed call on the subagent's model and prompt cache, made only while the conversation changes
(`sdk.d.ts` `Options.agentProgressSummaries`); the summary is the progress shown on the Agent call (D22).

### D6. The SDK's session functions run in process, under the bridge's config dir

`listSessions`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents`, `forkSession`,
`renameSession` and `resolveSettings` read `CLAUDE_CONFIG_DIR` from the environment of the thread they run in; their
options have none. The bridge's `process.env` is the login shell's (D3) and the CLI gets the same variable through
D4, so both read one config dir, and `ClaudeSdk.configRoot()` resolves it as the SDK does (`sdk/claude-sdk.ts`).
Tests, which run many homes in one process, inject an SDK whose session functions run in a worker thread started
with the home's environment (`__tests__/claude-code/helpers/isolated-sdk.ts`): some functions read the variable only
after their first `await`, so swapping `process.env` around a call would leak between tests.

### D7. The catalogue: a probe, a cache, the status

Models, commands and the account come from the CLI's `initialize` answer. With no host for the cwd, a probe
(`process/probe.ts`) starts a `query()` with an empty inbox, `settings: {disableAllHooks: true}` (a project's
`SessionStart` hook would otherwise run) and `persistSession: false`, awaits `initializationResult()` and the skill
names `reloadSkills()` lists, and closes it; it is bounded by 20 s, since no control request has a timeout of its
own. A probe without a project runs in the bridge's state dir, never the user's home, whose `.claude` the CLI would
read as a project's. Answers are cached per cwd in memory and in `<stateDir>/catalog.json` for 24 h; a host's own
`initialize`, `commands_changed`, and a change the config watch sees in the user's or a tracked project's settings
refresh them (`models/catalog.ts`, `catalog-cache.ts`, `config-watch.ts`).

`status()` reuses an answer younger than a minute, else probes: not installed, refused at startup (in words for the
reason, `models/startup-failures.ts`), signed out (`firstParty` with no key, token or sign-in, `models/account-state.ts`),
or answered; the version warning (D3) and a hook that a URL list blocks (D29) are added. It never fails.

Commands (`commands.ts`): what a user, project, plugin or MCP server defined first, then the CLI's own, each group in
the CLI's order; skills are marked from `reloadSkills()`; the built-ins the CLI tags terminal-oriented (`color`,
`doctor`, `exit`, `focus`, `reload-plugins`, `send-to-project`, `statusline`; `init.terminal_slash_commands`, held to
the real CLI by `catalogue/real_catalogue.test.ts`) are not listed.

## 3. Runs and input

### D8. Run boundaries and outcomes

A run starts when the adapter dispatches a prompt, or when a frame of a turn arrives with no send pending
(`session_state_changed: running`, trigger `system`: a background agent's wake-up turn). It ends on
`session_state_changed: idle` and on nothing else: `idle` comes after the last `result`, not between turns the CLI
chains without a send, and it waits for background agents (`spike/subagent.test.ts`). It also ends when the process
ends (aborted after a Stop, else an `error` outcome `backend_unavailable`), and when a Stop cancelled the only send
before the CLI began it.

A turn's outcome (`mapping/outcome.ts`) reads `terminal_reason` first: `aborted_streaming`/`aborted_tools` are
`aborted` although the subtype is `error_during_execution` and `is_error` is true; `max_turns`, `budget_exhausted`
are `limit`; `tool_deferred` is `deferred`; a `refusal` stop reason is an error (`content_filter`), never
`completed`; a `startup_failure_reason` is an error in the phone's words (`auth` when signing in again is the fix,
else `backend_unavailable`), naming the file for `config_file_invalid` (`invalid_config_file.path`, proven with a
broken `.claude.json`, `real_catalogue.test.ts`); the remaining failure reasons map to their `ErrorCode`s, an API
error by its HTTP status. The first turn of a run that failed decides the run's outcome.

### D9. Steer goes to the CLI; queue stays in the adapter; Stop

`promptModes: start, steer, queue`. Steer pushes the message now with `priority: "next"`; the CLI folds it into the
running turn beside the next tool result, and it is shown as `queue_changed` until its `command_lifecycle: started`.
Queue holds the input in the adapter's own queue (`live/queue.ts`), shown and cancellable one item at a time, and
sends one item per run once the previous run settled: the CLI's own `later` queue batches sends into one turn and
cannot show or cancel them one by one (`spike/queue.test.ts`).

Stop (`live/abort.ts`) sends `interrupt` with `cancelQueued: true` (the runtime takes it; `sdk.d.ts` declares no
argument, so `sdk/interrupt.ts` types it), which also kills background agents; the CLI has 5 s to answer, then the
process is ended. A Stop that reached the CLI before the message it was meant for (the receipt lists nothing) is
sent again once the turn begins. Everything queued or steered and not yet delivered goes back to the person as one
`input_returned`, steering first.

### D10. A prompt's send uuid is its `clientRequestId`

The `SDKUserMessage` of a prompt has `uuid = clientRequestId` (`ids.ts` `sendUuid`) and `origin: {kind: "human"}`.
The CLI keeps a send's uuid as its transcript entry's uuid and keys `command_lifecycle` and
`result.user_message_uuids` by it (`conformance/session_router.test.ts`), so one id names the prompt in the live
`user_message.messageId`, the transcript item and its image refs. Prompts are de-duplicated per open session by that
id (`live/prompt-desk.ts`). The owner journal (D25) records each prompt this bridge sent with its image names, which
the CLI does not keep; the store gives a user item its `clientRequestId` exactly when the journal has it, so a prompt
typed in a terminal never carries one, and a fork, which remaps every uuid, carries none.

### D11. Input shapes

Images go as base64 `image` blocks (`live/input.ts`). `PromptInput.command` becomes `/<name> <args>` in the text.
Files are not an attachment kind: the CLI takes a file as `@<path>` in the text, which the model request cannot tell
from the person typing it, so no conformance rule could hold a declared file attachment.

### D12. Models and thinking

`listModels` lists the CLI's `ModelInfo` rows, id = `value`, in the CLI's order with the Default row first; a row
whose `resolvedModel` equals the Default row's is left out, so no model shows twice (offline the CLI lists
`default, opus, fable, sonnet, haiku` with `default` and `opus` both `claude-opus-5-5`). Thinking is the effort
level: a model's `supportedEffortLevels`. `setModel` is `Query.setModel`; `setThinking` is
`applyFlagSettings({effortLevel})` (its rejection is caught and answered `backend_error`); both apply from the next
request. The model a turn runs on is read from `init.model` and shown by its listed id (`live/settings.ts`).

### D13. One mode axis: `permissions`

The SDK's `PermissionMode`s, in this order: `default`, `acceptEdits`, `plan`, `auto` (only when a listed model
`supportsAutoMode`), `dontAsk`, `bypassPermissions` (`modes.ts`, labels and descriptions there; the description of
bypass warns). `setMode` is `setPermissionMode`; a mode the CLI reports (`init`, `status.permissionMode`, a plan
approval's `setMode`) is shown as `mode_changed`. When the phone does not specify a mode, new and resumed sessions
inherit the user's configured `permissions.defaultMode` resolved via `sdk.resolveSettings` +
`sdk.filterEscalatingDefaultMode` (falling back to `default` when unset or filtered out).

Bypass is offered, and `allowDangerouslySkipPermissions` passed, only outside the case where the CLI exits at
startup: uid 0 without `IS_SANDBOX=1` or `CLAUDE_CODE_BUBBLEWRAP` (read in the 2.1.325 binary: `bypass_root`;
`process/bypass.ts`).

### D14. Usage and the context figure

`usage_updated` carries the process's running totals from `result.modelUsage` and `total_cost_usd` (subagents and
compaction included), replacing what was shown, never summed (`mapping/usage.ts`), together with `Usage.cache`
(`CacheWindow` derived from `cacheCreationEphemeral5mInputTokens` / `cacheCreationEphemeral1hInputTokens` with 5 m
taking precedence over 1 h on mixed writes, `confidence: "exact"` for explicit lifetime breakdowns and `"estimated"`
for inferred/read-only refreshes, and `lastTouchAt` stamped from the main loop's last `message_start`). The context figure comes after
each run: once `run_finished` is out, if the host's process is still live, one `getContextUsage({detail:
"summary"})`, sent as `usage_updated` over the snapshot's usage with `contextTokens = totalTokens` and
`contextWindow = maxTokens` (the window `/context` divides by; `live/context-after-run.ts`). It is never awaited by
the run's end. A failure is logged and sends nothing, except when the process asked has ended or been told to close
meanwhile: the SDK rejects every pending control request when its query closes (`sdk.mjs`: `Query closed before
response received`), which is how a session that ends right after a run answers. `integration/core_smoke.test.ts`
proves totals and the figure reach a phone through the core while the session stays open.

## 4. Asks

### D15. One interaction per CLI ask

The ask desk (`ui/desk.ts`) is each host's `canUseTool` and `onElicitation`. Each CLI request id is one interaction
with a minted id; a redelivered request keeps its interaction, and an answered one is replayed to it (`ui/book.ts`).

- **Tool permission** (`ui/permission.ts`, `permission-options.ts`): Allow, an allow for the session when the CLI
  suggested session updates, one Always-allow per settings file the CLI suggested a rule for (with the rule text,
  the updates echoed back; none when `suppressAlwaysAllowRule`), Deny (optional words), Deny and stop. Previews from
  the tool input (the command, the file changes, `blocked_path`). `requiresUserInteraction`, read with an `in`
  check, is `deliberate`.
- **AskUserQuestion** → `questions`: question id = index, answers keyed by question text, multi-select joined with
  a comma, free text always allowed, every question required.
- **ExitPlanMode** → `plan_approval` (D17).
- **MCP elicitation**: a flat form schema → `form`, fields in the schema's key order; an empty schema → `confirm`.

### D16. Nothing answers for a person

No timer answers an ask. The CLI's withdrawal (`control_cancel_request`, the signal) is `withdrawn`, the process
ending `expired`. A callback never throws: a throw is an automatic denial in the CLI, so a failure inside one leaves
the ask raised for a person, and an ask that cannot even be raised waits until the CLI withdraws it. A request the
contract cannot hold (a link that is not http(s), fields the app cannot show, a malformed AskUserQuestion) is raised as
a `confirm` whose body says so: confirm declines it, dismiss cancels it; it is never answered for the person
(`ui/elicitation.ts`, `questions.ts`). A URL elicitation is a `confirm` with its `url`: yes accepts, no declines, and
`elicitation_complete` withdraws it.

### D17. Plan approval chooses the next mode

`plan_approval` shows the plan the CLI read from its plan file (`input.plan`, `planFilePath`), editable when it
fits, with `modeOptions` = the permissions axis without `plan`, starting on `default`. Approve answers
`updatedInput` (the edited plan when edited) and `updatedPermissions: [{type: "setMode", mode, destination:
"session"}]` for `modeAfter`; reject is a denial carrying the feedback, and the session stays in plan
(`ui/plan.ts`, `asks/real_plan.test.ts`).

### D18. A person's "no" is sent in the CLI's own words

`ui/denial.ts` builds a denial from the 2.1.325 binary's own sentence ("The user doesn't want to proceed with this
tool use. …"), used by a permission's deny, a cancel, a plan rejection and the terminal hook's deny. The mapping
reads a failed tool result as `denied` when it starts with that sentence, or another of the CLI's refusals
(`Permission to use `, `Permission for this `), so a denial reads `denied` live and in history. Live, the `user`
frame's `tool_result_meta` decides first: it is `@internal` and absent from `sdk.d.ts`; in the binary it is
`[{id, permission_decision?: {decision: "accept" | "reject" | …, source, …}, …}]`, and `reject` makes the result
`denied` whatever the words (`mapping/result-meta.ts`).

### D19. One sanitiser for what the phone shows

`phone-text.ts` strips terminal escapes (CSI, OSC, two-character), C0 and C1 controls but tab, newline and carriage
return, and the invisible direction characters of UAX #9. Every ask title, body, option label and preview, every
tool title, tool output and notice goes through it, on the hosted and the terminal path alike. A person's prompt and
the model's text are content and are not touched.

## 5. Mapping SDK frames to contract events

`mapping/` turns each frame into events (`mapper.ts`); the host (`live/frame-handler.ts`) owns runs, the queue, the
model, the mode, asks and catalogues. The table below is `__tests__/claude-code/mapping/frame-kinds.ts`, typed over
the `SDKMessage` union, so an SDK that adds a variant fails the type check until someone decides what it shows; the
mapper's `system` switch is exhaustive the same way (`mapping/system-frames.ts`).

| Frame | Shows |
|---|---|
| `assistant` | `block_started`/`block_finished`, `tool_started` (whole input, title); a synthetic error frame as `notice(error)`; `supersedes` as `messages_retracted` |
| `user` | `tool_result` blocks as `tool_finished`; a prompt this host did not send as `user_message` |
| `stream_event` | text and thinking as `block_started`/`block_delta`/`block_finished` |
| `result/success`, `result/error_during_execution`, `result/error_max_turns`, `result/error_max_budget_usd`, `result/error_max_structured_output_retries` | `usage_updated`; a compaction still open ends; the outcome is the host's `run_finished` (D8) |
| `system/init` | the host's: model, mode, catalogues; the mapper reads the model and that a turn began |
| `system/status` | `compacting` as `compaction_started`; `null` with `compact_result` as `compaction_finished`; the permission mode is the host's |
| `system/compact_boundary` | `compaction_finished` with the token counts |
| `system/api_retry` | `retry_scheduled`; `retry_finished` from the next frame of the main loop |
| `system/informational`, `system/notification` | `notice` |
| `system/local_command_output` | `activity(command)` with the output as text |
| `system/model_refusal_fallback` | `notice(warning)` and `messages_retracted` for `retracted_message_uuids` |
| `system/model_refusal_no_fallback` | `notice(warning)`; the error outcome comes from the result |
| `system/mirror_error` | `notice(error)` |
| `system/worker_shutting_down` | `notice(warning)` |
| `system/plugin_install` | `notice(warning)` when an install failed |
| `system/session_writes_lost` | `notice(error)` saying what was not saved (transcript lines, `~/.claude.json`) and why (disk full, quota) |
| `system/permission_denied` | marks the tool call, whose result is then `denied` |
| `system/task_started` | `tool_updated(child_session)` on the Agent call that started a subagent; the task's type, command and start are kept for the background list and its end |
| `system/task_updated` | a task moved to the background (`patch.is_backgrounded`) ends as an activity |
| `system/background_tasks_changed` | `background_tasks_changed`, ambient tasks left out |
| `system/task_progress` | `tool_updated(progress)` on the call that started the task |
| `tool_progress` | `tool_updated(progress)` while the call runs |
| `rate_limit_event` | `extension(rate_limit)`: `resetsAt` epoch seconds → milliseconds, `utilization` fraction → percent |
| `conversation_reset` | `session_replaced` (`/clear`, a plan-exit context clear): the host goes on under the new id |
| `system/session_state_changed` | the host's: `idle` ends the run, `running` may start one (D8) |
| `system/commands_changed` | the host's: the command catalogue is invalidated |
| `system/task_notification` | the host ends the subagent's feed; a task in the background (not `skip_transcript`, not ambient) is an `activity` led by the CLI's `summary`, with its status, command, duration and child session; a foreground task ends with its call's `tool_result` |
| `system/elicitation_complete` | the host's: it withdraws a URL ask |
| `prompt_suggestion`, `auth_status`, `tool_use_summary`, `system/hook_started`, `system/hook_progress`, `system/hook_response`, `system/thinking_tokens`, `system/memory_recall`, `system/files_persisted`, `system/control_request_progress` | nothing: not asked for, or no contract home |

The text the CLI writes into user entries itself is read by one classifier for the live mapper, the transcript and
the terminal tail alike (`mapping/harness-text.ts`): context it attaches (`<system-reminder>`, `<ide_selection>`, a
hook's note) is left out of the person's words; a slash command's echo is `/name args`; its output, and a `!` escape's
(`<bash-stdout>`), is an `activity(command)`; a saved `<task-notification>` is the task's `activity` (live, the
`system/task_notification` frame shows it instead); an interrupt marker is where the run stopped.

`system/session_writes_lost` comes once, as the CLI exits after a full disk or quota cost it writes; a resume reads
only what was written, so a person is told, at `error` level, in plain words and with the fix (`mapping/notices.ts`).
`sdk.mjs` also passes through frames `SDKMessage` does not declare: `command_lifecycle` is the host's (D9); the rest
(`active_goal`, `session_title_changed`, `turn_preempted`, …) have no contract home.

### D20. Subagents are child sessions

A subagent is the child session `<sessionId>/<agentId>` with `parent{kind: "subagent"}`, listed from
`listSubagents` and its `.meta.json` sidecar, read by `getSubagentMessages`. Live, the parent's Agent call gets
`tool_updated{child_session}`; the subagent's frames (`forwardSubagentText`) go to the child's own stream when it is
open, as a run of its own, and are nested in the parent's run (`parentToolCallId`) only while the parent's call is
open. A background agent's call ends first, so its work reaches the child alone (`integration/children_real.test.ts`).

### D21. Ids

`ids.ts` is the one place for id formats. Run, interaction and queue item ids are minted (`crypto.randomUUID()`, never
reused across a session's processes). A tool call is its API `tool_use` id; a block `<message.id>:<index>`, the
index its position in the API message, equal live, in history and in the terminal tail
(`integration/ids_three_ways.test.ts`); a tool result item `<toolCallId>:result`; an image
`<entryUuid>:<blockIndex>[:<innerIndex>]`; a command its name.

### D22. How the rest maps

A tool call starts at its `assistant` frame with its whole input; a block ends at the first of its assistant frame,
`content_block_stop` and `message_stop`. A tool's outcome reads `tool_result_meta` and the CLI's wording (D18); a
running call the CLI cut short is `aborted`. A compaction's trigger is inferred: one that starts before the turn's
`init` is the person's (`manual`), one inside a turn the context filling (`auto`). A retry has no finish frame, so
the next frame of the turn finishes it. At the end of a run (`settle.ts`) everything still open closes: blocks with
their text so far, tools as `aborted` or `failed`, a retry, a compaction. A mapping fault is one warning notice; the
mapper never throws.

## 6. Store

### D23. Listing reads only its own rows

`store/list.ts` finds the files from `readdir`/`stat` as the SDK's lister does and orders them by `updatedAt` (D24),
newest first, then the greater `sessionId` first (`foundation/session_order.test.ts`). A row's `updatedAt` is never
later than its file's mtime, so walking the files newest mtime first, a row is final once it is newer than the next
file's mtime: a page reads the tails of the files down to there (cached by size and mtime) and only that page's rows
with `getSessionInfo`: at most `limit + 32` lite reads however deep the page. A listing's ranking is kept for 30 s
after its last page (`store/ranked-listing.ts`, at most 16 listings), so the pages after the first read on from where
the last one stopped instead of listing every project directory and ranking every newer file again: with 20,000
sessions the slowest later page fell from 343 ms to 58 ms and a full pass from 21 s to 5 s (measured, warm cache). A first page always ranks afresh. A conversation
that moves while pages are read (its activity passes the mtime the listing saw) is left off the later pages, where it
would break their order; it ranks above the cursor now, and the phone has it from the catalog. A search
(`SessionQuery.search`) reads rows until its page is full or it has read 2,000. Cursors are versioned and bound to the
read they page and the search (`cursor.ts`, `list-cursor.ts`); a foreign one is `invalid_input`. A row's `cwd` is the asked cwd, so a session started
in a git worktree lists under the worktree, not under its repository as `listSessions({dir})` would include it
(`store/list.test.ts`). Archived sessions (`SDKSessionInfo.archived`, set by Claude's apps) are listed like any
other: the contract has no archive, and hiding them would lose sessions the phone cannot get back.

### D24. Rows and titles

`updatedAt` is when the conversation last moved: the newest `user` or `assistant` entry's `timestamp` in a window at
the end of the transcript (`store/activity.ts`; 64 KiB, grown to past the longest line), never later than the file's
mtime, which it falls back to when no message is within reach. It is not the mtime: a CLI that resumed a session
appends unstamped bookkeeping (`cost-state`, `session-owner`, `tools-used`, `file-history-snapshot`, `last-prompt`,
`ai-title`, …) when it ends, so every session the phone merely opened would read as new and come back as done in the
inbox (`store/activity.test.ts`). A rename does not move it either.

`status` is live for a hosted session, `unknown` otherwise; `origin` comes from the owner journal (D25). The title is
the SDK's `summary`, which prefers a custom title, then the AI title, then the last prompt. The SDK folds the AI
title into `customTitle`, so `store/title-source.ts` reads where the SDK read: the newest `custom-title` entry of
the last and first 64 KiB of the transcript and the `<session>/custom-title.json` sidecar; a non-empty one, or the
sidecar, is `user`; otherwise `first_prompt` when the shown text is the first prompt, else `generated`.

### D25. The owner journal and the bridge's own writes

`<stateDir>/owned.jsonl` (`owned.ts`) records the sessions this bridge made (`origin: broski`), each prompt it sent
with its image names (D10), and when the last writes to a session's file were its own: a host ending, a rename, a
fork. Bounded; compacted past twice its capacity. A file last written at or before that time plus 1 s (the CLI's
batched flush) is not a terminal writing it, so a session reopened after a bridge restart is resumed, not watched
(conformance rule 27, `integration/own_writes.test.ts`). An ending host counts as hosted until its process ended and
its write was noted.

### D26. History

The transcript is what `getSessionMessages` returns, the chain of the session's live branch. The SDK's reader drops
`toolUseResult` and the details of `system` entries, so one streamed pass over the session's own file adds them
back, keyed by uuids the SDK already returned (`store/raw-scan.ts`): `turn_duration` → `run_boundary`; informational,
away and local-command entries → `notice`; a `compact_boundary`'s tokens → the next compaction item. Items are flat,
one per block, newest first; a per-session index (8 kept) from one full read turns a page into a window, with a
cursor `{entry uuid, items left}`. While a session this bridge hosts has a run, history ends before that run's first
entry (the cut the host tracks from the frames it saw), so the transcript never overlaps the snapshot (contract §8).
Images are `ImageRef`s read back from the entry.

### D27. Mutations

Rename is `renameSession`. Fork is `forkSession` (`upToMessageId` is inclusive): `through` an item forks at it, and
through a tool call at its result; `before` at the chain entry before it; a running session forks only what is
finished. The lineage is kept in `<stateDir>/forks.jsonl`, since the CLI keeps none. Delete moves the transcript and its directory to macOS `~/.Trash` by `rename` (`trash.ts`),
the trash found from the environment the CLI gets, so a test's temp `HOME` keeps it off the real one; a move never
copies or removes, and EPERM/EACCES on darwin (a service without Full Disk Access) is a `backend_error` that says so.
Each emits its catalog event; a child session refuses all three.

## 7. Terminal sessions and the hook

### D28. A session a terminal writes is watched, never written

A session this bridge does not host opens watch-only (no `control`) only while a terminal `claude` is **actively running** it (`status` of `busy` or `waiting` in `<configRoot>/sessions/<pid>.json`, or a pending hook ask, or an untracked file write in the last 10 s). Every running CLI keeps an entry in its register,
`<configRoot>/sessions/<pid>.json` (CLI 2.1.325: `pid`, `sessionId`, `procStart`, `kind`, `entrypoint`, `status`
of `busy | shell | idle | waiting`), rewritten as its status changes and removed at exit (`terminal/cli-processes.ts`).
An entry counts when its `entrypoint` is not `sdk-*` (the SDK's processes, this bridge's hosts among them, write
`kind: "interactive"` too, with `entrypoint: "sdk-ts"`), its pid lives (`kill(pid, 0)`) and, when it names a
`procStart`, `ps -o lstart=` in UTC still gives that start, so a killed CLI's entry on a reused pid does not count
(checked once per process). So a terminal run that thinks, or runs a tool, for longer than 10 s without writing is
never resumed in a second `claude`. Once the terminal is idle (`status` of `idle` or `shell`) — whether already idle
when opened or after finishing its active turn — the promotable view (`adapter-kit/promotable-view.ts`, opened by `terminal/promotable-view.ts`) runs in
controllable dormant-hosted mode (without spawning a `claude` process until the phone acts), revives lazily on the
phone's next prompt or setting change, and switches back to watch-only if the terminal starts a new active turn first.
When a tracked terminal `claude` finishes a turn or exits, `watch-only.ts` records `settledAt` so the 10 s mtime window
clears immediately for its final flush, and the promotable view flushes the tail, closes the watch, and promotes to
controllable dormant-hosted mode (`resynced` + `session_replaced`).

### D29. Terminal permission prompts through a `PermissionRequest` hook

With `claudeCode.terminalAsks` on (default), once the loopback listener is bound the bridge installs into the user's
`settings.json` (under `CLAUDE_CONFIG_DIR`, else `~/.claude`) one hook (`terminal/hook-settings.ts`):

```json
{ "hooks": { "PermissionRequest": [ { "hooks": [ {
  "type": "http", "url": "https://127.0.0.1:<port>/cc-terminal-hook", "timeout": 86400,
  "headers": { "Authorization": "Bearer <loopback token>" },
  "statusMessage": "Waiting for the Broski app (or answer here)" } ] } ] },
  "env": { "NODE_EXTRA_CA_CERTS": "~/.broski/tls/server.cert.pem" } }
```

Per the hooks reference: an `http` hook POSTs the event's JSON; `url`, `headers`, `timeout` (seconds; default 600),
`statusMessage` are its fields; a PermissionRequest hook decides by
`hookSpecificOutput.decision {behavior: "allow" | "deny", message?, interrupt?}`; a 2xx response with an empty body,
a non-2xx status, a connection failure and a timeout are non-blocking (unless `onFailure: "block"`, never set
here), so the CLI goes on to its own prompt. For a call that reaches the SDK's `canUseTool`, the hook runs beside the
host and whichever decides first applies.

- **The receiver** (`server/cc-terminal-hook.ts`, mounted at `/cc-terminal-hook` and `/hook/claude-code` via
  `server/hook-ingress.ts`, behind a dedicated per-run `hookToken` accepted only on hook routes and never on
  WebSocket upgrades) checks the body,
  hands the ask to the adapter, and holds the session open in the core (`BridgeCore.hold`, core README §20) while a
  person decides. The ask is raised on the watch-only session as a `tool_permission` with Allow once, the grants the
  terminal's own dialog would offer (its `permission_suggestions`, each checked on its own by
  `server/cc-permission-updates.ts`, worded as the hosted ask words them: `ui/permission-options.ts` `grantChoices`;
  picking one is an allow with those `updatedPermissions`), Deny and Deny and stop (`terminal/hook-interaction.ts`), answerable through `OpenSession.answer` (contract §5 rule 14), the lock
  screen included. A decision is the response; no decision is `{}`, which leaves it to the terminal's own prompt.
  It never answers for the person: the ask ends only when someone answers, the terminal's user answers first (the
  tool's result reaches the tail, or the run ends), or the CLI drops the request. The listener never idles a request
  out (`idleTimeout: 0`; Bun's 10 s default reset the real CLI's held request, `terminal/hook_cli.test.ts`).
- **AskUserQuestion and ExitPlanMode** are the hosted desk's questions and plan cards (`terminal/hook-person-asks.ts`).
  A bare allow answers neither; an allow with `updatedInput` (the questions echoed with an `answers` map, or the plan)
  does, and the CLI takes it in place of its own card (`terminal/hook_cli.test.ts`). Questions the phone cannot show
  are left to the terminal before anything is held.
- **Not raised:** a session this bridge hosts (its own `canUseTool` asks; `integration/hosted_hook.test.ts`).
- **TLS.** The loopback certificate names `IP:127.0.0.1,DNS:localhost` and is no CA (`platform.ts`,
  `tls-loopback.ts` regenerates one that is not); the CLI trusts it through `env.NODE_EXTRA_CA_CERTS`, which the
  installer refuses to overwrite when it names another file. Every `claude` the user runs then trusts this one
  certificate for the loopback names; being no CA it vouches for no other host, and its key is the user's `0600`
  file.
- **`allowedHttpHookUrls`**: when defined anywhere, only matching hook URLs run; the lists merge across sources; an
  empty list allows none (`sdk.d.ts` `Settings.allowedHttpHookUrls`). The installer never creates one (that would
  block the user's other HTTP hooks): it appends our URL to a non-empty list the user keeps, refuses an empty one,
  and on removal strips our URL only when other URLs remain (keeping a single-entry list intact so removal neither
  widens policy to all URLs nor leaves `[]` blocking future reinstalls). A project or managed list that leaves our
  URL out still blocks the hook;
  `status()` says so and names the sources (`terminal/allowed-urls.ts` matches a pattern as the binary does,
  `hook-blocked.ts`). Project and managed settings are never edited.
- **The edit** (`terminal/hook-install.ts`, `files/`) is strict JSON, key-preserving, atomic (temp then rename,
  compare-and-swap on the text read), idempotent (an unchanged file is not written), edits a symlinked file where it
  points, refuses a file that does not parse, one past 4 MiB, or one whose rewrite would change data. A file it
  creates is `0600`, since it holds the bearer token; an existing one keeps its mode.
- **Removal.** A bridge started with `terminalAsks` off removes the hook and its certificate setting at start;
  `broski uninstall` removes them whether or not a service was installed (`commands/daemon-service.ts`). A bridge that
  is not running leaves the URL dead, which the CLI treats as a non-blocking failure: the terminal prompts as usual.

## 8. Capabilities

### D30. The declared traits

`CLAUDE_CODE_TRAITS` (`traits.ts`): `streamText`, `streamThinking`, `promptModes` start, steer and queue,
`attachments: ["image"]` (D11), `commands`, `queue`, `interactions` tool_permission, questions, plan_approval, form
and confirm, `thinking`, `children`, `usage`, `extensions: ["rate_limit"]`; `planProposals` false (the todo tools are
off on the CLI's current models unless a launch opts in, and a plan reaches the phone as a `plan_approval`) and
`externalLive` false (D28). `fork`, `rename` and `delete` follow from the methods. Session capabilities: `compact` (a
`/compact` prompt) and `cancelQueued` for a hosted session; a terminal's session is watch-only and takes answers when
the hook is installed.

## 9. Tests

### D31. Tests run the real CLI against a scripted endpoint

`src/__tests__/claude-code/`: `helpers/claude-home.ts` makes a temp `CLAUDE_CONFIG_DIR` and `HOME` with every
off-switch and a proxy trap, `helpers/scripted-anthropic-server.ts` answers the Messages API from a script (side
requests for subagents, compaction and titles routed apart) and counts every escape, and each real-CLI test asserts
none. No test reads or writes the real `~/.claude`. The CLI is the SDK's own platform package binary, the one the
pin was released with; `BROSKI_TEST_CLAUDE_CLI` points the suite at another, such as the user's. Unit tests drive a
scripted `Query` (`helpers/fake-query.ts`).

- `conformance/`: the 28 rules on the real CLI, one script per session routed by its `X-Claude-Code-Session-Id`;
  the watched-ask rule runs a second real `claude` whose Write asks through the installed hook over TLS.
- `integration/core_smoke.test.ts`: a phone through the core end to end; `children_real.test.ts`,
  `hosted_hook.test.ts`, `own_writes.test.ts`, `ids_three_ways.test.ts`.
- `spike/`: the real CLI's behaviour the adapter relies on, the regression suite for every pin bump; the frame
  fixtures (`fixtures/frames/`) are re-recorded with `CC_SPIKE_RECORD=1` after a bump and the diff reviewed.
- One directory per part: `catalogue/`, `live/`, `mapping/`, `asks/`, `store/`, `terminal/`, `foundation/`.

## 10. Limits and known gaps

- A project or managed `allowedHttpHookUrls` that leaves our hook out still blocks it; it is told, not fixed (D29).
- A terminal session without the hook is watch-only with no answers; its asks stay in the terminal.
- `externalLive` is false, so a terminal's run shows only on a watch-only open (D28).
- Unverified offline: the `auto` compaction trigger against a real API, an `ORG_POLICY_LIMIT_PREFIXES` refusal, a
  real terminal REPL's `turn_duration`, macOS Trash permissions for a service, a root-run bridge (D13, read in the
  binary, not run), and `system/session_writes_lost` from a real full disk (mapped from `sdk.d.ts`).
- `canUseTool` with `bypassPermissions` logs the SDK's `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning when such a session
  starts: in that mode the CLI asks nothing, which is what the person chose.
