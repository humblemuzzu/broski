# The Broski backend contract

Status: protocol **1.0** (§12.4). The bridge core speaks it to every attached phone, and each backend has one adapter: Pi and Claude Code, both registered in every bridge (`server/contract-backends.ts`).

This document is the spec. The code is the definition: `packages/bridge/src/contract/` (zod schemas, interfaces, reducer, answer checker) and `packages/bridge/src/contract/testing/` (fake backend, conformance suite). Every backend fact below cites its source:

- `CC Dn`, `CC §n`: decision n or section n of the [Claude Code adapter README](../backends/claude-code/README.md), Claude Agent SDK 0.3.325.
- `pi §n`: the Pi adapter's notes, [`backends/pi/README.md`](../backends/pi/README.md), Pi 1.5.2 over `pi --mode rpc`.

Where this document and an adapter README disagree about a backend fact, the adapter README wins unless the disagreement is listed under [Errata](#19-errata), which records what the SDK source says.

**Contents.** [1 Layout](#1-where-it-lives) · [2 Hard rules](#2-hard-rules) · [3 Single source of truth](#3-single-source-of-truth-and-generation) · [4 Identity](#4-identity) · [5 The adapter interface](#5-the-adapter-interface) · [6 Capabilities](#6-capabilities) · [7 Events](#7-events) · [8 Live state](#8-live-state-snapshot-and-reconnect) · [9 Interactions](#9-interactions) · [10 Input](#10-input) · [11 Read models](#11-read-models) · [12 Wire protocol](#12-wire-protocol) · [13 Extensions](#13-backend-extensions) · [14 Conformance](#14-conformance) · [15 Lossy points](#15-lossy-points-and-unsupported-capabilities) · [16 Refinements of the brief](#16-refinements-of-the-brief) · [17 Not in the contract](#17-not-in-the-contract) · [18 Open questions](#18-open-questions) · [19 Errata](#19-errata) · [20 The workspace](#20-the-workspace)

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
| `contract/sessions.ts`, `transcript.ts`, `models.ts`, `modes.ts`, `commands.ts`, `usage.ts`, `status.ts`, `paging.ts`, `queue.ts`, `runs.ts`, `compaction.ts`, `content.ts`, `tools.ts`, `notice.ts`, `activity.ts` | Read models and the values events carry. |
| `contract/snapshot.ts`, `session-reducer.ts`, `run-items.ts` | `SessionSnapshot`; `applyEvent`, the executable meaning of every event; how live events become the active run's items. |
| `contract/protocol.ts`, `read-results.ts` | The wire protocol: requests, responses, version; the results of the read requests. |
| `contract/protocol-workspace.ts`, `workspace-files.ts`, `workspace-git.ts`, `workspace-terminal.ts` | The workspace requests and responses, and what they carry: files, git, terminals (§20). `protocol-request.ts` holds `RequestId` and the request and response shapes both protocol files build on. |
| `contract/extensions.ts` | Typed per-backend live events. |
| `contract/backend.ts` | `AgentBackend`, `OpenSession`, `SessionControl`, the sinks, capability derivation. Plain TypeScript over the schema types. |
| `contract/schema-registry.ts` | Names every schema after its export, for the JSON Schema. |
| `contract/contract.schema.json` | **Generated.** The contract as one JSON Schema (draft 2020-12). |
| `contract/testing/` | The fake backend (`fake-*.ts`), the stream checker, the conformance suite (`conformance*.ts`, `rules-*.ts`) and its runner. |
| `packages/bridge/scripts/gen-contract.ts`, `scripts/contract-gen/` | The generator: the JSON Schema, the fixtures and the Rust models (`rust-*.ts`); `--check`. |
| `packages/bridge/scripts/check-layers.ts`, `scripts/contract-gen/layers.ts`, `import-scan.ts` | The layer check, and the import reader it runs on. |
| `packages/bridge/contract-fixtures/` | **Generated.** `constants.json` (every bound), `contract_samples.json`, `fake_session_stream.json`, `reducer_trace.json`, `frame_prefix.json`: what the phone core holds itself equal to. |
| `packages/link/contract/` | The contract in the phone core's Rust (crate `broski-contract`): `src/generated/` **generated** models and bounds, `json_value.rs`, `tagged.rs`, `frame.rs` and the reducer port (`reducer.rs`, `run_items.rs`) by hand; `tests/fixtures/` replays every fixture, through the **generated** type registry in `tests/fixtures/generated/`. |

Commands, from `packages/bridge`: `bun run contract:gen` writes every generated file, `bun run contract:check` fails if any is stale, and `bun run check:layers` checks imports. CI runs both in the bridge job.

## 2. Hard rules

1. **The UI never branches on the backend.** It branches on `Capabilities`, `SessionCapabilities`, and the shape of what it receives. A backend's extras reach the app only as typed `extension` events (§13).
2. **Adapters are reached only through the contract.** The core holds `AgentBackend` values. It never imports `backends/<id>/`, and an adapter never sees sockets, phones, viewers or the wire.
3. **The contract is a leaf.** `src/contract/` imports only `zod` and itself. Its `testing/` may also import `bun:test`. `src/backends/<id>/` may import only the contract (not its test kit), itself, `zod` (to check frames that cross a process boundary the adapter owns, such as Pi's terminal link), `node:` built-ins (not `node:module`, whose `createRequire` loads what no check sees) and that backend's own SDK. No adapter imports another adapter's directory. Every specifier must be a plain string. `bun run check:layers` enforces all of it in CI: it reads every import, type-only ones included, from the file's tokens (`import-scan.ts`, so comments and strings never count), joined with Bun's own `Transpiler.scanImports`.
4. **Generated code is never edited by hand.** Change the zod schema, run `bun run contract:gen`, commit the result. CI fails on a stale file.
5. **Expected failures are values.** Every adapter method that can fail returns a result union, `{status: "accepted", …} | Rejected`, the same unions the wire carries (`PromptResult`, `ActionResult`, `NewSessionResult`, the read results of `read-results.ts`, and `OpenResult` for `open`). `status()` cannot fail: whatever stops it from finding out is an `error` issue in `BackendStatus.issues`, with `usable: false`. A thrown error is an adapter bug.
6. **No invalid answer reaches a backend.** The core runs `answerProblem` on every answer before an adapter sees it, and an adapter rejects a faulted one with `invalid_input` all the same. A malformed answer can otherwise become a silent denial or an over-grant.
7. **Sinks never throw, and adapters never throw into the core from a callback.** A sink that threw would break the stream of every session it serves.
8. **Every wire value is bounded.** Each string, list and map has a maximum (`limits.ts`): ids 256 characters, names 1,024, paths 4,096, text 1,048,576, the images of one prompt 4 MiB of base64, lists and maps 1,000 entries, catalogs 10,000, free JSON 64 levels deep. One message is capped whole: `MAX_MESSAGE_BYTES` (8 MiB of UTF-8 frame, the link's `LINK_MAX_MESSAGE_BYTES`), and a client message holds at most `MAX_CLIENT_MESSAGE_VALUES` (50,000) JSON values, because checking a message costs the bridge in proportion to its values; a prompt with every list full holds about 8,000. An adapter shortens a native value past its bound; §15 lists where that happens. A test walks the JSON Schema and fails on any unbounded string, list or map.

## 3. Single source of truth and generation

**Schema library: zod 4, pinned exactly at `4.2.1`.**

- zod 4 emits JSON Schema itself (`z.toJSONSchema`), so the language-neutral artifact needs no third library.
- The Claude Agent SDK peers on `zod ^4` (the SDK's `package.json`), so the bridge carries zod regardless.
- TypeBox is present only transitively, pinned by pi. Using it would tie the contract's schema library to pi's release cycle.
- One library, no mixing: every wire-visible type is a zod schema, its TypeScript type is `z.infer`, its runtime validator is the schema itself.

**Naming.** A schema's export name is its id everywhere: the `$defs` key in `contract.schema.json` (`schema-registry.ts`). Rename the export and every layer renames with it.

**Restrictions**, which keep a generated client exact. `scripts/contract-gen/type-model.ts` enforces them and fails naming the offending path:

- Objects are strict (`z.strictObject`): an unknown field is an error, both on the wire and in the JSON Schema (`additionalProperties: false`).
- Every object and enum is a named export. An anonymous one is refused.
- Every union is discriminated by a string tag (`type` for messages and events, `kind` or `status` for values).
- No `null`. Optional means absent.
- `JsonValue` is the only open type, for genuinely free JSON (tool input, edited input). It is checked by one bounded walk (`json.ts`) rather than a recursive zod schema, because zod recurses once per level of the input and overflows the stack near 10,000 levels; the generator writes its JSON Schema by hand to the same shape. `NativeIds` (`string → string`) carries backend-native ids for debugging. Nothing in the contract is `unknown` or `any`.
- Every integer stays within JavaScript's safe range (`z.int()` writes those bounds), so a client holds it in a signed 64-bit integer.

**Pipeline** (`bun run contract:gen`):

```
zod schemas ──z.toJSONSchema──▶ src/contract/contract.schema.json ──sampler──▶ contract-fixtures/contract_samples.json (every union member, every enum value, every object full and minimal; each sample is parsed by its zod schema)
      ├──FakeBackend scripted session──▶ contract-fixtures/fake_session_stream.json (every AgentEvent member, as wire ServerMessages)
      │                               └──applyEvent──▶ contract-fixtures/reducer_trace.json (the snapshot and status after every event)
      ├──limits.ts, MAX_PAGE_LIMIT, REQUEST_DEADLINE_MS──▶ contract-fixtures/constants.json
      ├──encodeFrame──▶ contract-fixtures/frame_prefix.json (how the core begins every frame, one frame it encoded, and one it encoded around lone surrogates)
      └──type model + the bounds + PROTOCOL_VERSION──▶ packages/link/contract/src/generated/ (one Rust file per contract module, constants.rs, mod.rs)
                                └──▶ packages/link/contract/tests/fixtures/generated/mod.rs (every type by schema name, for the fixture tests)
```

**The Rust models** (`scripts/contract-gen/rust-emit.ts`, `rust-fields.ts`, `rust-names.ts`, `rust-registry.ts`) are what the phone core decodes and encodes, and what its UniFFI crate exports to Swift and Kotlin (each model derives `uniffi::Record` or `uniffi::Enum` behind the crate's `uniffi` feature; a downstream UniFFI crate uses them as external types with no further code). The emitter writes rustfmt's own layout, so neither `contract:check` nor CI needs `rustfmt` to agree with it. What it writes:

- An object is a struct with `deny_unknown_fields` and `rename_all = "camelCase"`: the Rust field name puts `_` before each capital of the wire name (`toolCallId` → `tool_call_id`), which serde's camelCase undoes exactly. A field named by a Rust keyword is a raw identifier.
- An optional field is `Option<T>`: absent decodes to `None` and `None` is not written; `null` is refused (`codec::present`), except as the value of an optional `JsonValue`, where zod takes it too.
- A union is an enum internally tagged by its discriminator (`#[serde(tag = "type")]`), one variant per member named after its tag value (`session.attach.result` → `SessionAttachResult`), holding the member's struct. A member of several unions is one struct in each. An unknown tag or enum value is an error.
- A member struct has no tag field, because its union writes and checks the tag; it implements `Tagged` with its tag, and a field that holds a member directly (`AttachmentRead.image`) goes through `tagged.rs`, which writes and checks the tag the same way.
- **A gap against zod.** serde reads a struct from a JSON array too, field by field in declaration order: `["claude-code","s1"]` decodes as a `SessionRef`, and `["contract",{…}]` as a frame (`serde_json` answers a struct with `visit_seq` as well as `visit_map`; `deny_unknown_fields` does not touch it). An internally tagged union is read from an array whose first element is the tag, the rest being the member's fields in order (`["run_started","r","prompt"]` is an `AgentEvent::RunStarted`). The bridge never writes an array where an object belongs, so the decoder does not refuse one. Refusing it would mean wrapping serde's `Deserializer` and each accessor it hands out (`SeqAccess`, `MapAccess`, `EnumAccess`) so every nested struct and union asks for a map; `strictness.rs` pins the behaviour so that a decoder that closes the gap, or a serde that changes, shows.
- `integer` is `i64`, `number` `f64`, a string `String` whatever its pattern or format (the bridge checks what the phone sends, §9), a map `HashMap<String, T>`, `JsonValue` the hand-written enum in `json_value.rs` (numbers as `f64`, an object's members in wire order). An alias is a Rust `type` alias. The bounds of `constants.json` are `usize` constants, and `PROTOCOL_VERSION` a `ProtocolVersion` constant beside them, which the client's `hello` sends.

The emitter fails, naming the type, on a member tagged twice (serde reads one discriminator), on a list, map or alias of a union member (it would lose its tag; hold the union), and on a name Rust, Swift or Kotlin cannot take: a schema name the Rust prelude, Swift's standard library and Foundation, Kotlin's default imports or UniFFI's own declarations already use is renamed `Contract<Name>` (`Option` → `ContractOption`); a field or variant that cannot be an identifier, or a variant named `Companion` or `Self`, is an error.

**The reducer port.** `packages/link/contract/src/reducer.rs` and `run_items.rs` are `session-reducer.ts` and `run-items.ts` in Rust, written by hand and applied in place. `reducer_trace.json` holds them equal: the crate's tests replay every step of every case and compare the snapshot (whole, or the SHA-256 of its canonical JSON) and `sessionStatus`. A change to the TypeScript reducer regenerates the trace, and the Rust test names the case and step where the port now differs.

**Determinism.** Every generated file is ordered by UTF-16 code units, never by locale. `contract:check` ignores dotfiles (such as `.DS_Store`) in the directories it owns.

**Changing the contract.** Edit the schema → `bun run contract:gen` → `cargo test -p broski-contract` in `packages/link` (and the reducer port, if the reducer changed) → update this document and, if behaviour changed, the conformance rules.

## 4. Identity

| Id | Type | Minted by | Rule |
|---|---|---|---|
| `BackendId` | `claude-code \| pi` | contract | |
| `SessionRef` | `{backend, sessionId}` | adapter | `sessionId` is the backend's own durable session id: CC UUID (CC D2), Pi header UUIDv7 (pi §3). Stable for the session's life. |
| `RunId` | string | adapter | Unique per session for good (a UUID is the safe choice); CC and Pi have no native run id (CC D21, pi §13). A run ends with the bridge. |
| `MessageId`, `BlockId` | string | adapter | Unique per session. Derive from native identity where it exists, so live ids match transcript ids: CC `message.id` + block index (CC D21). Pi has no message id mid-stream, so the adapter mints one (pi §5). |
| `ToolCallId` | string | adapter | Unique per session. |
| `InteractionId`, `QueueItemId`, `AttachmentId` | string | adapter | Unique per session. An `AttachmentId` names image bytes the adapter can read back (§10). |
| `TranscriptItemId` | string ≤512 | adapter | Unique per session. May combine two ids: a tool result the live stream finished is `<toolCallId>:result` (`run-items.ts`). |
| `ModelId`, `CommandId` | string | adapter | |
| `ClientRequestId` | UUID | phone | On every prompt; the key prompts are de-duplicated by (§10). |
| `RequestId` | string ≤128 | phone | Correlates a wire request with its response. |

Backend-native ids may ride along in `EventEnvelope.native` (`NativeIds`) for debugging. The app never keys anything on them.

## 5. The adapter interface

`contract/backend.ts`:

```ts
type BackendFactory = (host: BackendHost) => Promise<AgentBackend>;   // host.catalog: CatalogSink
interface AgentBackend {
  id; traits;                                                // traits: the declared capabilities (§6)
  status(): Promise<BackendStatus>;                          // never fails (§2 rule 5)
  listSessions(query, page); getSession(ref); readTranscript(ref, page); readAttachment(ref, attachmentId);
  listModels(cwd, {includeUnavailable?}); listCommands({cwd?, session?}); listModes(cwd);
  open(target: {kind:"existing", session} | {kind:"new", options}, sink): Promise<OpenResult>;
  rename?(); delete?(); fork?(ref, at?);                      // absent = not supported
  dispose();
}
type OpenResult = {status:"accepted", session: OpenSession, snapshot} | Rejected;
interface OpenSession { session; snapshot(); control?: SessionControl; answer?(answer); close(); }   // control absent = watch-only; answer only beside no control
interface SessionControl { prompt; abort; answer; setModel; setThinking; setMode; compact?; cancelQueued?; }
```

Every method that can fail resolves with `{status: "accepted", …} | Rejected` (§2 rule 5).

**Lifecycle rules.** The conformance suite asserts every rule marked ✓.

1. ✓ `open` resolves with the live state `snapshot` at that moment. Nothing is emitted into the sink before that moment, and everything emitted afterwards applies on top of `snapshot`. Putting the snapshot in the result closes the race between "read the snapshot" and "the first event".
2. ✓ `snapshot()` always equals the open snapshot with every emitted event applied by `applyEvent`.
3. ✓ `close()` detaches the sink: **from the call on**, nothing is emitted and `control` methods and `answer` reject `closed`. It aborts nothing; a run in progress goes on in the backend. An in-process backend (CC's CLI child, Pi) keeps whatever it needs alive until the run settles. An ask pending at `close`, or raised after it, is held by the adapter and appears in the next `open`'s snapshot, where it can be answered: every backend can re-deliver (CC keeps its own registry of pending callbacks, CC D15; Pi's asks are the bridge's own, pi §8.5).
   **The core's side of it:** while a session's snapshot has an active run, a pending interaction, a compaction or retry under way, queued input, or a task running in the background, the core keeps its `OpenSession` open, phones attached or not, so no ask is raised to nobody and no event is lost from the log. It closes a session only once it is idle, and never aborts a run to do so; bridge shutdown is the one exception, and then the asks expire (§9).
4. ✓ `dispose()` closes every open session and silences the catalog sink.
5. ✓ Optional methods carry capabilities. An absent `rename`, `delete`, `fork`, `compact` or `cancelQueued` *is* the capability being false; nothing declares it separately (§6). So is `SessionCapabilities.answer`: true exactly when `control` or `OpenSession.answer` exists (`sessionAnswerer`).
6. ✓ `abort()` ends the active run with outcome `aborted`; with no run it is accepted and emits nothing. It resolves once the backend has taken the abort (Pi's `abort()` awaits idle, pi §7). `run_finished` may follow the resolution.
7. ✓ `prompt` is idempotent per `clientRequestId` within the session for accepted prompts; a rejection is not remembered (§10).
8. ✓ A malformed answer is rejected `invalid_input` and changes nothing. An answer to a resolved interaction is rejected `stale`.
9. ✓ `setModel` takes a listed model and nothing else (`not_found`); `setThinking` takes one of the current model's thinking values (`invalid_input`); `setMode` takes a listed mode and one of its values (`invalid_input`). Each shows as the event that changes the snapshot (`model_changed`, `mode_changed`).
10. ✓ `readAttachment` reads back the bytes an `ImageRef` names; an unknown id is `not_found`.
11. ✓ With `externalLive`, a run another client starts is reported live, with trigger `external`. When the bridge restarts every session survives and every run ends with it: a `RunId` does not outlive the bridge.
12. The core opens at most one `OpenSession` per `SessionRef` at a time and fans its events out to phones. Adapters may assume this.
13. The sink, the catalog sink, and every adapter callback into the core never throw.
14. ✓ **Answering without control.** A session this bridge may watch but not control (`control` absent) may still take answers to its asks through `OpenSession.answer`: a `claude` in a terminal raises a permission prompt through the bridge's hook (CC D29), and a person answers it from the phone or the lock screen while the terminal keeps the session. `answer` follows `SessionControl.answer` in everything: checked by the core's desk and `answerProblem` first, `stale` once resolved, `closed` after `close`. A session with `control` has no `answer` of its own; its answers go through `control.answer` as ever, so there is one path per session. Prompting, steering, stopping and every setting stay out of reach of a session without `control`.

**Catalog sink.** Backend-wide news: `session_updated{summary}`, `session_removed{session}`, `status_changed{status}`, `catalog_invalidated{scope: models|commands|modes}`. An adapter emits `session_updated` after its own create, rename, fork and first persist, whenever a row's status, title or model changes, and when a run ends. It emits `session_removed` after a delete. It relays external changes when the backend reports them. CC and Pi report nothing live, so their adapters watch the session directories (CC D7, D28, pi §11) and the configuration they list from. A session list is never broadcast whole. The core sends one `status_changed` of its own for each backend as it lands: backends start after the bridge listens, so a phone that listed the backends before may learn of one this way.

## 6. Capabilities

`Capabilities` is what a backend can do. Most fields are **declared** by the adapter as `traits`. `fork`, `rename` and `delete` are **derived** by `backendCapabilities(backend)` from whether the method exists, so they cannot lie. `SessionCapabilities` (`controllable`, `compact`, `cancelQueued`, `answer`) are derived per open session by `sessionCapabilities(session)`. `answer` says the session's asks can be answered here, controllable or not (§5 rule 14): the app shows an ask's Answer by it, and the composer by `controllable`. A field rather than a rule such as "interactions are answerable whenever there are any", because a watch-only session that takes no answers (a Pi terminal session, a Claude Code session written by a terminal without the hook) shows its asks without a button, and only the adapter knows which one it has.

Declared traits are checked against behaviour, both ways where the contract can observe it:

- The stream checker fails an adapter that emits an event its traits deny (a queue without `queue`, thinking deltas without `streamThinking`, an undeclared interaction kind or extension).
- The conformance driver must be able to produce every declared feature, interaction kind, attachment kind and command, and each must reach the model as sent; an undeclared one is rejected `unsupported`.
- `promptModes` always holds `start` and lists no mode twice (the schema refuses otherwise); an undeclared mode is rejected `unsupported`.
- `externalLive` is checked by a run another client starts (§14).

| Capability | Claude Code | Pi |
|---|---|---|
| `streamText` | ✓ `stream_event` text deltas with `includePartialMessages` (CC D5) | ✓ `message_update` (pi §12) |
| `streamThinking` | ✓ unless `thinking.display:'omitted'` (CC D5) | ✓ (`redacted` arrives whole) |
| `promptModes` | start, steer (`priority:'next'`), queue (the adapter's own queue) (CC D9) | start, steer, queue (`followUp`) (pi §6) |
| `attachments` | image (base64 blocks) (CC D11); a file reaches the CLI as `@path` in the text | image (pi §6) |
| `commands` | ✓ slash commands, skills (CC D7) | ✓ extension commands, templates, skills (pi §9) |
| `queue` (visible) | ✓ the adapter's own queue, one item per run | ✓ `queue_update`, texts only (pi §5) |
| `interactions` | tool_permission, questions, form, plan_approval (CC D15), confirm (empty MCP forms) | tool_permission (bridge-owned gate), questions (`broski:questions`), choice, confirm, text (pi §8) |
| `thinking` | ✓ effort levels (CC D12) | ✓ levels, clamped (pi §7) |
| `children` | ✓ subagents (CC D20) | ✓ a tool call's sub-run in its result's `details`, forks and handoffs (pi §13) |
| `usage` | ✓ (CC §5) | ✓ pulled after messages (pi §5) |
| `planProposals` | ✗ (the plan reaches the app as a `plan_approval`) | ✗ |
| `externalLive` | ✗ file tail only, on a watch-only open (CC D28) | ✓ a terminal `pi` through the terminal link (pi §11) |
| `extensions` | rate_limit | — |
| `fork` (derived) | ✓ `forkSession` (CC D27) | ✓ a file written by the store |
| `rename` | ✓ | ✓ `setSessionName` |
| `delete` | ✓ | ✓ the Trash (pi §3) |
| `compact` (session) | ✓ as a `/compact` prompt (CC D30) | ✓, but refused while running: Pi's `compact()` aborts the run (pi §7) |
| `cancelQueued` (session) | ✓ per item, the adapter's queue (CC D9) | ✗ clear-all only (pi §6) |
| `controllable` (session) | ✗ for terminal sessions (CC D28) | ✓ for a session this bridge runs, and for a terminal's through the link (message and Stop only); ✗ for one another client made |
| `answer` (session) | ✓ for a terminal session the hook raised an ask on | ✗ a terminal's asks stay in the terminal |

## 7. Events

Events are the normalized live stream, adapter → core → phone.

```
EventEnvelope { session: SessionRef, seq: int ≥1, at: Timestamp, event: AgentEvent, native?: NativeIds }
SinkRecord    = EventEnvelope without seq and session      // what an adapter emits
```

**Sequence and order.**

- `seq` is assigned by the core: 1, 2, 3… per session and stream epoch, without gaps (§12.2). The adapter emits in causal order.
- Every backend delivers a session's events in order: CC is one pipe (CC D1); Pi writes its events to one pipe, which the adapter delivers one at a time in that order (pi §5).
- Content between `run_started` and `run_finished` belongs to that run by position, so events carry no `runId` except the run events themselves and `Interaction.runId`.

**Stream rules**, checked by `contract/testing/stream-rules.ts` in every conformance scenario:

1. `run_started` only with no active run; `run_finished` names the active run. Exactly one `run_finished` per `run_started`.
2. Blocks and tools start inside a run; every block and tool of a run finishes before its `run_finished`; ids are never reused in a session, counting the ids the starting snapshot holds (open, running, or finished in `run.items`) and every id seen before a `resynced`.
3. `block_delta`/`block_finished` name an open block. If any delta was sent, `block_finished.text` equals the concatenated deltas.
4. `tool_updated`/`tool_finished` name a running tool. A nested call's `parentToolCallId` names a tool of the run.
5. Every `interaction_requested` id is new and is resolved exactly once. A blocking interaction names the active run. When a run finishes, none of its interactions is pending.
6. `retry_finished` follows a `retry_scheduled`; `compaction_finished` follows a `compaction_started`, and a compaction does not start while one is under way. No retry or compaction is under way at `run_finished`. A stream at rest has none open either.
7. Declared traits gate events: thinking deltas need `streamThinking`, text deltas `streamText`, plan blocks `planProposals`, `queue_changed` and `input_returned` `queue` (item ids unique), `usage_updated` `usage`, child sessions `children`, extensions their declared kind, interactions their declared kind.
8. `resynced` resets what is open to its snapshot; the ids seen so far stay seen.

**The events and their sources.** "synth." means the adapter synthesizes the event.

| Event | Meaning | Claude Code | Pi |
|---|---|---|---|
| `run_started{runId, trigger}` | The agent began a run | synth.: first frame after a send to an idle session, or `session_state_changed running` (CC D8) | synth.: first `agent_start`/`compaction_start` while idle, or a `prompt` Pi answers `started` (pi §5) |
| `run_finished{runId, outcome}` | It will not continue on its own | `session_state_changed idle`, which waits for background agents (CC D8) | `agent_settled` (pi §5) |
| `user_message{messageId, text, attachments[], clientRequestId?}` | Input reaching the model, including delivered steer and queue input | the adapter's own send; a prompt typed in a terminal from its transcript tail (CC §5) | `message_start` role user (pi §5) |
| `block_started/delta/finished` | One text, thinking or plan block | `stream_event` `content_block_*`; whole `assistant` frames (CC §5) | `text_*`/`thinking_*` in `message_update` (pi §5) |
| `tool_started/updated/finished` | One tool call | `tool_use`; `tool_progress`; `tool_result` + `tool_use_result` (CC §5) | `tool_execution_*`; `partialResult` is a snapshot (pi §5) |
| `interaction_requested/resolved` | A human is asked; the ask ended | `canUseTool`, `onElicitation`; resolved synth. (CC D15) | bridge dialogs and `tool_call` gate; resolved synth. (pi §8) |
| `queue_changed{items}` | The whole pending queue | the adapter's queue (CC D9) | `queue_update` (pi §5) |
| `background_tasks_changed{tasks}` | Every task running in the background, replacing the list; while it is not empty the session stays open | `system/background_tasks_changed` without ambient tasks, with each task's command and start from `task_started` | an extension's `pi.events.emit("broski:tasks", …)`, relayed by the bridge's extension (`backends/pi/extension-hints.md`) |
| `compaction_started/finished` | Context compaction | `status:'compacting'` … `compact_boundary` + `compact_result` (CC §5) | `compaction_start/end` (pi §5) |
| `retry_scheduled/finished` | A transient failure will be retried | `system/api_retry`; finish synth. (CC §5) | `auto_retry_start/end` (pi §5) |
| `usage_updated{usage}` | Session totals changed | `result` `modelUsage`, `total_cost_usd`; `getContextUsage` after a run (CC §5) | pull after `message_end` (pi §5) |
| `messages_retracted{messageIds}` | Withdrawn messages disappear, with their blocks and tool calls (and those calls' results), open or finished | `retracted_message_uuids`, `supersedes` (CC §5) | — |
| `model_changed{modelId?, thinking?}` | Model and thinking, both replaced | the adapter's `setModel`; per-turn `system/init` (CC §5) | the adapter's own calls; `thinking_level_changed` (pi §5) |
| `mode_changed{axis, value}` | One session mode now has `value` (§11.5) | `system/status.permissionMode`, the adapter's own `setPermissionMode` (CC D13) | the adapter's own `setMode` |
| `notice{level, text}` | One sentence to show, not a turn | `system/informational`, `system/notification` (CC §5) | extension `notify` (pi §8), a session's start problems |
| `activity{activityId, activity}` | Something that happened that is not a turn: a background task's end, a subagent's report, a command's output, an extension's message. Inside a run it is a run item; outside one the client shows it until a read of the transcript holds it | `task_notification` of a task in the background; `local_command_output` | a displayed custom message (`sendMessage`), as its `details.broski` hint says or as Pi's terminal shows it plainly |
| `error{error, retryable}` | A failure outside a run's outcome | process exit, transport error (CC D1) | a fault in the adapter's own part |
| `extension{extension}` | Typed per-backend extra (§13) | `rate_limit_event` | — |
| `session_replaced{session}` | The live session goes on under a new id; this event is the last under the old one. A phone away when it happened is told at its next attach (§12.2). `session` may also name the same session: what it allows changed (Pi: a terminal began or ended running it), and the only way to hand viewers the new `SessionCapabilities` is a new stream | `conversation_reset` (`/clear`, plan-exit context clear) (CC §5) | a terminal began or ended running the session |
| `input_returned{texts}` | Input the backend took back out of its queue because the run was stopped, in the order the backend's own interface would restore it; the client puts it back where the human types. Not state: the reducer ignores it. Needs `queue` | Stop with `cancelQueued` hands what was queued back | `abort` after `clearQueue()` (pi §7) |
| `resynced{snapshot}` | The live state is replaced | the CLI child restarted; the core's own reconcile (core README §6) | the core's own reconcile |

**Run triggers.** `prompt` (input through this bridge, including an action the backend runs as a run), `queue` (a queued prompt dispatched as the previous run ended), `system` (goal, wakeup, background task, restart recovery: CC D8), `external` (another client, such as a terminal run).

**Run outcomes** (`RunOutcome`):

| Outcome | Claude Code `terminal_reason` (CC D8) | Pi (pi §5) |
|---|---|---|
| `completed` | `completed`, `background_requested`, `stop_hook_prevented`, `hook_stopped` | `stopReason` stop/toolUse |
| `aborted` | `aborted_streaming`, `aborted_tools` | `aborted:true` / `stopReason:"aborted"` |
| `error{ErrorInfo}` | `prompt_too_long`, `model_error`, `api_error`, … (BIN `isError`) | `stopReason:"error"` |
| `limit{max_turns\|budget\|output_tokens}` | `max_turns`, `budget_exhausted`, `max_output_tokens` | `stopReason:"length"` |
| `deferred` | `tool_deferred` | `stopReason:"deferred"` |

`ErrorCode` (`auth`, `rate_limit`, `quota`, `context_overflow`, `model_unavailable`, `content_filter`, `network`, `server`, `tool`, `invalid_request`, `backend_unavailable`, `unknown`) normalizes CC `SDKAssistantMessageError` (CC D7) and Pi's error strings. The full mapping is in §15. The native code may go in `envelope.native`.

**Block kinds.** `text`, `thinking`, and `plan`, the last for a plan the agent proposes.

**Tool updates** (`ToolUpdate`). `input` delivers the complete input once a backend that streams arguments finishes (CC `input_json_delta`, CC §5; Pi `toolcall_*`, pi §5). The other kinds:

- `output_appended`: text appended to the tool's output.
- `output_replaced`: Pi `partialResult` snapshots, which replace the output so far.
- `progress`: CC `tool_progress`.
- `file_changes`: a backend's patch update, replacing the previous list.
- `child_session`: the session a subagent call runs in (CC subagent `agent_id`, CC D20; Pi a sub-run in the result's `details`).

**Children.** A subagent's session is a session of its own: its events go to its own `OpenSession` when one is open, and its row reaches lists through the catalog. CC forwards a subagent's tool calls (and its text with `forwardSubagentText`) inside the parent's run (CC D20); those stay in the parent's stream, nested by `parentToolCallId`.

**Tool results** (`ToolResult`) carry `content` (text, images by `ImageRef`, file references), `fileChanges` (CC `structuredPatch`/`gitDiff`, CC D26; Pi edit `details.diff`, pi §4), `error`, and `exitCode` where the backend has one: CC's `BashOutput` has none (Errata 2). A result may also carry a `display` (`ToolDisplay`): what the phone shows in place of its text when the tool has a view of its own: `todos{items[{text, status: pending|in_progress|completed}]}`, `links{items[{title, url, snippet?}]}` (http(s) only) or `files{paths, total?}`, each list holding at least one entry: an empty one is no display, and the result's text ("No files found") shows. CC derives it from `TodoWrite`, `WebSearch`, `Glob` and `Grep` in files mode (`mapping/tool-displays.ts`); Pi from an extension's `details.broski` (`mapping/display-hint.ts`). A failed result has none. `ToolOutcome` is `completed | failed | denied | aborted`.

## 8. Live state, snapshot and reconnect

`SessionSnapshot` is the live state: the active run with everything it has finished so far (`run.items`), open blocks with the newest `MAX_TEXT_CHARS` characters of their text, running tools with the newest `MAX_TEXT_CHARS` characters of their output, pending interactions, the queue, model, thinking and modes, usage, a compaction or retry in progress, and `lastOutcome`. Finished runs are read from the transcript.

`applyEvent(snapshot, {at, event})` in `session-reducer.ts` is the executable meaning of every event. Adapters, the core, and the phone core's Rust port (`packages/link/contract`, held equal by `reducer_trace.json`, §3) all agree with it. `sessionStatus(snapshot)` derives `idle | running | waiting_for_user`: waiting while a pending interaction blocks the run.

**Reconnect is two-sided.**

- *Phone ↔ bridge* is the core's job: a per-session event log with `seq`, plus the snapshot it maintains with `applyEvent`. A phone reattaching with `{epoch, seq}` gets the missed events, or, if the log no longer reaches back or the epoch changed, a `SnapshotSync` (§12.2). No backend offers replay, so the bridge must: CC (CC D1), Pi (pi §10).
- *Bridge ↔ backend* is the adapter's job. After a gap it re-reads and either emits corrective events or one `resynced{snapshot}`. Partial text lost in the gap reappears at the block's authoritative `block_finished`.

**Transcript vs live: the merge rule.** A phone attaching mid-run must render the run's finished part, its open part and the history before it, with no duplicate and no gap. Transcript ids cannot be the key: Pi names no entry in its events, only once it has persisted one (pi §5). So the contract splits the two by run instead of by id:

1. **The snapshot carries the active run whole.** `run.items` holds every item the run has finished, oldest first, in the live stream's ids, exactly as `applyEvent` builds them from the events (`run-items.ts`): its user messages, finished blocks, tool calls as they start (completed with their final input and child session when they finish) and tool results (`<toolCallId>:result`). Notices, compaction markers and model changes stay out; the live state already shows them. A retraction removes the retracted messages' items; `session_replaced` empties the list, because what came before belongs to the old session. Past 1,000 items the oldest leave and `run.droppedItems` counts them.
2. **The transcript holds finished runs only.** While a session open in this bridge has an active run, `readTranscript` ends just before that run's first item. Each backend knows where its run starts: CC the first chain entry after the send (CC D26), Pi the leaf at run start (pi §4).
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
| `form` | `fields[]` (`FormFieldSpec`: string, number, integer, boolean, multiselect), `server?` | `{values: {key → FormValue}}` |
| `plan_approval` | `plan` (markdown), `editable`, `path?`, `modeOptions?{axis, options[], defaultValue?}` (the values of a mode axis the session may go on in once approved) | `{decision: approve\|reject, plan?, feedback?, modeAfter?}` |
| `choice` | `options[{value, label, description?}]` | `{value}` |
| `confirm` | `url?` (an http(s) page to open before answering; the title and body say the rest) | `{confirmed}` |
| `text` | `placeholder?`, `initialText?`, `multiline` | `{text}` |
| any | | `cancel{stopRun, message?}` |

A form has no field that asks the person to open a link: Claude Code raises a URL elicitation as a `confirm` with its `url`; the phone offers the link by its host, Done accepts and Decline declines, and the server's own completion withdraws the ask. A link that is not http(s) is raised as a request the app cannot show.

**Permission options.** Each `PermissionOption` is `{id, label, effect: allow|deny, scope: once|turn|session|always, stopsRun, message: none|optional|required, rule?}`. The adapter builds the options from what the backend offers and maps the chosen `id` back to the native payload, so allow-once, allow-for-session, allow-always-with-rule, deny-and-continue-with-message and deny-and-stop all fit one shape. `grants` carry a requested permission profile (`{id, kind: network|read|write|deny, target?}`); allowing grants a non-empty subset.

**Cancel.** `cancel{stopRun, message?}` answers any kind: the human dismissed it. `stopRun` says whether the run ends. No backend times out on its own (CC D16, pi §8.4), and the bridge has no timeout policy either: nothing answers for a human. An interaction ends only when a human answers or cancels it, or the backend withdraws it or lets it expire. `expiresAt` is the backend's own deadline, shown and never acted on.

**Validation.** `answerProblem(interaction, answer)` faults:

- an answer that names another interaction;
- a reply of the wrong kind;
- an unknown option, question or field;
- a message the option forbids or lacks;
- edited input when not allowing an editable request;
- a grant listed twice, grants outside the request, an allow with no grant when grants were requested, or a deny with grants;
- question answers that name an unknown or repeated question, an unknown or repeated option, free text where the question takes none, or break `multiSelect` or `required`;
- form values of the wrong type, out of bounds, off-pattern, off-format or not an option;
- an empty answer to a required string or multiselect field;
- answers to inactive fields, and missing required active fields (a hidden one counts as answered only when it has a default, which the adapter fills in);
- plan feedback on an approval, an edited plan on a rejection or on a non-editable plan, a `modeAfter` on a rejection, on a plan that offers no modes, or that is not one of the `modeOptions`;
- a choice that is not an option;
- newlines in single-line text.

**Field keys.** A field's `key` is any string but `__proto__` (`FieldKey`; the JSON Schema says so as a `pattern`). A reply holds its answers in an object keyed by field key, and `JSON.parse` gives such an object a `__proto__` key of its own that zod's record parse then drops without a word, so a field so keyed could never be answered. The schema refuses the key in a field, a `when` condition and a reply (`invalid_message` naming it), and an adapter whose backend names a field `__proto__` owns the mapping: it shows the phone another key, unique among the form's, and maps the answer back to the backend's. Only `__proto__` is lost: every other name an object, a function or an array inherits, and the names around them, survives the parse (a test holds more than fifty of them to it). Any backend can name one: an MCP server's elicitation schema chooses its property names (CC D15).

`fieldIsActive` evaluates `when` (all conditions must hold; `eq` against a multiselect means "includes"; a condition on an unanswered field is false).

Where backends validate differently, `field-check.ts` is the strictest of them, so no backend refuses an answer it passes (Errata 3):

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

| Kind | Claude Code | Pi |
|---|---|---|
| `tool_permission` | `canUseTool` (CC D15). Options: allow once; allow for the session when the CLI suggested session updates; one allow-always per settings file it suggested a rule for (rule text, the `PermissionUpdate[]` echoed); deny (optional words, `interrupt:false`); deny-and-stop (`interrupt:true`). `suppressAlwaysAllowRule` drops always; `defaultToNo` → `defaultOptionId`; `requiresUserInteraction` → `deliberate`; the input is not editable. Previews from the tool input and `blocked_path`. A terminal `claude`'s `PermissionRequest` hook raises the same kind on a watch-only session. | Bridge-owned `tool_call` gate: allow once/session/always (bridge policy), deny (`block` + reason), deny-and-stop (block + abort); `input` mutable (pi §8.6). |
| `questions` | `AskUserQuestion` via `canUseTool` (CC D15). Question id = index; answers mapped to question-text keys, multi-select comma-joined; `allowCustom` always (CC adds "Other"); `required` always. Cancel → deny (`interrupt` = `stopRun`). | ✗ |
| `form` | `onElicitation` form mode: `requestedSchema` → fields in the schema's key order (CC D15). Submit → `accept` + `content`. | ✗ |
| `plan_approval` | `ExitPlanMode` via `canUseTool` (CC D15): approve → `updatedInput.plan` = edited plan; reject → deny with feedback. | ✗ |
| `choice` | ✗ | `ctx.ui.select` (pi §8). |
| `confirm` | an elicitation with an empty schema; a URL elicitation (with `url`); a request the app cannot show (a link that is not http(s), fields it cannot render), which a person may decline or dismiss | `ctx.ui.confirm`. |
| `text` | ✗ | `ctx.ui.input` (single line), `ctx.ui.editor` (multiline, `prefill` → `initialText`). |
| cancel → native | deny `{message, interrupt: stopRun}`; elicitation `decline` (+ `interrupt()` when `stopRun`) | `{cancelled:true}`; gate `block` (+ abort) |
| resolved: withdrawn | `control_cancel_request` (CC D16) | extension timeout or abort signal (pi §8.4) |
| resolved: expired | CLI child died (CC D16) | bridge restart (pi §8.5) |

## 10. Input

```
PromptInput { clientRequestId, mode: start|steer|queue, text, attachments[], command? }
PromptResult = accepted{disposition: started|steered|queued|handled, queueItemId?} | Rejected
Rejected { status: rejected, rejection: Rejection }
Rejection { code: busy|not_steerable|no_model|auth|invalid_input|unsupported|not_found|forbidden|stale|closed|backend_error, message }
```

`PromptInput` is strict: it has no other field. `disposition: handled` means the backend consumed the input without a run, such as an extension command.

**Modes.** `start` begins a run and is rejected `busy` while one is active. `steer` joins the active run at its next safe boundary. `queue` is delivered when the agent would otherwise stop: Pi goes on with it inside the same run (pi §6 `followUp`), Claude Code's adapter sends it once the run settled, as a run of its own (CC D9). With no active run, `steer` and `queue` start one (disposition `started`).

| | Claude Code | Pi |
|---|---|---|
| start | open-stream send (CC D9) | `prompt` (every mode is one) (pi §6) |
| steer | `priority:'next'` | `prompt{streamingBehavior:"steer"}` |
| queue | the adapter's queue, one send per run | `followUp` |
| idempotency | `uuid` = `clientRequestId` (CC D10); the adapter dedupes | none; the adapter dedupes (pi §6) |
| accepted signal | none synchronous; the adapter accepts on write (CC D9) | the `prompt` answer's disposition: `started`, `queued` or `handled` (pi §6) |
| typed rejections | — | `no_model`, `auth`, `busy` (compacting) (pi §6) |
| command | text `/name args` (CC D11) | text `/name` or `/skill:name` (pi §6) |

**Rules.** Every prompt carries a `clientRequestId`. The adapter de-duplicates within an open session: a repeat of an **accepted** prompt returns the first result and does nothing else. A rejection is not remembered, so a phone that retries with the same id after the cause is gone (the run that made it `busy` ended, the user signed in) is served; no backend admits anything on a rejection either. It passes the id to backends that persist it (CC `uuid`). The core de-duplicates across bridge restarts. The prompt's `user_message` carries its `clientRequestId`, which is how a phone matches its optimistic bubble. Every phone prompt is human input, so the adapter stamps the backend's human attribution itself (CC `origin:{kind:'human'}`, which changes `priority:'now'` semantics, CC D9). Failures after acceptance are events, not rejections (pi §6).

**Attachments.** `Attachment` = `ImageContent{mimeType, data(base64), name?}` | `FileContent{uri, mimeType?, name?}`; the images of one prompt hold at most 4 MiB of base64 together. A backend declares the kinds it takes in `Capabilities.attachments` (both declare `image`); an undeclared kind is rejected `unsupported`.

**Images go back by reference.** Inline bytes travel only in a prompt and in an `attachment.read` answer. Everything the bridge sends about input, the live `user_message` and the transcript's `user_message` items alike, carries `AttachmentRef` = `ImageRef{id, mimeType, name?}` | `FileContent`, and tool results carry `ImageRef` too (`ToolContent`). `readAttachment(session, id)` returns the bytes. Both backends keep them where an id can find them: the session JSONL (entry and block index, CC D26, pi §4). This keeps a 200-item transcript page small whatever its images weigh.

**Queued input after an abort.** An abort leaves the queue as the backend leaves it, and `queue_changed` shows the result: Pi clears both queues on Stop and hands the texts back in `input_returned`, as the terminal's Esc does (pi §7); Claude Code's Stop cancels the queued commands and does the same. What a backend takes back out is handed to the human in `input_returned{texts}`: the app joins those texts with a blank line between them and puts them in front of what is already typed, and nothing is sent again by itself. What stays queued is delivered by a later run, as the backend schedules it, and can be cancelled where `cancelQueued` exists.

## 11. Read models

### 11.1 Sessions

`SessionSummary { session, title?{text, source: user|generated|first_prompt}, cwd?, createdAt?, updatedAt, parent?{kind: fork|subagent, session}, modelId?, status, origin: broski|external, source? }`, listed newest-updated first by `listSessions(SessionQuery{cwd?, parent?}, PageRequest)`. `status` is `idle | running | waiting_for_user | unknown`.

| Field | Claude Code (CC D23) | Pi (pi §3) |
|---|---|---|
| title | `customTitle` user / `aiTitle` generated / prompts first_prompt | `name` user / `firstMessage` |
| cwd | `cwd` | header `cwd` (`""` for old sessions → absent) |
| createdAt / updatedAt | `createdAt?` / the last message's `timestamp` (never past the file's mtime) | `created` / `modified` |
| parent | subagents via `listSubagents`; fork lineage in the adapter's own journal | `parentSessionPath` fork (path → id by the bridge index) |
| status | live for hosted sessions, else `unknown` | live for hosted sessions, else `unknown` |
| origin | the adapter's owner journal; `entrypoint` `cli` → external | the bridge's index |
| paging | offset/limit, unstable under inserts; dedupe by id (CC D23) | none: a bridge-side index (pi §3) |

**Paging rules** (`PageRequest{cursor?, limit 1..200}`):

- Every page is newest first.
- `nextCursor` is opaque, minted only by the adapter that will read it.
- A page may be shorter than `limit` without being the last; only an absent `nextCursor` ends the list.
- A cursor the adapter did not mint is rejected `invalid_input`.
- On a list nobody changes, the pages concatenate to exactly the one-page list, with no duplicates or gaps (conformance). On a changing list, rows can move; the app de-duplicates by id.

### 11.2 Transcript

`readTranscript(session, page)` returns `TranscriptPage{items, nextCursor?, idStability: stable|positional}`, newest first. Items are flat, one per block, so a page boundary can never split a message. Items of one assistant message share `messageId`. A page holds finished runs only (§8) and names images by reference (§10). The item kinds are `user_message`, `block`, `tool_call`, `tool_result`, `notice`, `activity`, `compaction`, `model_change` and `run_boundary`.

| Item | Claude Code (CC D26) | Pi (pi §4) |
|---|---|---|
| `user_message` | `user` text + image blocks | role `user` |
| `block` (text/thinking/plan) | one `assistant` line per block | `text`/`thinking` blocks |
| `tool_call` + `tool_result` | `tool_use` + `tool_result`/`toolUseResult` | `toolCall` block + `toolResult`; a `bashExecution` entry as a `bash` call |
| `notice` | `system` informational | `branchSummary`, an error line for a failed message |
| `activity` | a saved `<task-notification>`, a slash command's output (`<local-command-stdout>`, `system/local_command`), a `!` escape's output | a displayed `custom_message` |
| `compaction` | `compact_boundary` (+ tokens) | `compaction` (summary, tokens) |
| `model_change` | `attachment.type:"model"` (disk only) | `model_change`, `thinking_level_change` |
| `run_boundary` | `turn_duration` / `result` (disk); an interrupt marker is `aborted` | — |
| ids | entry `uuid`, stable | entry ids stable |
| paging | chain offset from the start; whole file parsed (CC D26) | none: whole file (bridge pages) |

### 11.3 Models and thinking

`ModelSummary{id, displayName, description?, providerId?, providerName?, contextWindow?, inputModalities?, thinking: ThinkingSpec, isDefault, unavailableReason?}`. A plain `models.list` holds usable models only. With `includeUnavailable` the models the backend knows but cannot use now follow them, each with an `unavailableReason` that says what is missing; `setModel` refuses one (`auth`), and the conformance rule for models checks the order and the reason. `ThinkingSpec{options[{value, label?, description?}], defaultValue?}`: no options means thinking cannot be set. `setThinking(value)` takes one of the current model's option values and nothing else; anything else is rejected `invalid_input`. `setModel(id)` takes a listed model; anything else is rejected `not_found`. The snapshot's `modelId` is the model chosen. A model chosen mid-run is accepted and reaches the next run; whether the run's own later requests take it is the backend's (the conformance rule checks the next run).

| | Claude Code | Pi |
|---|---|---|
| list | the `initialize` answer's models (CC D7), the Default row first, no model twice (CC D12) | `get_available_models` (pi §9) |
| `id` | `value` (alias or id) | `provider/id` |
| thinking options | `supportedEffortLevels` (CC D12) | the model's `reasoning` and `thinkingLevelMap` (pi §14) |
| default | — | per-model or global default, clamped |
| context window | ✗ in the list; the context figure comes after each run (CC D14) | `contextWindow` |
| `isDefault` | — | settings default |

### 11.4 Commands, usage, status

- `CommandSummary{id, name, kind: command|skill|prompt, description?, argumentHint?}`. A prompt invokes one with `PromptInput.command = id` and its arguments as `text`. Sources: CC `SlashCommand` and skills, with `terminal_slash_commands` filtered out (CC D7); Pi extension commands, prompt templates and skills (pi §9).
- `Usage{inputTokens?, outputTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens?, costUsd?, contextTokens?, contextWindow?}` holds session totals as reported and the context window's fill; an unreported field is absent. CC `modelUsage` is cumulative per CLI process (CC D14), and the context figure comes from `getContextUsage` after each run. Pi's is `get_session_stats`' `contextUsage`, whose `tokens` may be null after compaction (pi §5).
- `BackendStatus{installed, version?, auth: signed_in|signed_out|unknown, usable, issues[]}`, from CC D7, pi §2. Finding it out never fails: a Pi catalog that cannot be read (pi §2) becomes an `error` issue with `usable: false`. The catalog lists that can fail return a result: `listModels`, `listCommands`, `listModes`.

### 11.5 Session modes

The settings a session runs under that change what the agent may do or how it works: Claude Code's permission mode, Pi's `permissions` (the bridge's gate) and the like. They are normalized, because the research shows one shape behind them, the same shape the contract already uses for thinking:

| | Claude Code | Pi |
|---|---|---|
| what | `PermissionMode` (CC D13) | `permissions`: `off` or `ask` (pi §8.6) |
| finite list | fixed enum: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto` (`sdk.d.ts:2562`) | `off`, `ask` |
| at start | `Options.permissionMode`, always passed (CC D5) | written to the session file |
| set later | `Query.setPermissionMode`, mid-run | `broski.permissions` entry |
| changed elsewhere | `system/status.permissionMode` | — |

So the contract has **mode axes**: `ModeAxis{id, label, description?, options: Option[], defaultValue?}`, listed by `listModes(cwd)` (a backend's modes may depend on the directory), each session's current values in `snapshot.modes: ModeSetting{axis, value}[]` (one per listed axis), `mode_changed{axis, value}` when one changes, `setMode(axis, value)` to change one (an unknown axis or value is `invalid_input`), and `NewSessionOptions.modes` to start in them. Values are opaque, like thinking values: the app shows the backend's labels and never branches on a value. What a value allows is said in its option's `description`, which is where an adapter words a risk such as `bypassPermissions`. A list that changes is `catalog_invalidated{scope: modes}`.

When a change takes effect is not a capability, because no backend lets the contract observe a mode's effect (a permission mode changes which tools ask, not anything the model or the stream shows), so it could not be checked; for CC it is mid-run.

## 12. Wire protocol

Layer 2: one schema, `protocol.ts` (and its generated JSON Schema), defines both ends.

### 12.1 Messages

Every client message is a request `{type, requestId, …}` answered by exactly one `{type: "<type>.result", requestId, …}` or an `error`. `ResponseFor<T>` types the pairing. On a socket every message travels inside `{"type":"contract","message":…}` (core README §4).

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
| `session.rename{session, title}`, `session.delete{session}` | `{result: ActionResult}` |
| `session.attach{session, resume?}` | `{capabilities: SessionCapabilities, sync: AttachSync}` |
| `session.detach{session}` | `{}` |
| `transcript.read{session, page}` | `{result: TranscriptRead{page} \| Rejected}` |
| `attachment.read{session, attachmentId}` | `{result: AttachmentRead{image} \| Rejected}` |
| `prompt{session, input}` | `{result: PromptResult}` |
| `abort`, `interaction.answer{answer}`, `queue.cancel{queueItemId}`, `model.set{modelId}`, `thinking.set{thinking}`, `mode.set{axis, value}`, `compact{instructions?}` (each with `session`) | `{result: ActionResult}` |

The workspace requests (`workspace.info`, `fs.*`, `git.*`, `term.*`) are listed in §20.

Server-pushed messages: `event{envelope}` (§7), `catalog{backend, event}` (§5), and a terminal's `term_output` and `term_exited` (§20).

Every `…Listed`/`…Found`/`…Read` member is `{status: "accepted", …}`, and every result union shares the one `Rejected` member. `error{requestId?, error{code: invalid_message|unsupported_version|unknown_backend|unknown_session|not_attached|rate_limited|internal, message}}` is only for a request the bridge could not handle at all; `requestId` is absent when the message carried none the bridge could read. `rate_limited` means the request was not served because its connection sent too much too fast; it may be sent again a few seconds later. Every request gets exactly one answer: the bridge answers `internal` itself when a backend has not finished a request within its deadline. An operation the backend lacks is an `unsupported` rejection inside the normal result, because capabilities already told the app.

### 12.2 Attach and replay

`session.attach{session, resume?: {epoch, seq}}` answers `sync`:

- `replay{epoch, afterSeq}`: events from `afterSeq + 1` follow as `event` messages.
- `snapshot{epoch, lastSeq, snapshot}`: the live state after `lastSeq`; events from `lastSeq + 1` follow.
- `replaced{epoch, session}`: the stream `epoch` ended in `session_replaced`, and its conversation goes on as `session`, after any further replacement. The client is attached to neither session and nothing follows: it attaches to `session` next (without `resume`, which names another session's stream). The answer's `capabilities` are `session`'s own, since the bridge opens it to give them.

The bridge replays only when it still holds every event after `resume.seq` in the same epoch. A bridge restart starts a new epoch.

**A session replaced while the phone is away.** `session_replaced` reaches only the clients viewing the stream. The core therefore remembers, for every stream that ended in one, which stream replaced it (the old stream's epoch to the new session and its epoch: the old session's id would also catch a phone that opens it on purpose to read its history). A client that attaches with a `resume` whose epoch is one of those is sent `replaced`, the chain followed to its end; a `resume` of any other epoch, or none, attaches as ever. An attach already under way when its session is replaced gets the same answer. Only an attach is answered so: reading the old session's transcript is not a sign the phone lost its conversation, and the old transcript is still there. The memory is bounded and kept across bridge restarts (core README §5).

### 12.3 Interactions over the wire

Pending interactions arrive in the snapshot or the replayed `interaction_requested` events, so a reconnecting phone always sees every pending ask. Several phones may answer: the first answer the core forwards wins, and the others get `stale`. A session without control takes `interaction.answer` when its capabilities say `answer` (§5 rule 14); every other control request on it is `unsupported`.

### 12.4 Versioning

`PROTOCOL_VERSION = {major: 1, minor: 0}`. Bridge and app talk only when `major` is equal; `hello` agrees on nothing else. Nothing has shipped, so 1.0 changes in place: there is no per-minor table and no stand-in frame for an older client. Once a client ships, a change the other side cannot ignore bumps `major`.

## 13. Backend extensions

A backend's extras are typed `extension{extension}` events, declared in `Capabilities.extensions`; never an untyped blob, and never a request:

- `rate_limit{window, status?, usedPercent?, resetsAt?}` (CC `rate_limit_event`: `resetsAt` in epoch seconds, `utilization` a fraction, CC §5).

## 14. Conformance

`contract/testing/` holds the reference implementation and the suite every adapter must pass.

- **`createFakeBackend(host, options)`**: in-memory and scriptable (`FakeStep`). It simulates streaming text, thinking and plan blocks; tools with streamed input, nested calls, child sessions and file changes; every interaction kind and every answer outcome; steer; queue with ids and cancel; compaction; retry; usage; retractions; notices, errors and extensions; failure, limit and defer outcomes; external sessions and external runs; `resynced`; backend loss with expiry; modes; images stored and read back by reference; both model-switch timings; a restart of the bridge, after which runs have ended. `traits`, `methods` and `modes` narrow it, which is how a capability is switched off.
- **`runConformance(name, factory, timeoutMs?)`** registers one bun test per rule. `checkRule(factory, rule)` runs one rule against a fresh backend and rejects with the reason it failed.
- **`ConformanceFactory = (host) => Promise<{backend, driver}>`**. Each adapter has a driver: Pi's seam is the real `pi` against a scripted OpenAI-compatible endpoint in a throwaway agent dir (`src/__tests__/pi/driver.ts`, pi §16), Claude Code's is the real `claude` against a scripted Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL`, `src/__tests__/claude-code/conformance/`). The driver (`conformance-types.ts`):
  - knows a `cwd` holding a `README.md` and an `otherCwd`;
  - `seedSessions(cwd, n)`;
  - `arrange(session, scenario)` for `reply`, `tool` (a tool call, then a text answer), `hold` (until aborted or `release`d), `interaction{kind}`, `feature{thinking|usage|plan_proposal|children}` and `echo_model` (two requests, each answering with the id of the model it ran with, a hold between). It returns false when the backend cannot, and that is a failure whenever the capability is declared;
  - `release(session)`; `quiesce()`, which resolves once everything asked so far has emitted all it will, short of a hold, a human or a run still going (the silence checks wait on it, never on a timer);
  - `delivered(session)`: the latest user input as it reached the model;
  - `runExternally(session)`: another client runs one reply;
  - `watchedAsk?()`: another client raises an ask in a session it owns that this bridge opens without `control` but with `answer` (§5 rule 14); absent or undefined when the backend has none, and a backend that has them must offer it;
  - `restart(host)`: the bridge restarts over the same backend state.

**The rules** (`CONFORMANCE_RULES` in `conformance.ts`, each on a fresh backend):

1. Capabilities match the methods the backend has: they parse (including `start` in `promptModes` and no value twice), and `status()` is a valid `BackendStatus`.
2. Models and their thinking options are consistent: they list, are valid, ids are unique, at most one is the default, thinking options do not repeat, every default thinking value is an option, no model offers thinking without `thinking`; with `includeUnavailable` the usable models come first and every later one says why it is unavailable.
3. Commands are listed exactly when declared: they list, are valid, ids are unique; at least one is listed exactly when `commands` is declared.
4. Modes and their options are consistent: they list, are valid, axis ids and option values are unique, every default is an option.
5. Session pages concatenate newest first inside the requested `cwd`: they keep to their limit and concatenate without duplicates or gaps, with another directory's sessions under it; a foreign cursor is rejected `invalid_input`.
6. A session can be read by its ref: right ref, directory, origin and status, listed; an unknown one is `not_found`.
7. Transcript pages concatenate newest first: they keep to their limit and concatenate without duplicates or gaps (the answer before the tool call before the prompt), hold the prompt with its `clientRequestId`; a foreign cursor is rejected.
8. Renames, forks and deletes work and show in the catalog: a rename shows in the catalog and the summary; a fork is marked as one, names its parent, holds the whole history, and a fork through an item ends at it; a delete shows in the catalog, and the session is gone from reads and listings. Each only where the method exists.
9. A run streams its answer and ends exactly once: it ends `completed`, produces text (streamed when `streamText`), and its user message carries the `clientRequestId`.
10. A tool call starts and finishes inside its run.
11. Every declared feature shows up as the event the contract names for it.
12. Input reaches the model with its attachments and command: every declared attachment kind and command reaches the model as sent; undeclared ones are rejected `unsupported`.
13. Images come back by reference: a prompt's image comes back as an `ImageRef`, in the live user message and in the transcript, and reads back byte for byte; an unknown attachment is `not_found`.
14. A repeated `clientRequestId` runs once and a rejection is not remembered: the same result, one run; a prompt rejected `busy` can be sent again with its id once the run ends.
15. `start` while a run is active is `busy`.
16. `steer` joins the active run (`steered`), or is rejected `unsupported` when not declared.
17. Queued input can be seen and cancelled: `queue` is `queued`, named and visible in `queue_changed` when declared, cancellable when `cancelQueued` exists, and a second cancel is rejected; or the mode is rejected `unsupported` when not declared.
18. `abort` ends the run: with no run it is accepted and silent; during a run it ends it `aborted`.
19. Models and thinking can be set and reach the model when declared: every listed model and thinking value can be chosen and shows as `model_changed`; others are refused; a model chosen mid-run is accepted, and the next run runs with it.
20. Modes can be set: a new session starts in the modes asked for, with one value per axis; every value can be chosen and shows as `mode_changed`; others are `invalid_input`.
21. Compaction runs when the session can compact, as one compaction.
22. Every declared interaction kind is answered, checked and cancelled correctly: invalid answers are rejected `invalid_input` and change nothing, a valid answer resolves it `answered` and the run goes on, a repeat answer is `stale`, `cancel{stopRun}` ends the run exactly when it says so, and an abort withdraws the pending ask.
23. The snapshot carries the active run and equals the open snapshot plus the events: mid-run, `snapshot()` equals the open snapshot plus the events, the active run carries its prompt in `run.items` while the transcript holds none of the run, a reopen yields the same live state and capabilities, and the finished run reaches the transcript.
24. `close` is idempotent, silent afterwards, and aborts nothing: nothing arrives from the call on, control rejects `closed`, the run survives the close, and an ask pending at close is in the next open's snapshot and can be answered there.
25. `dispose` silences every sink.
26. Runs another client starts are live when declared: with `externalLive`, a run another client starts is reported, with trigger `external`.
27. Sessions survive a restart and runs end with it: after a restart of the bridge the session is still there and its run is not.
28. A watched session that takes answers checks them and resolves its ask once: a session with `control` has no `answer` of its own; with `watchedAsk`, the watched session opens without `control` and with `answer`, its ask is pending (in the open snapshot or raised after), invalid answers are `invalid_input` and leave it pending, a valid one resolves it `answered`, a repeat is `stale`, and an answer after `close` is `closed`.

Every scenario's stream also passes the stream rules (§7), and every catalog event is validated as it arrives. `src/__tests__/contract_conformance.test.ts` runs the suite against the fake with every capability and with none optional; the Pi and Claude Code adapters run it in their own test directories.

**The suite can fail.** The `contract_negative_*.test.ts` files run deliberately broken adapters (one change each to the honest fake or its driver): every assertion of every rule, and every stream rule a rule relies on, fails at least one of them, for the reason it names. `fails()` (`src/__tests__/helpers/broken-adapters.ts`) requires the rule to reject with that reason, so a rule that lets its broken adapter through, or catches it only by accident, fails its negative test.

## 15. Lossy points and unsupported capabilities

What each backend cannot carry through the contract, and what is lost on the way. "Unsupported" means the capability is false or the kind is undeclared.

**Every backend**

- Per message: the model that wrote an assistant message, its usage and its stop reason are not carried (CC `message.model` and `usage`, CC D26; Pi `model`, `usage`, `stopReason`, pi §4). The session's totals are `Usage`, its current model is `modelId`, and model switches in history are `model_change` items.
- Past a bound (§2 rule 8) a value is shortened by the adapter: a tool's output beyond `MAX_TEXT_CHARS` (CC's Bash output), a title beyond `MAX_NAME_CHARS`, a list beyond its maximum. A running tool's output in the snapshot keeps its newest `MAX_TEXT_CHARS` characters.
- Inline documents that are not images (CC `document` blocks, CC D26) are left out of history: only images are read back by reference, and a file attached by path stays a `FileContent`.
- What queued input does after an abort differs per backend (§10); the contract shows the result in `queue_changed`, not a promise about it.
- When a mode change takes effect (§11.5).

**Claude Code**

- Unsupported: `planProposals`; `externalLive` (CC D28); `choice` and `text` interactions; file attachments (a file reaches the CLI as `@path` in the text).
- Lost, events: `thinking_tokens` estimates when thinking display is omitted (CC §5); `tool_use_summary`; `task_*` details beyond the child session link (description, usage, background state; CC §5); hook events; `system/init` catalogs between turns; `model_refusal_no_fallback` beyond its error; `memory_recall`, `files_persisted` and the other informational system frames; prompt suggestions.
- Lost, input: `shouldQuery:false` appends and `client_composed` verbatim prompts (CC D9).
- Lost, tool results: per-tool structured output beyond diffs, images and text, such as `BashOutput.gitOperation` and `backgroundTaskId`, and the `Read` variants (CC D26).
- Lost, interactions: AskUserQuestion `annotations.notes` and the free-form `response` (CC D15); a URL elicitation, which a person can only decline or dismiss.
- Lost, modes: none of the six permission modes is dropped; `bypassPermissions` needs `allowDangerouslySkipPermissions` at start (CC D13), so the adapter offers it only when it started the session with it.
- Lost, input and catalog: `priority:'now'` interrupt-and-send (do abort then start); transcript `gitBranch` and `tag`; the CLI's `capabilities` strings (the adapter uses them to set traits); effort as a single scale, so the adaptive/enabled/budget thinking modes are not chosen separately (CC D12).
- Lost, errors: `SDKAssistantMessageError` → `ErrorCode`: `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `verification_required`, `cloud_credential_error` → `auth`; `billing_error` → `quota`; `rate_limit` → `rate_limit`; `overloaded`, `server_error` → `server`; `invalid_request` → `invalid_request`; `model_not_found` → `model_unavailable`; `max_output_tokens` → the `limit` outcome; `unknown` → `unknown`.

**Pi**

- Unsupported: `planProposals`; `questions`, `form`, `plan_approval`; per-item queue cancel (only `clearQueue`, pi §6); file attachments; a session another client made cannot be driven (watch-only).
- Lost: `custom()` TUI dialogs, which RPC mode never sends (`ui.custom` returns undefined, pi-coding-agent 1.5.2 `rpc-mode.js:156-159`); fire-and-forget extension UI (`setStatus` but the bridge's own `broski:tasks` key, `setWidget`, `setTitle`); confirm's cancel-vs-false distinction (pi §8.3); `summarization_retry_*` (compaction-internal retries); `entry_appended` custom entries; error strings carry no class, so most errors are `unknown` (pi §13).

## 16. Refinements of the brief

The brief names proposals and says to refine them. These are the places the contract differs, and why.

| Brief | Contract | Why |
|---|---|---|
| `session_state` event | `sessionStatus(snapshot)`, derived | Every state is a function of runs, pending asks and the last outcome, so a separate event could only disagree with them. `unknown` exists only for list rows. |
| `message_started{messageId, role}` | `messageId` on every block (and optionally on tools); a separate atomic `user_message` event | A block is never orphaned by a lost marker. User input is complete when it arrives. |
| `runId` on the envelope | `runId` only on run events and `Interaction.runId` | Position in the ordered stream already attributes content to a run (§7). A redundant id could disagree with it. |
| `interaction_resolved{answered\|cancelled\|expired\|superseded}`, synthesized by the core | `answered\|withdrawn\|expired`, emitted by the adapter | Only the adapter knows whether its answer landed or the backend withdrew the ask (CC `control_cancel_request`). The core still owns first-answer-wins. The reply is not echoed, which keeps secret answers out of the broadcast and the log. |
| `InteractionAnswer{outcome: answered\|cancelled, payload, message?}` | `reply`: a per-kind union plus `cancel{stopRun, message?}` | Continue vs stop is explicit. Decline and cancel are distinct for some backends natively. |
| `plan_updated{kind: todo\|proposal}` | a `plan` block kind (a proposal) | A proposal streams as deltas; a block streams without resending the whole text on every change. The todo list is not in the contract. |
| `PromptInput.origin: human`, `skills?` | dropped; `command?` | Every phone prompt is human, so the adapter stamps it. Skills and commands are both invoked by id. |
| `PromptResult.accepted{runId?}` | no `runId` | CC cannot know the run at acceptance (CC D9). The `user_message.clientRequestId` links a prompt to its run. |
| `Page{nextCursor?, prevCursor?}` | `nextCursor?` only; a `TranscriptPage` also says `idStability` | Catch-up re-reads the newest page (§8); no backend-agnostic need for backward cursors. |
| Capabilities `pagedListing`, `pagedTranscript`, `revert`, "reconnect strategy" | paging mandatory; no revert; runs end with the bridge | Every adapter must page (natively or over a bridge index), so the flag would say nothing. A run never outlives the bridge, so there is no reconnect strategy to declare. |
| `ModelSummary.ref{providerId, modelId}` | opaque `id` + `providerId?`/`providerName?` | CC models have no provider (CC D12). The adapter encodes its own composite. |
| `ThinkingSpec{options, default}` | `defaultValue` | `default` is a reserved word in Swift and Java. |
| `open(ref \| new, sink)` → `OpenSession` | `OpenResult = {status: accepted, session, snapshot} \| Rejected` | Typed rejection instead of a throw, and no race between snapshot and first event (§5). |
| `status(): BackendStatus`, `listModels()`, `listCommands()` | `status()` never fails; the lists return results | A failure to find out the status is itself status (`issues`, `usable: false`); a list that fails has a reason the app can show, not an empty list. |
| `SessionSnapshot` — open blocks, running tools | plus the active run's finished items; the transcript holds finished runs only | The merge rule (§8): no backend gives live and transcript ids that always agree. |
| — | added session modes (§11.5), `attachment.read` (§10) | Modes: the research shows one shape across the backends. Attachments: transcript pages must not carry inline images. |
| `tool_started{childSession?}` | `ToolChildSession` update | The child is known only after the call starts in every backend that has one. |
| `Interaction.session` | dropped | The envelope already names the session. |
| — | added `input_returned{texts}` | A terminal's Esc gives queued input back to the human, and the contract had no way to say so. |
| — | added `OpenSession.answer` and `SessionCapabilities.answer` | A terminal's permission prompt reaches the bridge (CC D29) on a session the phone may only watch; giving that session a `control` would let the phone prompt and stop a session a terminal owns. The core refused every answer without `control`, so answering became its own optional method and its own capability. |
| — | added `session_replaced{session}` | CC continues a live session under a new id after `/clear` or a plan-exit context clear (`conversation_reset`, CC §5); without it the phone would keep watching a session that no longer receives anything. |

## 17. Not in the contract

- **Background-task control**: backgrounding a running tool, a task's stop affordance.
- **Catalogs** beyond models, commands and modes: Pi's global vs project scope (pi §13), auth and login flows (CC D7).
- **Taking over a session another client runs** (resuming a terminal-owned CC or Pi session interleaves writers, CC D28, pi §11): such a session stays watch-only.
- **Title search** in `SessionQuery`: CC and Pi would need the bridge index. An additive field later.

## 18. Open questions

Every open item that affects the contract, with the experiment that settles it.

| # | Question | Affects | Experiment |
|---|---|---|---|
| Q1 | Does a repeated CC `uuid` execute twice? | Nothing while the adapter de-duplicates (CC D10) | Same `uuid` twice while queued |
| Q2 | Does a PreToolUse `defer` work in streaming mode? | `deferred` outcome reachability for CC | Hook returning `defer` on AskUserQuestion; watch for `tool_deferred` |
| Q3 | How CC extended AskUserQuestion kinds (`text`, `number`) reach SDK sessions | `questions` vs `form` for CC | Enable `CLAUDE_CODE_QUESTION_EXTENDED`; log `canUseTool` input (CC D15) |
| Q4 | Purpose of `~/.claude/sessions/` | CC external session status | Run a terminal `claude`; list the directory; close it |

The other Claude Code questions are settled against the real CLI, each in its decision: an interrupted turn's outcome (CC D8), `command_lifecycle` for uuid-stamped sends and `interrupt({cancelQueued})` (CC D9), thinking by `applyFlagSettings({effortLevel})` (CC D12), the plan's next mode (CC D17), history before a compaction (CC D26), `idle` and background agents (CC D8), fork lineage (CC D27), effort levels (CC D12), and the rate limit's units (CC §5).

## 19. Errata

Found reading the Claude Code SDK's source against the contract:

1. **Claude Code fork**: `forkSession`'s `upToMessageId` is **inclusive** (`sdk.d.ts` `ForkSessionOptions`). The contract's `ForkPoint{position: before|through}` relies on it (CC D27).
2. **Claude Code diffs**: `BashOutput` has no exit code, only `returnCodeInterpretation` (`sdk-tools.d.ts`), so `ToolResult.exitCode` is absent for CC.

Found reading the Claude Code SDK's source against the contract, second round:

3. **Form validation strictness**: the strictest validator among the backends counts lengths in UTF-16 units, compiles `pattern` without flags and refuses every answer to a field whose pattern does not compile, requires a dotted email domain (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), refuses an empty string or empty selection for a required field, and does not excuse a hidden required field. `field-check.ts` adopts each of these (§9).
4. **Claude Code `cancelQueued`**: `interrupt_cancel_queued_v1` gates only `interrupt{cancel_queued: true}`, which aborts the turn and cancels every queued command (`sdk.d.ts` `SDKControlInterruptRequest`). Per-item cancel is the adapter's own queue (CC D9).
5. **Claude Code elicitation**: `ElicitResult.content` is typed `Record<string, unknown>` (`sdk.d.ts` `ElicitResult`); the values MCP accepts are the primitives `FormValue` carries.

Found in the client port against the contract:

6. **`answer-check.ts`, `field-check.ts` (inherited keys)**: a form answer was read as `values[key]`, so a field whose key every JavaScript object inherits (`constructor`, `toString`, `hasOwnProperty`, …) read a function as its answer: an optional such field left unanswered was refused (`expects text`), and a `neq` condition on it held with no answer. Answers are now read by own key only (`answerFor`); `contract_form_keys.test.ts` holds it. A field keyed `__proto__` was unanswerable over the wire (zod's record parse drops that key); it is now refused in the schema (erratum 7).
7. **`forms.ts`, `interaction-replies.ts` (`FieldKey`)**: `__proto__` is no longer a legal field key, and a reply carrying it is refused instead of arriving without it. The one key that cannot survive JSON parse plus zod's record, found by trying every name an object, a function and an array inherit (§9, *Field keys*). The adapter maps such a backend key to another; the answer check holds the same verdict on a reply beyond the wire (`no field __proto__`).

Found in the Pi terminal link work:

8. **§7 `session_replaced`, "under a new id"**: the event is also the stream's last event when the same session goes on with different `SessionCapabilities` (Pi: a terminal began or ended running a session the phone is looking at). The core already starts a new epoch for it; a client attached to the old epoch attaches again to the session it named, and the app treats a `session_replaced` or `replaced` that names the session it is viewing as a fresh attach, not as a lost session.
9. **§2 rule 3, `zod` in adapters**: an adapter that owns a process boundary of its own (Pi's terminal link, a local socket to a `pi` process the adapter does not start) validates what crosses it with `zod`. `scripts/contract-gen/layers.ts` allows `zod` in `src/backends/<id>/` and nothing else beyond the previous list.

## 20. The workspace

The machine's files, git and terminals, for quick work from the phone: browse, read and search files; status, diff, stage, commit, branches and checkout; a real terminal. The bridge serves them itself, not an agent backend (`docs/rebuild/PLAN.md`), behind the core's `WorkspaceHost` port (core README §22). The requests are machine-level: none names a backend or a session.

### 20.1 Requests

Every answer is `{type: "<type>.result", requestId, result}` with `result` an accepted value or the shared `Rejected` (§2 rule 5), except `term.detach`, answered `{}` or `error{not_attached}`.

| Request | Accepted result |
|---|---|
| `workspace.info{}` | `WorkspaceInfo{roots[], git, terminal}`: the folders every path must lie in (canonical, home first), whether git is installed, whether the bridge can open terminals (its PTY helper is present) |
| `fs.list{path, cursor?, limit?, hidden?}` | `FilesListed{path, entries[{name, kind: file\|dir\|symlink\|other, size?, modifiedAt?}], nextCursor?}`: directories first, then by name ignoring case; names starting with a dot only with `hidden`; a link is listed as itself. `limit` 1–200, 200 when absent. The cursor is the last entry's position, so a page goes on after it even when the directory changed |
| `fs.read{path, offset?, length?}` | `FileRead{path, encoding: utf8\|base64, content, offset, length, size, truncated}`: at most `length` bytes (`MAX_FILE_READ_BYTES`, 3 MiB, when absent) from `offset`. UTF-8 without a NUL is text, ending on a whole character when more follows; anything else is base64. `length` is the bytes `content` covers, `size` the whole file's, and `truncated` says the file goes on at `offset + length` |
| `fs.search{root, query, limit?}` | `FilesFound{root, matches[{path, kind}]}`: files and directories under `root` whose path relative to it matches `query` (at most 256 characters) by name, best match first. Names only: content search is not offered (§20.5) |
| `git.status{cwd}` | `GitStatusRead{root, branch?, head?, upstream?{name, ahead, behind}, staged[], unstaged[], untracked[], truncated}`; a change is `{path, previousPath?, change: added\|modified\|deleted\|renamed\|copied\|type_changed\|conflicted, additions?, deletions?}` (no counts for a binary or conflicted file); `branch` is absent on a detached HEAD, `head` before the first commit |
| `git.diff{cwd, path?, staged?}` | `GitDiffRead{root, files[{path, previousPath?, change, binary, hunks[{oldStart, oldLines, newStart, newLines, header?, lines[{kind: context\|added\|removed, text, oldLine?, newLine?, noNewline?}]}]}], truncated}`: the working tree against the index, or the index against HEAD with `staged`. A conflicted file is listed without hunks |
| `git.stage{cwd, paths}`, `git.unstage{cwd, paths}` | `ActionResult`; `.` is everything |
| `git.commit{cwd, message}` | `GitCommitted{commit{hash, subject, author, authoredAt}}`: commits what is staged |
| `git.branches{cwd}` | `GitBranchesListed{branches[{name, remote, current, upstream?}], truncated}`: local branches first, a remote one named with its remote (`origin/main`) |
| `git.checkout{cwd, branch}` | `GitCheckedOut{branch}`: a local branch, or a remote branch's name without its remote, which makes the local branch tracking it |
| `git.log{cwd, limit?}` | `GitLogRead{commits[]}`: the current branch's newest, 1–200, 200 when absent |
| `term.list{}` | `TerminalsListed{terminals[TerminalSummary]}`, newest first; `TerminalSummary{id, cwd, cols, rows, createdAt, status: running\|exited, exitCode?, signal?}` |
| `term.open{cwd, cols, rows, cellWidth?, cellHeight?}` | `TerminalOpened{terminal}`: the user's login shell in `cwd`, sized in cells and, when the cell size is given, in pixels (programs read both, image protocols the pixels) |
| `term.attach{id, since?}` | `TerminalAttached{terminal, seq, data}`, then live `term_output` (§20.2) |
| `term.detach{id}` | `{}` |
| `term.input{id, data}` | `ActionResult`: `data` is base64 of the bytes the phone's terminal encoded for the keys |
| `term.resize{id, cols, rows, cellWidth?, cellHeight?}` | `ActionResult` |
| `term.close{id}` | `ActionResult`: ends the process if it runs, then forgets the terminal |

Every git request names a directory inside the repository; the bridge runs git in the repository's top directory, which every path in a git request and answer is relative to (`root`).

### 20.2 Terminals

- **The bridge ships bytes; the phone emulates.** `term_output{id, seq, data}` carries raw output as base64: no decoding, no emulation, no replacement of bytes that are not UTF-8. The phone's VT emulator (libghostty) renders it (`docs/rebuild/research/terminal.md`).
- **`seq` is a byte offset** into the terminal's output since it opened: an output's `seq` is the offset of its first byte, so the next starts at `seq` plus its length.
- **Replay.** A terminal is read from the moment it opens until its process ends, viewed or not, into a ring of its newest `MAX_TERMINAL_OUTPUT_BYTES` (512 KiB). `term.attach{since}` answers what the ring holds from `since` on when it reaches back that far, else everything it holds; the answer's `seq` says where it starts, so a client that asked for more than it got knows there is a gap (and resets its emulator before applying it). Live output follows from `seq` plus the replay's length, with nothing missed or repeated in between. A full-screen program redraws on a resize, which a phone can send after a gapped replay.
- **Only to its viewers.** `term_output` and `term_exited{id, exitCode?, signal?}` go only to the clients attached to the terminal. `term_exited` is the last: an exited terminal has no viewers, and attaching to one answers its replay and views nothing.
- **Input and resizes need an attach** (`error{not_attached}` otherwise) and reach the terminal in the order the client sent them. Closing does not: a terminal can be ended from the list.
- **Exited terminals are kept**, with their output and how they ended, until closed or until a new terminal needs the place of the oldest: at most `MAX_TERMINALS` (20) at once. Opening a twenty-first while all run is `busy`.
- Bridge shutdown ends every terminal.

### 20.3 Bounds

| Value | Bound |
|---|---|
| One `fs.read` | `MAX_FILE_READ_BYTES` 3 MiB; `content` at most `MAX_IMAGE_CHARS` (base64 of it) |
| A search query | `MAX_SEARCH_QUERY_CHARS`, 256 |
| A diff | `MAX_DIFF_LINES` (20,000) lines, `MAX_TEXT_CHARS` characters of line text, `MAX_LIST_ITEMS` files; cut at a whole line, with `truncated` |
| Status lists, branches | `MAX_LIST_ITEMS` each, with `truncated` |
| Paths a request names, `git.stage`/`git.unstage` | `MAX_PATH_CHARS` each; 1–1,000 of them |
| Terminals | `MAX_TERMINALS` 20; columns, rows and cell pixels 1–`MAX_TERMINAL_DIMENSION` (500) |
| Terminal output | `MAX_TERMINAL_OUTPUT_BYTES` 512 KiB a replay (`MAX_TERMINAL_OUTPUT_CHARS` of base64); a `term_output` carries at most 64 KiB |
| One `term.input` | `MAX_TERMINAL_INPUT_BYTES` 64 KiB (`MAX_TERMINAL_INPUT_CHARS` of base64) |

An answer the link cannot carry is read again smaller, never cut: a shorter listing page with its cursor, a shorter file read that says `truncated`, a diff cut earlier, fewer matches (core README §9, §22). File content, diff lines and terminal output are never shortened as free text.

### 20.4 Errors

What could not be done is a `Rejected` with a plain message:

| Code | When |
|---|---|
| `forbidden` | The path lies outside the served folders, or a link leads out of them; a repository whose top directory does; the system refused the bridge the file |
| `not_found` | The path does not exist; a directory is in no git work tree; no such terminal |
| `invalid_input` | A path that is not a directory or not a file where one is needed; a cursor the bridge did not give out; a repository path that is absolute, leaves the repository or reads as an option; a branch name git could take for something else; and everything git itself refuses, in git's own words: nothing to commit, a switch that would overwrite local changes, an unknown branch, unmerged paths |
| `closed` | Input or a resize for a terminal that has exited |
| `busy` | Twenty terminals run |
| `unsupported` | git is not installed; the machine cannot open terminals; a bridge without a workspace |
| `backend_error` | git did not finish within 45 s or could not run; a terminal could not be started or resized; an unexpected file system error |

`forbidden` is the one code the workspace added: none of the others says "outside what this bridge may touch", and a phone shows that differently from a path that does not exist.

### 20.5 Not offered

- **Content search.** No served code searches file contents, and the one fast way (ripgrep) is not on every machine; a search that works only sometimes would need its own capability for little gain on a phone, where the agent searches contents on request.
- Push, pull, fetch, stash, branch creation, discarding changes and per-commit diffs: outside the phone's scope (PLAN, Phone scope).
- A diff of an untracked file: its content is read with `fs.read`.
