# Phase 1 — The Broski backend contract (brief)

Status: brief for the Phase 1 implementer. Written 2026-10-29 at commit `9678394` (after Phase 0 cleanup).
Inputs: the four research documents in `research/` — `claude-code.md` (SDK 0.3.312), `codex.md` (app-server v2, CLI 0.164.0), `opencode.md` (2.x server, CLI 2.1.4), `pi.md` (Pi + Pi Durable 1.4.0). They are the source of truth for every backend fact. Where this brief and a research document disagree, the research document wins; record the disagreement in the contract docs.

## 1. Why this exists

Broski is a phone app that remote-controls coding agents on the user's Mac:

```
Flutter app ⇄ Broski Link (Rust, Noise e2e; LAN or blind relay) ⇄ bridge (Bun/TS) ⇄ agent backends
```

The link layer is good and is not touched. Above it, every feature is written once per backend: there is no backend interface (`connectors/` has five unrelated shapes), the wire protocol has ~700 hand-mirrored message types (94% backend-specific), the Flutter UI branches on the backend in ~684 places, and `RuntimeCapabilities` is written five times and read nowhere. All four backend integrations are also out of date with their SDKs (see each research doc §16).

The rebuild follows Mario Zechner's pi method: strict one-way layers, one small contract per layer, a new backend or feature is a file not an edit across twenty files, capabilities are facts not decoration, old code is deleted when replaced.

Phase 1 builds **only the contract** — the types, the schema that is the single source of truth for the wire, the generated Dart models, the reference fake backend, the conformance test suite, the layer-enforcement checks, and the contract documentation. Nothing is wired into the running bridge or the app yet (Phase 2 = bridge core, Phase 3 = Flutter core, Phase 4 = one adapter per backend). Phase 1 must not change the behaviour of anything that exists.

## 2. Target architecture (for orientation; only the contract is built now)

```
L4 Flutter UI — generic screens driven only by capabilities; backend extras register as panels
L3 Flutter core — one BridgeClient, one SessionStore, one reducer, GENERATED protocol models
L2 Wire protocol — ~40 generic messages + one backend_call escape hatch; ONE schema → TS types + validators + Dart
L1 Bridge core — BackendRegistry, RunTracker, Interactions registry, Viewers/feed, paging, per-session event log
L0.5 Adapters — backends/<id>/ ; each depends only on its SDK + the contract
L0 Link — unchanged
```

The contract is the boundary between L1 and L0.5 (the `AgentBackend` interface) and the boundary between L1 and L3 (the wire protocol and its event union). Adapters never see sockets, phones, viewers or the wire; they implement the interface and emit normalized events into a sink. The core owns ids that backends do not provide, sequencing, replay, fan-out, first-answer-wins, and re-delivery.

## 3. Cross-backend facts the contract must absorb (all verified in research/)

