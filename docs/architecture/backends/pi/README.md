# The Pi adapter

`packages/bridge/src/backends/pi/` serves Pi (`@earendil-works/pi-coding-agent` 1.4.0, exact pin) through the backend contract ([`../../contract/README.md`](../../contract/README.md)). It implements `AgentBackend` on Pi's classic engine (`AgentSession` + session JSONL files), the engine the terminal `pi` runs, and passes all 28 conformance rules, rule 27 (`externalLive`) against a real terminal `pi` that runs the Broski link extension ([`terminal-link.md`](terminal-link.md)).

Status: built, reviewed three times, and every review finding answered ([`reviews/FIXES.md`](reviews/FIXES.md)). It is the only Pi the bridge serves, registered by default (compiled binaries included). The old Pi path (`connectors/pi/**`, `handlers/pi_*`, the `pi_*` wire messages) and the experimental Pi Durable backend (`connectors/pi-durable/**`, `pd_*`) were deleted on 2026-10-30, bridge and app; the last commit that has them is `e9d1a10`, including `docs/architecture/backends/pi-durable.md`. The app reaches this Pi only through the contract screens (Settings → long-press the version line); routing it from the main screens is in [`PHASE-4-PI-PLAN.md`](PHASE-4-PI-PLAN.md). [`STEP-0-INTERFACES.md`](STEP-0-INTERFACES.md) is the historical build plan; where it and this file differ, this file says what was built.

**`research/` is superseded.** The five research notes were written by an agent before the build, and are partly wrong. Where they differ from this file or the code (and the SDK `path:line` the code cites), this file and the code are right. They are kept as history only.

**Also:** [`terminal-link.md`](terminal-link.md) (the extension in the terminal, the channel, the reverse direction, take over, what Pi 1.4.0 cannot do).

**Contents.** [Run it](#run-it) · [Layout](#layout) · [Decisions](#decisions) · [Capabilities](#capabilities) · [How each method maps to Pi](#how-each-method-maps-to-pi) · [Traps it handles](#traps-it-handles) · [Tests](#tests) · [Owner decisions pending](#owner-decisions-pending) · [Contract gaps](#contract-gaps) · [Risks](#risks)

## Run it

```bash
cd packages/bridge
bun dev        # the core serves `pi` beside the old protocol's other backends
```

`server/contract-backends.ts` builds the core's backends: `[["pi", piWithLink]]` (`piBackendFactory` with the terminal link, on unless the bridge's config has `"pi": {"terminalLink": false}`; installing the extension and the socket are in [`terminal-link.md`](terminal-link.md)), always; `serve.ts` passes it as `contract`. With backends registered the core's journals default to `~/.broski/core`. The adapter reads the real `~/.pi/agent` (or `$PI_CODING_AGENT_DIR`) and the sessions directory the `pi` command uses.

## Layout

