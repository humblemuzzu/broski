# Phase 4 · Pi — the plan

Status: plan, not started. Inputs: the five SDK reports in [`research/`](research/) (01 session runtime, 02 session storage, 03 models/messages/streaming, 04 extensions/UI/tools, 05 Pi Durable), the contract ([`../../contract/README.md`](../../contract/README.md), `packages/bridge/src/contract/`), the bridge core ([`../../core/README.md`](../../core/README.md) §16) and the app core ([`../../app-core/README.md`](../../app-core/README.md) §12).

Goal: Pi runs on the phone **only** through the contract — one adapter in `packages/bridge/src/backends/pi/`, the generic screens in `lib/agent/` — and every line of the old Pi path is deleted.

**One Pi.** The app shows one backend, `pi`. Today it runs Pi's classic engine (`AgentSession` + session JSONL files), because that is what the `pi` command in the terminal runs. Pi Durable stops being a second backend: its old experimental path is deleted with the old Pi path, and when upstream makes the durable harness the engine `pi` runs by default, the adapter gets a durable engine behind the same `pi` backend (D19, §5). The phone always shows what the terminal `pi` shows.

Pinned SDK: `@earendil-works/*` **1.4.0**, exact. Upstream `main` is newer in a few places (noted in the reports); nothing here may depend on `main`. Pi Durable on `main` writes `pi.live` v3, which 1.4.0 cannot read: a bridge built on `main` must never touch a user's durable storage until we move deliberately.

---

## 1. What we are building, in one picture

```
phone ──contract──▶ bridge core ──AgentBackend──▶ backends/pi/
                                                   ├─ store/   reads the session files ourselves (list, transcript, attachments)
                                                   ├─ live/    one AgentSessionRuntime per open session, serialized
                                                   ├─ ui/      the remote ExtensionUIContext + the permission gate
                                                   ├─ models/  one ModelRuntime for the process, catalogue, thinking
                                                   └─ mapping/ Pi messages and events → contract items and events
          (later, §5: a durable/ engine beside store/ and live/, behind the same backend.ts; models/, mapping/, ui/ shared)
```

Rules (contract README, core README §13, enforced by `bun run check:layers`):

