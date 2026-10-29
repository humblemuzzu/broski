# The Broski app core

Status: Phase 3. The phone side of the [contract](../contract/README.md) (protocol **1.0**), speaking to the [bridge core](../core/README.md). It is additive: the old screens, providers and services keep working, and the new screens are reachable only from a hidden developer entry (a long press on the version line at the bottom of Settings, debug builds only). Phase 4 moves each backend's UI onto this layer and deletes the old code backend by backend.

Code: `lib/agent/` (one concept per file, every file under 400 lines). Tests: `test/agent/`. Enforcement: `tool/check_agent_core.dart`.

**Contents.** [1 Rules](#1-rules) · [2 Layout](#2-layout) · [3 The client](#3-the-client) · [4 The session store](#4-the-session-store) · [5 The merge rule](#5-history-and-the-merge-rule) · [6 Prompts](#6-prompts) · [7 Interactions](#7-interactions) · [8 Proving the ports](#8-proving-the-ports-equal-to-the-contract) · [9 The UI building blocks](#9-the-ui-building-blocks) · [10 Panels](#10-the-panels-registry) · [11 The fake bridge and the e2e test](#11-the-dev-fake-bridge-and-the-end-to-end-test) · [12 Phase 4](#12-how-phase-4-moves-a-backend-onto-this-layer) · [13 Limits](#13-limits-and-open-risks)

## 1. Rules

1. **Nothing under `lib/agent/` steers by backend.** Screens branch on `Capabilities`, `SessionCapabilities` and the shape of the data (contract README §2 rule 1). `BackendId` members and backend-id strings appear in exactly one file, `ui/backend_label.dart`, which turns an id into a display name and nothing else. `AgentType` never appears.
2. **`lib/agent/` imports only** the platform (`dart:`, Flutter, Riverpod), the generated contract (`package:broski/contract/generated/contract.dart`), itself, the theme, four packages already in `pubspec.yaml` (`uuid`, `image_picker`, `mime`, `url_launcher`), and named pieces of generic app infrastructure, each imported with a `show` of exactly what is used: `DetailSheet`, `AdaptiveMarkdownBody`, `DiffViewer` and `DiffEntry`, `WebSocketService` and `ConnectionStatus` with `webSocketServiceProvider`, `linkConnectionControllerProvider` (for send refusals), `appVersionProvider`, `LinkSendFailure`. Nothing from the old agent services, providers or models: `service_providers.dart`, for one, also exports `BridgeService`, which `show` keeps out.
3. **The contract's semantics are ported, never re-invented.** `applyEvent`/`sessionStatus` (reducer) and `answerProblem`/`fieldIsActive` (answer check) are held equal to the TypeScript by fixtures the generator computes from the TypeScript itself (§8).
4. **Generated code is never edited by hand** (`lib/contract/generated/`, `test/contract/generated/`, `test/contract/fixtures/`): `cd packages/bridge && bun run contract:gen`; CI runs `contract:check`.
5. **Every request ends in a typed value.** Nothing a caller awaits throws: a request is `Answered | Failed(ContractFailure)`, a read is `Done | Refused(Rejection) | Unreached(ContractFailure)`.
6. **No automatic answers.** Nothing on the phone answers an interaction on a person's behalf; `expiresAt` is shown, never acted on.

`dart run tool/check_agent_core.dart` enforces rules 1 and 2 (CI, blocking). It reads each file's tokens (`tool/agent_core_check/dart_tokens.dart`), so a word in a comment never counts and a string inside an interpolation always does. It checks every URI of a directive, conditional ones included, refuses a path with `.`, `..` or an escape in it, and requires the `show` above (`import_rules.dart`); it refuses any member read of `BackendId` (`.codex`, `.values[3]`, `.byName`), a dot shorthand (`.codex`), a backend value read as text or a number (`ref.backend.wire`, `.name`, `.index`), and a backend id spelled as a string in any form: whole, in a literal piece, joined from adjacent or `+`-joined literals, folded from `'${'co'}dex'`, joined from a list (`['c', 'odex'].join()`), or a fragment of five letters or more (`'Durable'`). It also holds that nothing in `lib/theme/`, which the core imports whole, exports anything outside the layers. Its tests prove each rule fails on a violating snippet, the reviewer's probes included (`test/tool/agent_core_check_test.dart`). The check is lexical: it catches the ways code steers by backend **by accident**, not every way a determined author could (`'p' + x`, a map of ids); review catches those.

## 2. Layout

| Path | Concept |
|---|---|
| `client/contract_client.dart` | `ContractClient`: `hello` per connection, requests matched by id, events, catalog news, problems. |
| `client/contract_link.dart`, `socket_contract_link.dart` | The link the client runs over; the adapter over the app's `WebSocketService`. |
| `client/contract_frame.dart` | The `{"type":"contract","message":…}` frame; reading frames; the request id an answer names. |
| `client/contract_state.dart`, `contract_failure.dart`, `contract_reply.dart`, `outcome.dart`, `contract_problem.dart` | Typed states, failures and results. |
| `client/request_waiters.dart`, `client_delays.dart`, `agent_clock.dart` | Pending requests with deadlines; waits that end when their owner closes; the injected clock. |
| `client/requests/*.dart` | One typed method per request, grouped catalog / sessions / live. |
| `reducer/*.dart` | The port of `session-reducer.ts` and `run-items.ts`. |
| `answers/*.dart`, `answers/url/*.dart` | The port of `answer-check.ts` and `field-check.ts`, with the JavaScript semantics they lean on (`trim`, code points, property order, `RegExp` both readings and the syntax only newer engines take, WHATWG `URL.canParse`). |
| `session/*.dart` | The session store: state, link, history, prompts, answers, notices; the controller and its parts; the events held while an attach is out (`held_events.dart`); the prompts a replaced session hands on (`prompt_handoff.dart`). |
| `catalog/*.dart` | Backends, paged session lists, model/command/mode lists, row actions. |
| `agent_providers.dart` | The Riverpod providers. |
| `ui/**` | The generic screens and sheets (§9), the panels registry (§10), the hidden entry. |

Tools: `tool/check_agent_core.dart` (rules 1 and 2), `tool/format_differential.dart` (the string checks against Bun at scale, §8), `tool/mutate_agent_core.dart` (mutation check, §8).

## 3. The client

- **Transport.** One `ContractClient` (`contractClientProvider`) runs over the socket the old services use (`SocketContractLink` over `WebSocketService`). It is not a third ad-hoc client: it is the client Phase 4 moves every screen to, and `BridgeService`/`PiBridgeService` go away with the old screens.
- **Frames.** Every request goes out alone through `sendImmediate`, never inside an old `batch` (the core does not serve a contract frame in a batch, core README §4). The one change to `WebSocketService` (`_tagOf`) tags a contract frame with its inner `requestId`, so a frame the link refuses fails its request at once (`LinkRefusal`) through the controller's `sendFailures`, instead of waiting out a deadline.
- **`hello` and versions (contract §12.4).** On every new connection the client sends `hello{protocol, client}` before anything else and holds other requests until it is answered. Same major: `ContractReady(generation, bridgeProtocol, bridgeVersion)`; another major or `unsupported_version`: `ContractIncompatible`, and every request fails `VersionMismatch`. A recoverable failure (`internal`, `rate_limited`, a lost answer) sends `hello` again after 2 s. A request waits for `hello` no longer than it would wait for an answer. Every minor is 0, so nothing is filtered yet; `bridgeProtocol` carries the bridge's minor for the day one is needed.
- **Deadlines.** The core answers every request within `REQUEST_DEADLINE_MS` (120 s, now generated as `contractRequestDeadlineMs`); the client waits that plus 15 s for the link, then fails `AnswerTimedOut`.
- **Typed errors.** An `error` answer is `ProtocolRefusal(ProtocolError)`; `rate_limited` is sent again after 2, 4 and 8 s before it is given up as such (core README §15). An answer of the wrong type or one that does not decode is `MalformedAnswer`.
- **Wire order.** `received` numbers every contract frame read, and an `Answered` reply carries its own number (`arrival`). Events reach listeners synchronously, so a listener reading `received` learns which side of an answer an event came on, whatever the microtask order in which the answer reaches the code that awaits it (§4, *Attach*).
- **Reconnects.** A link going down fails every pending request `ConnectionLost` and takes the client offline; requests fail fast while offline. The next connection is a new `hello` and a new `generation`, which is what every store reattaches on. The app's status mapping (`LinkStatusPublisher`, `BridgeStatusTracker`) already turns a replaced bridge socket into a reconnect edge.
- **The old heartbeat.** `WebSocketService` already answers the bridge's `ping` with `pong`; `test/agent/client/socket_contract_link_test.dart` holds that it still does beside contract frames.
- **Problems.** A frame that does not decode and names a waiting request fails it; otherwise it is a `ContractProblem`, and an unreadable event names its session, which then reattaches to recover what it lost.

## 4. The session store

`sessionProvider` is one `StateNotifierProvider.autoDispose.family` keyed by `SessionRef`: a `SessionController` per session, attached while anything watches it and detached when nothing does. Its state, `AgentSessionState`, is immutable: the link, the reduced `SessionSnapshot`, `SessionCapabilities`, the session's row, history, this phone's prompts and answers, notices and the newest extensions.

- **Link** (`session_link.dart`): `LinkWaiting → LinkAttaching → LinkLive`, or `LinkLost` / `LinkReplaced(next)`. Each holds the last `{epoch, seq}` applied. `LinkLost` is final and comes only from the bridge no longer knowing the session (`unknown_session`) or its deletion (`session_removed`); only the person's *Try again* attaches it again.
- **Attach**: on every new client generation, `session.attach{resume: last position}`. A `snapshot` answer replaces the live state; a `replay` answer keeps it, and the events that follow apply (contract §12.2). A replay that does not continue the stream held (another epoch, `afterSeq` past what was applied) attaches afresh. Any other failure (`internal`, `rate_limited` past the client's retries, `unknown_backend`, a lost or unreadable answer) is `LinkWaiting(resume, problem)`, tried again after 2, 4, 8, 16, then every 30 s while connected, and at once on the next connection.
- **Events while attaching** (`held_events.dart`). Events carry no epoch, so only the order the bridge sent them in says which stream an event continues. While an attach is out every event is held with its wire number; when the answer comes, those sent before it are judged against the position held before, then the answer applies, then those sent after it are judged against the new position. An answer of an attach that a newer one overtook is ignored, and the events after it are dropped: they belong to a sync this phone never applies, and the newer answer covers them. A failed attach, or a lost connection, first judges what it held, so nothing applies twice. Past 4,096 held events, or after an unreadable one, the session attaches again from where it is once answered.
- **Order** (`stream_sync.dart`): an event applies exactly when its `seq` is the next one. One already applied is skipped (a replay overlapping what arrived live). One past a gap reattaches from the last position applied; a gap among held events does not (the answer repairs it). While waiting for the connection, nothing applies: the reattach replays it.
- **Effects** (`session_effects.dart`): an echoed `user_message` clears its prompt; `run_finished` settles the run into history and re-reads the newest page; `interaction_resolved` ends an answer in progress; `notice`/`error` become notices; `extension` keeps the newest of each kind and window; `session_replaced` hands over to the next session, which the chat screen follows, and hands it this phone's prompts not yet echoed (`prompt_handoff.dart`): taken and refused ones as they are, one whose fate is unknown as *not confirmed*, for the person to send again, edit or drop, since the bridge de-duplicates prompts per session.
- **Catalog**: `transcript_invalidated` re-reads history from scratch; `session_removed` loses the session; `session_updated` refreshes its row. Session lists apply row news in place (`catalog/session_list_controller.dart`); model, command and mode lists are read again on `catalog_invalidated` of their scope and on every reconnect.

## 5. History and the merge rule

Contract §8 splits the conversation by run, not by id. `SessionHistory` holds finished items oldest first:

1. The newest transcript page is read at attach (snapshot), after every `run_finished`, and after `transcript_invalidated`. Only the read asked last may land, so an overtaken answer never puts back an older view.
2. With stable ids, a newest page is spliced where it begins in the pages already read (older pages stay, with their cursor); with positional ids, when it begins in none of them, or after a rewrite, it starts the history afresh with its own cursor. Older pages load on demand and never show a stable-id row twice.
3. At `run_finished` the run's live items move to `settling` and stay shown, with a marker for its `droppedItems`, until the re-read replaces them.
4. The timeline (`ui/chat/timeline_builder.dart`) is history, then settling, then the active run's items (`droppedItems` marked), then running tools not yet placed and open blocks, then this phone's prompts not echoed yet. Tool results join their calls, and a subagent's blocks and calls nest in the call that runs them (`parentToolCallId`).

Neither a race nor an id mismatch can double or drop an item: the transcript never overlaps the active run, the snapshot and the events after it are consistent by construction, and settled items are replaced, never merged.

## 6. Prompts

`PromptDesk` sends a `PromptInput` with a fresh UUID v4 `clientRequestId` and shows it at once (`PromptSending`). The session counts as running only once the bridge took a prompt that starts a run (`accepted{started}`) or `run_started` arrived, never on sending.

| Answer | What the phone does |
|---|---|
| `accepted{started, steered, queued}` | `PromptTaken`; leaves when the session echoes it, when a history page or snapshot shows it, or at `run_finished` unless it still waits in the queue. A queued prompt the queue shows is drawn as its queue chip, not twice. |
| `accepted{handled}` | Leaves at once: the backend consumed it without a run. |
| `Rejected` | `PromptNotSent(reason)`: rolled back, with *Send again* (same id: a rejection is not remembered, contract §10), *Edit* (back into the composer) and *Discard*. |
| Lost connection | `PromptUnconfirmed(resending)`: sent again with the same id once the session is attached again; the bridge de-duplicates accepted prompts, across restarts too (core README §8). |
| `not_attached` | The same, and the session attaches again now if it is live (an attach under way, or the next connection, sends it otherwise). |
| `internal`, `rate_limited` past the client's own retries, no answer within the deadline | The same, sent again by the phone after 2, 8 and 30 s while the session is live; after the last it waits for the person (`PromptUnconfirmed`, not resending). |
| Unreadable answer, client closed | `PromptUnconfirmed`, not resending: the bridge may have taken it, and sending it again would not tell. |
| Link refusal, version mismatch, any other `error` | `PromptNotSent`: the bridge never served it. |

A prompt not confirmed shows why, and whether the phone is still sending it, with the same *Send again*, *Edit* and *Discard* as one not sent: the person decides once the phone stops, and may decide earlier. *Send again* by the person starts the waits afresh.

## 7. Interactions

- **One sheet** (`ui/interactions/interaction_sheet.dart`) answers every kind: `tool_permission` (previews, options with scope, rule and run-ending, the message an option takes or needs, grants, editable input; a `deliberate` ask never answers on one tap), `questions` (several, single or multiple choice, free text, secret text hidden), `form` (every field kind and format, `when` conditions live, hidden fields left to their defaults, external steps acknowledged), `plan_approval` (approve, edited when editable, or reject with feedback), `external_url`, `choice`, `confirm`, `text` (single line never carries a newline). Every kind can be skipped with `cancel{stopRun}`.
- **Checked on the phone first.** As the person types, the draft reply goes through the Dart `answerProblem`; the problem is shown and Send stays disabled. `SessionControls.answer` checks again and never sends a faulted answer.
- **First answer wins** (contract §9, §12.3). An answer on its way is `AnswerSending` until the backend's `interaction_resolved`. A `stale` refusal is "already answered"; when the ask is already gone from view, the refusal is also a notice. An answer to an ask that ended is not sent, nor a second answer while the first is on its way (a double tap sends one request; the sheet and `SessionControls.answer` both refuse it).
- **Watch-only sessions** show their asks without an answer button: the client that owns them answers (core README §18).

## 8. Proving the ports equal to the contract

The generator writes two more fixtures, computed by the TypeScript contract itself:

- **`reducer_trace.json`** (`scripts/contract-gen/reducer-trace.ts`, `reducer-cases.ts`): the fake backend's scripted session (which crosses `session_replaced` and `resynced`) and synthetic cases for every branch: run lifecycle and every status, content outside a run, unknown ids, every tool update, nesting, retraction of open and finished items and their results, a run past 1,000 items (`droppedItems`) and its replacement, text past `MAX_TEXT_CHARS` trimmed at a surrogate pair, with the cut on each edge of the low surrogates (U+DC00, U+DFFF) and just outside them (U+DBFF, U+E000), settings, resync. Each step carries the event, the snapshot `applyEvent` gives (whole when small, else the SHA-256 of its canonical JSON) and `sessionStatus`. The generator refuses to write a trace that misses an event kind, a tool update kind, a status, the item bound or the surrogate trim. Strings longer than 4,096 characters are written as code-point runs (`fixture-text.ts`) and checked to expand back exactly. `test/agent/reducer/reducer_trace_test.dart` replays every case and requires equal canonical JSON at every step.
- **`answer_cases.json`** (`answer-cases.ts`, `answer-edge-cases.ts`, `answer-inputs.ts`, `field-activity-cases.ts`): 630 answers with the problem `answerProblem` finds or null (every request kind against every reply kind, every branch, every format against a battery of inputs, Punycode and space-mapped hosts, patterns under both readings and with the syntax only newer engines take, lengths, JavaScript blanks, property order of unknown keys, field keys every JavaScript object inherits), 140 `fieldIsActive` cases over every operator, scalar and answer kind, and 36 hosts the app leaves to the bridge with what Bun says of them. `test/agent/answers/answer_cases_test.dart` requires the same result for each answer and activity, and that the app accepts every host Bun accepts. The trace and the fixtures' snapshots are compared as canonical JSON (keys in code-unit order, built as text so integer-like keys do not reorder).
- **Constants** the app must share with the bridge are generated into `contract.dart` (`contractMaxTextChars`, `contractMaxListItems`, `contractRequestDeadlineMs`, …), and a union now declares the fields all its members share as getters (`TranscriptItem.id`, `ClientMessage.requestId`, `FormFieldSpec.key`).

**Where the app leaves the verdict to the bridge.** The bridge's check is the authority; the app never refuses what it accepts, and passes a few strings it refuses, which the bridge then refuses `invalid_input` with its own message:

- **Unicode hosts** in `uri` fields, written out or as `xn--` labels. UTS 46 maps and validates them through tables the app does not carry. `answers/url/idna_lite.dart` applies the mappings people type (full-width forms, ideographic full stops, ignored code points), refuses the common disallowed code points and the spaces UTS 46 maps to U+0020; a Punycode label must decode, encode back to itself, and decode only to code points those tables keep (no capital but Cherokee's, nothing folded, ignored or disallowed). Unassigned code points, compatibility mappings and the context and bidi rules stay with the bridge. An ASCII host without an `xn--` label is checked exactly.
- **One Bun quirk:** Bun's URL parser refuses a label of decimal digits that pass 2^32 − 1 only with a final `0`, followed by `x` (`10000000000X`), where the WHATWG standard reads a domain. The app keeps to the standard: copying the quirk would refuse what a fixed Bun accepts.
- **Patterns Dart 3.10's engine cannot judge.** Newer ECMAScript takes a group name used again in another alternative, modifiers (`(?i:…)`) and an astral group name without `u`; Dart refuses them. `js_pattern_syntax.dart` rewrites such a pattern in older syntax that compiles exactly when the original does: when only names changed and no back reference names a duplicated group, the rewrite also matches the same, and the app judges it; otherwise that reading is left to the bridge. Dart's engine also misses U+0000 against a negated class under `u` in a string holding a code unit above U+00FF, so a text holding U+0000 is judged by its plain reading only. JavaScriptCore compiles an escaped astral character under `u` against the standard; Dart refuses it, and the app passes.

**At scale.** `tool/format_differential.dart` runs `packages/bridge/scripts/format-corpus.ts`, which builds a seeded corpus and judges each line with the contract's own `fieldProblem` under Bun, and fails on any difference outside the cases above. Eight seeds of 180,000 lines each (60,000 `uri`, 30,000 each of `email`, `date`, `date-time` and `pattern`): no difference outside them, and none the other way. Beside it, one-off sweeps: every code point as a host and as a Punycode label (1.1 million each), every `xn--` label of up to four letters, digits and hyphens (1.9 million), and 2.6 million digit-and-`x` hosts: the app refused nothing Bun accepts. The reviewer's 40,000 URLs differ in 4 (all Unicode, all passed by the app), down from 205; its 40,000 emails in none.

**Mutation.** `dart run tool/mutate_agent_core.dart` applies each mutant (one guard of `session/`, `client/`, `reducer/` or `answers/` changed, `tool/agent_core_mutants/`) to a copy of the app and runs the agent tests; every mutant must be killed except those listed with the reason they change nothing a test can see. `--check` verifies that every mutant still matches its file. Last run: 80 mutants, 75 killed; the 5 that survive are listed as equivalent (an equal arrival number no frame can have, a text exactly at the cap, a run exactly at its bound, a status line no snapshot with a run reaches, and the Cherokee exemption Dart 3.10's case tables make moot).

**What the port found in the contract.** Reading form answers by own key only: the TypeScript read `values[key]`, so a field keyed `constructor` or `toString` read an inherited function as its answer. Fixed in `answer-check.ts` and `field-check.ts` (contract README §19, erratum 12); the Dart port already read own keys, and the fixtures now hold both to it.

## 9. The UI building blocks

All under `lib/agent/ui/`, reachable from `AgentHomeScreen`. What decides what is shown:

| Element | Shown when |
|---|---|
| Archive toggle, Archive/Unarchive | `capabilities.archive` |
| Rename / Fork / Delete row actions | `rename` / `fork` / `delete` |
| Subagents | `children` |
| Composer mode picker | while running: `promptModes` minus `start`; none left: "takes no input while a run is on" |
| Image / file attachment | `attachments` holds `image` / `file` |
| File / agent mention | `mentions` holds `file` / `agent` |
| Commands | `commands` |
| Thinking levels | `thinking` and the current model's `ThinkingSpec` options |
| Model switch note | `modelSwitch` |
| Mode axes | the backend's `modes.list` |
| Queue chip ✕ | `SessionCapabilities.cancelQueued` and controllable |
| Compact | `SessionCapabilities.compact` |
| Composer, Stop, Answer | `SessionCapabilities.controllable` |
| Fork from an item | `fork`, on finished history items |
| Backend operations | `backendOps` (§10) |

The chat view streams text and thinking blocks, tool cards with input, output, progress, file changes (the app's `DiffViewer`), results, child-session links and nested subagent work, the todo plan, retry and compaction banners, the last run's outcome when it needs saying, notices and extensions, the queue, the asks waiting, and a Stop bar always on screen while the session runs. A banner says when the conversation is not live: waiting for the connection, catching up, an attach the bridge could not serve and that is tried again (with *Try again* now), a session lost, or a Mac that speaks another protocol, which no reconnect fixes.

**Cost per streamed event.** The timeline is built in two parts (`ui/chat/timeline_providers.dart`): the finished part once per history, the live part (the run, open work, the queue, this phone's prompts) when one of those changes, and the list builds only the rows on screen. `test/agent/ui/timeline_memo_test.dart` holds that a delta rebuilds the live part only and that other news rebuilds neither. Measured on the test VM: building a 2,000-item history took 0.3 to 4 ms, rebuilt by a delta before and never now; the live part of a 1,000-item run takes 0.25 to 0.6 ms.

**Accessibility.** Every action a long press offers is also a screen reader's custom action (*Actions from here* on a finished item; session rows have a visible actions button), and every progress indicator says what is in progress.

## 10. The panels registry

`ui/panels/panel_registry.dart` maps every `BackendOpKind` to one `OpPanel` (label, place, and the questions its call needs). A screen asks `panelsAt(capabilities, OpPlace.session | OpPlace.item)`; a panel exists exactly when the backend lists its op in `backendOps`. The switch is exhaustive, so a new op does not compile until it has a panel. The call's type is the contract's own (each op belongs to one backend's union, contract §13). `run_op.dart` sends `backend.call` and shows the result; an op that rewrites history reaches the conversation through `transcript_invalidated`.

## 11. The dev fake bridge and the end-to-end test

`packages/bridge/scripts/dev-fake-bridge.ts` runs the real bridge server with the contract's fake backend in its core, on the unix socket a daemon dials, and is scripted over stdin (`seed`, `script{ask|hold}`, `release`). It cannot reach production: it lives in `scripts/`, which the npm package does not ship (`files: bin, src`) and nothing in `src/` or `bin/` imports (the compiled binary is built from `src/bootstrap.ts`); it refuses to run as a compiled binary, and with a home, or any path derived from one (`XDG_*`, `PI_CODING_AGENT_DIR`, `PI_DURABLE_ROOT`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, `CLAUDE_CONFIG_DIR`, the `BROSKI_*` directories), outside the temp directory unless `BROSKI_DEV_REAL_HOME=1`; it reads each stdin line with a strict schema and answers anything else with an error; it stops when its stdin closes. `src/__tests__/dev_fake_bridge_reach.test.ts` holds these facts, and that no file under `src/` or `bin/` names the fake bridge at all. The e2e test starts it with only `PATH`, `TMPDIR` and a temp home in its environment.

`test/agent/e2e/agent_core_e2e_test.dart` (tag `e2e`, runs in `flutter test`) starts the real `broski-link` daemon (`test/link/e2e/link_daemon.dart`) and the fake bridge, pairs phones over the LAN with the app's own pairing parts, and drives the real `ContractClient` and session store through the real link: `hello`, list, attach, a prompt streamed to its end and read back from the transcript; an ask answered from the phone, two phones and the first answer winning; a reconnect that replays what happened while away (same epoch); a reconnect after the stream closed that takes a fresh snapshot (new epoch).

## 12. How Phase 4 moves a backend onto this layer

For each backend, in its own change:

1. **Adapter**: write `packages/bridge/src/backends/<id>/` against `AgentBackend`, pass `runConformance`, register it in `server.ts`'s `contract.backends`.
2. **Capabilities**: check its `Capabilities` lists exactly what the adapter does; the screens follow them with no change.
3. **Screens**: route the backend's entry points (session list, chat, settings sheets) to `SessionListScreen`, `AgentChatScreen`, `showLiveSettings`, `showInteractionSheet`. Nothing in `lib/agent/` changes for it; if a screen seems to need the backend's id, the contract is missing a capability: add it there.
4. **Extras**: give each of its ops a panel if it is new (the registry will not compile without one) and render its extension kinds in `notices_strip.dart`.
5. **Proof**: extend the e2e test with the backend's driver where one exists (a scripted model endpoint), and the fake's traits narrowed to the backend's.
6. **Delete**: its old handlers, connector, runtime mapper, Dart models, providers, `BridgeService` extensions and screens; drop it from `AgentType`. When the last backend is moved, `BridgeService`, `PiBridgeService`, the old runtime events and the heartbeat go, and the hidden entry becomes the app's way in.

## 13. Limits and open risks

- **Decoding.** `WebSocketService` parses JSON over 4,096 characters off the UI isolate (7 to 13 ms for an 8 MB frame on the test VM); `ServerMessage.fromJson` runs on it, 7.6 ms for that frame the first time and under 1 ms after. Moving it off too would need the old service to hand over the raw text; Phase 4 owns that service.
- **Strings the app leaves to the bridge** (§8): Unicode hosts, one Bun URL quirk, and patterns Dart's engine cannot judge. The app passes them; the bridge refuses the bad ones `invalid_input`.
- **A session replaced while the phone is away.** `session_replaced` is the old stream's last event, and the core retires that stream, so a phone that reconnects after it attaches to the old id afresh (the backend opens it again, if it still has it) and never learns of the new one; its prompts not yet sent stay with the old session. Closing this needs the core to remember replacements, a contract change.
- **Events carry no epoch.** The wire order replaces it while an attach is out (§4); between attaches the `seq` continuity of one stream is all there is, which is all the core sends.
- **Rate-limit windows** show their status and percentage only: the units of `resetsAt` are unverified for both backends that send it (contract Q13, Q22).
- **Composer lengths** are not limited as typed; the composer refuses a message over `MAX_TEXT_CHARS` or images over 4 MiB together, and the bridge enforces the rest of the schema.
- **The old protocol shares the socket** until Phase 4; both clients see each other's frames and ignore them.
