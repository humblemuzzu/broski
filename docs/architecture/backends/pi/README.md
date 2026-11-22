# The Pi adapter

`packages/bridge/src/backends/pi/` speaks the backend contract ([contract README](../../contract/README.md)) for Pi. It
runs the user's own installed `pi`: one `pi --mode rpc` per hosted session, kept by a holder process that outlives the
bridge (§1.1), plus short-lived `pi --mode rpc --no-session` probes for the catalogs. It bundles no Pi and imports no Pi package; the contract README
cites this file as `pi §n`, and the sections below keep that numbering.

Every Pi fact here was checked against Pi 1.6.0 (`@earendil-works/pi-coding-agent`, the devDependency the tests run),
by its docs and `dist/`, or by an experiment with `PI_CODING_AGENT_DIR` on a temp dir. Paths are relative to that
package.

## Run it

```bash
cd packages/bridge
bun test src/__tests__/pi        # every Pi test, against the real `pi` and a scripted model endpoint
bun test src/__tests__/pi/conformance.test.ts
```

The bridge finds `pi` from the config key `pi.cliPath`, else `pi` on the login shell's `PATH`
(`server/pi-cli-path.ts`). `broski-bridge doctor` reports it and its version.

## Layout

| Directory | What lives there |
|---|---|
| `rpc/` | The wire: `JsonlSplitter` (LF-only records, CR stripped, 32 MiB cap), zod frames for responses, events and UI requests, `RpcClient` (request ids, deadlines, ordered delivery, backpressure), `PiProcess` (spawn in its own process group, stderr tail, the stop ladder). |
| `holder/` | The holder of a hosted session's `pi` (§1.1): the process itself (`holder.ts`, `main.ts`), what it keeps for the next bridge (`replay-log.ts`), how long it keeps an unattached `pi` (`orphan-policy.ts`), the socket protocol (`protocol.ts`) and the bridge's end of it (`link.ts`, `holders.ts`). The holder process loads only `node:` built-ins, `rpc/child.ts`, `rpc/jsonl.ts` and `contract/clip.ts`. |
| `live/` | A hosted session: `SessionHost` driving the parts `host-parts.ts` wires (a `PiChild`, the run tracker, prompt desk, queue mirror, settings, usage feed, the event bridge, the entry cursor), and `SessionHosts` (the registry with its locks, revive, idle end and the bound on hosts). |
| `host/` | The bridge's own extension (`extension/{index,ask}.ts`), written into `~/.broski/pi/` and loaded with `-e`: the permission gate, the fallback `broski_ask` tool (registered `defaultActive: false`, additively enabled in new phone sessions unless a cooperating extension claims `broski:ask-tool`/`broski:probe-ask-tool`) and the `broski.*` records. `extension/` is agent code, read by the rest of the adapter only as text. |
| `ui/` | Extension dialogs as interactions (`dialogs.ts`, `interactions.ts`) and permission asks (`permission-asks.ts`, `permission-request.ts`). |
| `mapping/` | Pi's messages and events as contract events and transcript items. |
| `models/`, `catalog/` | The catalogs a probe reads (`get_state`, `get_available_models`, `get_commands`), cached per directory. |
| `store/` | Session files read and written by the bridge itself: listing, transcripts, rename, fork, delete, the watch. |
| `terminal/` | The terminal link: an extension Pi loads in the user's terminal `pi`, and the socket it reports to. |

`scripts/contract-gen/layers.ts` enforces that no file but `host/extension/` imports a Pi package, that the extension
imports only Pi's packages, `node:` built-ins and itself, and that everything else reads it with
`with { type: "text" }`.

## 1. Hosting

- **One process per hosted session**: `pi --mode rpc --session <file> -e <host extension>` in the session's cwd, with
  the bridge's login-shell environment and `PI_OFFLINE=1` unless the user set it (`pi-install.ts`, `childEnv`).
  Without it Pi runs `npm install` for a configured package that is missing, under a phone's request (proven by
  `host_hosting.test.ts`).
