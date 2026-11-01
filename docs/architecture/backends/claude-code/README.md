# The Claude Code adapter

Status: **Step 5 (integration) done** on `cc/integrate`: the eight lanes merged into one adapter, all 31 conformance rules pass against the real CLI (`src/__tests__/claude-code/conformance/`), and the bridge registers it **only when the bridge config says `"claudeCode": {"contract": true}`** (D28, D127). With the flag off (the default) nothing changes for a user. The plan is [`PLAN.md`](PLAN.md); the seams are [`STEP-3-INTERFACES.md`](STEP-3-INTERFACES.md); each lane's full notes and evidence are in [`lanes/`](lanes/).

## What it is

The contract backend for Claude Code (`packages/bridge/src/backends/claude-code/`): it implements `AgentBackend` (`src/contract/backend.ts`) on `@anthropic-ai/claude-agent-sdk` 0.3.316 (bundled CLI 2.1.316), so the generic app (`lib/agent/`) drives Claude Code exactly as it drives Pi. It may import only the contract (not its test kit), itself, `node:` built-ins (not `node:module`), `zod` and the SDK (`bun run check:layers`).

## Layout

```
backends/claude-code/
  factory.ts        claudeCodeBackendFactory(options) → BackendFactory            foundation
  backend.ts        the AgentBackend over the parts; open routing; dispose order   foundation
  call-op.ts        AgentBackend.call: ClaudeCodeOp → ops/                         foundation
  traits.ts         CLAUDE_CODE_TRAITS, claudeCodeTraits({customTools})            foundation (D38)
  ports.ts, ports/  every seam between the parts                                  foundation
  services.ts       factory options, shared services                               foundation
  ids.ts cursor.ts bounds.ts json.ts rejections.ts catalog-feed.ts                foundation, built + tested
  permission-modes.ts  the permissions axis's values                               foundation, built
  sdk/              the ClaudeSdk port: in process, or a worker under a config dir (D36)   foundation, built
  process/env.ts process/inbox.ts                                                 foundation, built
  live/live-state.ts                                                              foundation, built
  owned.ts store/                                                                 lane A
  mapping/                                                                        lane B
  models/ modes.ts commands.ts status.ts process/probe.ts process/version-check.ts lane C
  live/ (but live-state.ts) process/options.ts                                    lane D
  ui/                                                                             lane E
  ops/                                                                            lane F
  terminal/                                                                       lane G
  open-session.ts   open routing: new/stored → live, child → parent host, written → terminal   integration
  trash.ts          the one move-to-trash (lane A's, D121)                        integration

src/server/  (the bridge side, outside the adapter's layer)
  claude-code-wiring.ts   what claudeCode.contract switches (D127)
  claude-code-backend.ts  the factory options production passes (D3, D35, D30, D26)
  claude-code-hooks.ts    which permission hook lands in the user's settings after listen
  cc-terminal-hook.ts     the terminal hook's receiver (lane G, D107)
  cc-custom-tools.ts cc-custom-tool-schema.ts   the custom tools port over custom-tools.ts (D30, D121)
src/tls-loopback.ts       is the loopback certificate one a terminal claude trusts (D124)
```

Tests: `src/__tests__/claude-code/foundation/` (Step 3), `conformance/` (the driver and the 31 rules on the real CLI), `integration/` (cross-lane checks on the whole backend and the server wiring, Step 5), `helpers/`, and one directory per lane (STEP-3 §1).

PLAN §7 listed `ui/dialogs.ts`; it is not created: D5 as amended by the spike passes no `onUserDialog` and declares no `choice`, so there is no dialog to map.

## Decisions

D1–D35 are [`PLAN.md`](PLAN.md) §3 (D1–D30 the plan's, D31–D35 the spike's). Step 3 took D36–D39.

### D36. An explicit config dir runs the SDK's session functions in a worker; production calls them in process

