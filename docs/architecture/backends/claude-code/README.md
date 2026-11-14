# The Claude Code adapter

Status: the only Claude Code. The adapter is registered in every bridge (`server/contract-backends.ts`), drives the user's installed `claude` (`server/claude-cli-path.ts`) and passes all 28 conformance rules against the real CLI (`src/__tests__/claude-code/conformance/`). Its terminal permission prompts arrive through a `PermissionRequest` hook (`claudeCode.terminalAsks`, default true). It serves no ops, custom tools, hook activities or prompt suggestions: the phone is not where those are managed (`docs/rebuild/PLAN.md`).

The decisions below (D-numbers) are the record of how it was built; the code cites them. The plan is [`PLAN.md`](PLAN.md), the seams [`STEP-3-INTERFACES.md`](STEP-3-INTERFACES.md) and each part's notes are in [`lanes/`](lanes/); those files and `research/` and `reviews/` were written before the rebuild and are marked historical: where one names an op, the old protocol, the Flutter app or a protocol minor, that part no longer exists.

## What it is

The contract backend for Claude Code (`packages/bridge/src/backends/claude-code/`): it implements `AgentBackend` (`src/contract/backend.ts`) on `@anthropic-ai/claude-agent-sdk` 0.3.316 (CLI 2.1.316), so a phone drives Claude Code exactly as it drives Pi. It may import only the contract (not its test kit), itself, `node:` built-ins (not `node:module`), `zod` and the SDK (`bun run check:layers`).

## Layout

```
backends/claude-code/
  factory.ts        claudeCodeBackendFactory(options) → BackendFactory
  backend.ts        the AgentBackend over the parts; open routing; dispose order
  traits.ts         CLAUDE_CODE_TRAITS (D38)
  ports.ts, ports/  every seam between the parts
  services.ts       factory options, shared services
  ids.ts cursor.ts bounds.ts json.ts rejections.ts catalog-feed.ts phone-text.ts trash.ts
  permission-modes.ts modes.ts commands.ts status.ts
  sdk/              the ClaudeSdk port: in process, or a worker under a config dir (D36)
  process/          env, options, the open inbox, the probe, the version check, the bypass rule
  owned.ts store/   the owner journal; sessions, history, forks, titles read from the CLI's files
  mapping/          SDK frames → contract events
  models/           the catalogue: models, thinking, the cache, the config watcher
  live/             one host per hosted session: the CLI process, runs, queue, Stop, asks' lifetime
  ui/               the ask desk: permissions, questions, forms, plan approval
  terminal/         a terminal `claude`'s session: tail, hook installer and receiver, watch-only sessions
  files/            strict, atomic edits of a user's JSON file
  open-session.ts   open routing: new/stored → live, child → parent host, written → terminal

src/server/  (the bridge side, outside the adapter's layer)
  claude-code-wiring.ts   the hook receiver and the factory, from `claudeCode.terminalAsks`
  claude-code-backend.ts  the factory options production passes
  claude-code-hooks.ts    which permission hook lands in the user's settings after listen
  cc-terminal-hook.ts     the terminal hook's receiver
src/tls-loopback.ts       is the loopback certificate one a terminal claude trusts (D124)
```