- **Handshake**: `get_state`. Pi answers its first command only after every extension's `session_start` returned. A v1
  file has no entry ids and Pi mints random ones when it migrates the file, so the host starts with no last entry and
  asks `get_entries` once for Pi's (`host_hosting.test.ts`); the store's positional ids (§3) serve reads only.
- **A dialog asked in `session_start` fails the open.** Pi binds extensions before it attaches its stdin reader
  (`dist/modes/rpc/rpc-mode.js:305` against `:669`), so that dialog can never be answered; the host refuses the open
  with the dialog's title instead of waiting for the start deadline (20 s).
- **Stop ladder** (`rpc/child.ts`): stdin EOF, 1.5 s; SIGTERM to the process group, 0.75 s; SIGKILL, 0.25 s. Pi runs
  `session_shutdown` on EOF; one SIGTERM during that shutdown does not interrupt it (`docs/rpc.md:93-97`). Why these
  waits, from Pi 1.5.2 (`docs/rpc.md` "Shutdown", changelog 1.5.1): a healthy `pi` is gone in a few hundred ms. Session
  files cannot be cut by any timing, since Pi appends them synchronously (`dist/core/session-manager.js:813`). What a
  SIGKILL can cut is Pi's wait for an OAuth refresh in flight to be saved (`dist/core/agent-session-runtime.js:309-318`,
  #11692), which loses the rotated token; a refresh normally takes well under a second, and hosted children run with
  `PI_OFFLINE=1`, so none starts by itself. The ladder is no longer because a host's settle wait plus the ladder must
  fit the bridge's 5 s teardown (`host_hooks.test.ts`), after which a `pi` stuck in its shutdown would outlive the bridge
  with nobody to kill it; waiting out the refresh's 30 s timeout (`pi-ai` `dist/auth/oauth/anthropic.js:77`) is not
  possible there. A refresh in flight when the ladder runs out can still lose its token: an accepted residual risk.
- **Measured** (5 starts, no extensions, M-series Mac): `get_state` answered 124–141 ms after spawn; RSS about 110 MB
  per `pi`.
- **New sessions** are written by the bridge before `pi` starts (header and `broski.origin`), because Pi writes no
  file until the first message. The model and thinking level a phone chose are set after the handshake with
  `set_model` / `set_thinking_level`, which do not change Pi's saved defaults (`rpc-mode.js:387-413`).
- **The phone's note never changes a session's system prompt**: a changed one makes the provider read the whole cached
  conversation again. A session the phone starts gets the note (`server/phone-writing.ts`) as the `broski_phone` section
  and keeps it as recorded, even after the config drops it; the phone's fork of a session begun elsewhere gets it once
  as a hidden `broski.phone_note` message after the prompt (`host/extension/`); and a terminal `pi` that goes on with a
  session the phone began keeps the recorded section through the link extension (`terminal/extension/phone-note.ts`).
  Proven by `live_phone_writing.test.ts`.
- **Idle and keep-open**: a host with no view, run, ask, compaction, retry or queued input ends; one that exits on its
  own is revived when a phone acts in its view again (`session-view.ts`); a view of a deleted session answers
  `closed`.
- **At most 8 hosts** (`MAX_HOSTED_SESSIONS`, `live/host-capacity.ts`): before a `pi` starts, the least recently used
  host with nothing in flight ends, even with a view attached. That view keeps showing what it showed, which an idle
  host had nothing to add to, and its next action starts a new host through the revive path and sends `resynced`
  with the new host's snapshot. A host with work in flight is never ended; when all are, the open or the revive is
  refused `busy`. A host whose session has work queued on its lock is skipped, so ending a host never waits on a lock
  while holding another (`host_capacity.test.ts`). Catalog probes are short-lived and not counted. Hosts taken over
  from holders at start (§1.1) make no room: they run already, and count against the bound from then on.

### 1.1 Holders: a run outlives the bridge