| Concern | Claude Code | Codex | OpenCode | Pi | Pi Durable | Contract consequence |
|---|---|---|---|---|---|---|
| Hosting | 1 CLI subprocess per `Query`, open `AsyncIterable` prompt | attach to shared daemon UDS, or own stdio child | HTTP client of the user's managed service | in-process `AgentSessionRuntime` per open session | in-process `Harness` per storage | `AgentBackend` is long-lived; `open()` returns a live session handle with `close()` |
| Run start | no event (derive) | `turn/started` | `execution.started` | no event (derive) | `run_start` | core/adapter synthesizes `run_started` with a Broski `runId`; trigger may be non-user (queue, goal, wakeup, external) |
| Truly done | `idle` after `result` with `queued_turn_count==0` | none (debounce `idle` + empty queue) | one terminal `execution.*` per busy period | `agent_settled{aborted}` | `run_end` w/o `run_start` in batch | `run_finished{outcome}`; outcomes include `completed, aborted, error, limit, suspended (OC shutdown), deferred (CC)` |
| Block identity | `message.id` + stream index | `itemId` (+ summary/content index) | `(assistantMessageId, kind, ordinal)` | (message, `contentIndex`), no message id | `contentIndex` | Broski `BlockId` minted by adapter; `block_finished` carries the full authoritative text (replace) |
| Prompt while busy | `priority next/later/now` | `turn/steer{expectedTurnId}`; `turn/start` steers by accident; queue experimental | `delivery steer/queue` | `streamingBehavior steer/followUp` | `whenBusy steer/followUp/reject` | `PromptMode = start | steer | queue`; result is `accepted{disposition}` or typed rejection |
| Idempotency | `uuid` (dedupe partial) | none | prompt `id` durable | none | `requestId` durable | contract `clientRequestId` always present; core dedupes where backend can't |
| Queue | `command_lifecycle` (internal), cancel runtime-only | `thread/queue/*` (exp) | inbox items w/ ids, cancel/promote | strings only, clear-all | inbox ids, abort per item | `queue_changed{items[]}` with ids when available; per-item cancel is a capability |
| Interactions | `canUseTool` (permission, AskUserQuestion keyed by question text, ExitPlanMode w/ edit), `onElicitation` (JSON schema forms, URL), `onUserDialog` | command/file/permissions approvals (decline≠cancel, payload decisions, grant subsets w/ scope), `requestUserInput` (multi-question, secret), MCP elicitation (forms, URL, `_meta.persist`) | permission (once/always/reject±message, batch reject), forms (typed fields, `when`, `external`, `custom`) | none built in; extension dialogs (select/confirm/input/editor) + bridge-owned `tool_call` gate | bridge-owned `beforeTool` hook | one `Interaction` union rich enough for all (see §4.5); `interaction_resolved{reason}` always synthesized by core; no backend has timeouts → timeouts are bridge policy and must map to an explicit answer |
| Interaction re-delivery | `reinitialize()` same process only | replay on `thread/resume` | re-list per session/location | bridge-owned | bridge-owned (memo) | core keeps the pending registry; adapter exposes `pendingInteractions()` where the backend can list |
| Sessions list | offset/limit, unstable | cursor (both ways), ≤100 | anchor cursor, no max | none (bridge index) | none (bridge dirs) | `Page<T>` with opaque cursor; adapters without native paging page over a bridge index |
| Transcript | lossy chain, offset | turns + items, two-level paging | 11 message types, cursor ≤200 | whole file | cursor entries | normalized `TranscriptItem` union, paged by opaque cursor, ids flagged stable/unstable |
| Children | `task_*`, subagent transcripts | child threads (`parentThreadId`) | child sessions (`parentID`) | none | child conversations | `SessionRef.parent{kind: fork|subagent}`; tool call may carry `childSessionRef` |
| Plan | Task*/TodoWrite tools, ExitPlanMode | `turn/plan/updated` + Plan-mode `plan` item | experimental tool metadata | none | none | two concepts: `plan_updated{kind: todo|proposal}` |
| Thinking | `adaptive/enabled/disabled` + effort levels | effort strings per model | model variants (free strings) | 7 levels, clamped | levels, unclamped | `ThinkingSpec` per model = list of opaque options + default; setting is one of the advertised values |
| Reconnect | none (bridge log) | `thread/resume` snapshot, no replay | refetch, no replay | state snapshot, no replay | snapshot-first | per-session monotonic `seq` + bridge event log + `SessionSnapshot`; phones resume from `lastSeq` or get a snapshot |
| External sessions | listed + tail only | live via shared daemon | live via managed service | listed + tail only | none | `SessionSummary.origin` and a capability `externalLive`; external read-only sessions are first-class |
| Retractions | `retracted_message_uuids` / `supersedes` | — | — | — | — | `messages_retracted{messageIds}` event |

## 4. What the contract must define

Names below are proposals; refine them, but every concept must exist. Every type is defined once in the schema and generated/derived everywhere else.

### 4.1 Identity
- `BackendId` (`claude-code | codex | opencode | pi | pi-durable`), `SessionRef {backend, sessionId}`, Broski-minted `RunId`, `BlockId`, `InteractionId`, `QueueItemId`, `ClientRequestId`. Backend-native ids travel in a `native` field where useful for debugging, never as the identity the app relies on.

### 4.2 `AgentBackend` (adapter interface) and `OpenSession`
- `id`, `status(): BackendStatus` (installed, version, authenticated, usable, reasons), `capabilities()` (static) and per-session capabilities after `open`.
- Catalog: `listSessions(query, page)`, `readTranscript(ref, page)`, `listModels()`, `listCommands()` (slash commands / skills / prompt templates, normalized).
- Mutations that do not need a live session: `rename`, `delete`, `archive`, `fork` — **optional members; absence = capability false** (no lying flags).
- `open(ref | new, sink)` → `OpenSession` with `prompt(input)`, `abort()`, `answer(interactionId, answer)`, `setModel`, `setThinking`, `compact?`, `cancelQueued?`, `snapshot()`, `close()`.
- The `sink` is the only way an adapter emits; it receives normalized events without seq (core assigns seq).
- Lifecycle rules (open/close idempotent, close aborts nothing unless asked, adapters must never throw into the core from event callbacks) are part of the contract docs and asserted by the conformance suite.

