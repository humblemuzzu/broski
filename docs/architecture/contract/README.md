# The Broski backend contract

Status: protocol **1.0** (§12.4). The bridge core speaks it to every attached phone, and each backend has one adapter: Pi and Claude Code, both registered in every bridge (`server/contract-backends.ts`). Sections that still describe the removed parts (ops, minors, the Dart pipeline, Pi Durable) are being rewritten; the code in `packages/bridge/src/contract/` is the definition.

This document is the spec. The code is the definition: `packages/bridge/src/contract/` (zod schemas, interfaces, reducer, answer checker) and `packages/bridge/src/contract/testing/` (fake backend, conformance suite). Every backend fact below cites the research in [`research/`](research/):

- `cc §n`: [`claude-code.md`](research/claude-code.md), Claude Agent SDK 0.3.312.
- `pi §n`: [`pi.md`](research/pi.md) part 1, Pi 1.4.0.

Where this document and a research report disagree, the report wins unless the disagreement is listed under [Errata](#19-errata), which records what the SDK source says.

**Contents.** [1 Layout](#1-where-it-lives) · [2 Hard rules](#2-hard-rules) · [3 Single source of truth](#3-single-source-of-truth-and-generation) · [4 Identity](#4-identity) · [5 The adapter interface](#5-the-adapter-interface) · [6 Capabilities](#6-capabilities) · [7 Events](#7-events) · [8 Live state](#8-live-state-snapshot-and-reconnect) · [9 Interactions](#9-interactions) · [10 Input](#10-input) · [11 Read models](#11-read-models) · [12 Wire protocol](#12-wire-protocol) · [13 Extensions](#13-backend-extensions) · [14 Conformance](#14-conformance) · [15 Lossy points](#15-lossy-points-and-unsupported-capabilities) · [16 Refinements of the brief](#16-refinements-of-the-brief) · [17 Not in Phase 1](#17-not-in-phase-1) · [18 Open questions](#18-open-questions) · [19 Errata](#19-errata)

---

## 1. Where it lives

| Path | Concept |
|---|---|
| `packages/bridge/src/contract/*.ts` | The contract: one concept per file. `index.ts` re-exports everything. |
| `contract/ids.ts`, `json.ts`, `limits.ts` | Ids, `SessionRef`, `BackendId`, `Timestamp`; `JsonValue`, `NativeIds`; the size bounds every wire value keeps to. |
| `contract/capabilities.ts` | `Capabilities`, `SessionCapabilities`. |
| `contract/events.ts`, `catalog-events.ts` | The live event union and its envelope; backend-wide catalog events. |
| `contract/interactions.ts`, `interaction-replies.ts`, `forms.ts`, `option.ts` | Interaction requests, replies, form fields, and the `Option` a human picks. |
| `contract/answer-check.ts`, `field-check.ts` | The answer validator, and whether one value fits one form field. |
| `contract/input.ts`, `rejection.ts` | `PromptInput`, `PromptResult`, `ActionResult`; `Rejection` and the `Rejected` member every result union shares. |
| `contract/sessions.ts`, `transcript.ts`, `models.ts`, `modes.ts`, `commands.ts`, `usage.ts`, `status.ts`, `paging.ts`, `queue.ts`, `runs.ts`, `compaction.ts`, `content.ts`, `tools.ts`, `notice.ts` | Read models and the values events carry. |
| `contract/snapshot.ts`, `session-reducer.ts`, `run-items.ts` | `SessionSnapshot`; `applyEvent`, the executable meaning of every event; how live events become the active run's items. |
| `contract/protocol.ts`, `read-results.ts` | The wire protocol: requests, responses, version; the results of the read requests. |
| `contract/extensions.ts` | Typed per-backend live events. |
| `contract/backend.ts` | `AgentBackend`, `OpenSession`, `SessionControl`, the sinks, capability derivation. Plain TypeScript over the schema types. |
| `contract/schema-registry.ts` | Names every schema after its export, for the JSON Schema. |
| `contract/contract.schema.json` | **Generated.** The contract as one JSON Schema (draft 2020-12). |
| `contract/testing/` | The fake backend (`fake-*.ts`), the stream checker, the conformance suite (`conformance*.ts`, `rules-*.ts`) and its runner. |
| `packages/bridge/scripts/gen-contract.ts`, `scripts/contract-gen/` | The generator: the JSON Schema and the fixtures; `--check`. |
| `packages/bridge/scripts/check-layers.ts`, `scripts/contract-gen/layers.ts`, `import-scan.ts` | The layer check, and the import reader it runs on. |
| `packages/bridge/contract-fixtures/` | **Generated.** `constants.json` (every bound), `contract_samples.json`, `fake_session_stream.json`, `reducer_trace.json`, `frame_prefix.json`: what a client core (Phase 3) holds itself equal to. |

Commands, from `packages/bridge`: `bun run contract:gen` writes every generated file, `bun run contract:check` fails if any is stale, and `bun run check:layers` checks imports. CI runs both in the bridge job.

## 2. Hard rules

1. **The UI never branches on the backend.** It branches on `Capabilities`, `SessionCapabilities`, and the shape of what it receives. A backend's extras reach the app only as typed `extension` events (§13).
2. **Adapters are reached only through the contract.** The core holds `AgentBackend` values. It never imports `backends/<id>/`, and an adapter never sees sockets, phones, viewers or the wire.
3. **The contract is a leaf.** `src/contract/` imports only `zod` and itself. Its `testing/` may also import `bun:test`. `src/backends/<id>/` may import only the contract (not its test kit), itself, `zod` (to check frames that cross a process boundary the adapter owns, such as Pi's terminal link), `node:` built-ins (not `node:module`, whose `createRequire` loads what no check sees) and that backend's own SDK. No adapter imports another adapter's directory. Every specifier must be a plain string. `bun run check:layers` enforces all of it in CI: it reads every import, type-only ones included, from the file's tokens (`import-scan.ts`, so comments and strings never count), joined with Bun's own `Transpiler.scanImports`.
4. **Generated code is never edited by hand.** Change the zod schema, run `bun run contract:gen`, commit the result. CI fails on a stale file.
5. **Expected failures are values.** Every adapter method that can fail returns a result union, `{status: "accepted", …} | Rejected`, the same unions the wire carries (`PromptResult`, `ActionResult`, `NewSessionResult`, the read results of `read-results.ts`, and `OpenResult` for `open`). `status()` cannot fail: whatever stops it from finding out is an `error` issue in `BackendStatus.issues`, with `usable: false`. A thrown error is an adapter bug.
6. **No invalid answer reaches a backend.** An adapter runs `answerProblem` on every answer and rejects a faulted one with `invalid_input`. A malformed answer can otherwise become a silent denial or an over-grant.
7. **Sinks never throw, and adapters never throw into the core from a callback.** Pi's `_emit` has no try/catch, so a throwing listener breaks the agent loop (pi §1).
8. **Every wire value is bounded.** Each string, list and map has a maximum (`limits.ts`): ids 256 characters, names 1,024, paths 4,096, text 1,048,576, the images of one prompt 4 MiB of base64, lists and maps 1,000 entries, catalogs 10,000, free JSON 64 levels deep. One message is capped whole: `MAX_MESSAGE_BYTES` (8 MiB of UTF-8 frame, the link's `LINK_MAX_MESSAGE_BYTES`), and a client message holds at most `MAX_CLIENT_MESSAGE_VALUES` (50,000) JSON values, because checking a message costs the bridge in proportion to its values; a prompt with every list full holds about 8,000. An adapter shortens a native value past its bound; §15 lists where that happens. A test walks the JSON Schema and fails on any unbounded string, list or map.

## 3. Single source of truth and generation

**Schema library: zod 4, pinned exactly at `4.2.1`.** It was already a direct dependency (`^4.0.0`, now exact; `bun.lock` changed by that one specifier line).

- zod 4 emits JSON Schema itself (`z.toJSONSchema`), so the language-neutral artifact needs no third library.
- The Claude Agent SDK peers on `zod ^4` (cc §0), so the bridge carries zod regardless.
- TypeBox is present only transitively, pinned by pi at `1.3.27` (`bun.lock`). Using it would tie the contract's schema library to pi's release cycle.
- One library, no mixing: every wire-visible type is a zod schema, its TypeScript type is `z.infer`, its runtime validator is the schema itself.

**Naming.** A schema's export name is its id everywhere: the `$defs` key in `contract.schema.json` (`schema-registry.ts`). Rename the export and every layer renames with it.

**Restrictions**, which keep a generated client exact. `scripts/contract-gen/type-model.ts` enforces them and fails naming the offending path:

- Objects are strict (`z.strictObject`): an unknown field is an error, both on the wire and in the JSON Schema (`additionalProperties: false`).
- Every object and enum is a named export. An anonymous one is refused.
- Every union is discriminated by a string tag (`type` for messages and events, `kind` or `status` for values).
- No `null`. Optional means absent.
- `JsonValue` is the only open type, for genuinely free JSON (tool input, edited input). It is checked by one bounded walk (`json.ts`) rather than a recursive zod schema, because zod recurses once per level of the input and overflows the stack near 10,000 levels; the generator writes its JSON Schema by hand to the same shape. `NativeIds` (`string → string`) carries backend-native ids for debugging. Nothing in the contract is `unknown` or `any`.

**Pipeline** (`bun run contract:gen`):

```
zod schemas ──z.toJSONSchema──▶ src/contract/contract.schema.json ──sampler──▶ contract-fixtures/contract_samples.json (every union member, every enum value, every object full and minimal; each sample is parsed by its zod schema)
      ├──FakeBackend scripted session──▶ contract-fixtures/fake_session_stream.json (every AgentEvent member, as wire ServerMessages)
      │                               └──applyEvent──▶ contract-fixtures/reducer_trace.json (the snapshot and status after every event)
      ├──limits.ts, MAX_PAGE_LIMIT, REQUEST_DEADLINE_MS──▶ contract-fixtures/constants.json
      └──encodeFrame──▶ contract-fixtures/frame_prefix.json (how the core begins every frame, and one frame it encoded)
```

**Determinism.** Every generated file is ordered by UTF-16 code units, never by locale. `contract:check` ignores dotfiles (such as `.DS_Store`) in the directories it owns.

**Changing the contract.** Edit the schema → `bun run contract:gen` → update this document and, if behaviour changed, the conformance rules.

## 4. Identity

| Id | Type | Minted by | Rule |
|---|---|---|---|
| `BackendId` | `claude-code \| pi` | contract | |
| `SessionRef` | `{backend, sessionId}` | adapter | `sessionId` is the backend's own durable session id: CC UUID (cc §3), Pi header UUIDv7 (pi §3). Stable for the session's life. |
| `RunId` | string | adapter | Unique per session for good (a UUID is the safe choice); CC and Pi have no native run id (cc §5, pi §13). A run ends with the bridge. |
| `MessageId`, `BlockId` | string | adapter | Unique per session. Derive from native identity where it exists, so live ids match transcript ids: CC `message.id` + block index (cc §5). Pi has no message id mid-stream, so the adapter mints one (pi §5). |
| `ToolCallId` | string | adapter | Unique per session. |
| `InteractionId`, `QueueItemId`, `AttachmentId` | string | adapter | Unique per session. An `AttachmentId` names image bytes the adapter can read back (§10). |
| `TranscriptItemId` | string ≤512 | adapter | Unique per session. May combine two ids: a tool result the live stream finished is `<toolCallId>:result` (`run-items.ts`). |
| `ClientRequestId` | UUID | phone | On every prompt; the key prompts are de-duplicated by (§10). |
| `RequestId` | string ≤128 | phone | Correlates a wire request with its response. |

Backend-native ids may ride along in `EventEnvelope.native` (`NativeIds`) for debugging. The app never keys anything on them.

## 5. The adapter interface

`contract/backend.ts`:

```ts
type BackendFactory = (host: BackendHost) => Promise<AgentBackend>;   // host.catalog: CatalogSink
interface AgentBackend {
  id; traits;                                                // traits: the declared capabilities (§6)
  status(): BackendStatus;                                   // never fails (§2 rule 5)
  listSessions(query, page); getSession(ref); readTranscript(ref, page); readAttachment(ref, attachmentId);
  listModels(cwd); listCommands({cwd?, session?}); listModes(cwd);
  open(target: {kind:"existing", session} | {kind:"new", options}, sink): Promise<OpenResult>;
  rename?(); delete?(); archive?(); fork?(ref, at?); call?(call);   // absent = not supported
  dispose();
}
type OpenResult = {status:"accepted", session: OpenSession, snapshot} | Rejected;
interface OpenSession { session; snapshot(); control?: SessionControl; answer?(answer); close(); }   // control absent = watch-only; answer only beside no control
interface SessionControl { prompt; abort; answer; setModel; setThinking; setMode; compact?; cancelQueued?; cancelCompaction?; cancelRetry?; }
```

Every method that can fail resolves with `{status: "accepted", …} | Rejected` (§2 rule 5).

**Lifecycle rules.** The conformance suite asserts every rule marked ✓.

1. ✓ `open` resolves with the live state `snapshot` at that moment. Nothing is emitted into the sink before that moment, and everything emitted afterwards applies on top of `snapshot`. Putting the snapshot in the result closes the race between "read the snapshot" and "the first event".
2. ✓ `snapshot()` always equals the open snapshot with every emitted event applied by `applyEvent`.
3. ✓ `close()` detaches the sink: **from the call on**, nothing is emitted and `control` methods and `answer` reject `closed`. It aborts nothing; a run in progress goes on in the backend. A second call does nothing. An in-process backend (CC's CLI child, Pi, Pi Durable) keeps whatever it needs alive until the run settles. An ask pending at `close`, or raised after it, is held by the adapter and appears in the next `open`'s snapshot, where it can be answered: every backend can re-deliver (CC keeps its own registry of pending callbacks, cc §8.7; Pi and Pi Durable asks are the bridge's own, pi §8.5, pd D8).
   **The core's side of it:** while a session's snapshot has an active run, a pending interaction, a compaction or retry under way, or queued input, the core keeps its `OpenSession` open, phones attached or not, so no ask is raised to nobody and no event is lost from the log. It closes a session only once it is idle, and never aborts a run to do so; bridge shutdown is the one exception, and then the asks expire (§9).
4. ✓ `dispose()` closes every open session and silences the catalog sink.
5. ✓ Optional methods carry capabilities. An absent `rename`, `delete`, `archive`, `fork`, `call`, `compact`, `cancelQueued`, `cancelCompaction` or `cancelRetry` *is* the capability being false; nothing declares it separately (§6). So is `SessionCapabilities.answer`: true exactly when `control` or `OpenSession.answer` exists (`sessionAnswerer`).
6. ✓ `abort()` ends the active run with outcome `aborted`; with no run it is accepted and emits nothing. It resolves once the backend has taken the abort (Pi's `abort()` awaits idle, pi §7). `run_finished` may follow the resolution.
7. ✓ `prompt` is idempotent per `clientRequestId` within the session for accepted prompts; a rejection is not remembered (§10).
8. ✓ A malformed answer is rejected `invalid_input` and changes nothing. An answer to a resolved interaction is rejected `stale`.
9. ✓ `setModel` takes a listed model and nothing else (`not_found`); `setThinking` takes one of the current model's thinking values (`invalid_input`); `setMode` takes a listed mode and one of its values (`invalid_input`). Each shows as the event that changes the snapshot (`model_changed`, `mode_changed`).
10. ✓ `readAttachment` reads back the bytes an `ImageRef` names; an unknown id is `not_found`.
11. ✓ A run another client starts is reported live exactly when `externalLive` says so, and survives a bridge restart (same `runId`) exactly when `durableRuns` says so.
12. The core opens at most one `OpenSession` per `SessionRef` at a time and fans its events out to phones. Adapters may assume this.
13. The sink, the catalog sink, and every adapter callback into the core never throw.
14. ✓ **Answering without control.** A session this bridge may watch but not control (`control` absent) may still take answers to its asks through `OpenSession.answer`: a `claude` in a terminal raises a permission prompt through the bridge's hook (Claude Code PLAN D26), and a person answers it from the phone or the lock screen while the terminal keeps the session. `answer` follows `SessionControl.answer` in everything: checked by the core's desk and `answerProblem` first, `stale` once resolved, `closed` after `close`. A session with `control` has no `answer` of its own; its answers go through `control.answer` as ever, so there is one path per session. Prompting, steering, stopping and every setting stay out of reach of a session without `control`.

**Catalog sink.** Backend-wide news: `session_updated{summary}`, `session_removed{session}`, `status_changed{status}`, `catalog_invalidated{scope: models|commands|modes}`, `transcript_invalidated{session}`. An adapter emits `transcript_invalidated` whenever a session's history is rewritten, so every phone re-reads it: after its own history-rewriting op (`rewritesHistory(kind)` in `backend-ops.ts`: Pi `navigate_tree`; §13), and when another client rewrites it. An adapter emits `session_updated` after its own create, rename, archive, fork and first persist, whenever a row's status, title, model or archived flag changes, and when a run ends. It emits `session_removed` after a delete. It relays external changes when the backend reports them. CC and Pi report nothing live, so their adapters watch the session directories (cc §13, pi §11). A session list is never broadcast whole. The core sends one `status_changed` of its own for each backend as it lands: backends start after the bridge listens, so a phone that listed the backends before may learn of one this way.

## 6. Capabilities

`Capabilities` replaces `RuntimeCapabilities`. The old type stays until a later phase deletes it. Most fields are **declared** by the adapter as `traits`. `fork`, `rename`, `delete` and `archive` are **derived** by `backendCapabilities(backend)` from whether the method exists, so they cannot lie. `SessionCapabilities` (`controllable`, `compact`, `cancelQueued`, `cancelCompaction`, `cancelRetry`, `answer`) are derived per open session by `sessionCapabilities(session)`. `answer` (since 1.4) says the session's asks can be answered here, controllable or not (§5 rule 14): the app shows an ask's Answer by it, and the composer by `controllable`. A field rather than a rule such as "interactions are answerable whenever there are any", because a watch-only session that takes no answers (a Pi terminal session, a Claude Code session written by a terminal without the hook) shows its asks without a button, and only the adapter knows which one it has.

Declared traits are checked against behaviour, both ways where the contract can observe it:

- The stream checker fails an adapter that emits an event its traits deny (a queue without `queue`, thinking deltas without `streamThinking`, an undeclared interaction kind or extension).
- The conformance driver must be able to produce every declared feature, interaction kind, attachment kind, mention kind and command, and each must reach the model as sent; an undeclared one is rejected `unsupported`.
- `promptModes` always holds `start` and lists no mode twice (the schema refuses otherwise); an undeclared mode is rejected `unsupported`.
- `modelSwitch` is checked with a model that names itself (the `echo_model` scenario): a model chosen mid-run reaches the run's next request exactly when it says `next_request`.
- `externalLive` and `durableRuns` are checked by a run another client starts and by a restart of the bridge (§14).
- `call` must exist exactly when `backendOps` is non-empty, and every declared op must answer in kind.

| Capability | Claude Code | Pi | Pi Durable |
|---|---|---|---|
| `streamText` | ✓ `stream_event` text deltas with `includePartialMessages` (cc §12) | ✓ `message_update` (pi §12) | ✓ commits ≤100 ms apart (pd D12) |
| `streamThinking` | ✓ unless `thinking.display:'omitted'` (cc §12) | ✓ (`redacted` arrives whole) | ✓ |
| `promptModes` | start, steer (`priority:'next'`), queue (`'later'`) (cc §6) | start, steer, queue (`followUp`) (pi §6) | start, steer, queue (`whenBusy`) (pd D6) |
| `attachments` | image (base64 blocks) (cc §6) | image (pi §6) | image (pd D6) |
| `mentions` | file (`@path` in text) (cc §6) | — | — |
| `commands` | ✓ slash commands, skills (cc §9) | ✓ extension commands, templates, skills (pi §9) | ✗ (pd D9) |
| `queue` (visible) | ✓ via internal `command_lifecycle`; default emission UNVERIFIED (cc §5, Q2) | ✓ `queue_update`, texts only (pi §5) | ✓ `inbox_update` (pd D5) |
| `interactions` | tool_permission, questions, form, plan_approval, external_url, choice (cc §8), confirm (empty MCP forms) | tool_permission (bridge-owned gate), choice, confirm, text (pi §8) | tool_permission (bridge-owned hook) (pd D8) |
| `modelSwitch` | `next_request` (cc §7) | `next_request` ("next turn") (pi §7) | `next_request` (pd D7) |
| `thinking` | ✓ effort levels (cc §7) | ✓ levels, clamped (pi §7) | ✓ levels, unclamped (pd D7) |
| `children` | ✓ subagents (cc §3) | ✓ a tool call's sub-run in its result's `details`, forks and handoffs (Pi README decision 32) | ✓ task-owned conversations (pd D3) |
| `usage` | ✓ (cc §5) | ✓ pulled after messages (pi §5) | ✓ (pd D5) |
| `plan` (todo) | ✓ TodoWrite / Task tools, model-dependent (cc §13) | ✗ | ✗ |
| `planProposals` | ✗ (the plan reaches the app as a `plan_approval`) | ✗ | ✗ |
| `externalLive` | ✗ file tail only (cc §11) | ✓ a terminal `pi` through the terminal link (Pi README decision 19) | ✗ no external writers (pd D11) |
| `durableRuns` | ✗ the CLI child dies with the bridge (cc §1) | ✗ in-process (pi §1) | ✓ (pd D1) |
| `extensions` | rate_limit, prompt_suggestion (1.4) | — | — |
| `backendOps` | rewind_files; since 1.4 session_settings, changed_files, refresh_models, config_files, config_file, settings_overview, mcp_servers, plugins, tasks, context_usage, custom_tools, custom_tool | navigate_tree, take_over, session_settings, session_tools, system_prompt, export_session, export_part, import_session, changed_files, refresh_models, read_tree, label_entry, abort_branch_summary, run_shell | — |
| `fork` (derived) | ✓ `forkSession` (cc §7) | ✓ `runtime.fork` (pi §7) | ✓ (pd D7) |
| `rename` | ✓ | ✓ `setSessionName` | ✓ bridge `meta.json` |
| `delete` | ✓ | ✓ bridge deletes the file (pi §3) | ✓ bridge directory |
| `archive` | ✗ (cc §3) | ✗ | ✗ |
| `compact` (session) | ✓ as a `/compact` prompt (cc §7) | ✓, but refuse while running: Pi's `compact()` aborts the run (pi §7) | ✓ (pd D7) |
| `cancelQueued` (session) | per item through `cancel_async_message`, which no capability gates but is runtime-only (cc §6, Errata 10; availability Q4). `interrupt_cancel_queued_v1` gates something else: the abort that also cancels every queued command | ✗ clear-all only (pi §6) | ✓ `submission.abort()` |
| `controllable` (session) | ✗ for terminal sessions (cc §11) | ✗ for terminal sessions (pi §11) | ✓ |

## 7. Events

Events are the normalized live stream, adapter → core → phone.

```
EventEnvelope { session: SessionRef, seq: int ≥1, at: Timestamp, event: AgentEvent, native?: NativeIds }
SinkRecord    = EventEnvelope without seq and session      // what an adapter emits
```

**Sequence and order.**

- `seq` is assigned by the core: 1, 2, 3… per session and stream epoch, without gaps (§12.2). The adapter emits in causal order.
- Every backend delivers a session's events in order: CC is one pipe (cc §1); Pi is synchronous (pi §5); Pi Durable emits one batch per commit (pd D5).
- Content between `run_started` and `run_finished` belongs to that run by position, so events carry no `runId` except the run events themselves and `Interaction.runId`.

**Stream rules**, checked by `contract/testing/stream-rules.ts` in every conformance scenario:

1. `run_started` only with no active run; `run_finished` names the active run. Exactly one `run_finished` per `run_started`.
2. Blocks and tools start inside a run; every block and tool of a run finishes before its `run_finished`; ids are never reused in a session, counting the ids the starting snapshot holds (open, running, or finished in `run.items`) and every id seen before a `resynced`.
3. `block_delta`/`block_finished` name an open block. If any delta was sent, `block_finished.text` equals the concatenated deltas.
4. `tool_updated`/`tool_finished` name a running tool. A nested call's `parentToolCallId` names a running tool.
5. Every `interaction_requested` id is new and is resolved exactly once. A blocking interaction names the active run. When a run finishes, none of its interactions is pending.
6. `retry_finished` follows a `retry_scheduled`; `compaction_finished` follows a `compaction_started`, and a compaction does not start while one is under way. No retry or compaction is under way at `run_finished`. A stream at rest has none open either.
7. Declared traits gate events: thinking deltas need `streamThinking`, text and plan deltas `streamText`, plan blocks `planProposals`, `queue_changed` `queue` (item ids unique), `usage_updated` `usage`, `plan_updated` `plan`, child sessions `children`, extensions their declared kind, interactions their declared kind.
8. `resynced` resets what is open to its snapshot; the ids seen so far stay seen.
9. An `activity` comes inside a run, and none is still `running` when its run finishes (since 1.4).

**The events and their sources.** "synth." means the adapter synthesizes the event.

| Event | Meaning | Claude Code | Pi | Pi Durable |
|---|---|---|---|---|
| `run_started{runId, trigger}` | The agent began a run | synth.: first frame after a send to an idle session, or opt-in `session_state_changed running` (cc §5) | synth.: first `agent_start`/`compaction_start` while idle, or `preflightResult("started")` (pi §5) | `run_start` (pd D5) |
| `run_finished{runId, outcome}` | It will not continue on its own | at settle: `idle` after `result` with `queued_turn_count == 0` and no background tasks (cc §5) | `agent_settled` (pi §5) | `run_end` with no `run_start` in its batch, plus the submission's status (pd D5) |
| `user_message` | Input reaching the model, including delivered steer and queue input | the adapter's own send; `user` echoes with `replay-user-messages` (cc §5) | `message_start` role user (pi §5) | `pi.user` entry (pd D4) |
| `block_started/delta/finished` | One text, thinking or plan block | `stream_event` `content_block_*`; whole `assistant` frames (cc §5) | `text_*`/`thinking_*` in `message_update` (pi §5) | `message_update.changes` (pd D5) |
| `tool_started/updated/finished` | One tool call | `tool_use`; `tool_progress`; `tool_result` + `tool_use_result` (cc §13) | `tool_execution_*`; `partialResult` is a snapshot (pi §5) | `tool_execution_*`; output trim/append windows (pd D5) |
| `interaction_requested/resolved` | A human is asked; the ask ended | `canUseTool`, `onElicitation`, `onUserDialog`; resolved synth. (cc §8) | bridge dialogs and `tool_call` gate; resolved synth. (pi §8) | `beforeTool` hook; resolved synth. (pd D8) |
| `queue_changed{items}` | The whole pending queue | `command_lifecycle` (cc §5) | `queue_update` (pi §5) | `inbox_update` (pd D5) |
| `compaction_started/finished` | Context compaction | `status:'compacting'` … `compact_boundary` + `compact_result` (cc §5) | `compaction_start/end` (pi §5) | `compaction_start/end` (pd D5) |
| `retry_scheduled/finished` | A transient failure will be retried | `system/api_retry`; finish synth. (cc §5) | `auto_retry_start/end` (pi §5) | `auto_retry_start/end` (pd D5) |
| `usage_updated{usage}` | Session totals changed | `result` `modelUsage`, `total_cost_usd`; `getContextUsage` (cc §5) | pull after `message_end` (pi §5) | `usage_changed` (pd D5) |
| `plan_updated{plan}` | The todo list, whole | `TodoWrite` (replace) / `TaskCreate/Update` (accumulated) (cc §13) | — | — |
| `messages_retracted{messageIds}` | Withdrawn messages disappear, with their blocks and tool calls (and those calls' results), open or finished | `retracted_message_uuids`, `supersedes` (cc §5) | — | — |
| `model_changed{modelId?, thinking?}` | Model and thinking, both replaced | the adapter's `setModel`; per-turn `system/init` (cc §5) | the adapter's own calls; `thinking_level_changed` (pi §5) | `agent_changed` (pd D5) |
| `mode_changed{axis, value}` | One session mode now has `value` (§11.5) | `system/status.permissionMode`, the adapter's own `setPermissionMode` (cc §5, §7) | — | — |
| `notice{level, text}` | Something to show, not a turn | `system/informational`, `system/notification` (cc §5) | extension `notify` (pi §8) | — |
| `activity{activity}` (since 1.4) | Work the harness ran around the turn, such as a hook: `{id, label, detail?, status: running\|succeeded\|failed\|cancelled, output?, durationMs?}`. A later one with the same `id` replaces it; it is one item in `run.items` (the reducer keeps where and when it began) and in the transcript. A client below 1.4 is sent a `notice` with the same `seq` (a warning when it failed), and reads an `ActivityItem` as a `NoticeItem` with the same id in a snapshot or a transcript page | `system/hook_started`, `hook_progress`, `hook_response` with `includeHookEvents` | — | — |
| `error{error, retryable}` | A failure outside a run's outcome | process exit, transport error (cc §1) | — | `onReport`, `harness.closed` (pd D14) |
| `extension{extension}` | Typed per-backend extra (§13) | `rate_limit_event` | — | — |
| `session_replaced{session}` | The live session goes on under a new id; this event is the last under the old one. A phone away when it happened is told at its next attach (§12.2). `session` may also name the same session: what it allows changed (Pi: a terminal began or ended running it, or a phone took it over), and the only way to hand viewers the new `SessionCapabilities` is a new stream | `conversation_reset` (`/clear`, plan-exit context clear) (cc §5) | — (the adapter hosts one runtime per session, pi §1) | — |
| `input_returned{texts}` (since 1.2) | Input the backend took back out of its queue because the run was stopped, in the order the backend's own interface would restore it; the client puts it back where the human types. Not state: the reducer ignores it. Needs `queue`. A client below 1.2 is sent a `notice` with the same texts and the same `seq` | — | `abort` after `clearQueue()` (pi §7) | — |
| `resynced{snapshot}` | The live state is replaced | the CLI child restarted | — | a replacement snapshot for a slow watcher (pd D5) |

**Run triggers.** `prompt` (input through this bridge, including an action the backend runs as a run), `queue` (a queued prompt dispatched as the previous run ended: Pi Durable chained runs, pd D5), `system` (goal, wakeup, background task, restart recovery: cc §5), `external` (another client, such as a terminal run).

**Run outcomes** (`RunOutcome`):

| Outcome | Claude Code `terminal_reason` (cc §5) | Pi (pi §5) | Pi Durable (pd D5) |
|---|---|---|---|
| `completed` | `completed`, `background_requested`, `stop_hook_prevented`, `hook_stopped` | `stopReason` stop/toolUse | submission `done` |
| `aborted` | `aborted_streaming`, `aborted_tools` | `aborted:true` / `stopReason:"aborted"` | `unanswered{aborted}` |
| `error{ErrorInfo}` | `prompt_too_long`, `model_error`, `api_error`, … (BIN `isError`) | `stopReason:"error"` | `unanswered{model_error, no_model, faulted, run_failed}` (Q34) |
| `limit{max_turns\|budget\|output_tokens}` | `max_turns`, `budget_exhausted`, `max_output_tokens` | `stopReason:"length"` | — |
| `suspended` | — | — | — |
| `deferred` | `tool_deferred` | `stopReason:"deferred"` | — |

`ErrorCode` normalizes CC `SDKAssistantMessageError` (cc §2) and Pi's error strings. The full mapping is in §15. The native code may go in `envelope.native`.

**Block kinds.** `text`, `thinking`, and `plan`, the last for a plan the agent proposes. The todo list is not a block; it is `plan_updated`.

**Tool updates** (`ToolUpdate`). `input` delivers the complete input once a backend that streams arguments finishes (CC `input_json_delta`, cc §13; Pi `toolcall_*`, pi §5). The other kinds:

- `output_appended`: Pi Durable `append`.
- `output_replaced`: Pi `partialResult` snapshots and the tail of a `!` command, Pi Durable `set` and `trimStart`.
- `progress`: CC `tool_progress`.
- `file_changes`: a backend's patch update, replacing the previous list.
- `child_session`: Pi Durable `details.conversationId` (pd D5), CC subagent `agent_id` (cc §3).

**Children.** A subagent's session is a session of its own: its events go to its own `OpenSession` when one is open, and its row reaches lists through the catalog. CC forwards a subagent's tool calls (and its text with `forwardSubagentText`) inside the parent's run (cc §5); those stay in the parent's stream, nested by `parentToolCallId`.

**Tool results** (`ToolResult`) carry `content` (text, images by `ImageRef`, file references), `fileChanges` (CC `structuredPatch`/`gitDiff`, cc §4; Pi edit `details.diff`, pi §4), `error`, and `exitCode` where the backend has one: CC's `BashOutput` has none (Errata 5). `ToolOutcome` is `completed | failed | denied | aborted`.

## 8. Live state, snapshot and reconnect

`SessionSnapshot` is the live state: the active run with everything it has finished so far (`run.items`), open blocks with the newest `MAX_TEXT_CHARS` characters of their text, running tools with the newest `MAX_TEXT_CHARS` characters of their output, pending interactions, the queue, model, thinking and modes, usage, the todo plan, a compaction or retry in progress, and `lastOutcome`. Finished runs are read from the transcript.

`applyEvent(snapshot, {at, event})` in `session-reducer.ts` is the executable meaning of every event. Adapters, the core, and (in Phase 3) the app all agree with it. `sessionStatus(snapshot)` derives `idle | running | waiting_for_user | suspended`: waiting while a pending interaction blocks the run, suspended after a `suspended` outcome.

**Reconnect is two-sided.**

- *Phone ↔ bridge* is the core's job: a per-session event log with `seq`, plus the snapshot it maintains with `applyEvent`. A phone reattaching with `{epoch, seq}` gets the missed events, or, if the log no longer reaches back or the epoch changed, a `SnapshotSync` (§12.2). No backend offers replay, so the bridge must: CC (cc §10), Pi (pi §10); Pi Durable is snapshot-first by design (pd D10).
- *Bridge ↔ backend* is the adapter's job. After a gap it re-reads (Pi Durable's snapshot, pd D10) and either emits corrective events or one `resynced{snapshot}`. Partial text lost in the gap reappears at the block's authoritative `block_finished`.

**Transcript vs live: the merge rule.** A phone attaching mid-run must render the run's finished part, its open part and the history before it, with no duplicate and no gap. Transcript ids cannot be the key: Pi has no ids until an entry is persisted (pi §5, Q28). So the contract splits the two by run instead of by id:

1. **The snapshot carries the active run whole.** `run.items` holds every item the run has finished, oldest first, in the live stream's ids, exactly as `applyEvent` builds them from the events (`run-items.ts`): its user messages, finished blocks, tool calls as they start (completed with their final input and child session when they finish) and tool results (`<toolCallId>:result`). Notices, compaction markers and model changes stay out; the live state already shows them. A retraction removes the retracted messages' items; `session_replaced` empties the list, because what came before belongs to the old session. Past 1,000 items the oldest leave and `run.droppedItems` counts them.
2. **The transcript holds finished runs only.** While a session open in this bridge has an active run, `readTranscript` ends just before that run's first item. Each backend knows where its run starts: CC the first chain entry after the send (cc §4), Pi the leaf at run start (pi §4), Pi Durable the last committed entry id at `run_start` (pd D4).
3. **At `run_finished` the phone re-reads the transcript's newest page** and replaces the run's live rendering with it.

The snapshot and the events that follow it are consistent by construction (§5 rule 1), and the transcript never overlaps them, so neither a race nor an id mismatch can double or drop an item. The cost is a larger snapshot for a long run; the bound and `droppedItems` keep it finite.

## 9. Interactions

One model for every question a backend asks a human.

```
Interaction { id, runId?, createdAt, expiresAt?, title, body?, blocksRun, origin?{toolCallId?, toolName?, parentToolCallId?}, request: InteractionRequest }
InteractionAnswer { interactionId, reply: InteractionReply }
interaction_resolved { interactionId, reason: answered | withdrawn | expired }
```

**Kinds** (`InteractionRequest`), and the reply each takes:

| Kind | Request | Reply |
|---|---|---|
| `tool_permission` | `input?` (editable when `inputEditable`), `reason?`, `previews[]` (command, file changes, network host, paths), `options[]`, `grants[]`, `defaultOptionId?`, `deliberate` | `{optionId, message?, editedInput?, grantIds[]}` |
| `questions` | `questions[]`: `{id, header?, text, options[{label, description?, preview?}], multiSelect, allowCustom, secret, required}` | `{answers[{questionId, selected[], custom?}]}` |
| `form` | `fields[]` (`FormFieldSpec`), `server?` | `{values: {key → FormValue}}` |
| `plan_approval` | `plan` (markdown), `editable`, `path?`, `modeOptions?{axis, options[], defaultValue?}` (since 1.4: the values of a mode axis the session may go on in once approved) | `{decision: approve\|reject, plan?, feedback?, modeAfter?}` (`modeAfter` since 1.4) |
| `external_url` | `url`, `server?` | `{}` (opened, consent to continue) |
| `choice` | `options[{value, label, description?}]` | `{value}` |
| `confirm` | (title and body say it) | `{confirmed}` |
| `text` | `placeholder?`, `initialText?`, `multiline` | `{text}` |
| any | | `cancel{stopRun, message?}` |

**Permission options.** Each `PermissionOption` is `{id, label, effect: allow|deny, scope: once|turn|session|always, stopsRun, message: none|optional|required, rule?}`. The adapter builds the options from what the backend offers and maps the chosen `id` back to the native payload, so allow-once, allow-for-session, allow-always-with-rule, deny-and-continue-with-message and deny-and-stop all fit one shape. `grants` carry a requested permission profile; allowing grants a non-empty subset.

**Cancel.** `cancel{stopRun, message?}` answers any kind: the human dismissed it. `stopRun` says whether the run ends. No backend times out on its own (cc §8.8, pi §8.4, pd D8), and the bridge has no timeout policy either: nothing answers for a human. An interaction ends only when a human answers or cancels it, or the backend withdraws it or lets it expire. `expiresAt` is the backend's own deadline, shown and never acted on.

**Validation.** `answerProblem(interaction, answer)` faults:

- a reply of the wrong kind;
- an unknown option, question or field;
- a message the option forbids or lacks;
- edited input when not allowing an editable request;
- grants outside the request, an allow with no grant, or a deny with grants;
- question answers that break `multiSelect`, `allowCustom` or `required`;
- form values of the wrong type, out of bounds, off-pattern, off-format or not an option;
- an empty answer to a required string or multiselect field;
- answers to inactive fields, and missing required active fields (a hidden one counts as answered only when it has a default, which the adapter fills in);
- an external field not acknowledged with `true`;
- plan feedback on an approval, an edited plan on a rejection or on a non-editable plan, a `modeAfter` on a rejection, on a plan that offers no modes, or that is not one of the `modeOptions`;
- a choice that is not an option;
- newlines in single-line text.

**Field keys.** A field's `key` is any string but `__proto__` (`FieldKey`; the JSON Schema says so as a `pattern`). A reply holds its answers in an object keyed by field key, and `JSON.parse` gives such an object a `__proto__` key of its own that zod's record parse then drops without a word, so a field so keyed could never be answered. The schema refuses the key in a field, a `when` condition and a reply (`invalid_message` naming it), and an adapter whose backend names a field `__proto__` owns the mapping: it shows the phone another key, unique among the form's, and maps the answer back to the backend's. Only `__proto__` is lost: every other name an object, a function or an array inherits, and the names around them, survives the parse (a test holds more than fifty of them to it). Any backend can name one: an MCP server's elicitation schema chooses its property names (cc §8.4).

`fieldIsActive` evaluates `when` (all conditions must hold; `eq` against a multiselect means "includes"; a condition on an unanswered field is false).

Where backends validate differently, `field-check.ts` is the strictest of them, so no backend refuses an answer it passes (Errata 8):

- `minLength` counts code points and `maxLength` UTF-16 units, so the value passes both readings.
- A `pattern` must match both compiled without flags and as JSON Schema means it (the `u` flag); a pattern neither compiles makes every answer fail.
- An email needs a dotted domain.
- A `date` is a real calendar day (`2026-02-30` is not); a `date-time` is RFC 3339 with an offset, a real day and a clock time.

**Resolution.** The adapter emits `interaction_resolved` exactly once:

- `answered` when this bridge's answer reached the backend.
- `withdrawn` when the backend ended the ask without that answer: run interrupted, tool call ended, another client answered, or a batch reject.
- `expired` when nothing can answer it any more: the backend process or the bridge restarted.

The core gives first-answer-wins across phones by calling `answer` once and refusing later answers `stale`. It re-delivers pending interactions on reattach from the snapshot, and never answers one on its own: a phone may come back hours later and the ask is still pending. When a backend loses pending asks on restart (CC, Pi) and re-asks after recovery, the re-ask is a new interaction.

**Per backend.** "✗" means the backend has no such ask; the capability omits the kind.

| Kind | Claude Code | Pi | Pi Durable |
|---|---|---|---|
| `tool_permission` | `canUseTool` (cc §8.1). Options: allow once; one allow-always per `permission_suggestions` (rule text, `PermissionUpdate[]` echoed); deny (message, `interrupt:false`); deny-and-stop (`interrupt:true`). `suppress_always_allow_rule` drops always; `default_to_no` → `defaultOptionId`; `requires_user_interaction` → `deliberate`; `updatedInput` → `inputEditable`. Previews from the tool input and `blocked_path`. | Bridge-owned `tool_call` gate: allow once/session/always (bridge policy), deny (`block` + reason), deny-and-stop (block + abort); `input` mutable (pi §8.6). | `beforeTool` hook: allow, deny (`block`), deny-and-stop (block + `abort`); `arguments` replace input; verdict memoized per task (pd D8). |
| `questions` | `AskUserQuestion` via `canUseTool` (cc §8.2). Question id = index; answers mapped to question-text keys, multi-select comma-joined; `allowCustom` always (CC adds "Other"); `required` unless the CLI advertises `ask_user_question_unanswered_v1`. Cancel → deny (`interrupt` = `stopRun`). | ✗ | ✗ |
| `form` | `onElicitation` form mode: `requestedSchema` + `property_order` → fields (cc §8.4). Submit → `accept` + `content`. | ✗ | ✗ |
| `plan_approval` | `ExitPlanMode` via `canUseTool` (cc §8.3): approve → `updatedInput.plan` = edited plan; reject → deny with feedback. | ✗ | ✗ |
| `external_url` | Elicitation `url` mode, completion via `elicitation_complete` (cc §8.4). | ✗ | ✗ |
| `choice` | `onUserDialog` `refusal_fallback_prompt`: `retry_fallback` / `edit_prompt` (cc §8.5). | `ctx.ui.select` (pi §8). | ✗ |
| `confirm` | an elicitation with an empty schema | `ctx.ui.confirm`. | ✗ |
| `text` | ✗ | `ctx.ui.input` (single line), `ctx.ui.editor` (multiline, `prefill` → `initialText`). | ✗ |
| cancel → native | deny `{message, interrupt: stopRun}`; elicitation `decline` (+ `interrupt()` when `stopRun`); dialog `{behavior:'cancelled'}` | `{cancelled:true}`; gate `block` (+ abort) | `block` (+ `abort`) |
| resolved: withdrawn | `control_cancel_request` (cc §8.7) | extension timeout or abort signal (pi §8.4) | task context aborted (pd D8) |
| resolved: expired | CLI child died (cc §8.7) | bridge restart (pi §8.5) | bridge restart; the rerun re-asks (pd D8, Q33) |

## 10. Input

```
PromptInput { clientRequestId, mode: start|steer|queue, text, attachments[], mentions[], command? }
PromptResult = accepted{disposition: started|steered|queued|handled, queueItemId?} | Rejected
Rejected { status: rejected, rejection: Rejection }
Rejection { code: busy|not_steerable|no_model|auth|invalid_input|unsupported|not_found|stale|closed|backend_error, message }
```

**Modes.** `start` begins a run and is rejected `busy` while one is active. `steer` joins the active run at its next safe boundary. `queue` is delivered when the agent would otherwise stop: CC and Pi go on with it inside the same run (cc §5 `queued_turn_count`; pi §6 `followUp`), while Pi Durable starts the next run (pd D5). With no active run, `steer` and `queue` start one (disposition `started`).

| | Claude Code | Pi | Pi Durable |
|---|---|---|---|
| start | open-stream send (cc §6) | `prompt()` when idle (pi §6) | `submit` (pd D6) |
| steer | `priority:'next'` | `prompt{streamingBehavior:"steer"}` | `whenBusy:"steer"` |
| queue | `priority:'later'` | `followUp` | `whenBusy:"followUp"` |
| idempotency | `uuid` = `clientRequestId`; dedupe of a repeat unverified (Q3) | none; the adapter dedupes (pi §6) | `requestId` = `clientRequestId`, durable (pd D6) |
| accepted signal | none synchronous; the adapter accepts on write (cc §6) | `preflightResult` (pi §6) | `submit` resolved (pd D6) |
| typed rejections | — | `no_model`, `auth`, `busy` (compacting) (pi §6) | `busy` (`ConversationBusy`) (pd D6) |
| command | text `/name args` (cc §6) | text `/name` or `/skill:name` (pi §6) | ✗ |

**Rules.** Every prompt carries a `clientRequestId`. The adapter de-duplicates within an open session: a repeat of an **accepted** prompt returns the first result and does nothing else. A rejection is not remembered, so a phone that retries with the same id after the cause is gone (the run that made it `busy` ended, the user signed in) is served; no backend admits anything on a rejection either (Pi Durable writes nothing on `ConversationBusy`, pd D6). It passes the id to backends that persist it (CC `uuid`, Pi Durable `requestId`). The core de-duplicates across bridge restarts. The prompt's `user_message` carries its `clientRequestId`, which is how a phone matches its optimistic bubble. Every phone prompt is human input, so the adapter stamps the backend's human attribution itself (CC `origin:{kind:'human'}`, which changes `priority:'now'` semantics, cc §6). Failures after acceptance are events, not rejections (pi §6).

**Mentions and attachments.** `Attachment` = `ImageContent{mimeType, data(base64)}` | `FileContent{uri, mimeType?}`; the images of one prompt hold at most 4 MiB of base64 together. `Mention` = `file{path}` | `agent{name}`, for backends that take structured mentions; CC takes `@path` in the text (cc §6).

**Images go back by reference.** Inline bytes travel only in a prompt and in an `attachment.read` answer. Everything the bridge sends about input, the live `user_message` and the transcript's `user_message` items alike, carries `AttachmentRef` = `ImageRef{id, mimeType, name?}` | `FileContent`, and tool results carry `ImageRef` too (`ToolContent`). `readAttachment(session, id)` returns the bytes. Every backend keeps them where an id can find them: CC and Pi in the session JSONL (entry and block index, cc §4, pi §4), Pi Durable in the entry (pd D4). This keeps a 200-item transcript page small whatever its images weigh.

**Queued input after an abort.** An abort leaves the queue as the backend leaves it, and `queue_changed` shows the result: Pi Durable withdraws queued input (pd D7); Pi clears both queues on Stop and hands the texts back in `input_returned` (since 1.2), as the terminal's Esc does (pi §7); Claude Code keeps queued commands unless the interrupt cancels them (cc §7). What stays is delivered by a later run, as the backend schedules it, and can be cancelled where `cancelQueued` exists. What a backend takes back out is handed to the human in `input_returned{texts}` (since 1.2): the app joins those texts with a blank line between them and puts them in front of what is already typed, and nothing is sent again by itself.

## 11. Read models

### 11.1 Sessions

`SessionSummary { session, title?{text, source: user|generated|first_prompt}, cwd?, createdAt?, updatedAt, parent?{kind: fork|subagent, session}, archived, modelId?, status, origin: broski|external, source? }`, listed newest-updated first by `listSessions(SessionQuery{cwd?, archived, parent?}, PageRequest)`.

| Field | Claude Code (cc §3) | Pi (pi §3) | Pi Durable (pd D3) |
|---|---|---|---|
| title | `customTitle` user / `aiTitle` generated / prompts first_prompt | `name` user / `firstMessage` | Broski `meta.json` |
| cwd | `cwd` | header `cwd` (`""` for old sessions → absent) | `meta.json` |
| createdAt / updatedAt | `createdAt?` / `lastModified` | `created` / `modified` | `meta.json` |
| parent | ✗ fork link not exposed (Q10); subagents via `listSubagents` | `parentSessionPath` fork (path → id by the bridge index) | `parent` fork, `owner` subagent |
| archived | always false | always false | false |
| status | live for hosted sessions, else `unknown` | live for hosted sessions, else `unknown` | live |
| origin | `entrypoint` `cli` → external | the bridge's index | always broski |
| paging | offset/limit, unstable under inserts; dedupe by id (cc §3) | none: a bridge-side index (pi §3) | none: Broski directories |

**Paging rules** (`PageRequest{cursor?, limit 1..200}`):

- Every page is newest first.
- `nextCursor` is opaque, minted only by the adapter that will read it.
- A page may be shorter than `limit` without being the last; only an absent `nextCursor` ends the list.
- A cursor the adapter did not mint is rejected `invalid_input`.
- On a list nobody changes, the pages concatenate to exactly the one-page list, with no duplicates or gaps (conformance). On a changing list, rows can move; the app de-duplicates by id.

### 11.2 Transcript

`readTranscript(session, page)` returns `TranscriptPage{items, nextCursor?, idStability: stable|positional}`, newest first. Items are flat, one per block, so a page boundary can never split a message. Items of one assistant message share `messageId`. A page holds finished runs only (§8) and names images by reference (§10).

| Item | Claude Code (cc §4) | Pi (pi §4) | Pi Durable (pd D4) |
|---|---|---|---|
| `user_message` | `user` text + image blocks | role `user` | `pi.user` |
| `block` (text/thinking/plan) | one `assistant` line per block | `text`/`thinking` blocks | assistant blocks |
| `tool_call` + `tool_result` | `tool_use` + `tool_result`/`toolUseResult` | `toolCall` block + `toolResult` | assistant `toolCall` + `pi.tool-result` |
| `notice` | `system` informational | `custom` display, `branchSummary` | `pi.reset` |
| `compaction` | `compact_boundary` (+ tokens) | `compaction` (summary, tokens) | `pi.compaction` |
| `model_change` | `attachment.type:"model"` (disk only) | `model_change`, `thinking_level_change` | `agent_changed` history |
| `run_boundary` | `turn_duration` / `result` (disk) | — | — |
| `activity` (since 1.4) | a hook's `attachment` (`hook_success`, `hook_non_blocking_error`, …), after the entry it follows | — | — |
| ids | entry `uuid`, stable | entry ids stable | entry ids stable |
| paging | chain offset from the start; whole file parsed (cc §4) | none: whole file (bridge pages) | native cursor |

### 11.3 Models and thinking

`ModelSummary{id, displayName, description?, providerId?, providerName?, contextWindow?, inputModalities?, thinking: ThinkingSpec, isDefault, unavailableReason?}`. A plain `models.list` holds usable models only. With `includeUnavailable` (since 1.3) the models the backend knows but cannot use now follow them, each with an `unavailableReason` that says what is missing; `setModel` refuses one (`auth`), and the conformance rule for models checks the order and the reason. `ThinkingSpec{options[{value, label?, description?}], defaultValue?}`: no options means thinking cannot be set. `setThinking(value)` takes one of the current model's option values and nothing else; anything else is rejected `invalid_input`. `setModel(id)` takes a listed model; anything else is rejected `not_found`. The snapshot's `modelId` is the model chosen; `modelSwitch` says when the choice reaches the model.

| | Claude Code | Pi | Pi Durable |
|---|---|---|---|
| list | `supportedModels()` (cc §9) | `refresh({allowNetwork:false})` + `getAvailable()` (pi §9) | the shared Pi `ModelRuntime` (pd D9) |
| `id` | `value` (alias or id) | `provider/id` | `provider/modelId` |
| thinking options | `supportedEffortLevels` (cc §7, Q11) | `getSupportedThinkingLevels(model)` (Errata 1) | same levels, unclamped (Q32) |
| default | — | per-model or global default, clamped | — |
| context window | ✗ until `modelUsage` (cc §9) | `contextWindow` | `contextWindow` |
| `isDefault` | — | settings default | — |

### 11.4 Commands, usage, status

- `CommandSummary{id, name, kind: command|skill|prompt, description?, argumentHint?}`. A prompt invokes one with `PromptInput.command = id` and its arguments as `text`. Sources: CC `SlashCommand` and skills, with `terminal_slash_commands` filtered out (cc §9); Pi extension commands, prompt templates and skills (pi §9). Pi Durable has none.
- `Usage{inputTokens?, outputTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens?, costUsd?, contextTokens?, contextWindow?}` holds session totals as reported; an unreported field is absent. CC `modelUsage` is cumulative per CLI process (cc §5). Pi's is `getContextUsage()` and may be null after compaction (pi §18 #23).
- `BackendStatus{installed, version?, auth: signed_in|signed_out|unknown, usable, issues[]}`, from cc §2, pi §2, pd D2. Finding it out never fails: a Pi `ModelRuntime` error (`getError()`, pi §2) becomes an `error` issue with `usable: false`. The catalog lists that can fail return a result: `listModels`, `listCommands`, `listModes`.

### 11.5 Session modes

The settings a session runs under that change what the agent may do or how it works: Claude Code's permission mode, Pi's thinking level and the like. They are normalized, because the research shows one shape behind them, the same shape the contract already uses for thinking:

| | Claude Code | Pi | Pi Durable |
|---|---|---|---|
| what | `PermissionMode` (cc §7) | none (pi §7) | none (pd D7) |
| finite list | fixed enum: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto` (`sdk.d.ts:2562`) | — | — |
| at start | `Options.permissionMode`, always passed (cc §14 #2) | — | — |
| set later | `Query.setPermissionMode`, mid-run | — | — |
| changed elsewhere | `system/status.permissionMode` | — | — |

So the contract has **mode axes**: `ModeAxis{id, label, description?, options: Option[], defaultValue?}`, listed by `listModes(cwd)` (a backend's modes may depend on the directory), each session's current values in `snapshot.modes: ModeSetting{axis, value}[]` (one per listed axis), `mode_changed{axis, value}` when one changes, `setMode(axis, value)` to change one (an unknown axis or value is `invalid_input`), and `NewSessionOptions.modes` to start in them. Values are opaque, like thinking values: the app shows the backend's labels and never branches on a value. What a value allows is said in its option's `description`, which is where an adapter words a risk such as `bypassPermissions`. A list that changes is `catalog_invalidated{scope: modes}`.

What this leaves out, and why, is in §15: when a change takes effect is not a capability, because no backend lets the contract observe a mode's effect (a permission mode changes which tools ask, not anything the model or the stream shows), so it could not be checked; for CC it is mid-run. Typed per-backend ops were the alternative; they would have put backend-specific panels in the app for one concept the backends share.

## 12. Wire protocol

Layer 2: one schema generates both ends (`protocol.ts` → `lib/contract/generated/protocol.dart`).

### 12.1 Messages

Every client message is a request `{type, requestId, …}` answered by exactly one `{type: "<type>.result", requestId, …}` or an `error`. `ResponseFor<T>` types the pairing.

| Request | Answer |
|---|---|
| `hello{protocol, client}` | `{protocol, bridgeVersion}` |
| `backends.list` | `{backends[{id, capabilities}]}` |
| `backend.status{backend}` | `{status}` |
| `models.list{backend, cwd?, includeUnavailable?}` | `{result: ModelsListed{models} \| Rejected}` |
| `commands.list{backend, cwd?, session?}` | `{result: CommandsListed{commands} \| Rejected}` |
| `modes.list{backend, cwd?}` | `{result: ModesListed{modes} \| Rejected}` |
| `sessions.list{backend, query, page}` | `{result: SessionsListed{page} \| Rejected}` |
| `session.get{session}` | `{result: SessionFound{summary} \| Rejected}` |
| `session.create{backend, options}` | `{result: NewSessionResult}` |
| `session.fork{session, at?}` | `{result: NewSessionResult}` |
| `session.rename{session, title}`, `session.delete{session}`, `session.archive{session, archived}` | `{result: ActionResult}` |
| `session.attach{session, resume?}` | `{capabilities: SessionCapabilities, sync: AttachSync}` |
| `session.detach{session}` | `{}` |
| `transcript.read{session, page}` | `{result: TranscriptRead{page} \| Rejected}` |
| `attachment.read{session, attachmentId}` | `{result: AttachmentRead{image} \| Rejected}` |
| `prompt{session, input}` | `{result: PromptResult}` |
| `abort`, `interaction.answer{answer}`, `queue.cancel{queueItemId}`, `model.set{modelId}`, `thinking.set{thinking}`, `mode.set{axis, value}`, `compact{instructions?}`, `compaction.cancel` (since 1.3), `retry.cancel` (since 1.3) | `{result: ActionResult}` |
| `backend.call{call}` | `{result: BackendCallResult}` |

Server-pushed messages: `event{envelope}` (§7) and `catalog{backend, event}` (§5).

Every `…Listed`/`…Found`/`…Read` member is `{status: "accepted", …}`, and every result union shares the one `Rejected` member. `error{requestId?, error{code: invalid_message|unsupported_version|unknown_backend|unknown_session|not_attached|rate_limited|internal, message}}` is only for a request the bridge could not handle at all; `requestId` is absent when the message carried none the bridge could read. `rate_limited` means the request was not served because its connection sent too much too fast; it may be sent again a few seconds later. Every request gets exactly one answer: the bridge answers `internal` itself when a backend has not finished a request within its deadline. An operation the backend lacks is an `unsupported` rejection inside the normal result, because capabilities already told the app.

### 12.2 Attach and replay

`session.attach{session, resume?: {epoch, seq}}` answers `sync`:

- `replay{epoch, afterSeq}`: events from `afterSeq + 1` follow as `event` messages.
- `snapshot{epoch, lastSeq, snapshot}`: the live state after `lastSeq`; events from `lastSeq + 1` follow.
- `replaced{epoch, session}` (since 1.1): the stream `epoch` ended in `session_replaced`, and its conversation goes on as `session`, after any further replacement. The client is attached to neither session and nothing follows: it attaches to `session` next (without `resume`, which names another session's stream). The answer's `capabilities` are `session`'s own, since the bridge opens it to give them.

The bridge replays only when it still holds every event after `resume.seq` in the same epoch. A bridge restart starts a new epoch.

**A session replaced while the phone is away.** `session_replaced` reaches only the clients viewing the stream. The core therefore remembers, for every stream that ended in one, which stream replaced it (the old stream's epoch to the new session and its epoch: the old session's id would also catch a phone that opens it on purpose to read its history). A client that attaches with a `resume` whose epoch is one of those is sent `replaced`, the chain followed to its end; a `resume` of any other epoch, or none, attaches as ever. An attach already under way when its session is replaced gets the same answer. Only an attach is answered so: reading the old session's transcript is not a sign the phone lost its conversation, and the old transcript is still there. The memory is bounded and kept across bridge restarts (core README §5). A client of minor 0 never sees `replaced`: it is attached to the session it named, as before.

### 12.3 Interactions over the wire

Pending interactions arrive in the snapshot or the replayed `interaction_requested` events, so a reconnecting phone always sees every pending ask. Several phones may answer: the first answer the core forwards wins, and the others get `stale`. A session without control takes `interaction.answer` when its capabilities say `answer` (§5 rule 14); every other control request on it is `unsupported`.

### 12.4 Versioning

`PROTOCOL_VERSION = {major: 1, minor: 0}`. Bridge and app talk only when `major` is equal; `hello` agrees on nothing else. Nothing has shipped, so 1.0 changes in place: there is no per-minor table and no stand-in frame for an older client. Once a client ships, a change the other side cannot ignore bumps `major`.

## 13. Backend extensions

A backend's extras are typed `extension{extension}` events, declared in `Capabilities.extensions`; never an untyped blob, and never a request (there is no `backend.call`):

- `rate_limit{window, status?, usedPercent?, resetsAt?}` (CC `rate_limit_event`, cc §2; units in Q13).

## 14. Conformance

`contract/testing/` holds the reference implementation and the suite every adapter must pass.

- **`createFakeBackend(host, options)`**: in-memory and scriptable (`FakeStep`). It simulates streaming text, thinking and plan blocks; tools with streamed input, nested calls, child sessions and file changes; every interaction kind and every answer outcome; steer; queue with ids and cancel; compaction; retry; usage; plans; retractions; notices, errors and extensions; failure, limit, suspend and defer outcomes; external sessions and external runs; `resynced`; backend loss with expiry; modes; images stored and read back by reference; both model-switch timings; a restart of the bridge that runs survive or not. `traits`, `methods` and `modes` narrow it, which is how a capability is switched off.
- **`runConformance(name, factory, timeoutMs?)`** registers one bun test per rule. `checkRule(factory, rule)` runs one rule against a fresh backend and rejects with the reason it failed.
- **`ConformanceFactory = (host) => Promise<{backend, driver}>`**. Phase 4 writes one driver per adapter; Pi's natural seam is the scripted OpenAI endpoint and live rig in `src/__tests__/helpers/` (pi §16), and a scripted endpoint serves CC too (`ANTHROPIC_BASE_URL`). The driver (`conformance-types.ts`):
  - knows a `cwd` holding a `README.md`, an `otherCwd`, and an `agentName` when agent mentions are declared;
  - `seedSessions(cwd, n)`;
  - `arrange(session, scenario)` for `reply`, `tool` (a tool call, then a text answer), `hold` (until aborted or `release`d), `interaction{kind}`, `feature{thinking|usage|plan|plan_proposal|children}` and `echo_model` (two requests, each answering with the id of the model it ran with, a hold between), `slow_compaction` (the next compaction, started by `compact`, waits until cancelled, aborted or released) and `slow_retry` (the run's first request fails transiently and its retry waits likewise, then answers). It returns false when the backend cannot, and that is a failure whenever the capability is declared;
  - `release(session)`; `quiesce()`, which resolves once everything asked so far has emitted all it will, short of a hold, a human or a run still going (the silence checks wait on it, never on a timer);
  - `delivered(session)`: the latest user input as it reached the model;
  - `backendCall(session, op)`: a valid call of a declared op;
  - `runExternally(session)`: another client runs one reply;
  - `watchedAsk?()`: another client raises an ask in a session it owns that this bridge opens without `control` but with `answer` (§5 rule 14); absent or undefined when the backend has none, and a backend that has them must offer it;
  - `restart(host)`: the bridge restarts over the same backend state.

**The rules** (`conformance.ts`, each on a fresh backend):

1. Capabilities parse (including `start` in `promptModes` and no value twice), `backendOps` exist exactly when `call` does, and `status()` is a valid `BackendStatus`.
2. Models list, are valid, ids are unique, at most one is the default, thinking options do not repeat, every default thinking value is an option, and no model offers thinking without `thinking`.
3. Commands list, are valid, ids are unique; at least one is listed exactly when `commands` is declared.
4. Modes list, are valid, axis ids and option values are unique, every default is an option.
5. Session pages keep to their limit and concatenate without duplicates or gaps, newest first, inside the requested `cwd`, with another directory's sessions under it; a foreign cursor is rejected `invalid_input`.
6. A session can be read by its ref: right ref, directory, origin and status, listed; an unknown one is `not_found`.
7. Transcript pages keep to their limit and concatenate without duplicates or gaps, newest first (the answer before the tool call before the prompt), hold the prompt with its `clientRequestId`; a foreign cursor is rejected.
8. Renames show in the catalog and the summary; archive and unarchive move the session between listings; a fork is marked as one, names its parent, holds the whole history, and a fork through an item ends at it; a delete shows in the catalog, and the session is gone from reads and listings.
9. Every declared op answers in its own kind; a history-rewriting one is followed by `transcript_invalidated`; an op on no session is `not_found`; another backend's op is `unsupported`.
10. A run ends `completed` exactly once, produces text (streamed when `streamText`), and its user message carries the `clientRequestId`.
11. A tool call starts and finishes inside its run.
12. Every declared feature shows up as the event the contract names for it.
13. Every declared attachment kind, mention kind and command reaches the model as sent; undeclared ones are rejected `unsupported`.
14. A prompt's image comes back as an `ImageRef`, in the live user message and in the transcript, and reads back byte for byte; an unknown attachment is `not_found`.
15. A repeated `clientRequestId` returns the same result and runs once; a prompt rejected `busy` can be sent again with its id once the run ends.
16. `start` during a run is rejected `busy`.
17. `steer` is `steered`, or rejected `unsupported` when not declared.
18. `queue` is `queued`, named and visible in `queue_changed` when declared, cancellable when `cancelQueued` exists, and a second cancel is rejected; or the mode is rejected `unsupported` when not declared.
19. `abort` with no run is accepted and silent; during a run it ends it `aborted`.
20. Every listed model and thinking value can be chosen and shows as `model_changed`; others are refused; a model chosen mid-run reaches the next request exactly when `modelSwitch` is `next_request`, and the next run always.
21. A new session starts in the modes asked for, with one value per axis; every value can be chosen and shows as `mode_changed`; others are `invalid_input`.
22. A session that can compact does, as one compaction.
23. Every declared interaction kind: invalid answers are rejected `invalid_input` and change nothing, a valid answer resolves it `answered` and the run goes on, a repeat answer is `stale`, `cancel{stopRun}` ends the run exactly when it says so, and an abort withdraws the pending ask.
24. Mid-run, `snapshot()` equals the open snapshot plus the events, the active run carries its prompt in `run.items` while the transcript holds none of the run, a reopen yields the same live state and capabilities, and the finished run reaches the transcript.
25. `close` is idempotent, nothing arrives from the call on, control rejects `closed`, the run survives the close, and an ask pending at close is in the next open's snapshot and can be answered there.
26. `dispose` silences every sink.
27. With `externalLive`, a run another client starts is reported, with trigger `external`.
28. A run survives a restart of the bridge, under its id, exactly when `durableRuns` is declared; the session survives always.
29. A session that can cancel a compaction or a retry does so on its own: with none under way the cancel is accepted and silent; a compaction cancelled while under way finishes `aborted` and the session compacts again; a retry cancelled while scheduled finishes unsuccessfully and its run does not complete.
30. Every declared op that reads an editable file (`config_file`, `custom_tool`) writes it only at the revision read (another is `stale`), a JSON file only when the text parses (`invalid_input`), a file it may not change never (`unsupported`); writing back what was read, at its revision, through the id the answer named, lands and answers the same text; an id the backend never named is `not_found`.
31. A session with `control` has no `answer` of its own; with `watchedAsk`, the watched session opens without `control` and with `answer`, its ask is pending (in the open snapshot or raised after), invalid answers are `invalid_input` and leave it pending, a valid one resolves it `answered`, a repeat is `stale`, and an answer after `close` is `closed`.

Every scenario's stream also passes the stream rules (§7), and every catalog event is validated as it arrives. `src/__tests__/contract_conformance.test.ts` runs the suite against the fake with every capability, as Claude Code with every op of its union, and with none.

**The suite can fail.** The `contract_negative_*.test.ts` files run 236 deliberately broken adapters (one change each to the honest fake or its driver): every assertion of every rule, and every stream rule a rule relies on, fails at least one of them, for the reason it names. `fails()` (`src/__tests__/helpers/broken-adapters.ts`) requires the rule to reject with that reason, so a rule that lets its broken adapter through, or catches it only by accident, fails its negative test.

## 15. Lossy points and unsupported capabilities

What each backend cannot carry through the contract, and what is lost on the way. "Unsupported" means the capability is false or the kind is undeclared.

**Every backend**

- Per message: the model that wrote an assistant message, its usage and its stop reason are not carried (CC `message.model` and `usage`, cc §4; Pi and Pi Durable `model`, `usage`, `stopReason`, pi §4, pd D4). The session's totals are `Usage`, its current model is `modelId`, and model switches in history are `model_change` items.
- Past a bound (§2 rule 8) a value is shortened by the adapter: a tool's output beyond `MAX_TEXT_CHARS` (CC's Bash output), a title beyond `MAX_NAME_CHARS`, a list beyond its maximum. A running tool's output in the snapshot keeps its newest `MAX_TEXT_CHARS` characters.
- Inline documents that are not images (CC `document` blocks, cc §4) are left out of history: only images are read back by reference, and a file attached by path stays a `FileContent`.
- What queued input does after an abort differs per backend (§10); the contract shows the result in `queue_changed`, not a promise about it.
- When a mode change takes effect (§11.5).

**Claude Code**

- Unsupported: archive; `planProposals`; `externalLive` (cc §11); `text` interactions; per-item queue cancel where the runtime-only `cancel_async_message` is unavailable (cc §6, Q4; it is ungated, Errata 10).
- Lost, events: `thinking_tokens` estimates when thinking display is omitted (cc §5); `tool_use_summary`; `task_*` details beyond the child session link (description, usage, background state; cc §5); hook events; `system/init` catalogs between turns; `model_refusal_no_fallback` beyond its error; `memory_recall`, `files_persisted` and the other informational system frames.
- Lost, input: `shouldQuery:false` appends and `client_composed` verbatim prompts (cc §6).
- Lost, tool results: per-tool structured output beyond diffs, images and text, such as `BashOutput.gitOperation` and `backgroundTaskId`, and the `Read` variants (cc §4).
- Lost, interactions: AskUserQuestion `annotations.notes` and the free-form `response` (cc §8.2). The post-plan permission mode is carried since 1.4 (`modeOptions`, `modeAfter`).
- Lost, modes: none of the six permission modes is dropped; `bypassPermissions` needs `allowDangerouslySkipPermissions` at start (cc §7), so the adapter offers it only when it started the session with it.
- Lost, input and catalog: `priority:'now'` interrupt-and-send (do abort then start); transcript `gitBranch` and `tag`; the CLI's `capabilities` strings (the adapter uses them to set traits); effort as a single scale, so the adaptive/enabled/budget thinking modes are not chosen separately (cc §7).
- Lost, errors: `SDKAssistantMessageError` → `ErrorCode`: `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `verification_required`, `cloud_credential_error` → `auth`; `billing_error` → `quota`; `rate_limit` → `rate_limit`; `overloaded`, `server_error` → `server`; `invalid_request` → `invalid_request`; `model_not_found` → `model_unavailable`; `max_output_tokens` → the `limit` outcome; `unknown` → `unknown`.

**Pi**

- Unsupported: archive; `plan`; `planProposals`; `questions`, `form`, `plan_approval`, `external_url`; per-item queue cancel (only `clearQueue`, pi §6); `durableRuns`; file attachments.
- Lost: `custom()` TUI dialogs cannot be answered remotely and become a notice (pi §8.1); fire-and-forget extension UI (`setStatus`, `setWidget`, `setTitle`); confirm's cancel-vs-false distinction (pi §8.3); `summarization_retry_*` (compaction-internal retries); `bashExecution` user shell output (shown as a notice); `entry_appended` custom entries; error strings carry no class, so most errors are `unknown` (Q31).

**Pi Durable**

- Unsupported: `commands`; `questions`, `form`, `plan_approval`, `external_url`, `choice`, `confirm`, `text`; archive; `externalLive`; `plan`; `planProposals`.
- Lost: tool `details` and `diagnostics`; `deferred_poll`; `task_failed` beyond an error notice; the per-provider/model usage split (summed); a compaction's `blocking` flag; the task id `compact()` returns.
- Experimental: `watchEvents` is gone on pi-mono main (pd D15). The adapter must be rewritten before any upgrade.

## 16. Refinements of the brief

The brief names proposals and says to refine them. These are the places the contract differs, and why.

| Brief | Contract | Why |
|---|---|---|
| `session_state` event | `sessionStatus(snapshot)`, derived | Every state is a function of runs, pending asks and the last outcome, so a separate event could only disagree with them. `unknown` exists only for list rows. |
| `message_started{messageId, role}` | `messageId` on every block (and optionally on tools); a separate atomic `user_message` event | A block is never orphaned by a lost marker. User input is complete when it arrives. |
| `runId` on the envelope | `runId` only on run events and `Interaction.runId` | Position in the ordered stream already attributes content to a run (§7). A redundant id could disagree with it. |
| `interaction_resolved{answered\|cancelled\|expired\|superseded}`, synthesized by the core | `answered\|withdrawn\|expired`, emitted by the adapter | Only the adapter knows whether its answer landed or the backend withdrew the ask (CC `control_cancel_request`). The core still owns first-answer-wins. The reply is not echoed, which keeps secret answers out of the broadcast and the log. |
| `InteractionAnswer{outcome: answered\|cancelled, payload, message?}` | `reply`: a per-kind union plus `cancel{stopRun, message?}` | Continue vs stop is explicit. Decline and cancel are distinct for some backends natively. |
| `plan_updated{kind: todo\|proposal}` | `plan_updated` (todo) + `block` kind `plan` (proposal) | A proposal streams as deltas; a block streams without resending the whole text on every change. |
| `PromptInput.origin: human`, `skills?` | dropped; `command?` | Every phone prompt is human, so the adapter stamps it. Skills and commands are both invoked by id. |
| `PromptResult.accepted{runId?}` | no `runId` | CC cannot know the run at acceptance (cc §6). The `user_message.clientRequestId` links a prompt to its run. |
| `Page{nextCursor?, prevCursor?}` | `nextCursor?` only; a `TranscriptPage` also says `idStability` | Catch-up re-reads the newest page (§8); no backend-agnostic need for backward cursors. |
| Capabilities `pagedListing`, `pagedTranscript`, `revert`, "reconnect strategy" | paging mandatory; revert is an op (§13); `durableRuns` | Every adapter must page (natively or over a bridge index), so the flag would say nothing. Revert means different things per backend. Whether a run survives the bridge is the actionable part of the reconnect strategy. |
| `ModelSummary.ref{providerId, modelId}` | opaque `id` + `providerId?`/`providerName?` | CC models have no provider (cc §9). The adapter encodes its own composite. |
| `ThinkingSpec{options, default}` | `defaultValue` | `default` is reserved in Dart. |
| `open(ref \| new, sink)` → `OpenSession` | `OpenResult = {status: accepted, session, snapshot} \| Rejected` | Typed rejection instead of a throw, and no race between snapshot and first event (§5). |
| `status(): BackendStatus`, `listModels()`, `listCommands()` | `status()` never fails; the lists return results | A failure to find out the status is itself status (`issues`, `usable: false`); a list that fails has a reason the app can show, not an empty list. |
| `SessionSnapshot` — open blocks, running tools | plus the active run's finished items; the transcript holds finished runs only | The merge rule (§8): no backend gives live and transcript ids that always agree. |
| — | added session modes (§11.5), `attachment.read` (§10), `transcript_invalidated` (§5) | Modes: the research shows one shape across the backends. Attachments: transcript pages must not carry inline images. Invalidation: other phones must learn of a rewritten history. |
| `tool_started{childSession?}` | `ToolChildSession` update | The child is known only after the call starts in every backend that has one. |
| `Interaction.session` | dropped | The envelope already names the session. |
| — | added `input_returned{texts}` and the Pi op `take_over` (1.2) | A terminal's Esc gives queued input back to the human, and the contract had no way to say so; a session another client made could never become controllable. |
| — | added `compaction.cancel`, `retry.cancel` and the Pi ops `session_settings`, `session_tools`, `system_prompt` (1.3) | Stop ended a compaction and a retry together with the run it belonged to, and the human could not end only one. The state is already normalized (`snapshot.compaction`, `snapshot.retry`), so the cancel is normalized too, as optional methods that announce themselves in `SessionCapabilities` like `compact` and `cancelQueued`. Pi's settings, tools and system prompt are its own and global in part, so they are typed ops, not modes (Pi README, decision 21). |
| — | added the configuration, list and custom tool ops, the `prompt_suggestion` extension and a plan approval's `modeOptions`/`modeAfter` (1.4) | A backend's configuration is files and its live lists (MCP servers, plugins, tasks, context) are its own, so they are ops; two shared payloads, a list of rows with actions and one file at a revision, let the phone draw every one by shape instead of one screen per backend feature (Claude Code PLAN D22, D24, D25, D30). |
| — | added `OpenSession.answer` and `SessionCapabilities.answer` (1.4) | A terminal's permission prompt reaches the bridge (Claude Code PLAN D26) on a session the phone may only watch; giving that session a `control` would let the phone prompt and stop a session a terminal owns. The core refused every answer without `control`, so answering became its own optional method and its own capability. |
| — | added `session_replaced{session}` | CC continues a live session under a new id after `/clear` or a plan-exit context clear (`conversation_reset`, cc §5); without it the phone would keep watching a session that no longer receives anything. |

## 17. Not in Phase 1

- **Background-task control** beyond listing and stopping a task (1.4 `tasks`): backgrounding a running tool (`backgroundTasks`), `perTaskStopAffordance` (cc §7).
- **Catalogs** beyond models, commands and the 1.4 configuration and list ops: Pi's global vs project scope (pi §13), auth and login flows (cc §9).
- **External-session takeover** (resuming a terminal-owned CC or Pi session interleaves writers, cc §11, pi §11).
- **Title search** in `SessionQuery`: CC and Pi would need the bridge index. An additive field later.
- The core: the event log, `seq`, epochs, first-answer-wins, de-duplication across restarts (Phase 2). The Flutter reducer that mirrors `applyEvent` (Phase 3).

## 18. Open questions

Every UNVERIFIED research item that affects the contract, with the experiment that settles it. None blocks Phase 2.

| # | Question | Affects | Experiment |
|---|---|---|---|
| Q1 | CC `result.subtype` / `is_error` for an interrupted turn | `RunOutcome` for CC aborts | Long turn via `AsyncIterable`, `interrupt()`, print the `result` (cc §17) |
| Q2 | Is CC `command_lifecycle` emitted by default with a `uuid`, or only with `--replay-user-messages`? | CC `queue` trait | Two uuid-stamped mid-turn prompts with and without the flag (cc §17) |
| Q3 | Does a repeated CC `uuid` execute twice? | Adapter dedupe (still done in the bridge) | Same `uuid` twice while queued (cc §17) |
| Q4 | `interrupt({cancelQueued})` / `cancelAsyncMessage` on CLI 2.1.312 | CC `cancelQueued` | Call both on a `'later'` message; read `capabilities` first (cc §17) |
| Q5 | Mid-session thinking via `applyFlagSettings({alwaysThinkingEnabled})` | CC `setThinking` | Apply and watch the next `thinking_delta` (cc §17) |
| Q6 | ExitPlanMode post-approval mode via `updatedPermissions setMode` | `plan_approval` reply | Approve with and without it; read `status.permissionMode` (cc §17) |
| Q7 | Does a PreToolUse `defer` work in streaming mode? | `deferred` outcome reachability for CC | Hook returning `defer` on AskUserQuestion; watch for `tool_deferred` (cc §17) |
| Q8 | Does CC `getSessionMessages` drop pre-compaction history? | Transcript completeness | Compact; compare the chain with the JSONL (cc §17) |
| Q9 | Meaning of `CLAUDE_CODE_BG_TASKS_REPORT_RUNNING` for `idle` | When CC `run_finished` fires | Background subagent; compare `idle` timing (cc §17) |
| Q10 | Is `forkedFrom` exposed for CC forks? | `SessionSummary.parent` for CC | Fork, read the new file's first entries (cc §17) |
| Q11 | Real `supportedEffortLevels` per CC model | `ThinkingSpec` for CC | Print `initializationResult().models` (cc §17) |
| Q12 | How CC extended AskUserQuestion kinds (`text`, `number`) reach SDK sessions | `questions` vs `form` for CC | Enable `CLAUDE_CODE_QUESTION_EXTENDED`; log `canUseTool` input (cc §8.2) |
| Q13 | Units of CC `rate_limit_event.resetsAt` and the scale of `utilization` | `rate_limit` extension | Log a real event next to the claude.ai usage page (found in Pass 2; `sdk.d.ts:5921` documents neither) |
| Q14 | Purpose of `~/.claude/sessions/` | CC external session status | Run a terminal `claude`; list the directory; close it (cc §17) |
| Q28 | Does a Pi listener microtask after `message_end` see the new entry as `getLeafId()`? | Transcript id alignment for Pi | (pi §17) |
| Q29 | Pi `tool_call` handler that never resolves, then abort: does `agent_settled` fire? | `withdrawn` + `run_finished` guarantee for the Pi gate | (pi §17) |
| Q30 | Stability of Pi `preflightResult` across versions | Pi's accepted signal | Pin and add a contract test (pi §17) |
| Q31 | Which Pi errors are `isRetryableAssistantError`? | `ErrorCode` and retry for Pi | Read `packages/ai/src/utils/retry*.ts` (pi §17) |
| Q32 | Does pi-ai clamp Pi Durable's thinking by `thinkingLevelMap`? | `ThinkingSpec` for Pi Durable | `thinkingLevel:"xhigh"` on a model without it; inspect the request (pd D17) |
| Q33 | Does a human-waiting `beforeTool` re-ask after a bridge restart? | `expired` + re-request for Pi Durable | Kill the bridge mid-approval; reopen (pd D17) |
| Q34 | Pi Durable submission reasons `reset` and `stale` as run outcomes | `RunOutcome` mapping | Submit across a `reset()` and a stale write; read the `submission` events (pd D6; Broski reading, not research) |

## 19. Errata

Found in Pass 2 (SDK source against the research):

1. **pi.md §7, §11.3 path**: `getSupportedThinkingLevels` and `clampThinkingLevel` live in `packages/ai/src/models.ts:1260-1290` (pi-ai, exported from `@earendil-works/pi-ai` `dist/models.d.ts:271`). The citation `PM models.ts:1260-1269` reads, by the report's citation key, as `packages/coding-agent/src/core/models.ts`, which does not exist at `v1.4.0`. The behaviour described is correct.
4. **claude-code.md §3 (fork)**: `forkSession`'s `upToMessageId` is **inclusive** (`sdk.d.ts` `ForkSessionOptions`). The report does not say so. The contract's `ForkPoint{position: before|through}` relies on it.
5. **claude-code.md §4 (diffs)**: `BashOutput` has no exit code, only `returnCodeInterpretation` (`sdk-tools.d.ts`), so `ToolResult.exitCode` is absent for CC.

Found in round 2 (SDK source against the research and the contract):

8. **Form validation strictness**: the strictest validator among the researched backends counts lengths in UTF-16 units, compiles `pattern` without flags and refuses every answer to a field whose pattern does not compile, requires a dotted email domain (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), refuses an empty string or empty selection for a required field, and does not excuse a hidden required field. `field-check.ts` adopts each of these (§9).
10. **claude-code.md §6, §12 (`cancelQueued`)**: `interrupt_cancel_queued_v1` gates only `interrupt{cancel_queued: true}`, which aborts the turn and cancels every queued command (`sdk.d.ts:4836`). Per-item cancel is `cancel_async_message{message_uuid}`, which no capability gates (`sdk.d.ts:3987-3992`); it is still runtime-only on `Query` (Q4).
11. **claude-code.md §8.4**: `ElicitResult.content` is typed `Record<string, unknown>` (`sdk.d.ts:778`), not the primitive record the report gives; the values MCP accepts are the primitives `FormValue` carries.

Found in Phase 3 (the app's port against the contract):

12. **`answer-check.ts`, `field-check.ts` (inherited keys)**: a form answer was read as `values[key]`, so a field whose key every JavaScript object inherits (`constructor`, `toString`, `hasOwnProperty`, …) read a function as its answer: an optional such field left unanswered was refused (`expects text`), and a `neq` condition on it held with no answer. Answers are now read by own key only (`answerFor`); `contract_form_keys.test.ts` and the generated `answer_cases.json` hold it. A field keyed `__proto__` was unanswerable over the wire (zod's record parse drops that key); it is now refused in the schema (erratum 13).
13. **`forms.ts`, `interaction-replies.ts` (`FieldKey`)**: `__proto__` is no longer a legal field key, and a reply carrying it is refused instead of arriving without it. The one key that cannot survive JSON parse plus zod's record, found by trying every name an object, a function and an array inherit (§9, *Field keys*). The adapter maps such a backend key to another; `answer_cases.json` holds the answer check to the same verdict on a reply beyond the wire (`no field __proto__`).

Found in the Pi terminal link and take-over work (protocol 1.2):

14. **§7 `session_replaced`, "under a new id"**: the event is also the stream's last event when the same session goes on with different `SessionCapabilities` (Pi: a terminal began or ended running a session the phone is looking at; a take-over). The core already starts a new epoch for it; a client attached to the old epoch attaches again to the session it named, and the app treats a `session_replaced` or `replaced` that names the session it is viewing as a fresh attach, not as a lost session.
15. **§2 rule 3, `zod` in adapters**: an adapter that owns a process boundary of its own (Pi's terminal link, a local socket to a `pi` process the adapter does not start) validates what crosses it with `zod`. `scripts/contract-gen/layers.ts` allows `zod` in `src/backends/<id>/` and nothing else beyond the previous list.
