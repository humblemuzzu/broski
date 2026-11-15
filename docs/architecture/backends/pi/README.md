# The Pi adapter

`packages/bridge/src/backends/pi/` speaks the backend contract ([contract README](../../contract/README.md)) for Pi. It
runs the user's own installed `pi`: one `pi --mode rpc` child per hosted session, plus short-lived
`pi --mode rpc --no-session` probes for the catalogs. It bundles no Pi and imports no Pi package; the contract README
cites this file as `pi §n`, and the sections below keep that numbering.

Every Pi fact here was checked against Pi 1.5.2 (`@earendil-works/pi-coding-agent`, the devDependency the tests run),
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
| `live/` | A hosted session: `SessionHost` around a `PiChild`, the run tracker, prompt desk, queue mirror, settings, usage feed, the event bridge, the entry cursor, and `SessionHosts` (the registry with its locks, revive and idle end). |
| `host/` | The bridge's own extension, written into `~/.broski/pi/broski-host.ts` and loaded with `-e`: the permission gate and the `broski.*` records. `extension/` is agent code, read by the rest of the adapter only as text. |
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
  `session_shutdown` on EOF; one SIGTERM during that shutdown does not interrupt it (`docs/rpc.md:93-97`).
- **Measured** (5 starts, no extensions, M-series Mac): `get_state` answered 124–141 ms after spawn; RSS about 110 MB
  per `pi`.
- **New sessions** are written by the bridge before `pi` starts (header and `broski.origin`), because Pi writes no
  file until the first message. The model and thinking level a phone chose are set after the handshake with
  `set_model` / `set_thinking_level`, which do not change Pi's saved defaults (`rpc-mode.js:387-413`).
- **Idle and keep-open**: a host with no view, run, ask, compaction, retry or queued input ends; one that exits on its
  own is revived when a phone acts in its view again (`session-view.ts`); a view of a deleted session answers
  `closed`.

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
a compaction run's end, and as a session opens. An extension's `sendMessage` with no turn starts no run.

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
`setStatus`, `setWidget`, `setTitle` and `set_editor_text` are ignored.

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

Asks are the bridge's own: one pending when a view closes is in the next open's snapshot.

### 8.6 The permission gate

`host/extension/index.ts` handles `tool_call` when the session's mode is `ask`: it asks with `ctx.ui.input` whose title
is `broski-permission:` + the call as JSON, passing `ctx.signal`, and the bridge answers with a verdict as JSON
(`allow`, `allow_session`, `deny` with a message). An edited input is checked with pi-ai's `validateToolArguments`; one
it refuses is asked again with the problem. Permissions live in the last `broski.permissions` entry, read at
`session_start` and appended by the bridge through the extension's `broski-host` command. The extension also cancels
`session_before_switch` and `session_before_fork`, so the `pi` stays on the session the bridge opened.

## 9. Catalogs

`probeCatalog` runs `pi --mode rpc --no-session` in the directory: `get_state`, `get_available_models`,
`get_commands`, dialogs cancelled. A listing with a hosted session in that directory asks that `pi` instead. The cache
holds a read for 30 s while the stamps of Pi's sources (auth, models, settings, trust, extensions, prompts, skills, the
project's `.pi`) are unchanged, stamped once the probe is done: a first `pi` start writes an empty `auth.json` and
`models-store.json` (experiment). RPC lists only models Pi can run, so `includeUnavailable` adds nothing. A `pi` with no model reports a placeholder
(id, provider and api all `unknown`) as `get_state`'s model; `selectedModel` reads it as none, so a session shows no model
and `setThinking`, `compact` and a prompt (which Pi refuses as "No API key found for the selected model") answer
`no_model` (`live_no_model.test.ts`).

## 10. Reconnect

A view reopens on the host's snapshot; a host whose `pi` exited is revived on the next action.

## 11. External sessions

A session another client wrote opens watch-only. A terminal `pi` runs the Broski link extension, installed in the
agent dir, which reports over a unix socket with a key file ([terminal-link.md](terminal-link.md)); it does nothing
outside the interactive terminal (`ctx.mode`), so the bridge's own `pi` links nothing.

## 12. Capabilities

`traits.ts`: text and thinking streams, start/steer/queue, images, commands, the queue, `tool_permission`, `choice`,
`confirm`, `text`, thinking, children, usage, `externalLive`; no plan proposals, no `cancelQueued` (RPC has only
`clear_queue`). Every one passes `runConformance` against the real `pi`.

## 13. Mapping

`mapping/`: stream blocks keyed by content index, tool calls by provider id per response, results with file changes
for `edit` and `write`, compaction and retry events, error classes, usage copied from Pi's totals.

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
adapter's own frame schemas.

## 17. Risks and open questions

- About 110 MB per hosted session; many open sessions cost memory the SDK host shared.
- A Pi release that changes an RPC shape fails the frame schemas, which reports a fault instead of guessing.
- The permission gate rides on `ctx.ui.input`; a Pi that changes how `input` titles reach RPC breaks it.