One concept per file, 125 files; none passes 400 lines (`live/session-host.ts`, 394, is the largest). Imports: the contract, the adapter itself, `zod` (the terminal link's frames), `node:` built-ins and the three Pi packages from their roots (`bun run check:layers`).

| File | What it is |
|---|---|
| `backend.ts` | `createPiBackend`: every `AgentBackend` method, delegating to the parts below; a foreign `SessionRef` is `not_found`, a foreign op `unsupported`. |
| `factory.ts` | `piBackendFactory`: the `BackendFactory` the bridge registers. |
| `services.ts` | The process's one `ModelRuntime` (D1) over `<agentDir>/auth.json`, `models.json`, `models-store.json`. |
| `ports.ts` | The interfaces the parts offer each other (`SessionStore`, `LiveOverlay`, `AskHost`, `InteractionPort`, `HostAccess`, …). |
| `traits.ts` | `PI_TRAITS`, the declared capabilities. |
| `status.ts` | `status()`: version, sign-in, usable models, the default model, the user's `enabledModels` problems. |
| `commands.ts`, `command-cache.ts` | `listCommands`: prompt templates, skills and extension commands. They come from a session hosted in the cwd, or else from a resource loader kept while the settings signature holds (30 s). |
| `config-watch.ts` | Watches the agent dir: a changed `auth.json`, `models.json`, `models-store.json` or `settings.json` is `catalog_invalidated` and a fresh `status_changed`. |
| `session-name.ts` | A rename's title as Pi stores it, checked once for hosted and stored sessions. |
| `command-ids.ts` | A command's wire id (`ext:`, `prompt:`, `skill:`) and the `/name args` text Pi dispatches. |
| `modes.ts` | The one mode axis, `permissions` (`off`/`ask`). |
| `project-settings.ts`, `trust-file.ts` | The terminal's dialog-free project trust, read from `trust.json` without Pi's lock; a read-only `SettingsManager` for reads, Pi's own for a hosted session. |
| `no-package-installs.ts` | Loads that install nothing: missing packages are found with Pi's own resolution, skipped and named. |
| `broski-entries.ts` | The adapter's `custom` entries: `broski.origin`, `broski.prompt`, `broski.permissions`, `broski.tool_outcome`. |
| `ids.ts`, `cursor.ts` | Every id the adapter mints or derives; the page cursor envelope. |
| `bounds.ts`, `json.ts`, `terminal-text.ts`, `phone-text.ts` | Bounding strings and free JSON to the contract's limits; removing terminal escapes. |
| `rejections.ts`, `error-text.ts`, `catalog-feed.ts`, `is-directory.ts` | `ACCEPTED`/`rejected`/`CLOSED`; one line of error text; the catalog sink silenced at dispose; one stat. |
| **`store/`** | Reads session files itself, never through `SessionManager` (D6). |
| `store/session-store.ts` | `createSessionStore`: the `SessionStore` facade over one index and one watch. |
| `store/session-dir.ts` | Where Pi keeps a cwd's sessions (`PI_CODING_AGENT_SESSION_DIR` > `sessionDir` > default), creating nothing. |
| `store/session-index.ts`, `store/dir-listing.ts`, `store/span-cache.ts` | In-memory index of session files by stamp, with a short memory of ids no file holds; directory stamps; entry spans per path and stamp. |
| `store/session-head.ts`, `store/session-details.ts` | A row's facts from a file's first and last bytes; its title and origin from one pass. |
| `store/session-watch.ts` | `fs.watch` per sessions root: another process's sessions reach the catalog. |
| `store/list.ts` | `listSessions`/`getSession`: header-cwd filter, live overlay, keyset cursor. |
| `store/transcript.ts`, `store/branch-items.ts` | `readTranscript`: the branch to the leaf (or the live cut), paged by item; each entry with the records beside it. |
| `store/attachments.ts` | `readAttachment`: an image block read back by `<entryId>:<contentIndex>`. |
| `store/jsonl-reader.ts`, `store/line-scanner.ts`, `store/entry-line.ts`, `store/migration.ts` | LF-only span reading, the header and its version as Pi reads it, cycle-safe branch walk, in-memory migration. |
| `store/open-file.ts` | Opens only regular files, without ever blocking (`O_NONBLOCK`); tells an absent file from a file system that failed. |
| `store/mutations.ts`, `store/fork-entries.ts`, `store/fork-file.ts`, `store/discard-file.ts` | Rename, fork and delete of sessions nobody hosts, only inside trusted sessions roots; a fork laid out as Pi's `createBranchedSession`; delete only through `trash`. |
| `store/pool.ts` | A bounded-concurrency map. |
| **`mapping/`** | Pure: Pi's messages, entries and events as contract values. |
| `mapping/message-items.ts` | Entries as transcript items; the live `user_message`; an extension message's notice. |
| `mapping/stream-blocks.ts`, `mapping/open-block.ts` | `message_update`/`message_end` as `block_*` and streamed `tool_started`/`tool_updated`; an open block's text kept in pieces. |
| `mapping/prompt-title.ts` | A first prompt as a title: as typed, one line, the same live and listed. |
| `mapping/tool-items.ts` | Tool results, outcomes, live output, file changes from `edit`/`write`. |
| `mapping/errors.ts`, `mapping/session-events.ts`, `mapping/usage.ts` | Run outcomes and error classes; compaction, retry and model events; `Usage`. |
| **`models/`** | `model-runtime.ts` (refresh only on a changed file, a half-written `models.json` never loaded, last good list), `catalogue.ts` (`listModels`, `find`), `model-ids.ts` (wire ids), `thinking.ts` (`ThinkingSpec`). |
| **`live/`** | One `AgentSessionRuntime` per hosted session. |
| `live/session-hosts.ts` | The registry: open new/existing/watch-only, the live overlay, hosted rename/delete, `withIdleSession`, shutdown of every host at once. |
| `live/new-session-file.ts`, `live/new-session-options.ts`, `live/scoped-start.ts` | A new session's file, written at creation as Pi's first flush writes it; the session's model (the `enabledModels` scope, as the terminal applies it). |
| `live/host-startup.ts` | A host's start: runtime, then binding, within `START_DEADLINE_MS`. |
| `live/session-host.ts` | One hosted session: runtime, binding, live state, controls, abort, finish. |
| `live/runtime-factory.ts` | `createAgentSessionServices` + `createAgentSessionFromServices` + `createAgentSessionRuntime` around the shared `ModelRuntime`. |
| `live/extension-binding.ts`, `live/command-scope.ts` | `bindExtensions`, which the open waits for unless a `session_start` handler asks a human; whether an ask comes from inside an extension command. |
| `live/host-bindings.ts` | What the extensions are bound to: the remote UI, `mode: "rpc"`, the adapter's abort, command actions a phone cannot do. |
| `live/startup-notices.ts`, `live/notice-memory.ts` | What the terminal reports at a session's start, as notices after the open; only what the session's previous start did not report. |
| `live/event-bridge.ts`, `live/tool-flow.ts` | Pi's session events into the live state; tool calls through a run. |
| `live/run-tracker.ts`, `live/usage-feed.ts`, `live/persisted-entry.ts` | The adapter's run (D3): `run_started`, the transcript cut, and `run_finished` at `agent_settled` or at an idle compaction's end; usage pulls; a message's stored entry. |
| `live/prompt-desk.ts`, `live/pi-prompt.ts`, `live/prompt-input.ts`, `live/prompt-errors.ts` | Prompts: routing, idempotency, one call into Pi and its disposition, what Pi cannot take, Pi's refusals as rejections. |
| `live/queue-mirror.ts` | The queue with the adapter's ids, kept in step with `queue_update`. |
| `live/settings.ts` | `setModel`/`setThinking`/`setMode`, and the tools allowed for the session, kept in `broski.permissions`. |
| `live/compaction-request.ts` | `compact`. |
| `live/shutdown.ts` | Bounded abort, abort-then-dispose within `HOST_END_BUDGET_MS` (D17). |
| `live/session-lock.ts`, `live/live-state.ts`, `live/host-live-state.ts`, `live/open-session.ts`, `live/host-summary.ts`, `live/host-row.ts`, `live/host-environment.ts`, `live/hosted-session.ts`, `live/live-notes.ts` | The per-session lock; the live state through `applyEvent`; the view the core holds; a hosted session's list row; notice and fault events. |
| **`ui/`** | `interactions.ts` (pending asks, exactly-once resolution), `ui-context.ts` (the remote `ExtensionUIContext`), `permission-gate.ts` + `permission-request.ts` + `visible-text.ts` + `edited-input.ts` (D14; no default answer, and a cut input is shown cut and cannot be edited), `extensions.ts` (built-ins + the gate), `plain-theme.ts`. |
| `ops/navigate-tree.ts`, `ops/take-over.ts` | `backend.call` `navigate_tree` (D8) and `take_over` (decision 17). |
| `live/session-view.ts` | The `OpenSession` the core holds for a session: hosted, watching, or a terminal's, changing between them with `session_replaced` (decision 19). |
| **`terminal/`** | The terminal link ([`terminal-link.md`](terminal-link.md)): `protocol.ts` (strict frames), `link-server.ts` (the socket and key), `connection.ts`, `registry.ts`, `feed.ts` (a terminal's events as live state), `control.ts` (prompt and abort through the terminal), `install.ts` + `extension-sources.ts` (the extension in the agent dir), `link.ts` (start, stop, problem), and `extension/` (the files that run inside the terminal's `pi`). |
| **`network/`** | Pi's `httpProxy` for Pi's requests only (decision 18): `proxy-setting.ts`, `proxy-plan.ts`, `no-proxy.ts`, `scoped-runtime.ts`, `proxy-status.ts`. |

## Decisions

### D1–D20 as built

| # | As built |
|---|---|
| D1 | In-process SDK. `services.ts` creates the one `ModelRuntime`; `runtime-factory.ts` passes it to `createAgentSessionServices`, so Pi never builds a second. One `AgentSessionRuntime` per hosted session. |
| D2 | `SessionLocks` per session id, held for an open, a prompt until Pi decides it, `setModel`/`setThinking`/`setMode`, `compact` until Pi has taken it, a hosted rename, a delete, `withIdleSession` and a host's end; never for `abort`, `answer`, `snapshot`, `close` or reads. In-process only. |
| D3 | The run is the adapter's: `run_started` when Pi reports `preflightResult("started")`, when a prompt Pi is still deciding starts its run early (below), or on an agent event with no run (trigger `system`); `run_finished` only at `agent_settled`, or when a run started early ends because Pi did not run the prompt. Outcome from `agent_settled.aborted`, else the last assistant message's `stopReason`. |
| D4 | `start`/`steer`/`queue`, routed on the adapter's run, each one `session.prompt(text, {streamingBehavior})`. No `cancelQueued`: Pi's `clearQueue()` empties the queue whole, and input queued again meets every `input` handler anew (`queue_leftovers.test.ts`). Stop clears the queue and hands the texts back (decision 16). A run that settles with input still queued says so in a warning notice. A blank prompt is `invalid_input`; while a compaction runs, prompts are refused `busy`. |
| D5 | An in-memory map of accepted results (1,000) plus `broski.prompt {clientRequestId, imageNames}` right after the user message. |
| D6 | The store reads files itself. `SessionManager.open` only hosts a session this bridge made (a write path). |
| D7 | In-memory index, stamped `(size, mtimeMs, ino, ctimeMs)`; header-cwd filter after realpath; keyset list cursor; transcript cursor `{entry position, item position, item id}`. |
| D8 | `navigate_tree` without a summary appends a `label` on the target, so the leaf survives a reopen here and in the terminal. |
| D9 | Wire id `provider/id`, looked up in a table, never split. A provider's `%` and `/` are escaped (`%25`, `%2F`), so `a` + `b/c` and `a/b` + `c` are two models; every provider Pi ships keeps Pi's own id. `refresh({allowNetwork:false})` before each list, serialized, last good list kept. `setModel` never persists. |
| D10 | `usage_updated` from `getSessionStats()` (its `contextUsage`): at open, after each assistant message, after a compaction, after a model switch and at each run end; repeats dropped. |
| D11 | Images only, and only for a model whose input takes images (`invalid_input` otherwise). No mentions. |
| D12 | Commands are templates, skills and extension commands. An extension command is answered `handled` at once and runs even mid-run, whatever the prompt's mode: Pi runs commands outside its queue, and no contract rule is broken. Text without `command` is sent with `expandPromptTemplates: false`. |
| D13 | The remote UI context, modelled on Pi's RPC mode. Only the extension's own `timeout` or `signal` ends an ask besides the human (reported `withdrawn`); an abort withdraws the run's asks; shutdown expires them (Pi's default answers). No timer of the adapter's own. An ask raised inside an extension command (before or after it awaits) has no run and never blocks one. Supersedes the plan's D13. |
| D14 | `permissions` axis; the hidden `broski-permissions` extension asks `tool_permission` per call with `ask`; persisted as `broski.permissions`. |
| D15 | `codemode`, `tool-search`, `mcp` load as the CLI loads them (`llama.cpp` has no root export). |
| D16 | `externalLive: true`, for a terminal that runs the link extension (decision 19). Sessions another client made, with no terminal link, open watch-only until taken over (decision 17), and so does a session of this bridge whose cwd is gone. The sessions directories are watched for the catalog; a hosted session's row is announced by its host alone. |
| D17 | Shutdown ends every host at once. For each: asks expired, the extensions' start let finish (500 ms), abort and wait for `agent_settled` (2.5 s), then `dispose()` (1 s). That is `HOST_END_BUDGET_MS`, 4 s, inside the bridge's 5 s teardown (`lifecycle/teardown.ts`). An abort that rejects still disposes. `abort()` from Stop is bounded (5 s). A start is bounded too (`START_DEADLINE_MS`, 20 s, inside the core's 30 s), and a runtime that arrives later is disposed. Supersedes the plan's D17. |
| D18 | No `reload()`: an extension's `ctx.reload()` throws "The phone cannot reload extensions". Settings never through `applyOverrides`. |
| D19, D20 | One `pi` backend on the classic engine; the durable engine is not built. |

### Rulings carried from the build plan (STEP-0 §9–§10)

External sessions are watch-only unless taken over or run through the link (§10 item 4, decisions 17 and 19); an abort clears Pi's queue and returns the texts (§10 item 1, decision 16); an extension's timeout reports `withdrawn`, not `expired` (§10 item 2); only `notify` and `custom()` become notices (§10 item 3); `compact` answers once Pi has taken it (§9 item 6); `listModels` lists every available model, the `enabledModels` scope first (§9 item 8).

### Adapter decisions

1. **Packages are never installed by an open or a listing.** The terminal installs missing configured packages at start (the loader resolves with no `onMissing`, `src/core/package-manager.ts:1308-1313`); a phone's open must not run `npm install`/`git clone` under a request deadline. Pi's own `DefaultPackageManager.resolve` runs first with an `onMissing` that answers `"skip"` and names the source. Nothing missing (the usual case): the load runs untouched, `PI_OFFLINE` is never set. Something missing: `PI_OFFLINE` (1.4.0's only switch) is on during that load only, and the session gets a warning notice naming each package ("Run pi in a terminal to install it").
2. **A session file a listing finds first is still news.** The index's starting point is taken once, when the watch starts; a root watched later (created after start, or re-attached after a lost watcher) is re-scanned, and never re-baselined. Before, each newly watched root re-baselined every directory, swallowing a file written since.
3. **Nothing an extension asks holds a request to the core's deadlines.** The open waits for `bindExtensions` or for the first ask a `session_start` handler raises, whichever comes first: the session opens with the ask in its snapshot (no run, not blocking), and Pi-touching controls (`prompt`, `setModel`, `setThinking`, `compact`) answer `busy` until the extensions have started, as a terminal takes no input before then. A prompt Pi is still deciding while idle is answered `started` the moment one of its `input` or `before_agent_start` handlers asks a human, or a pre-prompt compaction begins: its run starts then and the ask names it. If Pi then handles the prompt itself or refuses it, that run ends `completed` (or `aborted`) or `error`, never having reached the model.
4. **Start problems and settings problems are reported where the terminal reports them.** A session's start (runtime diagnostics, unreadable settings files, extensions that failed to load, a model that could not be restored, missing packages) becomes notices delivered right after the open. The user's global `enabledModels` problems are `status()` warnings. `isDefault` marks the settings default only (below, owner decisions).
5. **The transcript says what the live stream said.** A call the gate denied, or one cut short by an abort, gets a `broski.tool_outcome` entry after its result, so the transcript reads `denied`/`aborted` where Pi stores an ordinary error. An assistant message that ended in an error, an abort or a length cut gets the terminal's own line as an error `notice` item. A skill command reads `/skill:name args`, as typed, live and stored (`parseSkillBlock`). An extension's displayed message is a live `notice` too.
6. **An ask that outlives its run still waits for its human.** At a natural `agent_settled` the run's pending asks are withdrawn from the run and raised again on their own, under a new id, their extension still waiting on the same answer. These are asks raised by a timer or a background handler during the run; an extension command's ask never belongs to the run. The id cannot be kept: the contract has no event that changes an interaction in place, and its stream rules refuse a reused id (`contract/testing/stream-rules.ts:224-226`). An answer sent in that instant is told `stale`, and the phone shows the ask again. An abort still withdraws the run's asks (Pi's default answers them), as Esc closes a dialog in the terminal.
7. **Forks and header versions as Pi.** A fork drops the branch's `label` entries, re-chains each kept entry under the one before, re-points a compaction's `firstKeptEntryId` that named a dropped label, and appends one fresh `label` per label the whole file resolves for a kept entry. A header `version` is read as Pi's migration compares it: `"3"` is 3, a value that is no number migrates nothing.
8. **Reads write nothing and stall nothing.** Reads use a `SettingsManager` over a read-only storage: Pi's file storage locks each settings file it reads (a `settings.json.lock` directory) and spins synchronously up to about 200 ms on a held lock, after which it reads nothing. A hosted session keeps Pi's own storage. Every session file is opened `O_RDONLY|O_NONBLOCK` and only read when it is a regular file: a named pipe opened plainly blocks a file-system thread until a writer comes.
9. **An item is found by its id, not its position.** An assistant message whose first block Pi stores empty (an encrypted reasoning signature) yields fewer items than blocks; `entryOf` (navigate) and a fork point now look items up by id.
10. **A new session is on disk from its creation.** Pi writes a session's file only with its first message (`_persist`, `src/core/session-manager.ts:1172-1190`), creating it with `"wx"`. The adapter writes the header and its own entries exactly as that first flush would, then opens the file with `SessionManager.open`, which loads it as already flushed (`:1029-1050`). So the id answers from the first moment, through idle closes and restarts. A new chat abandoned before its first prompt stays listed, empty, as Pi's own `/resume` lists such files ("(no messages)"); delete removes it.
11. **Delete goes through the Trash or not at all.** A missing or failing `trash` is `backend_error` ("the session was not deleted: … Delete it in a terminal."); the file is never removed any other way. Containment is checked on real paths before a host is ended. Rename, fork and delete touch only the sessions roots the user's own settings name. A directory that only an untrusted project's `.pi/settings.json` names is listed (Pi uses it) but never written (`unsupported`).
12. **An approval shows what runs.** A permission request has no default answer. A command or input too long for the contract is shown cut, says so, cannot be edited and is `deliberate`. Control and bidi characters are written out where the human reads them.
13. **A fork is written at once**, even with no message on its branch, unlike Pi's `createBranchedSession` (`session-manager.ts:1719-1724`): its id must open at once and survive a restart, as a new session's does.
14. **The transcript shows what happened, as the terminal does.** `context_edit` entries change only what the model is sent. The terminal's rebuilt chat renders entries without them (`src/modes/interactive/interactive-mode.ts:4060-4076`), and so does the adapter.
15. **Start notices are not repeated.** A session hosted again reports only the start problems its previous start did not (per session, 256 remembered, for the bridge's life).
16. **Pi's agent dir is watched.** A `/login`, a `models.json` edit or a settings change in a terminal invalidates the phone's model list (and its commands, for a settings change) and sends a fresh status. A `models.json` caught half-written is never loaded into the runtime the sessions share.
17. **Take over.** `backend.call take_over{sessionId}` (protocol 1.2) makes a session another client made controllable. `ops/take-over.ts` refuses `busy` when a terminal holds the file through the link, or its file changed in the last 10 s (`RECENT_WRITE_MS`); `not_found` when its cwd is gone; `accepted` at once when it is already this bridge's. Otherwise, inside the session lock (`SessionHosts.takeOver`), it appends `broski.origin` as a rename appends `session_info`, hosts the session, and hands the viewing phone the new capabilities with `session_replaced` naming the same session. Only the human knows whether a terminal without the extension is still on the file, so the app's panel asks first: "Make sure no terminal is using this session". A fork is unchanged and needs no take-over.
18. **`httpProxy` is applied to Pi's requests only.** The shared `ModelRuntime` handed to Pi's sessions is wrapped (`network/scoped-runtime.ts`): `stream`, `complete`, `streamSimple` and `completeSimple` get a per-request `fetch` that routes through the proxy, and the `env` option (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`) that Bedrock and the Codex WebSocket read (pi-ai `ProviderRequestOptions`). No global changes: `process.env`, the global `fetch` and every other backend's and the bridge's own requests behave as before. The setting is read from the global `settings.json` (`??=` as Pi: a proxy variable already in the bridge's environment wins, per scheme) and re-read when the file changes. Loopback, `localhost`, `::1` and unix sockets are never proxied, and `NO_PROXY` always lists `localhost,127.0.0.1,::1`. Not covered, and named by `status()`: the Google providers (their adapter throws on a custom `fetch`), OAuth token refresh, extensions' own requests, and `bash` tool children. Tested against a local `node:http` proxy and the scripted model endpoint (`network_proxy.test.ts`).
19. **Terminal sessions are live through the Broski link.** A bridge-owned extension inside the terminal's `pi` sends the session's events over a local authenticated socket; the bridge turns them into live state (`terminal/feed.ts`), `run_started{trigger: "external"}` included. The phone's message and Stop go through the terminal's own process, so Pi's terminal stays the file's only writer. Terminal asks stay in the terminal. The session is a `SessionView` that is hosted, watching or a terminal's and changes between them as circumstances do; every change is a `session_replaced` naming the same session. A hosted session that is idle gives way to a terminal that opens it; one that is running is not given up, and the terminal's user is warned. Everything about the extension, the channel and its limits is in [`terminal-link.md`](terminal-link.md).
20. **Stop is the terminal's Esc.** Where this bridge hosts the session, `abort` first takes both queues out of Pi (`clearQueue()`, steering then follow-up, as `interactive-mode.ts:4711-4725` restores them), emits `queue_changed` empty and then `input_returned{texts}` (protocol 1.2), then aborts. The app puts the texts into the composer in front of what is typed, joined with a blank line, as the terminal's editor does. A client below 1.2 gets a `notice` naming the unsent texts. Nothing is queued again by the adapter, and the next prompt carries no leftovers (`live_runs.test.ts`).

## Capabilities

`streamText` ✓, `streamThinking` ✓, `promptModes` start/steer/queue, `attachments` image, `mentions` none, `commands` ✓, `queue` ✓, `interactions` tool_permission/choice/confirm/text, `modelSwitch` next_request, `thinking` ✓, `children` ✗, `usage` ✓, `plan` ✗, `planProposals` ✗, `externalLive` ✓ (terminals with the link extension), `durableRuns` ✗, `extensions` none, `backendOps` navigate_tree, take_over. Derived: `fork`, `rename`, `delete` ✓, `archive` ✗. Session: a session this bridge runs (`broski.origin`, or taken over) is controllable with `compact` and without `cancelQueued`; one a terminal runs through the link is controllable (message and Stop only, no `compact`, no model/thinking/mode change); one nobody runs here, or one whose cwd is gone, has no `control`.

## How each method maps to Pi

| Method | Pi |
|---|---|
| `status` | `ModelRuntimeHost.available()` (a refresh when a file changed, then `getAvailableSnapshot()`), `hasConfiguredAuth`, settings `defaultProvider/defaultModel`, `resolveModelScopeWithDiagnostics` (once per refresh), the `httpProxy` and terminal-link warnings (decisions 18, 19), `VERSION`. Never throws. |
| `listSessions`, `getSession` | The store's index over the sessions directories; live status and model from `SessionHosts`. |
| `readTranscript`, `readAttachment` | The store's span reader over the branch to the file's last entry, or to the leaf at the run's start while a run is active. |
| `listModels` | `refresh({allowNetwork:false})` when a file changed, then `getAvailableSnapshot()`, scope order from `enabledModels`, `getSupportedThinkingLevels`/`clampThinkingLevel`. |
| `listCommands` | For a session hosted in the cwd: `extensionRunner.getRegisteredCommands()`, `promptTemplates`, `resourceLoader.getSkills()`. Otherwise a `DefaultResourceLoader.reload()` for the cwd (trust as the terminal), kept while the settings signature holds (30 s). An extension command hides the template and the skill it shadows. |
| `listModes` | `permissions`. |
| `open` (new) | `SessionManager.create(cwd, dir)` + `broski.origin` (+ `broski.permissions`), written with `"wx"` and reopened with `SessionManager.open` (decision 10); the model from the `enabledModels` scope; then `createAgentSessionRuntime` and `bindExtensions({uiContext, mode: "rpc", abortHandler, commandContextActions, onError})`, within 20 s. |
| `open` (existing) | The hosted session's view; a terminal's view when a terminal holds the file through the link; else `SessionManager.open` for a session this bridge made whose cwd exists; a watch-only view otherwise. |
| `rename` | One title check (`session-name.ts`), then `session.setSessionName` when hosted; else one appended `session_info` line, inside a trusted root. |
| `delete` | `busy` unless idle; containment on real paths; the host ends; then `trash`, or `backend_error` with the file kept. |
| `fork` | A new v3 file written by the store, laid out as `createBranchedSession`. |
| `call` | `navigate_tree`: `session.navigateTree` under `withIdleSession`, a `label` when no summary, then `transcript_invalidated`. `take_over`: decision 17. |
| `dispose` | Watch stopped, every host shut down (D17), catalog silenced. |
| `prompt` | `session.prompt(text, {expandPromptTemplates, source: "rpc", images, streamingBehavior, preflightResult})`. |
| `abort` | The run's asks withdrawn, the queues cleared and returned (`input_returned`, decision 20), then `session.abort()` bounded. For a terminal's session, `ctx.abort()` in the terminal. |
| `answer` | `answerProblem`, then the pending ask's promise. |
| `setModel`, `setThinking` | `session.setModel(model)` (no persist), `session.setThinkingLevel(level)`, then `model_changed`. |
| `setMode` | `broski.permissions`, then `mode_changed`. |
| `compact` | `session.compact(instructions)`, answered at `compaction_start`. While idle it is a run (trigger `prompt`), ended with usage and `run_finished`. |

## Traps it handles

`agent_end` is not a run's end (only `agent_settled`); `prompt()` resolves at the run's end, so the disposition comes from `preflightResult`; idle `steer`/`followUp` start nothing (all three modes go through `prompt()`); a prompt made in Pi's settle window is deferred (the adapter waits for its own settle, then routes as idle); `abort()` has no bound; `dispose()` mid-run drops persistence; `reload()` mid-run breaks tools; a throwing listener breaks the agent loop (every listener is a `try/catch`); `message_update.message` is the provider's live partial (read synchronously, never kept); a provider's tool call id is unique at best within one response (ids per response, live ids minted); `SessionManager.open` rewrites files and loops on a parent cycle (never used to read; the branch walk keeps a visited set); `readline` splits on U+2028 (LF only); `getDefaultSessionDir` creates directories (computed without); an `append*` moves the leaf before it writes (writes are caught and reported); `setModel` with `persist` changes the global default (never passed); an extension's dialog `editor` has no timeout or signal; `plainTheme().fg()` emits escapes (every extension and tool string is escape-free); `ExtensionUIContext` is copied with `{...ui}` (a plain object); a `tool_call` hook ignores `abort()` (the gate listens to `ctx.signal`, and abort withdraws the ask); a pre-prompt compaction or an `input` handler can hold a prompt's disposition (early start); `session_start` handlers hold `bindExtensions` (early open); settings and trust reads lock and spin (read-only settings storage); a named pipe blocks an `open()` (non-blocking opens).

## Tests

`packages/bridge/src/__tests__/pi/`: 90 test files, 960 tests, all on Pi's faux provider in a throwaway home (`createPiTestEnv` scrubs every provider key; `registerFaux` refuses to run beside a real model). `bun test src/__tests__/pi/` runs them in about 105 seconds. None runs concurrently with another (`test_hygiene.test.ts`): they share `process.env` and `PATH`. The memory and event-loop watchdog is armed only by the files that run live sessions (`helpers/use-watchdog.ts`), and terminated after them.

| Files | What they hold |
|---|---|
| `conformance.test.ts`, `driver.ts`, `driver_sdk*`, `helpers/` | `runConformance("pi")`: all 28 rules over `createPiBackend` with the conformance driver (scripted faux responses per session, and a driver extension that holds runs and raises dialogs), and the driver's own tests. |
| `sdk_boot`, `sdk_semantics` | The SDK facts the adapter relies on, executed against the pin. |
| `cursor`, `ids`, `bounded_values`, `session_lock`, `probe`, `test_hygiene` | The shared primitives and the test infrastructure. |
| `store_*` | The store: reading, listing and paging, transcripts, sessions directories and projects, rename, delete, fork, the watch, freshness and robustness (files changing under a read, descriptor exhaustion, sizes), leaks, parity with Pi's own reading. |
| `mapping_*` | Pi's entries, events and stream as contract values; run outcomes and error classes. |
| `models_*`, `status`, `commands*`, `config_watch`, `project_trust`, `no_package_installs`, `reads_write_nothing`, `catalogue_contract_rules` | Models and the catalogue, status, commands, the agent-dir watch, trust, package loads. |
| `host_*`, `start_*`, `ask_deadlines`, `queue_leftovers` | A hosted session's life: hosting, starts and their deadlines, ends and shutdown, interleavings, races, leaks over 100 cycles, asks that come before anything awaits. |
| `live_*`, `transcript_records` | The live matrix over the backend: prompts, runs, compaction, settings, permissions, sessions, listing, lifecycle, dialogs, transcript records. |
| `take_over`, `terminal_link`, `terminal_channel`, `terminal_extension`, `terminal_install` | Take over (refused with a terminal and on a recent write, accepted otherwise, controllable afterwards, a fork unchanged); the terminal link end to end with a real Pi session in `tui` mode behind the real extension (live run, mid-run attach, a message and Stop through the terminal, quitting, a new session, compaction, thinking, a name); the socket's key, modes, strict frames and size limit; the extension alone (no bridge, backoff under fake timers, a full buffer and the resync, the warning); install, update, foreign folder, uninstall, the off switch, and no extension in hosted sessions. |
| `network_proxy*` | `httpProxy` for Pi's requests only, against a local `node:http` proxy and the scripted endpoint: a hosted session's request goes through it, no setting goes direct, the global `fetch` and `process.env` are untouched, `CONNECT` for https, loopback/`NO_PROXY`/unix never proxied. |
| `interaction_desk`, `dialogs`, `ui_context`, `gate*`, `builtin_extensions`, `navigate*` | Interactions, the remote UI, the permission gate, the built-in extensions, `navigate_tree`. |

Plus `src/__tests__/contract_pi_registration.test.ts`: the flag off serves nothing, on serves `pi` to a phone over a real bridge's link socket, a compiled binary never.

## Owner decisions pending

1. **Who may drive a session the bridge did not make** — *resolved: option d, and more.* "Take over" is a `backend.call` the phone offers on a watch-only session (decision 17); the adapter refuses while a terminal holds the file through the link or the file changed in the last 10 s, and the app asks the human first. A session a terminal runs through the Broski link needs no take-over: the phone drives it through the terminal (decision 19). Sessions no one runs here and no one takes over stay watch-only (the old app's sessions after cutover, until the first take-over). What remains: a terminal without the extension that is idle on the file cannot be seen; only the question to the human covers it.
2. **The queue after Stop** — *resolved: option c.* Stop clears both queues and `input_returned` hands the texts to the phone's composer, as the terminal's Esc does (decision 20). Only for a session this bridge hosts; for a terminal's session the texts go to the terminal's editor (`terminal-link.md`).
3. **Missing packages are never installed from the phone** (adapter decision 1). Installing as the terminal does would need a progress channel and a deadline the contract does not give an open.
4. **`httpProxy`** — *resolved: applied to Pi's requests only* (decision 18), with a warning for the uncovered cases (Google models, OAuth token refresh). The bridge's environment and other backends are unchanged.
5. **`isDefault` marks the settings default only** (contract README §11.3). With no default set, a new session takes the `enabledModels` scope's first model, or else Pi's pick (`findInitialModel`, not exported); the snapshot's `modelId` shows it.
6. **Text prompts do not dispatch commands** (`expandPromptTemplates: false`, STEP-0 §9 item 3): `/name` typed as text reaches the model; commands go through `PromptInput.command`.
7. **`notify` is not throttled**: Pi's own RPC mode forwards every one; each notice is one bounded event, and the core's replay window and send windows bound what a flood costs.
8. **An ask from a timer or a background handler belongs to the run it was raised in.** Pi gives a dialog no origin. An extension command's dialogs are told apart (`live/command-scope.ts`); a timer's are not, so an abort withdraws them, and a natural end re-raises them under a new id (adapter decision 6).
9. **`navigate_tree` on a session nobody has open, whose extension asks in `session_start`**, is `busy` ("open it to answer"): the temporary host cannot show the ask, and its end expires it.

## Contract gaps

1. **No "accepted, waiting" prompt answer.** Early start covers a prompt sent while idle. A `steer` or `queue` sent mid-run, whose `input` handler asks a human, still waits for the answer before Pi decides its disposition. A human slower than 120 s gets the core's `error{internal}`, while the input is still queued later.
2. **No in-place interaction update.** An ask that outlives its run is re-raised under a new id (adapter decision 6); an `interaction_updated` event would let it keep its id.
3. **Project `enabledModels` problems have no carrier**: `ModelsListed` holds models only; the global ones are status warnings.
4. **Notices are not state**: a session's start notices reach the views attached when it starts, not a phone that attaches later (and, by decision 15, not at the next start either).
5. **Extensions' `project_trust` handlers are not run.** Trust is read as the terminal reads it without a dialog: saved decision, then `defaultProjectTrust`. A project that needs trust gets a warning notice. The phone cannot grant trust.
6. From STEP-0 §12: `DeliveredInput` compares an image's name, which no model receives; a fork point inside an assistant message (Pi forks at whole messages: `invalid_input`); `navigate_tree` on a `user_message` moves the leaf to its parent, as the terminal's `/tree`.
7. From the plan: no tree read, no user `!bash`, no active-tools op; `setStatus`/`setWidget`/`setTitle` are lost.
8. **A terminal's queue is invisible.** Pi gives extensions no queue or retry event (1.4.0), so a terminal session never sends `queue_changed` and cannot `cancelQueued`; the phone's steer and queue are delivered but not listed.
9. **A terminal's questions cannot be answered from the phone.** There is no extension API to answer another surface's dialog; the phone shows a notice that the terminal waits.
10. **No "this session changed what it allows" event.** `session_replaced` naming the same session carries it (contract errata 14); a dedicated `capabilities_changed` would not end the stream.

## Risks

- An extension's `pi.registerProvider` lands on the process's one `ModelRuntime` and stays until the bridge restarts.
- Two calls with one provider tool call id inside one response cannot be told apart (Pi pairs them the same way).
- An extension or provider that ignores the abort signal keeps the run open past `abort()`'s deadline (reported honestly: no `run_finished` until Pi settles). At shutdown such a runtime is disposed when the 4 s budget is spent, mid-run.
- With a configured package missing, `PI_OFFLINE` is on process-wide while that session loads, so a `find`/`grep` in another session cannot download a missing `fd`/`rg` meanwhile (Pi reads the variable at each call, `src/utils/tools-manager.ts:15-19, 362-365`).
- The lock orders this bridge's calls only; a terminal `pi` writing the same file is not excluded (hence owner decision 1).
- A new chat abandoned before its first prompt stays as an empty session file (decision 10), in the phone's list and in the terminal's `/resume`.
- The extension is code in the user's `pi` process. It is small, bounded and tested against a stalled bridge, but a Pi release that changes the extension API (`ctx.mode`, `session_start`, `pi.sendUserMessage`, `ui_prompt_*`) can break it; the bridge then sees no terminal (watch-only) and the terminal is not harmed. The extension is versioned (`// broski-link-extension v1`) and rewritten by the bridge when it differs.
- A terminal started before the extension was installed has not loaded it; it needs a restart or `/reload`.
- A terminal that opens a session the phone is running can still type in it (decision 19): the warning is all the bridge can do.
- Any process of the same user that reads `~/.broski/pi-link/bridge.key` can speak to the link: it can claim to be a terminal and feed a session's live state, and receive the phone's messages for the session it names. It is the trust of `~/.pi` itself.
- `httpProxy` does not cover Google models, OAuth refresh, extensions' own requests or a `bash` tool's children (decision 18).