- `backends/pi/` imports only the contract, itself, `node:` built-ins and `@earendil-works/*` from the **package root** (deep imports fail at runtime: the packages' `exports` maps have only `.` and `./rpc-entry`, report 01 §9).
- No adapter file knows about sockets, phones, viewers or the wire. It returns `Rejected` for expected failures and throws only on bugs.
- Every file is one concept and stays well under 400 lines.

---

## 2. Decisions (each one closes a question the reports raised)

| # | Decision | Why (report) |
|---|---|---|
| D1 | **In-process SDK, not RPC mode.** One shared `ModelRuntime`, `SettingsManager` and agent dir for the process; **one `AgentSessionRuntime` per open session**, built by a factory that always passes the shared `ModelRuntime` (never lets `createAgentSessionServices` build a new one). | 01 §1, §8, §11; RPC costs a process per session and adds nothing in-process. |
| D2 | **A per-session async mutex** around prompt, steer, queue, abort, compact, setModel, setThinking, navigate, rename, close. Pi serializes nothing itself. | 01 §8 (two switches leak a runtime; prompt during a switch runs on a dying session). |
| D3 | **The run is ours.** The adapter mints `runId` when it accepts a prompt, emits `run_started` then, and emits `run_finished` **only on `agent_settled`**. `agent_start`/`agent_end` pairs inside a run become `retry_scheduled`/`retry_finished` (from `auto_retry_*`), never run boundaries. Outcome: `aborted` from `agent_settled.aborted`; `failed` when the last assistant message has `stopReason: "error"` (its `errorMessage`); else `completed`. | 01 findings 1, 2; 03 §8. The old mapper ended runs on `agent_end` (the "stuck/early Stop" bug). |
| D4 | **Prompt modes `start`, `steer`, `queue`.** Idle: all three call `prompt()` (Pi's idle `steer`/`followUp` start nothing, report 01 finding 3). Running: `steer` → `session.steer`, `queue` → `session.followUp` (delivered inside the same run). `cancelQueued` is **not implemented** (Pi's queue is text-only and `clearQueue` is all-or-nothing, 01 finding 14). The adapter keeps its own ordered mirror of queued items with ids it minted, driven by `queue_update`. | 01 §5. |
| D5 | **Prompt idempotency**: an in-memory map per open session plus a `custom` entry `broski.prompt {clientRequestId}` appended right after the user message, so the transcript names it after a restart (conformance rule 7). | 02 finding 10. |
| D6 | **We read session files ourselves; `SessionManager.open` is never used to read.** It rewrites files (adds a newline, re-ids v1/v2 files, writes a header into empty files), its path walk loops forever on a cycle, and its listing splits lines with `readline` (wrong on U+2028/U+2029). Our reader: LF-split, cycle-safe (visited set), migrates in memory with Pi's own pure migration function if the package root exports it (else a ported copy with a parity test), never writes. | 02 findings 1–3, 5. |
| D7 | **Our own session index** for listing: reuse `index-cache/*` and `utils/jsonl-line-spans.ts` (stamp = mtime, size, ino, ctime). Sessions dir resolved exactly as Pi resolves it: `PI_CODING_AGENT_SESSION_DIR` > `settings.sessionDir` > default; listing filters on the **header `cwd`**, compared after realpath on both sides. List cursor: keyset `(updatedAt desc, id desc)` plus the cwd; transcript cursor: one absolute item boundary plus an anchor item id. A cursor we did not mint, or a stale one, is `invalid_input`, never "the newest page". | 02 findings 6–8, 15. |
| D8 | **The leaf survives a restart.** A tree navigation without a summary also appends a `label` entry on the target (Pi's own mechanism), so the last entry in file order is on the chosen branch for us **and** for a terminal `pi`. | 02 finding 4. |
| D9 | **Models**: wire id `` `${provider}/${id}` ``, mapped back through a table, never `split("/")`. `refresh({allowNetwork:false})` before every list, serialized, keeping the last good list on failure (the old `pi-model-runtime.ts` logic, moved). Thinking options per model from Pi's own supported-levels function (some models have no `off`). `modelSwitch: "next_request"`. `model_changed` is emitted by the adapter (Pi emits none). `setModel` never persists the global default. | 03 findings 1–3, 11, 12; 01 finding 13. |
| D10 | **Usage**: Pi emits no usage event; the adapter emits `usage_updated` at each `run_finished` from `getSessionStats()` + `getContextUsage()` (which may be `undefined`, or report `null` tokens right after a compaction). | 03 finding 8. |
| D11 | **Attachments: images only**, and only for a model whose input includes images; otherwise the prompt is refused with a clear message (Pi would silently swap the image for placeholder text). Mentions: none until verified. | 03 finding 7. |
| D12 | **Commands** = extension commands + prompt templates + skills. Pi's TUI commands (`/compact`, `/model`, `/new`…) are **not** commands: they are the contract's `compact`, `setModel`, `session.create`. A command prompt is sent as `/name args` text through `prompt()`; extension commands run at once, even mid-run. | 04 finding 13. |
| D13 | **Superseded** by [README D13](README.md#d1d20-as-built): an extension's `timeout` or `signal` ends an ask as `withdrawn`, not `expired` (README ruling on asks), `setStatus`/`setWidget`/`setTitle` are dropped (only `notify` and `custom()` become notices), and an extension command's dialog never belongs to a run. Original text: **Remote dialogs**: our `ExtensionUIContext`, bound with `mode: "rpc"` and modelled exactly on Pi's `rpc-mode.ts` `createDialogPromise`: `select`→`choice`, `confirm`→`confirm`, `input`→`text`, `editor`→`text` (multiline, prefilled), `notify`/`setStatus`/`setWidget`/`setTitle` → `notice`. **No timer unless the extension passed `timeout`** (then it is the interaction's `expiresAt`, and expiry resolves Pi's default and emits `interaction_resolved{expired}`); the extension's `signal` withdraws it; dispose resolves defaults (never rejects). A `theme` that works without `initTheme()`. | 04 findings 1–5, 14. |
| D14 | **Permissions, new for Pi.** Pi has none by design. We add an opt-in **mode axis `permissions`: `off` (default, Pi as the terminal runs it) / `ask`**. `ask` loads a hidden bridge extension (`DefaultResourceLoader({extensionFactories})`) whose `tool_call` handler raises a `tool_permission` interaction and blocks or allows. Abort cannot cancel a `tool_call` hook (report 04 finding 4), so the adapter settles its own pending asks on abort as `withdrawn`. Our handler never throws (a throw there fails the tool with the exception text). | 04 findings 4, 6, 7. Closes `link-feed/decision.ts`'s "Pi has no permission path". |
| D15 | **Built-in extensions** (MCP, codemode, tool search) load for our host the way the terminal loads them, through `extensionFactories`, so the phone sees the same tools a terminal `pi` does. Project trust stays Pi's default. | 04 findings 10–12. |
| D16 | **External sessions: honest capabilities.** Pi has no lock and no marker for a file another `pi` is writing. `externalLive: false`. List rows still update from the index's file stamps (`session_updated`). A watch-only view of a terminal session is a later step, not this phase. | 01 finding 15; 02 §8. |
| D17 | **Superseded** by [README D17](README.md#d1d20-as-built): the queue is left as Pi leaves it after an abort (README owner decision 2), and a host's end fits the bridge's 5 s teardown (`HOST_END_BUDGET_MS`, 4 s, hosts in parallel). Original text: **Close and shutdown never truncate.** The core already keeps busy sessions open; on shutdown the adapter aborts, waits for `agent_settled` with a deadline, then disposes the runtime (Pi's `dispose` alone drops persistence mid-run, 01 finding 5). `abort()` itself gets a deadline (Pi's has none, 01 finding 6), and the adapter clears Pi's queues after an abort so stale input never replays. | 01 findings 5, 6. |
| D18 | **No `reload()` while a run is on** (it kills in-flight tool contexts). Settings change through `SettingsManager` setters + `flush()`, never `applyOverrides`. | 01 findings 7, 10. |
| D19 | **One `pi` backend; its engine follows the terminal `pi`.** Classic engine now. The durable engine is added later behind the same `backend.ts` (§5), chosen the way the `pi` command chooses it, so the phone and the terminal always see the same sessions. The app never knows which engine runs: the capabilities change (`durableRuns`, failure reasons), the screens follow them. `pi-durable` is not registered; its id leaves the contract in the next contract cleanup. | 05 (durable 1.4.0 cannot say why a run failed, has no lock of its own, and `main`'s `pi.live` v3 is unreadable by 1.4.0: not ready to be the default). |
| D20 | **The old Pi Durable path is deleted with the old Pi path** (Step 6), and so is the app's Experimental toggle for it. Durable storage on disk is never touched or deleted; its sessions reappear when the durable engine lands. | User decision: one Pi. Also removes the two old Pi files old Durable imports, so nothing is kept for later. |

### Capabilities Pi 1.4.0 declares (D1–D18 applied)

`streamText` ✓ · `streamThinking` ✓ · `promptModes` start, steer, queue · `attachments` image · `mentions` none · `commands` ✓ · `queue` ✓ (`queue_changed`) · `interactions` tool_permission, choice, confirm, text · `modelSwitch` next_request · `thinking` ✓ · `children` ✗ (Pi has no subagent sessions, 02 finding 13) · `usage` ✓ · `plan` ✗ · `planProposals` ✗ · `externalLive` ✗ · `durableRuns` ✗ · `extensions` none · `backendOps` navigate_tree · `fork` ✓ · `rename` ✓ · `delete` ✓ · `archive` ✗. Session: `controllable` ✓, `compact` ✓, `cancelQueued` ✗.

### Contract gaps (recorded, not blocking this phase)

| Gap | Effect | When |
|---|---|---|
| No tree read | branches off the current leaf are invisible on the phone | contract minor after this phase, if wanted |
| No user `!bash` op/event | the old bash card has no new home | contract minor (a `PiOp` that streams as a tool item) |
| No active-tools op | can't toggle `grep`/`find`/`ls` from the phone | later |
| Status/widget are notices only | no keyed status line | acceptable |

Any contract change follows the Phase 1 discipline: zod → `contract:gen` → Dart → conformance → negative test.

---

## 3. File layout

```
packages/bridge/src/backends/
  pi/
    models/model-runtime.ts       one ModelRuntime, serialized refresh, last-good list
    models/catalogue.ts           enabled-model scope (one pass), ModelSummary, id table
    models/thinking.ts            ThinkingSpec per model
    mapping/message-items.ts      AgentMessage → transcript items (text, thinking, tool, image refs)
    mapping/stream-blocks.ts      message_update deltas → block_started/delta/finished (ids `${messageId}:${contentIndex}`)
    mapping/tool-items.ts         tool_execution_* + built-in tool `details` → tool items, file changes
    mapping/errors.ts             stopReason / errorMessage → run outcome, error events
    factory.ts                    BackendFactory: shared services, status probe
    backend.ts                    AgentBackend: the methods, delegating to the parts below
    status.ts                     status(): SDK, agent dir, credentials, models, default model
    store/session-dir.ts          Pi's session dir resolution, header-cwd filter
    store/jsonl-reader.ts         LF split, migration, cycle-safe path, never writes
    store/session-index.ts        index rows over index-cache + line spans
    store/list.ts                 listSessions + keyset cursor
    store/transcript.ts           readTranscript + item cursor
    store/attachments.ts          readAttachment for image refs
    store/mutations.ts            rename / delete / fork of a closed session (containment checks)
    live/runtime-factory.ts       AgentSessionRuntime per session, shared services
    live/session-lock.ts          the per-session mutex
    live/open-session.ts          OpenSession + snapshot + SessionControl
    live/run-tracker.ts           runId, run_started/finished, retries, outcome
    live/event-bridge.ts          AgentSessionEvent → SinkRecord (uses mapping/)
    live/prompt-desk.ts           modes, idempotency map + broski.prompt entry
    live/queue-mirror.ts          queue_update → queue items with our ids
    live/settings.ts              setModel / setThinking / setMode, model_changed
    live/shutdown.ts              abort → settled (deadline) → dispose
    ui/ui-context.ts              ExtensionUIContext (rpc-mode semantics)
    ui/interactions.ts            pending asks, ids, answer → promise, withdraw/expire
    ui/permission-gate.ts         hidden extension: tool_call → tool_permission
    ui/extensions.ts              extensionFactories: built-ins + our hidden ones
    ops/navigate-tree.ts          backend.call navigate_tree (+ label for the leaf, D8)
    commands.ts                   listCommands
    modes.ts                      listModes (the permissions axis)
packages/bridge/src/__tests__/pi/
    conformance.test.ts           runConformance("pi", …)
    driver.ts                     ConformanceDriver: temp agent dir, faux provider / scripted server
    store_*.test.ts               fixtures: v1/v2/v3, U+2028, a parent cycle, a 40 MB file, symlinked cwd
    live_*.test.ts                the live matrix (§6)
```

---

## 4. How the work runs: parallel lanes

### Step 0 — Foundation (one delegate, serial, ~1 day)

Write the interfaces every lane codes against, and nothing else: the `models/` and `mapping/` function signatures, `OpenSession` internals (`SessionLock`, `RunTracker`, `EventBridge` inputs), the `ui/` hooks the live session calls, the store's row/item types, the driver's skeleton. Register **no** backend yet. Exit: `typecheck`, `check:layers` green; every lane's input is a type, not a guess.

### Step 1 — Six lanes in parallel (one delegate each, own files only)

| Lane | Owns | Depends on | Exit |
|---|---|---|---|
| **A · Store** | `pi/store/*`, store tests | Step 0 | list/get/transcript/attachments/rename/delete/fork-closed pass their fixture tests, incl. U+2028, cycle, migration, 40 MB, symlink, foreign cursor |
| **B · Mapping** | `pi/mapping/*` | Step 0 | table tests: every `AgentSessionEvent` variant (24) and every message/content shape (03 §12) → contract records, checked by the contract schemas |
| **C · Models & catalogue** | `pi/models/*`, `pi/status.ts`, `commands.ts`, `modes.ts` | Step 0 | models list with thinking specs (incl. a no-`off` model), id table round trip, refresh serialization, status issues |
| **D · Live session** | `pi/live/*` | Step 0 (+ B, C interfaces) | open/prompt/steer/queue/abort/compact/setModel/setThinking against the faux provider; run boundaries on `agent_settled` only; shutdown never truncates |
| **E · Interactions & extensions** | `pi/ui/*`, `ops/navigate-tree.ts` | Step 0 | every dialog kind round trip; timeout only from the extension; signal withdraws; dispose resolves defaults; the gate allows, denies, withdraws on abort |
| **F · Conformance driver + live matrix** | `__tests__/pi/*` | Step 0 | driver complete; matrix tests written (they go green as D and E land) |

Lanes never edit each other's files; a needed change to a shared interface goes back through the Step 0 owner.

### Step 2 — Integration (one delegate)

`pi/backend.ts` + `factory.ts` assembled; `runConformance("pi")` **all 28 rules green**; registered in `server.ts`'s `contract.backends` behind a dev flag (`BROSKI_CONTRACT_PI=1`) so the old Pi path and the new one never open the same session file at once during testing.

### Step 3 — Review and fix (the Phase 1 pattern)

1. `code_review`, strict: the diff against the five reports, the contract and D1–D18.
2. One fix delegate takes every finding, critical to low, and re-checks the adapter against the SDK `.d.ts` once more.
3. One DeepSeek Flash sweep: no `as any`, no `split("/")` on model ids, no `SessionManager.open` on a read path, no `applyOverrides`, no `reload()` reachable mid-run, no timer that answers an interaction, no deep imports.

### Step 4 — App side (parallel with Step 3)

Per app-core README §12: route Pi's entry points (session list, chat, settings, interactions) to `SessionListScreen`, `AgentChatScreen`, `showLiveSettings`, `showInteractionSheet`; the `navigate_tree` panel already exists in the registry (check its questions); render Pi notices in `notices_strip.dart`. **Nothing in `lib/agent/` may need Pi's id**; if a screen seems to, the contract lacks a capability and we add it there. Extend `test/agent/e2e/` with a Pi driver (real daemon, real bridge, scripted model endpoint).

### Step 5 — On-device testing (you, with a checklist)

Real Mac, real `~/.pi`, real phone over LAN and over the relay:

1. List shows the same sessions `pi --resume` shows, newest first; scrolling pages; a session made in the terminal appears.
2. Open, prompt, stream text/thinking/tools; Stop works mid-tool; the run ends once.
3. Steer mid-run; queue mid-run; queue chips update; follow-up runs in the same run.
4. Switch model mid-run (takes effect next request); thinking levels match the model (a model without `off`).
5. Image prompt on a vision model; refused cleanly on a non-vision one.
6. An extension `confirm`/`select`/`input`/`editor` (a test extension in a scratch project): answered from the phone; left unanswered for ten minutes and still waiting; answered from a second phone (first wins).
7. Permissions axis `ask`: approve, deny, abort while asking.
8. Compact; rename; fork from an item; delete; navigate tree and reopen (leaf kept, also in the terminal `pi`).
9. Background the app mid-run and return; kill the bridge mid-run and restart (transcript intact, no duplicate prompt).
10. A 50 MB session opens and scrolls.

### Step 6 — Cutover and deletion (one delegate, after Step 5 passes)

Remove the dev flag (Pi is served by the contract by default), route the app's Pi entry points to the generic screens for everyone, then delete:

**Status (2026-10-30):** the flag is removed and every item below is deleted, bridge, app, tests and the link_dart Pi e2e. Done since: the main screens route to the generic ones — Pi is in the backend picker and the Sessions and Projects tabs, with offline viewing and the local run-finished notification ([app core §14](../../app-core/README.md#14-a-contract-backend-in-the-app)). Push notifications have no Pi path yet: the old one went with the old Pi, and the core has no link-feed tap.

**Bridge** (≈ 8,800 + 523 lines, 28 test files reviewed):
- `connectors/pi.ts`, `connectors/pi/*` (34 modules), `connectors/pi_extension_ui.ts`
- `handlers/pi_*.ts` (22), `handlers/unified_pi.ts`, the Pi arms of `handlers/unified*.ts` and `handlers/misc.ts`
- `runtime/pi-runtime-event-mapper.ts`, `pi-runtime-read-models.ts`, `pi-runtime-bootstrap.ts`
- `types/pi-client.ts`, `types/pi-server.ts`, `types/pi.ts` and their routes in `routing/routes.ts`
- Pi wiring in `server/pi-pending-prompts.ts`, `server/backends.ts`, `server/intervals.ts`, `server/shutdown.ts`, `server/connections.ts`, `server/deps.ts`, `serve.ts`; the Pi exclusion in `server/link-feed/decision.ts` (Pi now answers through the core)
- the 17 old Pi tests (keep `helpers/pi-live-rig.ts` / `scripted-openai-server.ts` if the new tests use them)
- **the old Pi Durable path too** (D20, ≈ 3,100 lines): `connectors/pi-durable/*`, `handlers/pi_durable.ts`, `handlers/pi_durable/*`, `transport/pi-durable-socket.ts`, `runtime/pi-durable-*.ts`, `types/pi-durable.ts`, its routes and wiring, `__tests__/pi_durable/*` (11 files). Keep `storage-lock.ts`'s logic in the git history for the durable engine (§5). Never touch the durable storage directory.

**App** (≈ 13,300 lines in 68 Pi-named files, plus Pi branches in 61 other files, 32 test files):
- `services/pi_bridge_service.dart` (the second request client), `services/bridge/bridge_pi_*.dart`
- `providers/pi/*`, `pi_provider.dart`, `pi_subagent_invocation_provider.dart`, `pi_tool_subagents_provider.dart`, `providers/chat/pi_stream_handler.dart`, `pi_bash_message.dart`
- `screens/sessions/pi_*`, `screens/sheets/pi_*` (non-durable), `screens/chat/hydration/hydrate_pi.dart`, `screens/chat/pi_*` (non-durable), `screens/pi/*`
- `models/pi*.dart`, `widgets/pi/*`, `widgets/chat/pi_actions_content.dart`
- the Pi Durable app path: `models/pi_durable/*`, `providers/pi_durable/*` (incl. the Experimental flag), `providers/chat/pi_durable_*`, `screens/chat/pi_durable_*`, `screens/sessions/pi_durable_sessions_view.dart`, `screens/sheets/pi_durable_*`, `services/bridge/bridge_pi_durable.dart`
- every `AgentType.pi` / `AgentType.piDurable` / `isPi` / `isPiDurable` / `piBridge` branch in the 61 shared files, then both `AgentType` members
- **Gate**: `grep` finds no old Pi or Pi Durable symbol; `bun run typecheck`, `lint`, `test`, `check:layers`, `contract:check`; `flutter analyze`, `flutter test`, `dart run tool/check_agent_core.dart`; the e2e tests.

**Docs**: `docs/architecture/backends/pi/README.md` (the adapter as built: decisions, capabilities, traps); AGENTS.md's Pi notes and file tables updated by script.

---

## 5. Later · the durable engine behind the same `pi` backend

When upstream makes the durable harness what the `pi` command runs by default (watch the `pi` CHANGELOG; we follow the terminal, D19), add `backends/pi/durable/` beside `store/` and `live/`, sharing `models/`, `mapping/` and `ui/`, and let `backend.ts` pick the engine the way `pi` does. No app change: the capabilities change and the screens follow. Old classic sessions stay readable through `store/` as long as `pi` itself still reads them. What report 05 says that engine must do:

- **Keep `storage-lock.ts`** (load-bearing: two harnesses on one directory corrupt it for good); fix its pid-reuse hole.
- `Harness.open` rewrites tasks, so it is never a read: reads go through our own JSONL reader where possible.
- **The adapter owns** each prompt's outcome (Durable's `requestId` replay reports a failed run as done), each pending interaction (Durable cannot tell "waiting for approval" from "not started"), and the run failure reason (1.4.0's `pi.live` has none; the submission record's `unanswered` reason is the only trace).
- Permission hooks wait through `awaitWithContext`, so `close()` cannot hang; no 600 s auto-deny.
- `conversation.watch()` (already in 1.4.0) for the live view; one watch per open session, never one per batch.
- Capabilities: fork/reset/subagents only once implemented; `durableRuns` ✓.
- Build it against the upstream release that makes durable the default, not 1.4.0: that release is expected to carry `pi.live` v3 with `runFailure` (1.4.0 can only say *that* a run failed, not why).

---

## 6. The live test matrix (lane F; scripted model, temp agent dir, never `~/.pi`)

1. prompt → abort → prompt: second run starts, nothing replayed from the queue.
2. Retry inside a run (scripted 529 then success): one `run_started`, `retry_scheduled`/`retry_finished`, one `run_finished`.
3. Error run: `run_finished{failed}` with the provider message.
4. Steer and queue while idle: each starts a run. While running: steer reaches the next request, queue the next turn; `queue_changed` tracks both.
5. Two prompts with the same `clientRequestId` (also across a close/reopen): one run.
6. Close during a run is refused by the keep-open rule; shutdown during a run: transcript has the aborted turn, nothing lost.
7. `abort()` against a provider that ignores the signal: answered within the deadline.
8. Two opens of different sessions in one cwd at once; two quick reopens of one session: no leaked runtime (count them).
9. setModel mid-run: next request uses it; `model_changed` emitted; setThinking on a model without `off`.
10. Every dialog kind: answered; cancelled; extension timeout expires (and only then); signal withdraws; dispose resolves defaults; two clients, first answer wins.
11. Permission gate: allow, deny, abort while pending (withdrawn), nested codemode tool call.
12. Compaction manual and automatic: `compaction_started/finished`; transcript still pages across the compaction.
13. Fork before/at an item; rename; delete; navigate tree with and without summary, then reopen: leaf kept.
14. Transcript paging: stable cursors while the file grows; foreign cursor `invalid_input`; a 40 MB file; U+2028 text; a parent cycle (no hang); a v1 file (no write to disk).
15. Listing: header-cwd filter, symlinked cwd, `PI_CODING_AGENT_SESSION_DIR`, a session written by another process appears via the index stamp.
16. Image prompt on a non-vision model: refused.
17. Usage after a run; context usage `null` after compaction handled.
18. Extension command mid-run runs at once; `/compact` typed as text is not treated as a command.
19. Bridge restart mid-run (conformance `restart`): no duplicate prompt, run outcome recorded.
20. App e2e: daemon + bridge + scripted model: list, attach, stream, answer an ask from the phone, reconnect replay.

---

## 7. Order, at a glance

```
Step 0 foundation ─▶ Step 1 lanes A B C D E F (parallel) ─▶ Step 2 integration (conformance green, dev flag)
                                                             ├─▶ Step 3 review → fix → sweep
                                                             └─▶ Step 4 app routing + e2e
                                                                       ─▶ Step 5 on-device checklist
                                                                       ─▶ Step 6 cutover + delete old Pi and old Pi Durable
                                                                       ─▶ later: durable engine behind `pi`, when upstream makes it the default
```

Nothing is deleted before the new path has passed conformance, review and the on-device checklist; once it has, the old path goes in one change with no compatibility shim.
