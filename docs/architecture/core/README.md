# The Broski bridge core

Status: Phase 2. The core speaks the [contract](../contract/README.md) (protocol **1.1**) to phones and the `AgentBackend` interface to adapters. Production registers **no backend** yet: Phase 4 adds one adapter per backend. The old protocol keeps serving the app beside it until Phase 4 deletes it backend by backend.

Code: `packages/bridge/src/core/` (one concept per file), wired into the existing connection layer by `packages/bridge/src/server/contract-seam.ts`.

**Contents.** [1 What it owns](#1-what-the-core-owns) · [2 Layout](#2-layout) · [3 Data flow](#3-data-flow) · [4 The seam](#4-the-seam-into-the-running-bridge) · [5 Sessions](#5-session-lifecycle) · [6 Streams](#6-streams-seq-epoch-replay) · [7 Interactions](#7-interactions) · [8 Prompts](#8-prompts) · [9 Fitting the link](#9-fitting-every-message-to-the-link) · [10 Backpressure](#10-backpressure-and-the-rate-limit) · [11 Trust](#11-what-the-core-does-not-trust) · [12 Versioning](#12-versioning) · [13 Layers](#13-layers) · [14 Numbers](#14-numbers) · [15 Phase 3](#15-how-phase-3-plugs-in) · [16 Phase 4](#16-how-phase-4-plugs-in) · [17 Tests](#17-tests) · [18 Limits](#18-limits-and-open-risks)

## 1. What the core owns

What no backend provides (contract README §5, §8, §9, §10, §12):

- the **backend registry**: the only way to reach an adapter; backends start beside the listeners, never before them;
- one **live stream per open session**: the `OpenSession`, the live state built with the contract's own `applyEvent`, the `seq` of every event, the **epoch** of the stream, and a bounded **replay log**;
- **viewers and fan-out**: live events go only to the clients attached to the session, catalog news to every client that said `hello`;
- **attach and reattach**: a replay from the log when it reaches back in the same epoch, else a snapshot;
- the **keep-open rule**: a session with work in flight stays open, viewed or not;
- the **interactions desk**: every answer checked by `answerProblem`, first answer wins, no automatic answers;
- **prompt idempotency** across what an adapter cannot see: a session closed and reopened, and a bridge restart;
- **one answer per request**, whatever the adapter does, within a deadline;
- **every wire message within the link's cap**, never cut mid-JSON;
- the **wire boundary**: every inbound frame bounded and checked against the contract's zod schemas, every outbound message checked too.

What it does not do: anything backend-specific. It never mints run, block, tool, interaction or queue ids (adapters do, README §4), never synthesizes `interaction_resolved` (adapters do, README §9), and never branches on the backend id.

## 2. Layout

| File | Concept |
|---|---|
| `core.ts` | `BridgeCore`: assembles the parts; `addBackend`, `connect`, `dispose`; announces a backend that lands. |
| `ports.ts` | What the core needs from the bridge around it: `ClientLink`, `CoreLog`, `CoreClock`, `DirectoryPolicy`, `PromptJournal`. |
| `backend-registry.ts` | Backends by id, their start and the wait for it, capability descriptors, status with fault containment, dispose. |
| `catalog-feed.ts` | Catalog news to every negotiated client; a deleted session's stream ends here. |
| `session-hub.ts` | Open on first use, at most one `OpenSession` per session, idle close, `session_replaced`, removal, the open and close deadlines, shutdown. |
| `minor-views.ts` | What a client of an older minor is sent instead of what a later minor added: the descriptor without the ops a later minor added (`take_over`, `session_settings`, `session_tools`, `system_prompt`), a session's capabilities without `cancelCompaction` and `cancelRetry`, `input_returned` as a `notice`. |
| `keep-open.ts` | `holdsOpen(snapshot)` and the idle-close delay. |
| `live-session.ts` | One stream: checks adapter records, applies them, numbers them, logs them, fans them out; `sync` for attach; `reconcile` with the adapter's snapshot. |
| `session-sink.ts` | The sink an adapter gets: never throws, holds early records, follows a replacement. |
| `event-log.ts` | The bounded replay window. |
| `client.ts` | One connected app: `hello` state, attached sessions and the places reserved for attaches under way, per-session ordering of attach/detach, a send that never throws. |
| `interaction-desk.ts` | Answers: validation, first-answer-wins, stale vs not found. |
| `prompt-ledger.ts` | Prompt idempotency: accepted results by `(session, clientRequestId)`, in-flight sharing, journal. |
| `protocol-server.ts` | Inbound frame → `ClientMessage`: size bound, shape walk, schema; the `hello` gate; the rate-limit answer; one answer per request within the request deadline; outbound check and fit. |
| `message-shape.ts` | The bounded walk that runs before the schema. |
| `deadline.ts` | `within` (work or a fallback at a deadline), `settled` (a call's outcome, throws included). |
| `request-routes.ts` | Every request type to its handler (exhaustive: a missing one does not compile). |
| `context.ts`, `controlled.ts` | The handler context, `onBackend` (the backend a request names, waited for while it starts) and `controlled` (the viewed session and its control, for the eight control requests). |
| `requests-catalog.ts`, `requests-sessions.ts`, `requests-live.ts` | The handlers: backend-wide reads; session mutations and reads; attach, detach and session control. |
| `results.ts`, `directories.ts`, `paged-read.ts`, `session-key.ts`, `same-state.ts` | Result and error builders; the directory policy; re-reading a page that is too large; session keys and log labels; snapshot equality. |
| `replacements.ts`, `attach-redirect.ts` | Which stream replaced which, bounded and kept across restarts; answering an attach to a replaced session with the session that continues it. |
| `frame.ts` | The `{"type":"contract","message":…}` frame, and the prefix every frame begins with. |
| `wire-fit.ts`, `snapshot-fit.ts`, `text-elision.ts` | Fitting a message to the link: run items, free text, the event fallbacks. |

Outside `core/`: `server/contract-seam.ts` (the seam, §4), `server/json-lines-journal.ts` (a journal file) with `contract-prompt-journal.ts` and `contract-replacement-journal.ts` (the two it keeps).

## 3. Data flow

```
phone ──link──▶ server/messages.ts ──{"type":"contract"}──▶ seam ──▶ ProtocolServer ──▶ handler ──▶ AgentBackend / SessionControl
                                                                                                    │
phone ◀──send queue (sendPayload)◀── CoreClient ◀── LiveSession.publish ◀── SessionSinkRouter ◀─── adapter sink.emit
phone ◀──send queue ◀── CoreClient ◀── CatalogFeed ◀── registry host ◀───────────────────────────── adapter catalog.emit
```

An adapter record goes: sink (never throws) → `SinkRecord` schema check → `applyEvent` → `seq` → envelope → fitted frame, encoded **once** → replay log → every viewer → the hub (`interaction_resolved`, `session_replaced`, keep-open review). Everything on that path is synchronous, so no viewer can see events out of order and an attach is atomic (§6). A viewer's link that throws costs that viewer the frame and nothing else: `CoreClient.send` contains it.

## 4. The seam into the running bridge

Contract messages share each phone's socket with the old protocol, which owns every other frame type. Two old types (`abort`, `error`) are also contract types, so every contract message travels in one frame type in both directions:

```
{"type":"contract","message":<ClientMessage | ServerMessage>}
```

The old code knows the core only through these lines:

| File | Change |
|---|---|
| `server.ts` | `BridgeServerOptions.contract`; `createContractSeam(…)` (one call); `contract` handed to the connections, the message handler and the stop; `contract.start()` once the listeners are bound. |
| `server/messages.ts` | After the JSON parse and the object check, before the old prototype-poison check: `if (deps.contract.owns(parsed)) return deps.contract.receive(ws, parsed, frameBytes(raw));`. |
| `server/connections.ts` | On close: `deps.contract.disconnect(ws)`. When the socket's rate limit refuses a frame: `if (deps.contract.refuse(ws, raw)) return;`. |
| `server/shutdown.ts` | `deps.contract.stop()` among the backend disposals, inside the teardown budget. |

So a contract frame passes the old connection layer's socket cap (`BROSKI_MAX_WS_MESSAGE_MB`, 15 MiB, which closes the socket) and shares its per-socket rate limit, and its replies go through the old send queue (§10). It skips the old prototype-poison and depth guard on purpose: legal contract data names keys (form field keys, free JSON in `editedInput`) that guard refuses, and nesting it refuses, while the contract's strict schemas never merge an object into another. A contract frame inside an old `batch` is not served (the contract has no batch). Old handlers, connectors and routes are untouched.

## 5. Session lifecycle

- **Open on first use**: an attach (`acquire`) or a `session.create` (`open({kind:"new"})`). Concurrent attaches share one open. A session closing is not opened again until its `close()` has finished: at most one `OpenSession` per session at a time (README §5 rule 12).
- **Deadlines on the adapter.** An `open` that has not resolved within 30 s fails `backend_error` (an attach answers `internal` with that code); an `OpenSession` it hands over later is closed at once, and the next open of that session waits for that close. A `close` waited for more than 30 s is logged and waited for no longer. An adapter that does not answer has broken its liveness, and without these one wedged call would keep a session from ever opening again; rule 12 holds for every adapter that answers.
- **The sink holds early records.** `open` resolves with the snapshot; records the adapter emits after that moment but before the hub's continuation runs are held and published in order, on top of that snapshot (README §5 rule 1).
- **Keep-open rule** (README §5 rule 3). `holdsOpen(snapshot)`: an active run, a pending interaction, a compaction or retry under way, or accepted input still queued. While it holds, the session stays open with or without viewers, so no ask is raised to nobody and no event is lost from the log. The queue is included because closing would strand accepted input an adapter may hold in its own memory (Codex without the experimental queue, cx §6.2).
- **Idle close**: once a session is idle and unviewed, it closes after `idleCloseMs` (60 s). Any viewer change and every event passes through `reviewIdle`, which schedules or cancels the timer. A created session nobody attaches to closes the same way.
- **Replacement**: `session_replaced{session}` is the old stream's last event. A new stream (new epoch, `seq` from 1) takes over the same `OpenSession`, sink and in-flight answers (one shared set of claims) under the new id. Viewers of the old stream are let go and attach to the new one. The core records which stream replaced which (`Replacements`: the old stream's epoch to the new session and its epoch, so a chain is followed from the first epoch alone): at most 4,096 records, none older than 30 days, appended to `replacements.jsonl` beside the prompt journal and loaded at start. A client of minor 1 or later that attaches with a `resume` of one of those epochs, or whose attach was under way when its session was replaced, is answered `replaced{epoch, session}` with the successor's own capabilities, opened for the purpose and kept for the attach that follows (README §12.2); an older client is attached to the session it named, as before. A session replaced and then reopened under its old id is a new stream with a new epoch, which no record names.
- **Removal**: a catalog `session_removed` ends the session's stream and lets its viewers go.
- **Shutdown** is the one time busy sessions close: `dispose` retires every stream and disposes every backend, whose pending asks expire (README §9). An open or a backend that lands after it is closed or disposed as it lands.

## 6. Streams, seq, epoch, replay

- `seq` is 1, 2, 3… per stream, without gaps (README §7). The epoch is a UUID per stream: a reopened session, a replaced one and a restarted bridge each start a new one.
- The replay log keeps the newest 4,096 events or 4 MiB of their frames, whichever is less (always the newest event). It is meant for a phone that drops off for a moment: past that window one snapshot is cheaper to send than the events it replaces.
- `session.attach{resume}` answers `replay{afterSeq}` when the epoch matches and the log still holds every event after `resume.seq`; otherwise `snapshot{lastSeq}` (README §12.2). A `resume.seq` beyond the stream's newest is a snapshot too.
- **Atomic attach.** From the reconcile to joining the viewers nothing awaits: the core checks the adapter's snapshot (below), computes the sync, sends the answer, sends the replayed frames, then adds the client. No event can fall between the sync and the first live event. An answer that could not go out as given (it did not fit the link) leaves the client viewing nothing.
- **Reconcile** (README §5 rule 2). At every attach the core compares its live state with `OpenSession.snapshot()`, as JSON with keys in any order. They differ only when the adapter broke the rule; then the adapter's state wins, published as `resynced`.
- Per client, attach and detach of one session run in arrival order, and a control request waits for the attaches and detaches sent before it, so `attach; prompt; detach` sent back to back act in that order without serializing unrelated requests.

## 7. Interactions

- **Every answer is checked by `answerProblem` before any adapter sees it** (README §2 rule 6). A faulted answer is `invalid_input` and changes nothing.
- **First answer wins** across phones (README §9, §12.3). An answer on its way to the adapter claims the interaction; another is `stale`. If the adapter refuses the first, or throws, the claim is released and the next answer may go. A resolved interaction is remembered, so a late answer is `stale`, not `not_found`.
- The other phones see the end as the adapter's `interaction_resolved`.
- **Re-delivery**: pending interactions are in every attach's snapshot and in replayed `interaction_requested` events.
- **No timeout policy.** The core never answers on anyone's behalf: an interaction ends only when a human answers or cancels it, or the backend withdraws it or lets it expire. A phone may come back hours later and the ask is still there. `Interaction.expiresAt` is the backend's own deadline, shown, never acted on. (The request deadline of §11 answers a *request* the adapter never answered; it answers no interaction.)
- A session that can only be watched (`controllable: false`) answers every control request, answers included, `unsupported`.

## 8. Prompts

- `PromptInput` is checked by the contract schema at the wire (text 1 MiB, images 4 MiB of base64 together, lists 1,000).
- **Idempotency** (README §10): a repeat of an **accepted** `clientRequestId` gets the first result and reaches no backend; a rejection is not remembered; a repeat that arrives while the first is on its way shares its result. The ledger keeps 10,000 accepted prompts by `(session, clientRequestId)`, across a close and reopen of the session.
- **Across bridge restarts**: the prompt journal, a JSON-lines file (`prompts.jsonl` in the journal directory, `~/.broski/core` once backends are served, `0600` in a `0700` directory; the replacement journal is `replacements.jsonl` beside it, written the same way, README §5), loaded at start, appended per accepted prompt, compacted to the newest 10,000 past 20,000 lines. Unparsable lines are skipped and rewritten away at the next start; after an append that failed part-way the next one starts on a line of its own. An I/O failure is logged; the in-memory ledger goes on. Under test isolation, a journal path inside the real home throws before anything is written.
- The adapter still de-duplicates within an open session and passes the id to backends that persist it (README §10); the ledger covers what it cannot see.

## 9. Fitting every message to the link

The link carries one message of at most `linkMessageLimitBytes` (8 MiB by default, `BROSKI_LINK_MESSAGE_MB` 1–8). The core fits every frame to it, measured in UTF-8 bytes of the whole `{"type":"contract",…}` frame, and never cuts JSON:

1. **As it is**, when it fits.
2. **A snapshot sheds its run's oldest items** (attach answers and `resynced` events) when that alone makes it fit, counted in `run.droppedItems`, the contract's own mechanism for a run past its bound; the transcript has them once the run ends. The newest items stay whole.
3. **Otherwise the rest of the message is over the cap by itself, so free text is cut** (`text-elision.ts`) with every item kept: every string longer than a common length is cut to it, the longest that fits, never below 1,024 units, with `…` where it was cut. The length is measured, not guessed: an estimate from each string's bytes per unit, corrected by each measured overshoot, finds a length that fits, and interpolation between it and the nearest that does not (a bisection after any step that did not halve the gap) finds the longest; a typical message takes five to eight encodings. Only strings longer than `MAX_PATH_CHARS` are free text: every id, name, option value, path and URL the contract carries is bounded at or below it. An open block's text and a running tool's output keep their newest part, since the deltas that follow extend them; everything else keeps its start. Never cut: a form field's `when` condition values (they decide what the phone shows), cursors and image bytes (outside the scopes). An interaction whose editable input or plan is cut is sent as not editable, so a phone never sends a cut copy back as an edit. The result is checked against `ServerMessage`.
4. **When even text at its floor does not fit beside every item**, the snapshot sheds items as in step 2 and its text is cut again.
5. **Paged reads** (`sessions.list`, `transcript.read`) are read again with a smaller page first: a shorter page is still a page, and the adapter mints the cursor for what it returned.
6. **When nothing fits**: an event becomes `resynced` with the live state after it (which can shed run items), and when not even that fits, an `error` event saying what was left out (code `unknown`, not retryable). An answer becomes `error{internal}` with the sizes. A catalog event is dropped and logged.

Each event is fitted once, at publish, and every viewer and the replay log get that same frame.

## 10. Backpressure and the rate limit

Every contract frame goes through the old send queue's `sendPayload` (`utils/runtime-send-queue.ts`), per socket, never blocking another: a link socket may hold its own window (`BROSKI_LINK_BACKPRESSURE_MB`, 32 MiB) in the socket plus as much again in the queue; past that it is closed with 4013, the daemon redials, and the phone reattaches with its last `{epoch, seq}` and gets a replay or a snapshot. A network (loopback) socket is shed at 4 MiB with 1013. Memory per client is therefore bounded by the queue's windows; memory per session by the replay window; sessions per client by 32 viewed at once, counting attaches still under way.

Inbound, a socket has one token bucket for both protocols (`BROSKI_RATE_LIMIT_*`: 60 a second, bursts of 150, then 10 s refused). A contract frame it refuses is answered by the core, `error{rate_limited}` with the frame's `requestId` when it is readable, and not served; any other frame keeps the old `RATE_LIMITED` reply. Answering means parsing the refused frame, which costs far less than the link takes to deliver it.

## 11. What the core does not trust

"Don't trust even our own code":

- **Inbound**, in order, each failure `invalid_message` with the `requestId` when it is readable: the frame must be exactly `{type, message}`; at most `MAX_MESSAGE_BYTES` (8 MiB, the contract's whole-message bound); within the shape walk (`message-shape.ts`: at most `MAX_CLIENT_MESSAGE_VALUES` 50,000 JSON values, no list or object over `MAX_LIST_ITEMS` 1,000 entries, nothing nested 67 deep), whose bounds are exactly what `ClientMessage` allows (a test derives them from the generated JSON Schema); then `ClientMessage` (strict objects, bounded values). The walk exists because the schema's cost grows with every value it checks and every issue it reports: a prompt with two million attachments cost 1 s and 1.8 GB before it, a bounded walk after. Nothing but `hello` is served before a `hello` with the same major. The old prototype-poison guard does not run on contract frames (§4), so free JSON (`editedInput`) reaches an adapter with whatever keys the phone sent, `__proto__` and `constructor` included: an adapter copies such a value (spread, `structuredClone`) and never merges it into another object (`Object.assign`, a deep merge). Records zod parses (form values) drop a `__proto__` key.
- **Directories**: every `cwd` a request names (`models.list`, `commands.list`, `modes.list`, `sessions.list`, `session.create`) goes through the bridge's directory policy (`getSecurePath`: allowed bases, realpath, symlinks) and reaches the adapter canonical, or is refused `invalid_input`, as the old protocol refuses it. Paths inside a prompt (`mentions[].path`, `attachments[].uri`) reach the adapter as sent, as in the old protocol: the agent reads files anyway, and each adapter owns how its backend resolves them.
- **Adapter records**: each is checked as a `SinkRecord`; an invalid one never reaches a phone, and the adapter's own snapshot replaces it (`resynced`) when that snapshot is valid. Records arriving after a close are dropped.
- **Adapter snapshots**: checked at open (an invalid one fails the open, and the session is closed), and reconciled at every attach.
- **Adapter answers**: every response is checked as a `ServerMessage` before it leaves; an invalid one is replaced by `error{internal}`.
- **Adapter faults**: a method that throws, at once or later, answers its request `error{internal}` and is logged; a thrown or invalid `status()` becomes an unusable status with an `error` issue (README §11.4); a failed `dispose` is logged and the rest go on; a factory that fails leaves the bridge running without that backend and says why to every request that names it. Neither sink ever throws into the adapter (README §2 rule 7).
- **Adapter liveness**: every request is answered within `REQUEST_DEADLINE_MS` (120 s, longer than any wait of the core's own); one the adapter never finishes is answered `error{internal}` and its late result is dropped. Opens and closes have their own deadlines (§5).
- **Log lines** quote every string a phone chose (request ids, session ids), so a phone cannot write a line of its own into the bridge's log.

## 12. Versioning

`hello` is mandatory. Bridge and app talk only when `major` is equal (README §12.4); another major is `unsupported_version` and ends the talk: the client's sessions are let go, and an attach already under way is refused rather than completed. The client's minor is kept (`CoreClient.speaks`), and what a later minor added is sent only to a client that named it: 1.1 added the `replaced` attach answer (`ADDED_IN_MINOR.replacedSync`), which an older client is not sent; 1.2 added the `take_over` op (`ADDED_IN_MINOR.takeOver`) and the `input_returned` event (`ADDED_IN_MINOR.inputReturned`). Both are cut for an older client in one place, `minor-views.ts`: `descriptorFor` strips the op from the backend's descriptor, and `withOlderView` turns the event into an info `notice` that carries the same texts (`EncodedFrame.instead`, picked by `CoreClient.send`; the event keeps its `seq`, so replay and resume count the same for every client). **The next minor bump adds its own check at the place it sends.** The answer carries the bridge's protocol and version.

## 13. Layers

`bun run check:layers` (CI) judges `src/core/` too (`scripts/contract-gen/layers.ts`):

- `src/core/` may import only itself, the contract (not `contract/testing/`), `zod`, and `CORE_INFRASTRUCTURE`: `state/bounded-map` and `transport/send-limits` (`frameBytes`).
- Those infrastructure modules are judged as well: they may import only `zod` and each other, so the core reaches nothing through them.
- So the core never imports `connectors/`, `handlers/`, `runtime/`, `server/`, `types/`, `logging/`, `backends/<id>/` or a `node:` module.
- Adapters still may not import the core; they reach it only through the `AgentBackend` they hand the registry.

## 14. Numbers

| What | Value | Where |
|---|---|---|
| Idle close delay | 60 s | `keep-open.ts` |
| Replay window | 4,096 events or 4 MiB | `event-log.ts` |
| Sessions one client views at once | 32, attaches under way included | `requests-live.ts` |
| Accepted prompts remembered | 10,000 (journal compacts past 20,000 lines) | `prompt-ledger.ts` |
| Replaced streams remembered | 4,096, none older than 30 days (journal compacts past 8,192 lines) | `replacements.ts` |
| Resolved interactions remembered | 10,000 | `interaction-desk.ts` |
| Shortened text keeps at least | 1,024 UTF-16 units | `text-elision.ts` |
| Frame cap, outbound | `linkMessageLimitBytes`, 8 MiB | `server/limits.ts` |
| Frame cap, inbound | `MAX_MESSAGE_BYTES`, 8 MiB | `contract/limits.ts` |
| JSON values in a client message | `MAX_CLIENT_MESSAGE_VALUES`, 50,000 | `contract/limits.ts` |
| Nesting of a client message | 67 (`MAX_JSON_DEPTH` + 3) | `message-shape.ts` |
| A request waits for a backend still starting | 30 s from its start | `backend-registry.ts` |
| An adapter's open, or a close waited for | 30 s | `deadline.ts` |
| A request, start to answer | 120 s | `protocol-server.ts` |

## 15. How Phase 3 plugs in

- Wrap every request in `{"type":"contract","message":…}` and read the `message` of every `contract` frame with the generated `ServerMessage.fromJson`; ignore other frame types while the old protocol shares the socket, except the old heartbeat: answer its `ping` with `pong` until Phase 4 removes it (the contract has no keepalive of its own).
- Send `hello` first. Keep `{epoch, seq}` per attached session from every `event`, and reattach with it after any reconnect; apply a `snapshot` sync by replacing the session's state, a `replay` by applying what follows.
- `backends.list` gives the backends ready now. A `catalog{backend, status_changed}` for a backend the app has not listed means it has just landed: list again.
- `error{rate_limited}` means the request was not served: wait a few seconds and send it again.
- Mirror `applyEvent`; treat `resynced` as a replacement; expect `droppedItems > 0` on a long run; expect `…` in very long text; re-read the transcript's newest page at `run_finished` (README §8).
- After `session_replaced`, attach to the new id. An attach whose answer is `replaced{session}` (a phone that was away; send `hello` with minor 1) says the same: attach to `session` instead, without `resume`. After `session_removed`, drop the session.

The app does all of this in `lib/agent/`: see [`docs/architecture/app-core/README.md`](../app-core/README.md).

## 16. How Phase 4 plugs in

- Write `backends/<id>/`, export a `BackendFactory`, and register it in `server.ts`'s options (`contract.backends: [[id, factory]]`). Nothing in the core changes.
- Factories start once the bridge listens (`contract.start()`), all at once and in the background, as the managed OpenCode start does: a request that names a backend still starting waits for it up to 30 s from the start, then is answered `unknown_backend` saying it is still starting; a backend that lands later is announced to every client (`status_changed`). A factory may take as long as its backend needs, but report an unreachable service through `status()` rather than failing.
- Pass the conformance suite; then delete that backend's old code.
- Once backends are registered the journals (`prompts.jsonl`, `replacements.jsonl`) default to `~/.broski/core`; pass another `journalDirectory` to move them.

## 17. Tests

- Unit, in process (`__tests__/helpers/core-rig.ts`: the core, the fake backend, in-memory clients that check every frame against `ServerMessage`, a manual clock): `core_protocol`, `core_streams`, `core_session_lifecycle`, `core_control`, `core_interactions`, `core_wire_fit`, `core_text_elision`, `core_wire_guards`, `core_adapter_guards`, `core_backend_start`, `core_backend_registry`, `core_event_log`, `core_keep_open`, `core_session_keys`, `core_prompt_journal`, `core_replacement_journal`, `core_session_replacement` (a phone away, a chain, an older minor, the memory's bounds, a successor not yet open), `core_seam`; the layer rules in `contract_layers`.
- Adapters that differ from the fake in one way live in `__tests__/helpers/core-adapters.ts` (`wrappingSessions`, `changedSession`, `Gate` for a call that waits for the test); faults are made by wrapping the fake (`adapt`), never by mocking the core.
- End to end over the real link path (`__tests__/helpers/core-bridge.ts`: a real bridge with the fake registered, phones on its unix socket through `link/unix-ws.ts`): `core_e2e_link` (hello, broken frames, the old protocol beside, two phones, steer and queue, catalog, interactions across phones), `core_e2e_resilience` (replay and stale-epoch snapshot, a slow phone, a phone cut off at its window, keep-open, the snapshot of a long run at a 1 MiB cap, a bridge restart) and `core_e2e_seam` (a closed socket's sessions, stop, the old guards beside the contract, the rate limit, an oversized frame, backends starting after the bridge listens) and `core_e2e_replacement` (a replaced session told to the phone that comes back, also after a bridge restart). The phone's side of it runs through the real daemon in `test/agent/e2e/` (app-core README §11).
- No sleeps: the fake works in microtasks, so `setImmediate` is its quiescence; timers run on the manual clock (`whenPending` waits for another process to schedule one); e2e waits on frames.
- **Mutation check**: `bun run mutate:core` (`scripts/mutate-core.ts`, mutants in `scripts/mutate-core/`) applies each of 185 mutants (one guard changed or removed) of the core, the seam, the journals, the reducer, the layer rules and the field-key rule to a copy of the bridge and runs these tests; `--check` only verifies that every mutant still matches its file. Every mutant is killed except the ones listed with the reason they change nothing a test can see (memory only, speed only, or a guard no input can reach).

## 18. Limits and open risks

- **Fitting has a floor.** A message whose non-text part alone (ids, names, lists of short strings, deep tool input JSON) exceeds the cap cannot fit; it then falls to the §9 fallbacks. No real backend produces one; a 1 MiB cap (`BROSKI_LINK_MESSAGE_MB=1`) makes a 4 MiB image unreadable (`error{internal}`), and a session whose pending ask cannot fit cannot be attached until the ask ends.
- **Cut text is lossy.** A phone that edits a prefilled `text` interaction cut by §9 sees the `…` where it was cut; so does a form field's `defaultValue` longer than the cut length, which the phone would send back as the field's value if untouched. Only defaults past 4,096 characters can be cut.
- **Held-open sessions are not counted.** A session with a run, an ask, a compaction, a retry or queued input stays open with no viewer and no limit on how many, each with its replay window: that is the keep-open rule and "no automatic answers" taken together.
- **A wedged adapter call is answered, not cancelled.** The contract has no cancellation, so the request deadline answers the phone while the core still awaits the adapter's promise; each such call holds its continuation until the adapter settles it.
- **The live state is only as legal as the adapter's events.** `applyEvent` bounds text but not how many blocks, tools or asks are open at once; an adapter that opens more than 1,000 makes the live state break the contract, and attaches answer `error{internal}` until they close.
- **The adapter's `session_replaced` id must be fresh.** The hub does not merge two streams under one id.
- **A replacement is remembered by stream, for 30 days.** A phone away longer, or whose record fell out of the 4,096, attaches to the old session as it was left. Reading the old session's transcript is never redirected (the history is still there); only an attach that resumes the ended stream is.
- **The old heartbeat** still closes a socket that never answers `ping` (90 s).
- **A watch-only session** shows asks it cannot answer; the terminal that owns it answers them.
- `session.attach.result` has no `Rejected` member, so an open the adapter refuses for a reason other than `not_found` is `error{internal}` carrying the rejection's code and message. Giving the answer a result union would change its shape, a major change; the error carries everything meanwhile.