The SDK's session and settings functions (`listSessions`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents`, `forkSession`, `renameSession`, `resolveSettings`) read `CLAUDE_CONFIG_DIR` from the environment of the thread they run in: `sdk.mjs:30` `function hu(){return process.env.CLAUDE_CONFIG_DIR}` and `Mt=PP(()=>(hu()??join(homedir(),".claude")).normalize("NFC"),hu)`; their options have no config dir (`sdk.d.ts:939` `GetSessionMessagesOptions`, `:1143` `ListSessionsOptions`, `:3418` `ResolveSettingsOptions`).

When they read it decides the mechanism. Read in `sdk.mjs`:

| Function | First read of the config dir | Before its first `await`? |
|---|---|---|
| `listSessions` | `X0(e,t,n=Et())` default parameter (`sdk.mjs:117`) | yes |
| `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents` | `ws(…,o=Et())` default parameter, called synchronously (`:56`, `:114`, `:117`) | yes |
| `forkSession` with `dir` | `qn(l,o)` defaults `n=Et()` after `await No(t,…)` (`:117` `kxe`) | **no** |
| `renameSession` with `dir`, `deleteSession` with `dir` | `qn(…)` after `await No(…)` (`:161` `J3`, `aJe`) | **no** |
| `resolveSettings` | after `await R6()` (`:152` `k6`) | **no** |

A synchronous swap of `process.env` around the call would therefore leave `fork`, `rename` and `resolveSettings` reading whatever the environment says after the first `await`, and a swap held across that `await` mutates the bridge's environment while other code runs (forbidden). So:

- **`configDir` unset (production):** the functions run in process. The bridge's `process.env` already is the login shell's (`applyServiceShellEnv` imports it, `platform/shell-env.ts`), so a `CLAUDE_CONFIG_DIR` set in `~/.zshrc` reaches the SDK and the CLI alike (the CLI gets `services.cliEnv`, built from the same shell env).
- **`configDir` set (tests, and any future override):** they run in a `node:worker_threads` worker started with `env: {…cliEnv, CLAUDE_CONFIG_DIR: configDir}` (`sdk/worker-client.ts`, `sdk/sdk-worker.ts`). Bun gives a worker its own `process.env` (proven before writing it: two workers with different `env` read different values while the parent's stays as it was). The bridge's `process.env` is never written. The worker starts on the first call, is `unref`'d, and ends at `dispose()`.

Evidence: `src/__tests__/claude-code/foundation/config_dir.test.ts` — two ports over two temp config dirs, five reads in one `Promise.all` (lists with and without `dir`, messages, a cross-dir `getSessionInfo` that must miss), with the bridge's own `CLAUDE_CONFIG_DIR` pointed at a third, decoy dir: each port sees exactly its own sessions and the decoy is untouched; `renameSession` and `forkSession` with `dir` land in the right dir; a disposed port refuses. A compiled bridge never starts the worker (production leaves `configDir` unset), so `scripts/build.sh` needs no extra entry point; a build that ever sets `configDir` must add `sdk/sdk-worker.ts` as a `bun build --compile` entry point first.

### D37. A prompt's send `uuid` is its `clientRequestId`

The `SDKUserMessage` that carries a prompt has `uuid = clientRequestId` (`ids.ts` `sendUuid`). The CLI keeps a send's uuid as its transcript entry's uuid (`sdk.d.ts:878-882`; proven by `conformance/session_router.test.ts`: the first chain entry's uuid is the uuid sent), keys `command_lifecycle` and `result.user_message_uuids` by it (08-spike Q4), so one id names the prompt in the live `user_message.messageId`, the transcript item id (`userItemId`), and the image refs `<uuid>:<blockIndex>`. The owner journal (`owned.ts`) records each prompt this bridge sent with its image names (the CLI keeps none); the store gives a user item `clientRequestId = uuid` exactly when the journal has it, so a prompt typed in a terminal never carries one. A fork remaps every uuid, so a fork's prompts carry none.

### D38. The declared capabilities

`CLAUDE_CODE_TRAITS` (`traits.ts`) is the plan's list with two changes, each because no conformance rule could pass the plan's value:

- **`attachments: ["image"]`, files as mentions.** A contract file attachment is a path on the Mac (`FileContent.uri`), which D10 sends as `@<path>`, exactly as a file mention. Rule 13 compares each delivered attachment and mention with what was sent, and a driver reading the model request cannot tell `@path`-from-an-attachment from `@path`-from-a-mention, so declaring both would make one of them fail. A file reaches Claude Code as a mention (`mentions: ["file", "agent"]`).
- **`plan: false`.** On the CLI's models (`claude-*-5-5`) the todo tools are off: the 2.1.316 binary enables `TodoWrite`/`TaskCreate` only for an older model, a launch opt-in, or `CLAUDE_CODE_ENABLE_TODO_TOOLS` (`p5()` in the binary's strings), and no recorded `system/init` lists either tool (`fixtures/frames/text.jsonl`, `subagent.jsonl`). Rule 12 could not show `plan_updated` without the adapter forcing that variable, which would offer the model a tool a terminal `claude` does not (D5's parity). Lane B therefore emits no `plan_updated` (an undeclared trait is a stream violation). **Owner to confirm**; the alternative is `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` in D4's env and `plan: true`.

The custom tool ops are declared only when the server layer hands over the custom tools port (`claudeCodeTraits({customTools})`), since rule 9 calls every declared op. `cancelRetry` is not a method (the CLI's retry is cancelled only by interrupting the run, Q13), so rule 29 checks nothing for retries; `cancelCompaction` is lane D's to decide (D70s).

### D39. Every live id the adapter mints is a random UUID; the CLI's own ids are used where they are unique

`ids.ts` is the one place for id formats: run, interaction and queue item ids are minted (`crypto.randomUUID()`, never reused in a session across CLI processes); a tool call is its API `tool_use` id; a block is `<message.id>:<index>`; a tool result item `<toolCallId>:result`; an image `<entryUuid>:<blockIndex>[:<innerIndex>]`; a child session `<sessionId>/<agentId>`; a command its name. The CLI's `request_id` of an ask is per process and is mapped to a minted interaction id by the desk, so a redelivered ask (fact 13) keeps its interaction and a new process never reuses one.

## Lane decisions

One line per decision; the reasoning, the SDK facts verified twice and the measurements are in each lane's notes (linked). Where an integration decision (D120–D129) changed a lane's, it says so here and the integration decision wins.

### Lane A · Store (D40–D49) — [`lanes/A.md`](lanes/A.md)

- **D40** A list page is ordered from `readdir`/`stat` like the SDK's `$we` (mtime desc, then the greater `sessionId`) and reads only its own rows with `getSessionInfo`: at most `limit + 32` lite reads (`store/scale.test.ts`: 50 per page on a 500-session project).
- **D41** History is what the SDK's reader returns; it drops `tool_use_result` and system details. **D41a** one streamed pass over the session's own file adds them back, keyed by uuids the SDK already returned. **D41b** `turn_duration` → `run_boundary`, informational/away/local-command → `notice`, `compact_boundary` → the next compaction item's tokens.
- **D42** A per-session index (8 sessions) from one full read; cursor `{entry uuid, items left}`; `LiveRow.cut` limits a running session's history; a lost cut gives an empty page.
- **D43** Fork lineage in `<stateDir>/forks.jsonl`; `through` a tool call forks at its result.
- **D44** Delete moves the transcript and its directory to the OS trash by `rename`, location from `services.cliEnv` (now `trash.ts`, shared: D121).
- **D45** The owner journal `<stateDir>/owned.jsonl` (sessions, prompts with image names, and since D122 the bridge's own last writes), bounded, compacted at 180,000 lines.
- **D46** Subagents are child sessions from `listSubagents` + sidecars. **D47** Row titles follow the SDK's `summary` (which prefers the last prompt). **D48** `lastChainUuid` of a session with no file is `null`. **D49** rename/fork/remove emit their catalog events (rename now with the caller's overlay, D127's port change).

### Lane B · Mapping (D50–D59) — [`lanes/b.md`](lanes/b.md)

- **D50** A subagent's work goes to its own stream, and nested (`parentToolCallId`) in the parent's only while the parent's call is open.
- **D51** A tool call starts at its `assistant` frame (whole input, title). **D52** Block ids `<message.id>:<index>`, finished by the first of assistant frame / `content_block_stop` / `message_stop`.
- **D53** Tool outcomes from the CLI's wording; a person's denial reads `denied` only when it starts with `HUMAN_DENIAL_PREFIX` (the asks and the terminal hook now use it: D125).
- **D54** Compaction start/finish/tokens; the `auto` trigger is inferred and unverified offline. **D55** Usage from `modelUsage`/`total_cost_usd`, replaced not summed. **D56** Notices. **D57** `settle` closes everything open. **D58** Retry with no finish frame. **D59** Never throws; a fault is one warning notice.

### Lane C · Catalogue (D60–D69) — [`lanes/c.md`](lanes/c.md)

- **D60** Models are `ModelInfo` rows, id = `value`; listed with rows whose wire id no other row shares first (`fable, sonnet, haiku, default, opus`), see D120.
- **D61** Commands: user/project/plugin/MCP first, terminal-only built-ins hidden, skills from `reloadSkills()`. **D62** The probe (empty inbox, hooks disabled, 20 s bound). **D63** Cache in memory + `<stateDir>/catalog.json`, 24 h. **D64** Status cases (missing binary, refused, signed out, version mismatch). **D65** One `permissions` axis, `auto` only when a model supports it. **D66** Failures are values.

### Lane D · Live session (D70–D79) — [`lanes/D.md`](lanes/D.md)

- **D70** The transcript cut is tracked from frames (`frame_uuids.test.ts`, `chain_tail.test.ts`).
- **D71** A run starts at dispatch or on `running`, ends on `idle` (or the process ending, or a Stop that cancelled an unstarted send).
- **D72** A steer is a queue item until the CLI starts it. **D73** The queue is the adapter's, one item per run. **D74** Stop = `interrupt({cancelQueued})`, a 5 s deadline, and a second Stop when the first beat the message. **D75** Run outcome rules. **D76** `cancelCompaction` declared (Stop of a compact-only run). **D77** `/clear` re-keys the host as `session_replaced`. **D78** Model, thinking and mode. **D79** Prompt suggestions only when the setting is `true`; restart, mentions, idle grace, transient hosts, child feeds.

### Lane E · Asks (D80–D89) — [`lanes/e.md`](lanes/e.md)

- **D80** One ask per CLI request id; an answered one is replayed. **D81** Permission options (allow once, session, always per destination, deny once, deny and stop); payloads stay in the desk.
- **D82** A request the contract cannot hold is raised as a decline-or-dismiss `confirm`, never answered for the person. **D83** Field order is the schema's key order. **D84** Plan approval with `modeOptions` from the host. **D85** URL elicitations and the server's completion (withdrawn). **D86** Failures keep the ask raised; nothing returns `null`. **D87** CLI and MCP text stripped of ANSI/bidi. **D88** `requiresUserInteraction` read with an `in` check. **D89** Stop the run = deny with `interrupt` and the host's abort.

### Lane F · Ops (D90–D99) — [`lanes/f.md`](lanes/f.md)

- **D90** Config files addressed `<kind>:<scope>[/<path>]`, relative to `configRoot()`. **D91** The writer: strict JSON, settings checked by the CLI's own reader, contained, compare-and-swap, atomic; delete goes to the trash (`trash.ts` since D121, no more `trash` binary).
- **D92** `mcp_servers` never writes `~/.claude.json`: the CLI's own `mcp_toggle` persists the toggle (contradicts PLAN D22; corrected there).
- **D93** `plugins` rows from `enabledPlugins`; loaded/failed plugins from `system/init` are not shown (port gap, D127). **D94** `session_settings`: output style, auto memory, prompt suggestions (shown off unless `true`: D125); fast mode and 1M context left out. **D95** `settings_overview` with secrets masked. **D96** `changed_files` folds tool results (12,000 items at most). **D97** rewind/context/MCP on `withHost`. **D98** Custom tools through the port only. **D99** The config watcher (wired at integration).

### Lane G · Terminal (D100–D109) — [`lanes/g.md`](lanes/g.md)

- **D100** The tail: one watcher per project directory, positional reads, bounded lines. **D101** What is translated; block ids by `apiBlockIndex` (equal live, in history and in the tail: `integration/ids_three_ways.test.ts`). **D102** Run ends, with a quiet rule for SDK-written sessions. **D103** Opening mid-turn. **D104** `writing(id)` (now also ignoring the bridge's own writes, D122).
- **D105** The hook in the user's settings (never creates `allowedHttpHookUrls` since D123). **D106** The certificate blocker (fixed by D124). **D107** The receiver, no timer. **D108** The ask on the phone (allow once, deny, deny and stop). **D109** `claudeCode.terminalAsks`.

### Lane H · App (D110–D119) — [`lanes/h.md`](lanes/h.md)

- **D110** A file opens beside its list. **D111** Every file refusal its own case. **D112** Custom tools edited from the list. **D113** The plan approval mode picker. **D114** The prompt suggestion chip. **D115** Project panels (wiring is Step 7's). **D116** Session list search, order, filter, group (title exclude filters are Step 7's). **D117** Groups by name. **D118** Status tones from the theme.

## Integration decisions (D120–D129)

### D120. The model list keeps lane C's order, because the CLI's own order cannot pass rule 20

The plan owner asked for the CLI's order ("Default (recommended)" first) with `model-echo.ts` folding rows that share a wire id. With that order rule 20's first two listed models are `default` and `opus`, and the CLI sends them **identically**: a probe through the scripted endpoint (2026-11-01) recorded `model: "claude-opus-5-5"` and the same `anthropic-beta` list for both; `initializationResult().models` gives `default → claude-opus-5-5`, `opus → claude-opus-5-5` (08-spike Q11), and `ANTHROPIC_DEFAULT_OPUS_MODEL` moves both (`default → X[1m]`, `opus → X`). No fold can tell which row a request ran with, so switching from the first to the second listed model is not observable and rule 20's second half fails. Per the instruction, the order is not changed and this is reported: **owner decision pending** (accept lane C's order, or weaken rule 20 for backends whose rows alias one model).

### D121. One trash: lane A's rename, for every delete

`store/trash.ts` moved to `trash.ts` with `trashTargetOf(env, now)`; `config_file` delete (lane F) and the custom tools port's delete use it, and F's `trash` binary is gone (Linux has none). A custom tool lives inside `~/.broski/custom-tools.json`, so its delete writes the definition as `custom tool <name>.json` into `~/.broski/claude-code/trash-staging/` and moves that file to the trash before the tool leaves the store; a failed move keeps the tool and says why (`integration/custom_tools_port.test.ts`). **Unverified:** macOS protects `~/.Trash` from processes without Full Disk Access in some setups; a refused `rename` is a `backend_error` and the file stays (on-device check, Step 8).

### D122. A file this bridge wrote last is not a terminal writing it

Rule 28 failed: after a restart the reopened session took lane G's watch-only path (its file was written seconds ago by the bridge's own, now killed, CLI) and showed a run no process would finish. `Ownership.noteOwnWrite(id, at)` / `ownWriteAt(id)` (journal line `{k:"r"}`) record when a host ends, a rename appends its title and a fork writes its file; `writing(id)` ignores a file last written at or before that time plus `OWN_FLUSH_MS` (1 s, the CLI's batched flush). Proven by rule 28, `terminal/released.test.ts` and `integration/own_writes.test.ts` (which fails without the rename and fork notes). A host that ends while an open arrives in its last 2.5 s can still be seen as written for up to 10 s (no run is shown: the file holds a finished turn).

### D123. The terminal hook never creates `allowedHttpHookUrls`

`sdk.d.ts:7647`: "When set, HTTP hooks with non-matching URLs are blocked. If undefined, all URLs are allowed. If empty array, no HTTP hooks are allowed. Arrays merge across settings sources"; the binary carries the same schema text and "does not match any pattern in allowedHttpHookUrls"; `hook_cli.test.ts` shows a list without our URL blocks the hook and a missing list lets it run. So the installer appends our URL only to a non-empty list the user keeps, refuses an empty one (the user forbids HTTP hooks), and removes a list that holds only our URL (an older installer made it). A list set by project or managed settings without our URL still blocks the hook silently (it fails open to the terminal's own prompt).

### D124. The loopback certificate names 127.0.0.1 and is no CA; the CLI trusts it by `NODE_EXTRA_CA_CERTS`

`platform.ts` now generates `-addext subjectAltName=IP:127.0.0.1,DNS:localhost -addext basicConstraints=critical,CA:FALSE` (OpenSSL 4.1 and LibreSSL 3.3.6 both accept it), and `ensureTlsMaterial` regenerates a certificate that lacks the name or is a CA (`tls-loopback.ts`, `tls_loopback_name.test.ts`). The hook installer writes `env.NODE_EXTRA_CA_CERTS = ~/.broski/tls/server.cert.pem` into the user's Claude settings and refuses when the user already names another file there. Verified against the real CLI: a hook call over the bridge generator's own certificate succeeds (`hook_cli.test.ts`, "the bridge's own loopback certificate"). **Trade-off:** every `claude` the user runs trusts this one certificate for `127.0.0.1`/`localhost`; being no CA, it cannot vouch for any other host, and its key is the user's own `0600` file. The settings edit is strict JSON, atomic and key-preserving (lane G's installer). The alternative (a plain-HTTP loopback route) stays rejected: compiled builds force TLS.

### D125. A person's "no" is sent in the CLI's own words

`ui/denial.ts` builds a denial from `HUMAN_DENIAL_PREFIX` exactly as the 2.1.316 binary words its own ("The user doesn't want to proceed with this tool use. The tool use was rejected … To tell you how to proceed, the user said:\n<words>", or "… STOP what you are doing …"); a tool permission's deny, a cancel, a plan rejection and the terminal hook's deny use it. A denial reads `denied` live and in history (`integration/denial.test.ts`) and in the terminal CLI's tool result (`hook_cli.test.ts`). The `session_settings` prompt-suggestions toggle shows an absent key as off and writes `true` explicitly, matching D79; a suggestion then reaches the phone end to end (`integration/prompt_suggestion.test.ts`).

### D126. A terminal session asked about before its first flush is waited for

The real path of rule 31 showed a terminal's hook ask arriving before the CLI wrote the session's first lines (about 100 ms late, D103): `open` found no file, answered `not_found`, the hold failed and the phone never saw the ask. `open-session.ts` now looks for a session a terminal is writing for up to `FIRST_FLUSH_MS` (3 s) before `not_found`.

### D127. The flag, the server wiring, and what the old path does while it is on

`claudeCode.contract` (default false) registers the adapter (`server/contract-backends.ts`); `claudeCode.terminalAsks` (default true) installs the terminal hook only with the flag on, removes it otherwise. Production passes the CLI from the one resolver (shared with the old connector), `expectedCliVersion` from the SDK package's `claudeCodeVersion` (a JSON import, so `bun build --compile` bakes it), the login-shell environment, `stateDir ~/.broski/claude-code`, no `configDir`, the custom tools port and the receiver's `setHandler`; the receiver reaches the core's `hold`/`release` through `connect(seam)` (the seam is built after the HTTP wiring). With the flag on, the old protocol's `PreToolUse` hook stands down: it is removed once at start if its marker is there (that installer rewrites the whole file, so only then), never installed, and not uninstalled at shutdown; otherwise both hooks would raise two asks for one prompt, also for the adapter's own sessions. What coexists, and why: the old `/cc-hook` route (receives nothing once its hook is gone), the old external tail and file watchers (read-only), and the old live path for a legacy selection (the app gates one path per backend, D29; a session the old path is running looks to the adapter like a terminal writing it, so the adapter opens it watch-only). Port changes: `Ownership.noteOwnWrite`/`ownWriteAt`, `TerminalDeps.ownWriteAt`, `SessionStore.rename(…, live)` (lane A's wish; `remove` needs no overlay, it emits `session_removed` only), `callOp(OpsDeps)`, `ClaudeCodeParts.configWatch`. Not made, for Step 6/7: `Ownership.claim(id, parent)` (would retire `forks.jsonl`), and `HostView` exposing `system/init` data (plugins loaded/failed, fast mode).

### D128. `externalLive` stays false

Rule 27 opens a **new** session (`rig.openNew()`, hosted by this bridge) and expects another client's run on that same open. A hosted session follows only its own process (D21's one writer per file); lane G's tail shows another process's run on a **watch-only** open (`terminal/watch_live_cli.test.ts`), which is not what the rule opens. Declaring it would make rule 27 fail by construction.

### D129. The conformance world runs the real path

Rule 31 goes through a real second `claude` process whose Write asks, the installed `PermissionRequest` hook over TLS, the server's own receiver and the adapter's handler (`conformance/terminal-asks.ts`), not a written transcript and a synthesised ask (lane G's `watched-ask.ts` stays for its unit tests). Custom tools are the server's port with an in-memory store (`world-custom-tools.ts`). `delivered()` reads the last `user`-role message (CLI 2.1.316 puts a `system` "# Environment" message after the first one), and `arrange` replaces a session's unconsumed script (a Stop that beat its message leaves the scenario unread, D74). The elicitation server gained `ask_url_completed` for the server-side completion check.

## Corrections to the research

- `listSessions` breaks a `lastModified` tie by the **greater** `sessionId` first (`sdk.mjs:117` `zwe`, `$we`; `src/__tests__/claude-code/foundation/session_order.test.ts`), not ascending as research 04 §3 and PLAN fact 15 say. Lane A's keyset (D15) orders the same way.

Lane findings that correct the plan or the research (details in the lane notes): `mcp_toggle` persists itself (F, D92); a schema-invalid settings file is skipped whole (F); project settings are read at `<cwd>/.claude` for a subdirectory cwd (F); an aborted tool shows only in its result's text (B); a failed tool's `tool_use_result` is a string (B); no `user` echo of host sends (B); `system/init` comes only with a turn (C, D); a probe runs `SessionStart` hooks unless disabled (C); the terminal prompt and the hook race (G); `turn_duration` is written by the REPL only (G); the SDK already drops in-flight duplicate asks (E); nested forms never reach `onElicitation` (E).

## Known gaps

- D26 is answered on the contract by Step 3b (`OpenSession.answer`, core README §21) and wired by D127; the remaining limits are D123's (a project or managed URL list) and D122's last-2.5-s window.
- D120: the model order is the owner's call.
- Unverified against a real API (no offline recording): the `auto` compaction trigger and `contextTokens` (B), an `ORG_POLICY_LIMIT_PREFIXES` refusal (C), `stopTask` on a real background task (F), a real terminal REPL's `turn_duration` and dialog (G), macOS Trash permissions for a service (D121).
- Owner decisions of 2026-11-01 for Step 7 (PLAN §10): hook activity cards stay (the host will turn on `includeHookEvents`; nothing here prevents it) and fork-on-resume / continue-latest stay; diff-stat badges, the agent-teams toggle and Broski's plugin-path config are dropped.