Tests: `src/__tests__/claude-code/`: `foundation/`, `conformance/` (the driver and the rules on the real CLI), `integration/` (cross-part checks and the server wiring), `spike/` (the real CLI's behaviour, the regression suite for every SDK pin bump), `helpers/`, and one directory per part.

## Decisions

D1–D35 are [`PLAN.md`](PLAN.md) §3.

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
- **`configDir` set (tests, and any future override):** they run in a `node:worker_threads` worker started with `env: {…cliEnv, CLAUDE_CONFIG_DIR: configDir}` (`sdk/worker-client.ts`, `sdk/sdk-worker.ts`). Bun gives a worker its own `process.env`. The bridge's `process.env` is never written. The worker starts on the first call, is `unref`'d, and ends at `dispose()`.

Evidence: `src/__tests__/claude-code/foundation/config_dir.test.ts` — two ports over two temp config dirs, concurrent reads, with the bridge's own `CLAUDE_CONFIG_DIR` pointed at a third, decoy dir: each port sees exactly its own sessions and the decoy is untouched; `renameSession` and `forkSession` with `dir` land in the right dir; a disposed port refuses. A compiled bridge never starts the worker (D142).

### D37. A prompt's send `uuid` is its `clientRequestId`

The `SDKUserMessage` that carries a prompt has `uuid = clientRequestId` (`ids.ts` `sendUuid`). The CLI keeps a send's uuid as its transcript entry's uuid (`sdk.d.ts:878-882`; proven by `conformance/session_router.test.ts`: the first chain entry's uuid is the uuid sent), keys `command_lifecycle` and `result.user_message_uuids` by it (08-spike Q4), so one id names the prompt in the live `user_message.messageId`, the transcript item id (`userItemId`), and the image refs `<uuid>:<blockIndex>`. The owner journal (`owned.ts`) records each prompt this bridge sent with its image names (the CLI keeps none); the store gives a user item `clientRequestId = uuid` exactly when the journal has it, so a prompt typed in a terminal never carries one. A fork remaps every uuid, so a fork's prompts carry none.

### D38. The declared capabilities

`CLAUDE_CODE_TRAITS` (`traits.ts`): `streamText`, `streamThinking`, `promptModes` start, steer and queue, `attachments: ["image"]`, `commands`, `queue`, `interactions` tool_permission, questions, plan_approval, form and confirm, `thinking`, `children`, `usage`, `extensions: ["rate_limit"]`; `planProposals` and `externalLive` false. `fork`, `rename` and `delete` follow from the methods `backend.ts` implements. Session capabilities: `compact` (a `/compact` prompt) and `cancelQueued` for a session this bridge hosts; a session a terminal writes is watch-only, and takes answers (`answer`) when the hook raised an ask on it.

- **Files are not an attachment kind here.** A contract file attachment is a path on the Mac (`FileContent.uri`); the CLI takes a file as `@<path>` in the text, which a driver reading the model request cannot tell from the user typing it, so no conformance rule could pass a declared file attachment.
- **No todo list.** On the CLI's current models the todo tools are off (the 2.1.316 binary enables `TodoWrite`/`TaskCreate` only for an older model, a launch opt-in, or `CLAUDE_CODE_ENABLE_TODO_TOOLS`), and the contract has no plan-list event; a plan the agent proposes reaches the phone as a `plan_approval`.

### D39. Every live id the adapter mints is a random UUID; the CLI's own ids are used where they are unique

`ids.ts` is the one place for id formats: run, interaction and queue item ids are minted (`crypto.randomUUID()`, never reused in a session across CLI processes); a tool call is its API `tool_use` id; a block is `<message.id>:<index>`; a tool result item `<toolCallId>:result`; an image `<entryUuid>:<blockIndex>[:<innerIndex>]`; a child session `<sessionId>/<agentId>`; a command its name. The CLI's `request_id` of an ask is per process and is mapped to a minted interaction id by the desk, so a redelivered ask keeps its interaction and a new process never reuses one.

## Part decisions

One line per decision; the reasoning and the SDK facts are in each part's notes (linked, historical).

### Store (D40–D49) — [`lanes/A.md`](lanes/A.md)

- **D40** A list page is ordered from `readdir`/`stat` like the SDK's `$we` (mtime desc, then the greater `sessionId`) and reads only its own rows with `getSessionInfo`: at most `limit + 32` lite reads.
- **D41** History is what the SDK's reader returns; it drops `tool_use_result` and system details. **D41a** one streamed pass over the session's own file adds them back, keyed by uuids the SDK already returned. **D41b** `turn_duration` → `run_boundary`, informational/away/local-command → `notice`, `compact_boundary` → the next compaction item's tokens.
- **D42** A per-session index (8 sessions) from one full read; cursor `{entry uuid, items left}`; `LiveRow.cut` limits a running session's history; a lost cut gives an empty page.
- **D43** Fork lineage in `<stateDir>/forks.jsonl`; `through` a tool call forks at its result.
- **D44** Delete moves the transcript and its directory to the OS trash by `rename` (`trash.ts`).
- **D45** The owner journal `<stateDir>/owned.jsonl` (sessions, prompts with image names, the bridge's own last writes), bounded, compacted at 180,000 lines.
- **D46** Subagents are child sessions from `listSubagents` + sidecars. **D47** Row titles follow the SDK's `summary` (which prefers the last prompt); the title's source is D131's. **D48** `lastChainUuid` of a session with no file is `null`. **D49** rename/fork/remove emit their catalog events.

### Mapping (D50–D59) — [`lanes/b.md`](lanes/b.md)

- **D50** A subagent's work goes to its own stream, and nested (`parentToolCallId`) in the parent's only while the parent's call is open.
- **D51** A tool call starts at its `assistant` frame (whole input, title). **D52** Block ids `<message.id>:<index>`, finished by the first of assistant frame / `content_block_stop` / `message_stop`.
- **D53** Tool outcomes from the CLI's wording; a person's denial reads `denied` only when it starts with `HUMAN_DENIAL_PREFIX` (D125). Live, the frame's `tool_result_meta` decides first (D133).
- **D54** Compaction start/finish/tokens; the `auto` trigger is inferred and unverified offline. **D55** Usage from `modelUsage`/`total_cost_usd`, replaced not summed. **D56** Notices. **D57** `settle` closes everything open. **D58** Retry with no finish frame. **D59** Never throws; a fault is one warning notice.

### Catalogue (D60–D66) — [`lanes/c.md`](lanes/c.md)

- **D60** Models are `ModelInfo` rows, id = `value`, in the order D135 sets.
- **D61** Commands: user/project/plugin/MCP first, terminal-only built-ins hidden, skills from `reloadSkills()`. **D62** The probe (empty inbox, hooks disabled, 20 s bound). **D63** Cache in memory + `<stateDir>/catalog.json`, 24 h. **D64** Status cases (missing binary, refused, signed out, version mismatch). **D65** One `permissions` axis, `auto` only when a model supports it. **D66** Failures are values.

### Live session (D70–D78) — [`lanes/D.md`](lanes/D.md)

- **D70** The transcript cut is tracked from frames.
- **D71** A run starts at dispatch or on `running`, ends on `idle` (or the process ending, or a Stop that cancelled an unstarted send).
- **D72** A steer is a queue item until the CLI starts it. **D73** The queue is the adapter's, one item per run. **D74** Stop = `interrupt({cancelQueued})`, a 5 s deadline, and a second Stop when the first beat the message; what was queued comes back as `input_returned`. **D75** Run outcome rules. **D77** `/clear` re-keys the host as `session_replaced`. **D78** Model, thinking and mode.

### Asks (D80–D89) — [`lanes/e.md`](lanes/e.md)

- **D80** One ask per CLI request id; an answered one is replayed. **D81** Permission options (allow once, session, always per destination, deny once, deny and stop); payloads stay in the desk.
- **D82** A request the contract cannot hold, a URL elicitation included, is raised as a decline-or-dismiss `confirm`, never answered for the person. **D83** Field order is the schema's key order. **D84** Plan approval with `modeOptions` from the host. **D86** Failures keep the ask raised; nothing returns `null`. **D87** CLI and MCP text stripped of ANSI/bidi. **D88** `requiresUserInteraction` read with an `in` check. **D89** Stop the run = deny with `interrupt` and the host's abort.

### Terminal (D100–D109) — [`lanes/g.md`](lanes/g.md)

- **D100** The tail: one watcher per project directory, positional reads, bounded lines. **D101** What is translated; block ids by `apiBlockIndex` (equal live, in history and in the tail: `integration/ids_three_ways.test.ts`). **D102** Run ends, with a quiet rule for SDK-written sessions. **D103** Opening mid-turn. **D104** `writing(id)` (ignoring the bridge's own writes, D122).
- **D105** The hook in the user's settings (never creates `allowedHttpHookUrls`, D123). **D106** The certificate blocker (fixed by D124). **D107** The receiver, no timer. **D108** The ask on the phone (allow once, deny, deny and stop). **D109** `claudeCode.terminalAsks`.

## Integration decisions

### D121. One trash

`trash.ts` is the one move-to-trash, with `trashTargetOf(env, now)`; a session delete uses it. **Unverified:** macOS protects `~/.Trash` from processes without Full Disk Access in some setups; a refused `rename` is a `backend_error` that says so (D138) and the file stays.

### D122. A file this bridge wrote last is not a terminal writing it

After a restart the reopened session took the terminal's watch-only path (its file was written seconds ago by the bridge's own, now killed, CLI) and showed a run no process would finish. `Ownership.noteOwnWrite(id, at)` / `ownWriteAt(id)` (journal line `{k:"r"}`) record when a host ends, a rename appends its title and a fork writes its file; `writing(id)` ignores a file last written at or before that time plus `OWN_FLUSH_MS` (1 s, the CLI's batched flush). Proven by conformance rule 27 (sessions survive a restart and runs end with it), `terminal/released.test.ts` and `integration/own_writes.test.ts`.

### D123. The terminal hook never creates `allowedHttpHookUrls`

`sdk.d.ts:7647`: "When set, HTTP hooks with non-matching URLs are blocked. If undefined, all URLs are allowed. If empty array, no HTTP hooks are allowed. Arrays merge across settings sources". So the installer appends our URL only to a non-empty list the user keeps, refuses an empty one (the user forbids HTTP hooks), and removes a list that holds only our URL. A list set by project or managed settings without our URL still blocks the hook (it fails open to the terminal's own prompt); D136 tells it.

### D124. The loopback certificate names 127.0.0.1 and is no CA; the CLI trusts it by `NODE_EXTRA_CA_CERTS`

`platform.ts` generates `-addext subjectAltName=IP:127.0.0.1,DNS:localhost -addext basicConstraints=critical,CA:FALSE`, and `ensureTlsMaterial` regenerates a certificate that lacks the name or is a CA (`tls-loopback.ts`, `tls_loopback_name.test.ts`). The hook installer writes `env.NODE_EXTRA_CA_CERTS = ~/.broski/tls/server.cert.pem` into the user's Claude settings and refuses when the user already names another file there. **Trade-off:** every `claude` the user runs trusts this one certificate for `127.0.0.1`/`localhost`; being no CA, it cannot vouch for any other host, and its key is the user's own `0600` file. The settings edit is strict JSON, atomic and key-preserving (D139). The file then holds the loopback bearer token in the hook's header: a settings file the installer creates is `0600`; an existing one keeps the mode the user gave it (never a silent chmod), so a `0644` file or one kept in a dotfiles repository exposes the token to whoever can read it.

### D125. A person's "no" is sent in the CLI's own words

`ui/denial.ts` builds a denial from `HUMAN_DENIAL_PREFIX` exactly as the 2.1.316 binary words its own; a tool permission's deny, a cancel, a plan rejection and the terminal hook's deny use it. A denial reads `denied` live and in history (`integration/denial.test.ts`) and in the terminal CLI's tool result (`hook_cli.test.ts`).

### D126. A terminal session asked about before its first flush is waited for

A terminal's hook ask can arrive before the CLI wrote the session's first lines (about 100 ms late, D103): `open-session.ts` looks for a session a terminal is writing for up to `FIRST_FLUSH_MS` (3 s) before `not_found`.

### D128. `externalLive` stays false

Conformance rule 26 opens a **new** session (hosted by this bridge) and expects another client's run on that same open. A hosted session follows only its own process (one writer per file); the terminal tail shows another process's run on a **watch-only** open (`terminal/watch_live_cli.test.ts`), which is not what the rule opens.

### D129. The conformance world runs the real path

The watched-ask rule goes through a real second `claude` process whose Write asks, the installed `PermissionRequest` hook over TLS, the server's own receiver and the adapter's handler (`conformance/terminal-asks.ts`). `delivered()` reads the last `user`-role message (CLI 2.1.316 puts a `system` "# Environment" message after the first one), and `arrange` replaces a session's unconsumed script (a Stop that beat its message leaves the scenario unread, D74).

## Hardening decisions

- **D130 · One sanitiser for what the phone shows.** `phone-text.ts` strips terminal escapes (CSI, OSC, two-character), C0 and C1 controls but tab, newline and carriage return, and the invisible direction characters of UAX #9; every ask title, body, option label and preview, every tool title, tool output and notice goes through it, on the hosted and the terminal path alike. A user's own prompt and the model's text are content and are not touched.
- **D131 · A title's source is read where the SDK read it.** The SDK folds the AI title into `customTitle` (`sdk.mjs` `ml`), so `store/title-source.ts` looks at the same 64 KiB head and tail and the `<session>/custom-title.json` sidecar, cached by size and mtime: a `customTitle` key or the sidecar is `user`; a `customTitle` the SDK took from `aiTitle` is `generated`; with neither, `first_prompt` only when the shown text is the first prompt, else `generated`.
- **D132 · No bypass flag as root.** The 2.1.316 binary exits 1 (`startup_failure_reason: "bypass_root"`) when `allowDangerouslySkipPermissions` or the mode meets uid 0 without `IS_SANDBOX=1` or `CLAUDE_CODE_BUBBLEWRAP`. `process/bypass.ts` passes the flag only outside that case, and the permissions axis then leaves `bypassPermissions` out. The CLI's env carries `CLAUDE_CODE_STARTUP_FAILURE_RESULTS=1`, so any startup refusal reaches the run outcome typed, in words (`models/startup-failures.ts`).
- **D133 · A live refusal is read from `tool_result_meta`.** The binary's schema (`@internal`, absent from `sdk.d.ts`): `[{id, non_execution_kind?, permission_decision?: {decision: "accept"|"reject"|"cancelled", source}}]`; `reject` makes a failed call `denied` (`mapping/result-meta.ts`), whatever the person wrote; history, which has no such field, keeps reading the wording.
- **D134 · The context figure after each run.** After `run_finished`, if the host's process is still live, one `getContextUsage({detail: "summary"})`, sent as `usage_updated` over the snapshot's usage: `contextTokens = totalTokens`, `contextWindow = maxTokens` (the window the CLI's `/context` divides by). Never awaited by the run's end. A failure is logged to stderr and sends nothing, unless the process asked has ended or been told to close meanwhile: the SDK rejects every pending control request when its query closes (`sdk.mjs`, `Query closed before response received`), which is how a session that ends right after a run answers, not a fault (`live/context-after-run.ts`).
- **D135 · Models in the CLI's order, the Default row first, no model twice.** A row whose wire id (`resolvedModel`) equals the Default row's is left out: offline the CLI lists `default, opus, fable, sonnet, haiku` with `default` and `opus` both `claude-opus-5-5`, so the phone shows `default, fable, sonnet, haiku`. Rule 19 (models and thinking can be set) passes on the real CLI; `conformance/model-echo.ts` maps a wire id over the listed rows.
- **D136 · A URL list that blocks the terminal hook is told, never edited.** `allowedHttpHookUrls` merges across sources; when the merged list leaves our hook's URL out (`terminal/allowed-urls.ts` reads a pattern as the binary does), `status()` carries a warning naming the sources that keep a list.
- **D137 · An ending host counts as hosted until its own last write is noted.** `finish()` forgets the host at once but notes the bridge's own write (D122) only after its process ended, up to 2.5 s later; the registry keeps it in `ending` until then, so a terminal check does not take an open in that window for a terminal writing the file.
- **D138 · A trash move macOS refuses says why.** EPERM or EACCES on darwin (a service without Full Disk Access) is a `backend_error` naming Full Disk Access; the file stays.
- **D139 · Every edit of a user's file is strict.** In `files/` and the hook installer: a file that does not parse is refused and left byte for byte; one past 4 MiB is refused unread; one whose rewrite would change data (a key written twice, a number a double cannot hold: `files/json-round-trip.ts`) is refused as `invalid_input`; the write is temp-then-rename with the file's mode kept, compare-and-swap on the text read; a file we create holding the hook token is `0600`.
- **D140 · The loopback listener never idles out a request.** `server/loopback-listener.ts` sets `idleTimeout: 0`: Bun's 10 s default reset the real CLI's held hook request (`hook_cli.test.ts` fails without it). The listener is loopback-only.
- **D141 · `broski uninstall` takes the hook out.** After the service is removed, `removeClaudeCodeTerminalHook` takes our `PermissionRequest` hook and its certificate setting out of the user's Claude settings; a bridge started with `claudeCode.terminalAsks` off removes them at start. Left behind: a bridge binary deleted without `broski uninstall` leaves the hook pointing at a dead port; the CLI's behaviour against a refused hook URL is not verified.
- **D142 · A compiled bridge given a config dir refuses, it does not crash.** The SDK worker (D36) is not a compile entry point, so `createClaudeSdk` in a `/$bunfs/` binary with `configDir` set answers every session read with a rejection that says why.
- **D143 · A worktree's sessions are the worktree's.** Conformance rule 5 makes each row's `cwd` the asked cwd, so a session started in a git worktree lists under the worktree, not under its repository, although the SDK's `listSessions({dir})` would include worktrees (`store/list.test.ts`).
- **D144 · Costs a user does not see.** `agentProgressSummaries` stays on: the CLI forks a running subagent's conversation about every 30 s for a summary, a small billed call that reuses the prompt cache (`sdk.d.ts:2135-2143`). A probe starts the user's MCP servers (settings are not narrowed; only hooks are off).

## Corrections to the research

- `listSessions` breaks a `lastModified` tie by the **greater** `sessionId` first (`sdk.mjs:117` `zwe`, `$we`; `src/__tests__/claude-code/foundation/session_order.test.ts`), not ascending as research 04 §3 and PLAN fact 15 say.
- Findings that correct the plan or the research (details in the part notes): a schema-invalid settings file is skipped whole; an aborted tool shows only in its result's text; a failed tool's `tool_use_result` is a string; no `user` echo of host sends; `system/init` comes only with a turn; a probe runs `SessionStart` hooks unless disabled; the terminal prompt and the hook race; `turn_duration` is written by the REPL only; the SDK already drops in-flight duplicate asks; nested forms never reach `onElicitation`.

## Known gaps

- A project or managed URL list that leaves our hook out still blocks it; it is told (D136).
- Unverified against a real API (no offline recording): the `auto` compaction trigger and `result.usage.iterations` (the context figure comes from D134), an `ORG_POLICY_LIMIT_PREFIXES` refusal, a real terminal REPL's `turn_duration` and dialog, macOS Trash permissions for a service (D121), a root-run bridge (D132, read in the binary, not run).
- A watch-only (terminal) session shows asks only when the hook raised them; without the hook it is watch-only with no answers.
- `externalLive` is false (D128), so a terminal's run shows only on the watch-only open.