`pi --mode rpc` ends its run when its stdin closes, and a bridge's death closes it: the daemon restarts a bridge with
SIGKILL (`packages/link/daemon/src/supervisor.rs`), so no graceful shutdown runs. So a hosted `pi` is never the
bridge's child. `startHost` starts a holder, the bridge binary again with `__pi-holder <dir>` (`src/index.ts`,
`src/bootstrap.ts`; from source `bun <entry> __pi-holder`, `server/pi-holder-command.ts`), detached into a session of
its own, stdio ignored but for stdin, over which the bridge writes the launch spec once (the `pi` path, args, cwd and
environment, which holds secrets: never argv, never a file) and closes it. The holder runs with `PATH`, `HOME`,
`TMPDIR` and `LANG` alone.

- **Its directory** is `~/.broski/pi-hosts/<12 hex of sha256(session id)>/` (`0700`): `sock` (`0600`, short because
  a unix socket path is at most 103 bytes on macOS) and `holder.json` (`holderVersion`, `pid`, `piPid`, `sessionId`,
  `file`, `cwd`, `startedAt`, `extension`, the bridge extension's hash). The holder listens, writes `holder.json`,
  then starts `pi` as `PiProcess` does (its own process group), and removes the directory when it ends. The bridge
  never signals a pid it reads there: a directory nothing answers in is removed, nothing more.
- **The protocol** is JSON lines. Pi's records pass through as Pi wrote them; the holder's start with `{"holder":`:
  `hello` (`version`, `sessionId`, `extension`, `replayed`, `truncated`), then the replay, then `live`, then Pi's
  records as they come; `exit` (`code`, `signal`, `error`, `stderr`) when `pi` ends; `replaced` to a bridge another
  one displaced (one bridge at a time, the newest wins); `oversized` for a record past the 32 MiB cap. From the bridge,
  complete lines go to `pi`'s stdin through one writer queue; a half line from a bridge that went is dropped, so the
  next bridge's first command is not glued to it; `{"holder":"stop"}` answers every dialog still open with Pi's
  default (`cancelled`, as a bridge's own stop does) and runs the stop ladder (§1) in the holder. A socket
  that closes without `exit`, or `replaced`, is this bridge losing the session, not `pi` ending. `replaced`: another
  bridge took it, and what this one showed ends. A socket that closed: the host shows what it showed, run and asks
  included, emits nothing, answers `busy` ("reconnecting"), and still counts as busy, so the core keeps the session
  open and a terminal is warned; the bridge takes the holder over again (`live/reattach.ts`: at once, then after 0.5,
  1, 2 and 4 s, each attempt under the session lock and no wait under it), the view moves to the new host with
  `resynced`, and no run ends. When no holder answers any more the run ends `backend_unavailable` ("Pi stopped while
  the bridge was reconnecting to it"); when the attempts run out it ends saying the run may still be going on, and
  the next action takes the holder over. A takeover that fails lets the holder go: it never stops its `pi`.
- **`pi` is never made to wait.** The holder reads its stdout without pause (`holder/backlog.ts`). A backlog alone is
  no stall: one tool's progress record may be as large as the 32 MiB cap (a subagent tool that reports its whole
  conversation sends tens of MB each time), and a burst of them outruns any reader for a moment. A bridge is dropped
  when its backlog, beyond what is left of its replay, stays past 32 MiB for 5 s without the socket draining, or passes
  128 MiB at all; it then takes the session over again with a replay.
- **The bridge's reading** (`rpc/client.ts`): a tool's progress that a later one of the same call supersedes before it
  is delivered is dropped (the adapter reads each as the whole output so far, `output_replaced`, as the replay does).
  Past 16 MiB waiting for delivery the transport is paused, but never while a lookup is pending: a delivery awaits
  `get_entries` for the entry a message was stored as, and its answer comes behind what is already sent. A replayed
  message the file already held is matched from the seeded entries without asking Pi.
- **The replay** (`replay-log.ts`) is every record since the session was last at rest, without `response`s (they answer
  the dead bridge's commands). At `agent_settled`, with no compaction or retry open, it starts over keeping only the
  dialogs nobody answered whose own `timeout` has not run out (a permission ask goes, Pi dropped it with its run's
  signal, §8.4) and the last `setStatus` per key. A replayed dialog's `timeout` is what is left of it. Past 64 MiB the
  deltas of messages and outputs of tools that have ended, and outputs a later one replaces, go first; if the rest is
  still too much the replay is `truncated` to its asks and statuses until the next rest.
- **Unattached** (`orphan-policy.ts`), a holder keeps an idle `pi` 10 minutes (from when it went idle), a running one
  4 hours, one asking a human 24 hours, then stops it, which persists the run in the session file as any stop does. It
  also stops `pi` when its directory is gone, and on SIGTERM, SIGINT or SIGHUP. A holder killed outright closes `pi`'s
  stdin, which ends it.
- **Taking over** (`SessionHosts`): at start the bridge scans `pi-hosts` (`adopting`); every open, revive, list and read
  waits for it, and an open first asks for a holder of its session under the session lock, so no second `pi` ever
  starts on a file a holder runs. Each holder is taken over under its session's lock, the host built as for a stored
  session (`store.locate`, `facts`) plus the file's entries since its last user message, which the replayed messages
  are matched to (`EntryCursor`'s seed), and the `broski.prompt` records, so the replayed user message carries its
  `clientRequestId`. The replay runs through the ordinary `RpcClient`/`EventBridge` path with nothing written twice (no
  record, usage pull, title or notice), the run under way becomes a new run (trigger `system`) with its tool calls and
  asks (re-raised with Pi's own dialog id), then the usual handshake, then the host is ready and announced. A truncated
  replay starts no run and says so in a notice; the next event starts one. A holder of another protocol version, or
  whose `holder.json` cannot be read, is stopped; one whose `pi` runs another version of the bridge's extension is
  taken over and ends once idle (`retiring`). A run that ended with no bridge is taken over idle, and its `pi` ends.
- **Shutdown**: an idle host stops its `pi` as before; a host with work under way is let go, its holder keeping it.
  `broski stop` and `broski uninstall` stop every holder (`holders.ts`, `stopHolders`); `broski restart` spares them.
- **Supervisors**: launchd kills a job's process group, which a holder has left.

## 2. Status

`status.ts`: `pi` found or not (with the fix), `pi --version` (cached by the file's stamp; a warning below 1.5.1, the
release with the RPC shutdown fix and `agent_settled.aborted`), and whether the agent dir's catalog has a model.
`pi --version` loads no extension (experiment).

## 3. Sessions and listing

Session files are Pi's JSONL (`docs/session-format.md`), read by `store/` without Pi: listing by header cwd, titles,
paging by keyset cursor, the watch, and v1/v2 files migrated in memory as `session-manager.js:30-85` does (a v1
compaction's `firstKeptEntryIndex` becomes `firstKeptEntryId` and is dropped). Rename appends a `session_info` line;
fork writes a new v3 file; delete goes through `trash`.

## 4. Transcript

Read from the file, newest first; a hosted run cuts the transcript at the entry it started after. A user message's
`clientRequestId` and image names come from the `broski.prompt` record that names its entry id; a denied or aborted
tool result from `broski.tool_outcome`.

## 5. Live events

`message_update` carries no `partial` over RPC; `toolcall_start` names its call (`docs/json.md:72-93`). Message ids
are minted by the adapter. A run starts on `agent_start` or a `started` prompt, and ends only on `agent_settled`
(`aborted` decides aborted). Usage is pulled with `get_session_stats` after each assistant message, before a run's and
a compaction run's end, as a session opens, and when Pi's built-in idle cache warmer appends a `usage` entry
(`entry_appended`). `Usage.cache` reads the model's `promptCache` (`short` / `long` with `cacheWrite1h`, falling back
to Anthropic 5m/1h only on `provider === "anthropic"` without `promptCache`), labelling explicit writes `exact` and
read-only refreshes `estimated`. Oversized (>32 MiB) `agent_end` dumps are dropped silently in both `rpc/client.ts`
and `holder/holder.ts`. An extension's `sendMessage` with no turn starts no run.

## 6. Input

Every mode is a `prompt` with `streamingBehavior` (`steer` / `followUp`) when a run is active (`docs/rpc-commands.md:7-42`).
Pi answers once it has decided: `started`, `queued` or `handled`. Text is sent as typed, so text that names an extension
command runs it and a template expands (`docs/rpc-commands.md:31-33`). A prompt sent while Pi runs a run's
`agent_settled` handlers is answered after the settle and starts its own run; the bridge reports `busy` for a `start`
until `run_finished`. No deadline ends a `prompt`: an extension's `input` handler or command may wait on a human
for as long as the human takes, so only Pi's answer or its exit does. The phone is answered at the run's start (§8) or
by the core's own 120 s deadline, which leaves the prompt with Pi (`ask_deadlines.test.ts`).

## 7. Control

Stop: the run's asks are withdrawn, `clear_queue` hands queued input back (`input_returned`), then `abort`. Pi answers
`abort` only once the run stopped; an `input` dialog with no signal holds it until cancelled (experiment), which the
withdrawal does. Past the 10 s deadline the abort is still accepted and the run ends when Pi settles it. Compaction:
`compact`, refused while a run is active; its run ends after its usage is shown.

## 8. Interactions

### 8.1 What asks

Extension dialogs (`select`, `confirm`, `input`, `editor`; `notify` is a notice) and the bridge's permission gate.
`setStatus` under the bridge's own `broski:tasks` key carries the background tasks extensions announce; other
statuses, `setWidget`, `setTitle` and `set_editor_text` draw on a terminal's screen and are ignored. A displayed
extension message (`sendMessage`) is an `activity`, live and from the session file: as its `details.broski` hint
says, else its `customType` over its text (`mapping/custom-activity.ts`, [extension-hints.md](extension-hints.md)).

### 8.2 Requests

`extension_ui_request` frames (`docs/rpc-extension-ui.md`), validated in `rpc/frames.ts`.

### 8.3 Answers

`extension_ui_response` with `value`, `confirmed` or `cancelled`. A cancel gives the extension Pi's default.

### 8.4 Timeouts and cancellation

A dialog's own `timeout` is resolved by Pi; the interaction carries `expiresAt` and is withdrawn at it. A dialog whose
own signal ends it is resolved by Pi with no message to the client (`rpc-mode.js:51-82`), so the bridge cannot tell
which of an extension's dialogs that befell. The permission ask is bound to its tool call's signal (`ctx.signal`): it is
withdrawn when its run ends, and one the gate raises once the run's abort has begun (a second parallel call, preflighted
while `clear_queue` is in flight) ends at once with Pi's default, which blocks the call; left alone it would outlive
`run_finished` as an ask nothing can answer (`live_permissions.test.ts`). Any other dialog still pending when its run
ends is raised again on its own and only a human ends it. Shutdown expires every ask; a dialog asked from a
`session_shutdown` handler after stdin closed can never be answered, and Pi exits once its event loop is empty
(`rpc-mode.js:597-610, 666-669`, experiment).

### 8.5 Re-delivery

Asks are the bridge's own: one pending when a view closes is in the next open's snapshot. One pending when the bridge
dies is kept by the holder (§1.1) and raised again by the next bridge, a new interaction with the same request and the
time its dialog has left, answered to Pi under Pi's own id; one answered before is not raised again. Asks expire when
`pi` exits.

### 8.6 The permission gate

`host/extension/index.ts` handles `tool_call` when the session's mode is `ask`: it asks with `ctx.ui.input` whose title
is `broski-permission:` + the call as JSON, passing `ctx.signal`, and the bridge answers with a verdict as JSON
(`allow`, `allow_session`, `deny` with a message). An edited input is checked with pi-ai's `validateToolArguments`; one
it refuses is asked again with the problem. Permissions live in the last `broski.permissions` entry, read at
`session_start` and appended by the bridge through the extension's `broski-host` command. `broski_ask` (`host/extension/ask.ts`,
registered with `defaultActive: false` and additively enabled in new phone sessions unless a cooperating extension claims
`broski:ask-tool`/`broski:probe-ask-tool`) is exempt from the permission gate. The extension also cancels
`session_before_switch` and `session_before_fork`, so the `pi` stays on the session the bridge opened.

## 9. Catalogs

`probeCatalog` runs `pi --mode rpc --no-session` in the directory: `get_state`, `get_available_models`,
`get_commands`; fire-and-forget UI frames are ignored and a blocking startup dialog fails the probe at once naming it
(since Pi does not read stdin before `session_start` finishes). A listing with a hosted session in that directory asks that `pi` instead. The cache
holds a read for 30 s while the stamps of Pi's sources (auth, models, settings, trust, extensions, prompts, skills, the
project's `.pi`) are unchanged, stamped once the probe is done: a first `pi` start writes an empty `auth.json` and
`models-store.json` (experiment). RPC lists only models Pi can run, so `includeUnavailable` adds nothing. A `pi` with no model reports a placeholder
(id, provider and api all `unknown`) as `get_state`'s model; `selectedModel` reads it as none, so a session shows no model
and `setThinking`, `compact` and a prompt (which Pi refuses as "No API key found for the selected model") answer
`no_model` (`live_no_model.test.ts`).

## 10. Reconnect

A view reopens on the host's snapshot; a host whose `pi` exited is revived on the next action. After a bridge restart
the session's holder is taken over (§1.1): the run under way is in the reopened snapshot under a new `RunId`
(conformance `runsSurviveRestart`, contract README §5 rule 11).

## 11. External sessions

A session another client wrote opens watch-only. A terminal `pi` runs the Broski link extension, installed in the
agent dir, which reports over a unix socket with a key file ([terminal-link.md](terminal-link.md)); it does nothing
outside the interactive terminal (`ctx.mode`), so the bridge's own `pi` links nothing. What the terminal asks reaches
the phone too: the extension wraps Pi's shared `ctx.ui` (`select`, `confirm`, `input`) and listens on
`broski:questions` in TUI mode ([extension-hints.md](extension-hints.md)), the bridge raises each as an ask (`terminal/dialogs.ts`),
and the first answer, the terminal's or the phone's, closes the other. When resuming a phone-started session whose
branch recorded `broski_ask`, `terminal/extension/ask.ts` registers and activates `broski_ask` lazily in TUI mode with
exact schema parity, racing terminal select/multi-select/input against the phone card.

## 12. Capabilities

`traits.ts`: text and thinking streams, start/steer/queue, images, commands, the queue, `tool_permission`,
`questions` (`broski:questions`), `choice`, `confirm`, `text`, thinking, children, usage, `externalLive`; no plan proposals, no `cancelQueued` (RPC has only
`clear_queue`). Every one passes `runConformance` against the real `pi`.

## 13. Mapping

`mapping/`: stream blocks keyed by content index, tool calls by provider id per response, results with file changes
for `edit` and `write`, compaction and retry events, error classes (excluding Bedrock `Throttling error:` and
`Service unavailable:` from overflow), `adapter-kit/phone-text` sanitization on dialogs and questions (mapping cleaned
option labels back to original labels), and usage + `CacheWindow` from Pi's totals and per-model `promptCache`.

## 14. Facts relied on, and where they come from

| Fact | Source |
|---|---|
| LF-delimited JSON records; responses carry the request id | `docs/rpc.md` |
| `prompt` answers after its preflight with a disposition; extension commands run at once | `docs/rpc-commands.md:7-42` |
| `streamingBehavior` is required while streaming | `docs/rpc-commands.md:20-27` |
| `get_entries` with `since` | `docs/rpc-commands.md:689-717` |
| stdin EOF is an orderly shutdown; a second signal exits | `docs/rpc.md:93-97` |
| extensions bound before stdin is read | `dist/modes/rpc/rpc-mode.js:305, 669`; experiment |
| dialog timeout and signal resolved by Pi, client not told | `dist/modes/rpc/rpc-mode.js:51-82` |
| `set_model` / `set_thinking_level` do not persist | `dist/modes/rpc/rpc-mode.js:387-413` |
| `PI_OFFLINE` stops package installs and catalog refreshes | `docs/environment-variables.md:84`; `host_hosting.test.ts` |
| an extension that fails to load ends `pi` with the reason on stderr | `start_reports.test.ts` |
| the provider gets the session id when the model asks for affinity | `@earendil-works/pi-ai` `dist/api/openai-completions.js:516-541` |
| retryable provider errors | `@earendil-works/pi-ai` `dist/utils/retry.js:208-215` |
| supported thinking levels | `@earendil-works/pi-ai` `dist/models.js:701-713` |
| a `pi` with no model holds the "unknown" placeholder model | `@earendil-works/pi-agent-core` `dist/agent.js:18-29`; `dist/core/auth-guidance.js:3,17-19`; experiment |

## 15. Deviations from the SDK adapter

- A `session_start` dialog fails the open (§1).
- A permission ask is withdrawn when its run ends; any other dialog Pi ended by its own signal waits for a human, raised again on its own (§8.4).
- Typed text that names a command runs it (§6).
- A prompt during Pi's settle is `busy` (§6).
- Start problems are reported only when they end `pi` (an extension that fails to load); a missing package or an
  untrusted project's skipped resources are not reported.
- No unavailable models are listed (§9).
- An extension command's dialog is taken to be the command's while the command runs, even with a run active; RPC
  gives a dialog no origin.

## 16. Tests

A world (`__tests__/pi/helpers/pi-world.ts`) is a temp home and agent dir, a scripted OpenAI-compatible endpoint
(`__tests__/helpers/scripted-openai-server.ts`) registered in `models.json` with session affinity, so each session's
requests are routed to its own script (`pi-router.ts`), a driver extension that waits on the endpoint's gates and
reports in notes, and the real backend running the devDependency's `pi` behind a shim that logs each start (for the
process-leak checks). `conformance.test.ts` runs `runConformance`; the `live_*`, `host_*`, `gate`, `catalog` and
`terminal_*` files cover the rest at the same seam; `mapping_*` and `store_*` feed Pi-shaped values through the
adapter's own frame schemas. `holder_*` run the holder over a real socket against a stand-in `pi`
(`helpers/fake-pi.ts`); `host_restart` kills a bridge running in a process of its own (`helpers/bridge-process.ts`)
with SIGKILL and has the next one take its sessions over.

## 17. Risks and open questions

- A holder is a second Bun process per hosted session: about 30 MB resident beside `pi`'s 160 MB (measured on the
  compiled binary, macOS arm64). It runs the code of the bridge that started it, so after an upgrade old holders speak
  the old protocol: one of another `HOLDER_VERSION` is stopped, one whose `pi` runs an older bridge extension retires
  when idle.
- launchd is relied on to kill only the job's process group, which a holder leaves with `setsid`; this was reasoned
  from launchd's documented `AbandonProcessGroup` behaviour, not tried against a live LaunchAgent.
- About 110 MB per hosted session, so 8 hosts are about 0.9 GB; with every host busy a ninth session cannot be opened
  until one finishes (§1). The bound is a constant: a machine that wants more hosts needs a change here.
- A Pi release that changes an RPC shape fails the frame schemas, which reports a fault instead of guessing.
- The permission gate rides on `ctx.ui.input`; a Pi that changes how `input` titles reach RPC breaks it.