### 4.3 Capabilities
- One `Capabilities` type replacing `RuntimeCapabilities`. Booleans/enums for: streamText, streamThinking, steer, queue, cancelQueued, abort, interaction kinds supported, switchModel (between / mid-run), thinking, pagedListing, pagedTranscript, fork, revert, compact, rename, delete, archive, children, usage, plan kinds, attachments (images/files), externalLive, reconnect strategy.
- Capabilities must be **derivable/checked**: the conformance suite fails if an adapter declares a capability whose method is missing, or implements an optional method while declaring it unsupported.

### 4.4 Events (normalized union, adapter → core → phone)
Envelope `{seq, session: SessionRef, runId?, at, event}`. Event kinds at least:
`session_state` (idle | running | waiting_for_user | suspended | error), `run_started{runId, trigger}`, `run_finished{runId, outcome, error?}`, `message_started{messageId, role}`, `block_started{blockId, kind: text|thinking}`, `block_delta{blockId, text}`, `block_finished{blockId, text}` (authoritative full value), `tool_started{toolCallId, name, input, parentToolCallId?, childSession?}`, `tool_updated{toolCallId, output delta or metadata replace}`, `tool_finished{toolCallId, status, output (text + structured + diff)}`, `interaction_requested{interaction}`, `interaction_resolved{interactionId, reason: answered|cancelled|expired|superseded}`, `queue_changed{items}`, `compaction_started/finished`, `retry_scheduled{attempt, at?, error}` / `retry_finished`, `usage_updated`, `plan_updated{kind: todo|proposal}`, `messages_retracted{messageIds}`, `session_updated{summary}`, `session_removed`, `notice{level, text}`, `error{code, message, retryable}`.
Everything a backend offers that does not fit goes in typed per-backend `extension` events — never as `unknown` blobs the app must parse ad hoc.

### 4.5 Interactions (one model for every human question)
- `Interaction {id, session, runId?, kind, title, body?, createdAt, expiresAt?, origin{toolCallId?, toolName?, parentToolCallId?}, payload}` with kinds at least:
  - `tool_permission` — decisions list (allow once / allow for session / allow always with rule+scope / deny and continue with message / deny and stop), optional editable input, structured preview (command, file diffs, network host), grant-subset form for Codex permissions profiles.
  - `questions` — 1..n questions, each with options (label+description+preview), multi-select, allow-custom text, secret flag; answers keyed by question id (adapter maps to CC question-text keys / Codex ids / OC `q{i}`).
  - `form` — typed fields superset: string (format, min/max length, pattern, options, custom), number, integer (min/max), boolean, multiselect (min/max items), external URL acknowledgement; per-field `default`, `required`, `hidden`, `when` conditions.
  - `plan_approval` — plan text, editable, approve/reject-with-feedback.
  - `external_url` (open link, confirm done) and a generic `choice`/`confirm`/`text` for Pi extension dialogs.
- `InteractionAnswer {interactionId, outcome: answered | cancelled, payload per kind, message?}` — cancel/decline semantics explicit (continue vs stop the run).
- The core owns first-answer-wins across phones, broadcasts `interaction_resolved`, re-delivers pending on reconnect, and applies the timeout policy.

### 4.6 Input
`PromptInput {clientRequestId, text, attachments[{kind: image|file, data|path, mime, name}], mentions?, skills?, mode: start|steer|queue, origin: human}` → `PromptResult = accepted{disposition: started|steered|queued|handled, queueItemId?, runId?} | rejected{code, message}`. Rejections are typed (busy, not_steerable, no_model, auth, invalid_input, unsupported_mode, ...).

### 4.7 Read models
- `SessionSummary {ref, title, titleSource, cwd, createdAt, updatedAt, parent?{kind: fork|subagent, ref}, archived, model?, status, origin: broski|external, nativeSource?}`.
- `TranscriptItem` union (user message with attachments, assistant message with blocks, tool call + result, system notice, compaction marker, model/agent switch, run boundary) with `idStability: stable | positional`.
- `ModelSummary {ref{providerId, modelId}, displayName, contextWindow?, inputModalities?, thinking: ThinkingSpec{options[], default}, default?: boolean}`; `CommandSummary`; `Usage`.
- `Page<T> {items, nextCursor?, prevCursor?}` with opaque string cursors.
- `SessionSnapshot` — everything a reconnecting phone needs to rebuild the live view without replay: state, active run, open blocks with text so far, running tools, pending interactions, queue, model/thinking, usage, last seq.

### 4.8 Wire protocol (L2)
- ~40 generic client→bridge requests (sessions.list, session.open/attach/detach, transcript.read, prompt, abort, interaction.answer, queue.cancel, model.set, thinking.set, compact, fork, rename, delete, archive, models.list, commands.list, backend.status, …) and bridge→client messages (responses + the event envelope + snapshot), each with a `requestId`.
- One escape hatch `backend_call{backend, op, params}` / `backend_result` for genuinely backend-specific features (Codex review, Pi tree, CC memory, OpenCode revert, …), each op typed per backend.
- Versioned: a `protocolVersion` and a rule for additive vs breaking changes.

## 5. Single source of truth and generation
- Define every wire-visible type once with a runtime schema library already present in the bridge (`zod` 4 is a direct dependency; `typebox` is present transitively via pi — choose one, justify it in the docs, pin it exactly, do not use both for the contract).
- From that schema: TS static types (inferred), runtime validators used at the wire boundary, JSON Schema, and **generated Dart models** (`fromJson`/`toJson`, sealed classes for unions, no `dynamic` in public API) written to a generated directory in `lib/` with a header saying generated/do-not-edit.
- A generator script with a `--check` mode that fails when generated output is stale; wire it into `package.json` scripts and CI.
- Internal-only adapter types (the `AgentBackend` interface, sink) may be plain TS but must reference the schema types, never duplicate them.

## 6. Reference fake backend + conformance suite
- `FakeBackend`: an in-memory, scriptable implementation of `AgentBackend` that can simulate every capability (streaming, steer, queue, every interaction kind, compaction, retry, children, errors, reconnect). It proves the contract is implementable and is the test double for Phase 2/3.
- Conformance suite: one function that takes an adapter factory + a scenario driver and asserts the contract's behavioural rules (event ordering, exactly one `run_finished` per `run_started`, `block_finished` text equals accumulated deltas, every `interaction_requested` ends in exactly one `interaction_resolved`, capabilities match implemented methods, prompt dedupe by `clientRequestId`, pages concatenate without duplicates, snapshot + subsequent events reproduce the live state, close is idempotent, sink never receives events after close). Run it against `FakeBackend` in Phase 1; Phase 4 runs it against each real adapter.

## 7. Layer enforcement (Mario-style, in CI)
- `contract/` imports nothing from the rest of the bridge (it is a leaf; only its schema library).
- Future `backends/<id>/` may import only the contract and its own SDK (add the check now; it passes vacuously until adapters exist).
- Generated Dart is fresh.
- Keep checks small, deterministic, and blocking.

## 8. Quality bar (non-negotiable)
- No guessing: every backend-shaped decision cites the research doc section. Unknowns are listed as open questions in the docs, never papered over.
- No `any`, no `as any`, no `unknown` in public contract types except a deliberately typed opaque `native` debug field; no `?? []` fallbacks for impossible states; no defensive code for states the types forbid.
- Small files, one concept per file (Mario: up to ~1,000 lines is fine if it is one concept; a second concept is the reason to split). Explicit names. No comments that restate code; comments only where a careful reader would misread.
- No dead code, no speculative features beyond what §4 lists, no compatibility shims with the old protocol (the old protocol stays untouched and is deleted in later phases).
- Tests test behaviour through public interfaces, not internals.
- Everything green: bridge `bun run typecheck`, `bun run lint`, `bun test`; repo `dart format --set-exit-if-changed lib test`, `flutter analyze`, `flutter test`; web-app typecheck untouched.

## 9. Out of scope for Phase 1
Wiring into `server.ts`/handlers/routing, touching existing connectors or handlers, Flutter UI or providers (only generated models + their tests), the link layer, `reference/`, upgrading any SDK dependency, deleting the old protocol.
