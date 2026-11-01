# Claude Code — Step 3: the interfaces the eight lanes build on

Read [`PLAN.md`](PLAN.md) (all of it) and the adapter [`README.md`](README.md) (D36–D39) first. This file is what each Step 4 lane codes against: the files it owns, the ports it implements and consumes, the stubs it fills, the rules and tests that are its exit, the SDK facts it relies on, and what it must not touch. Built on `cc/foundation` from `main` at `09436c2`. Where this file and the plan or a research file disagree, this file was checked against the SDK (§3, rows marked **correction**).

**Citations.** `d.ts:N` = `packages/bridge/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` line N; `tools.d.ts:N` = `sdk-tools.d.ts`; `mjs:N` = `sdk.mjs` line N (minified: a line holds many functions, so the function name is given too); `bin` = the strings of the 2.1.316 `claude` binary; `fixture:<name>` = `src/__tests__/claude-code/fixtures/frames/<name>.jsonl`; `CT` = `packages/bridge/src/contract/`; `CC` = `packages/bridge/src/backends/claude-code/`; `T` = `packages/bridge/src/__tests__/claude-code/`.

**Contents.** [1 What Step 3 built](#1-what-step-3-built) · [2 The shape](#2-the-shape) · [3 SDK facts](#3-sdk-facts-verified-twice) · [4 Capabilities](#4-capabilities) · [5 Shared helpers](#5-shared-helpers) · [6 Lane briefs](#6-lane-briefs) · [7 Who owns what](#7-who-owns-every-method-and-rule) · [8 Step 5 join points](#8-step-5-join-points) · [9 Gaps](#9-contract-and-core-gaps) · [10 The conformance driver](#10-the-conformance-driver) · [11 Traps](#11-traps)

---

## 1. What Step 3 built

- **Built, tested, frozen** (a lane that needs a change stops and asks the plan owner): `bounds.ts`, `rejections.ts`, `json.ts`, `ids.ts`, `cursor.ts`, `catalog-feed.ts`, `permission-modes.ts`, `traits.ts`, `ports.ts` + `ports/*`, `services.ts`, `factory.ts`, `backend.ts`, `call-op.ts`, `sdk/*`, `process/env.ts`, `process/inbox.ts`, `live/live-state.ts`. Tests: `T/foundation/*` (shared helpers, ids, primitives, the D36 config dir, the skeleton).
- **Test helpers, shared, frozen**: `T/helpers/fake-claude-sdk.ts` (a `ClaudeSdk` whose session functions answer empty or from `overrides`, whose `query()` hands out scripted queries), `T/helpers/fake-query.ts` (a full `Query`: push frames, `end()`, every control call recorded and answered by `handlers` or rejected as not scripted), `T/helpers/frame-fixtures.ts` (`readFrameFixture(scenario)`, `frameScenarios()`), `T/helpers/fixture-transcripts.ts` (`writeFixtureSession(configDir, {sessionId, cwd, prompts})`: a transcript in the CLI's shape, for tests only).
- **Typed stubs**: every other file under `CC`. Each export has its final name and type; each body answers `notBuilt("lane X: …")` (`rejected("unsupported", "not built yet: …")`) where it returns a result, nothing where it is a sink, an empty value where it is a pure mapping. **Step 5's gate:** `grep -rn "notBuilt(\|not built yet" packages/bridge/src/backends/claude-code` finds only `rejections.ts`.
- **Frozen signatures**: everything in `ports.ts`/`ports/*`, every lane entry point `backend.ts` calls (§6, "Entry point"), and every cross-lane helper (§6 B). **Lane-internal signatures may be refined by the lane** (a store-internal helper, a host class's constructor) as long as those hold.
- **Not built**: the server side (`server/contract-backends.ts` registration, D28; the custom tools port over `custom-tools.ts`, D30; `server/cc-terminal-hook.ts`, D26). Nothing serves users.

**Test directories.** Each lane writes its tests in its own directory so worktrees never collide: `T/store/` (A), `T/mapping/` (B), `T/catalogue/` (C), `T/live/` (D), `T/asks/` (E), `T/ops/` (F), `T/terminal/` (G); lane H in `test/agent/` per app-core rules. A lane adds helpers under its own directory, never in `T/helpers/` (frozen) or another lane's.

**Bun quirk every lane must know**: with a worker-backed `ClaudeSdk` (an explicit `configDir`, D36), assert a rejection with `.then(ok, err)`, not `expect(p).rejects`: in Bun 1.4.4 `expect(p).rejects` never settles when the rejection arrives through a worker message after an earlier one (reproduced with a bare echo worker, `T/foundation/config_dir.test.ts` uses the `.then` form).

---

## 2. The shape

```
backend.ts ── reads ─────▶ store/ (SessionStore) ◀── LiveOverlay ── live/ (LiveSessions)
   │                          ▲   └── Ownership (owned.ts)              │  per host: inbox, consumer, RunTracker,
   │  open(new|existing) ─────┼────────────────────────────────────────▶│  PromptDesk, InputQueue, SessionSettings,
   │  open(child ref) ────────┼────────────────────────────────────────▶│  LiveState, FrameMapper (mapping/, B),
   │  open(terminal writing) ─┼──▶ terminal/ (TerminalWatch, G)         │  AskDesk (ui/, E)
   ├── listModels/Commands/Modes/status ──▶ models/catalog.ts (CatalogueAccess, C) ◀─ observe(init) ─┘
   ├── call(ClaudeCodeOp) ──▶ call-op.ts ──▶ ops/*.ts (F) ── withHost/withLiveHost ──▶ live/
   └── dispose: terminal → live → store → sdk → catalog.silence()
every SDK call ──▶ ClaudeSdk (sdk/, D36): query() in process; session functions in process, or in a worker under configDir
```

Construction order (`createClaudeCodeParts`): `CatalogFeed` → `Ownership` → `TerminalWatch` (reaches the store and live through closures) → `SessionStore` → `CatalogueAccess` → `LiveSessions`. The factory then awaits `ownership.load()` and `terminal.start()`. Every event of an open session goes through its `LiveState.emit` (`SessionEmitter`), which applies `applyEvent` and forwards to the attached sink, so `snapshot()` is exact (contract README §5 rules 1–2). Catalog news goes through the one `CatalogFeed`, silenced last in `dispose()`.

---

## 3. SDK facts verified twice

Each row was checked in the declaration **and** in the implementation, a recorded frame or a run, before the seam that encodes it was written, and re-checked after the diff reads (§11 of the report).

| # | Fact | Declaration | Implementation / run | Seam |
|---|---|---|---|---|
| 1 | Session functions read `process.env.CLAUDE_CONFIG_DIR` of their thread; no option names it | `d.ts:939` `GetSessionMessagesOptions`, `:1143` `ListSessionsOptions`, `:3418` `ResolveSettingsOptions` (no config dir) | `mjs:30` `function hu()`, `Mt=PP(…,hu)`; run: `T/foundation/config_dir.test.ts` | `ClaudeSdk` (D36) |
| 2 | The list/info/messages/subagents functions read it before their first `await`; `forkSession`/`renameSession`/`deleteSession` with `dir` and `resolveSettings` after one | — (an implementation fact) | `mjs:117` `X0(e,t,n=Et())`; `mjs:56` `ws(…,o=Et())`, `qn(e,t,n=Et())`; `mjs:117` `kxe`; `mjs:161` `J3`, `aJe`; `mjs:152` `k6(){await R6()…}`; run: the worker test covers rename and fork | `sdk/worker-client.ts` |
| 3 | A Bun worker has its own `process.env` | Node `worker_threads` `WorkerOptions.env` | run: two workers, two `env`s, parent untouched (probe), `config_dir.test.ts` | D36 |
| 4 | `options.env` replaces the environment; the SDK stamps `CLAUDE_CODE_ENTRYPOINT=sdk-ts` and `CLAUDE_AGENT_SDK_VERSION` only when absent | `d.ts:1706-1723` | `mjs:158` `gt=L?{...L}:{...process.env};if(!gt.CLAUDE_CODE_ENTRYPOINT)…` | `process/env.ts` (drops inherited ones) |
| 5 | `interrupt()` declares no parameter; the runtime takes `{cancelQueued}` | `d.ts:2952`, wire `d.ts:4848` `cancel_queued` | `mjs:154` `async interrupt(e)`; 08-spike Q3; `T/foundation/primitives.test.ts` | `sdk/interrupt.ts` |
| 6 | `command_lifecycle` frames are not in the `SDKMessage` union | `d.ts:5604` (union), mentioned only in `d.ts:4848`'s doc | fixture:text (queued, started, completed); `primitives.test.ts` reads every fixture | `sdk/lifecycle.ts` |
| 7 | A send's `uuid` becomes its transcript entry's uuid | `d.ts:878-882` (`upToMessageId`: "or from the `uuid` you supplied on a streamed SDKUserMessage") | run: `T/conformance/session_router.test.ts` (chain[0].uuid = the uuid sent) | D37, `ids.ts` |
| 8 | Every `/v1/messages` request names its session in `X-Claude-Code-Session-Id` | — | bin string `X-Claude-Code-Session-Id`; run: `session_router.test.ts` | the driver's router |
| 9 | The `Query` interface is exactly the members `FakeQuery` implements | `d.ts:2938-3343` | `T/helpers/fake-query.ts` `implements Query` typechecks | fakes |
| 10 | `ModelInfo.resolvedModel` maps an alias row to its wire id | `d.ts:1450` | 08-spike Q11 (`default → claude-opus-5-5`) | catalogue, driver echo |
| 11 | On `claude-*-5-5` models the todo tools are off | `tools.d.ts:1101` declares `TodoWriteInput` (declared ≠ offered) | bin `p5()`: on only for older models, a launch opt-in or `CLAUDE_CODE_ENABLE_TODO_TOOLS`; no fixture's `system/init` lists `TodoWrite`/`TaskCreate` | D38 `plan: false` |
| 12 | An elicitation with an empty schema arrives as `mode: "form"`, `requestedSchema: {type:"object", properties:{}}` | `d.ts:750-769` | run: `T/conformance/elicit_server.test.ts` | lane E `confirm` |
| 13 | A user-scope MCP server (`$CLAUDE_CONFIG_DIR/.claude.json`) whose tools user settings allow elicits with no tool permission first | — | `mjs:43` `HD()` (the global config under `CLAUDE_CONFIG_DIR`); run: `elicit_server.test.ts` (`canUseTool` never called) | the driver |
| 14 | `listSessions` includes programmatic (SDK) sessions by default | `d.ts:1174` | `mjs:117` `d=l??!0` | lane A (D17) |
| 15 | `SDKSessionInfo` carries no path; `customTitle`, `firstPrompt`, `summary`, `cwd`, `createdAt`, `lastModified`, `fileSize` | `d.ts:6138-6179` | `config_dir.test.ts` reads `customTitle` after `renameSession` | lane A |
| 16 | Task frames: `task_started{tool_use_id, task_type}`, `task_updated.patch.status`, `task_notification.status`, `background_tasks_changed` (replace) | `d.ts:6387`, `:6432`, `:6322`, `:3814` | fixture:subagent, fixture:subagent-background | `BackgroundTask`, `TaskStatus` |
| 17 | `PermissionRequest` hook input and decision | `d.ts:2573`, `:2581` | — (D26 is blocked, §9) | `ports/terminal.ts` |
| 18 | **Correction** of research 04 §3 and PLAN fact 15: `listSessions` breaks a `lastModified` tie by the **greater** `sessionId` first, paged or not | — (the `d.ts` says nothing of ties) | `mjs:117` `zwe` (`a.sessionId<i.sessionId?-1:…`) and `$we` (`t.sessionId<e.sessionId?-1:…`); run: `T/foundation/session_order.test.ts` | lane A's keyset |

Facts the plan already cites twice (08-spike §2) and the seams rely on without re-deriving: one `result` per turn (`d.ts:6023`), `idle` the run-over signal (`d.ts:6181-6190`, needs `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`), `aborted: true` on cut frames (`d.ts:3747`), `terminal_reason` (`d.ts:10151`), a throwing callback is a denial (`d.ts:218-227`), `PermissionResult`/`setMode` (`d.ts:2594-2613`), ExitPlanMode (`tools.d.ts:851-866`, `3395-3421`), AskUserQuestion keyed by text (`tools.d.ts:1139`, `2688`), `forkSession` inclusive (`d.ts:870-890`), `updateSettings` (`d.ts:3046-3058`), `supportedModels` cached (`d.ts:3105`), `onElicitation` (`d.ts:1545-1553`), `priority`/`client_composed` (`d.ts:6588`, `6631`), `perTaskStopAffordance` (`d.ts:1849-1868`).

---

## 4. Capabilities

`CLAUDE_CODE_TRAITS` (`CC/traits.ts`), each against the rule that tests it (research 06 §5):

| Field | Value | Rule | Owner who makes it pass |
|---|---|---|---|
| `streamText`, `streamThinking` | true, true | 10 (text deltas), 12 (thinking deltas) | B (stream events), D |
| `promptModes` | start, steer, queue | 16, 17, 18 | D (D8) |
| `attachments` | image | 13, 14 | D (send), A (transcript `ImageRef` + journal names), B (`imageRefsOf`, `imageAt`) |
| `mentions` | file, agent | 13 | D (`@<path>`, `@agent-<name>`, D10) |
| `commands` | true | 3, 13 | C (list), D (`/<name> <args>`) |
| `queue` | true (+ `cancelQueued`) | 18 | D (D8) |
| `interactions` | tool_permission, questions, plan_approval, form, external_url, confirm | 23, 24, 25 | E, with D's run tracking |
| `modelSwitch` | next_request | 20 (`echo_model`) | D (`Query.setModel`), C (ids) |
| `thinking` | true | 2, 20 | C (spec), D (`applyFlagSettings({effortLevel})`) |
| `children` | true | 12 (`tool_updated{child_session}`) | B, D |
| `usage` | true | 12 | B |
| `plan` | **false** (D38) | 12 | — (B emits no `plan_updated`) |
| `planProposals`, `externalLive`, `durableRuns` | false | 12, 27, 28 | D (28: a restart ends the run) |
| `extensions` | rate_limit, prompt_suggestion | stream gating only | B |
| `backendOps` | all 13 `ClaudeCodeOp` kinds; the two custom tool ops only with the port | 1, 9, 30 | F |
| `fork`, `rename`, `delete` | derived (methods exist) | 8 | A |
| session `compact` | lane D implements | 22 | D |
| session `cancelQueued` | lane D implements | 18 | D |
| `cancelCompaction` | D decides (D70s) | 29 | D |
| `cancelRetry` | absent (Q13: interrupt only) | 29 (nothing checked) | — |

---

## 5. Shared helpers

| File | What | One helper per job (PLAN §8) |
|---|---|---|
| `rejections.ts` | `ACCEPTED`, `CLOSED`, `rejected(code, message)` (message clipped), `notBuilt(what)`, `isRejected(x)` | no lane writes its own |
| `bounds.ts` | `clip`, `clipEnd` (surrogate-safe), `nameOr(text, fallback)` (never empty, ≤ `MAX_NAME_CHARS`), `fitsId(id)` (ids are never cut), `boundList(items, max)` and `boundRecord(record, max)` → `{items, omitted}` | every string, list and map from the SDK |
| `json.ts` | `boundedJson(unknown): JsonValue` (strings, lists, keys, depth bounded; cycles, functions, bigints → null; `__proto__` stays an own key), `isRecord(unknown)` | tool input, `tool_use_result`, MCP content |
| `ids.ts` | see the table below | every id |
| `cursor.ts` | `cursorScope(parts)`, `encodeCursor(kind, scope, position)`, `decodeCursor(cursor, kind, scope, guard)`; kinds `sessions`, `transcript` | a foreign cursor → `invalid_input` |
| `catalog-feed.ts` | `CatalogFeed{emit, silence}` | every catalog event |
| `permission-modes.ts` | `PERMISSIONS_AXIS = "permissions"`, `DEFAULT_PERMISSION_MODE = "default"`, `PERMISSION_MODES` (D12 order), `isPermissionMode` | C lists, D sets, E offers |
| `process/env.ts` | `cliEnv({base, clientApp, configDir?})` (D4) | every CLI and the D36 worker |
| `process/inbox.ts` | `createInbox()` → `{iterable, push, end, ended}`: open until `end()`, one consumer | hosts, probe, transient hosts |
| `live/live-state.ts` | `LiveState` (`SessionEmitter`): `snapshot()`, `emit(event, native?)`, `attach(sink)` → snapshot, `detach(sink)`, `attached` | every open session: hosted, child, watch-only |
| `sdk/interrupt.ts` | `interruptQuery(query, {cancelQueued})` | Stop (D) |
| `sdk/lifecycle.ts` | `asCommandLifecycle(frame)` → `{commandUuid, state}` or undefined | D's consumer |
| `sdk/claude-sdk.ts` | `createClaudeSdk({configDir?, env})` | `services.ts` only |

**Ids** (`ids.ts`, D37, D39):

| Id | Format | Function |
|---|---|---|
| run, interaction, queue item | random UUID | `mintRunId`, `mintInteractionId`, `mintQueueItemId` |
| a prompt's send uuid | the prompt's `clientRequestId` | `sendUuid(clientRequestId)` (undefined for a non-UUID) |
| user item / live `user_message.messageId` | the entry uuid | `userItemId(entryUuid)` |
| block | `<message.id>:<index>`, index = the block's position in the API message | `blockId`, `parseBlockId` (last `:`) |
| tool call | the API `tool_use` id | `toolCallId(toolUseId)` (undefined past `MAX_ID_CHARS`) |
| tool result item | `<toolCallId>:result` | `toolResultItemId` |
| image | `<entryUuid>:<blockIndex>`, inside a tool result `<entryUuid>:<blockIndex>:<innerIndex>` | `imageAttachmentId`, `parseImageAttachmentId` |
| child session | `<sessionId>/<agentId>` (agent id `[A-Za-z0-9_.-]{1,128}`, the frames' `agent_id` = the task's `task_id`) | `childRef`, `parseChildRef` |
| command | the `SlashCommand.name`, no slash, no whitespace | `commandId`, `commandText(id, args)` → `/<id> <args>` |
| UUID check | — | `isUuid(value): value is UUID` |

---

## 6. Lane briefs

Each brief: **Owns** (files; nothing else), **Entry point** (frozen, called by `backend.ts`), **Implements**, **Consumes**, **Fills**, **Exit**, **SDK facts**, **Must not touch**. Every lane: no edits to `CT`, `src/core/`, `lib/` (except H), `ports.ts`/`ports/*`, `traits.ts`, `ids.ts`, the other frozen files of §1, or another lane's files. A lane that needs a port change stops and reports to the plan owner. Decisions go into the adapter README in the lane's range.

### A · Store (D40–D49)

- **Owns**: `CC/owned.ts`, `CC/store/*`; tests in `T/store/`.
- **Entry point**: `createSessionStore(deps: StoreDeps): SessionStore` (`store/session-store.ts`), `createOwnership(deps: OwnershipDeps): Ownership` (`owned.ts`).
- **Implements**: `SessionStore`, `Ownership` (`ports/store.ts`). Contracts: a cursor this store did not mint → `invalid_input`; unknown session → `not_found`; every `sessionId` may be a child ref (D20), and `rename`/`fork`/`remove` of a child → `unsupported`; `transcript` honours `LiveRow.cut` (nothing after `cut.lastUuidBefore`; `null` → an empty page); `fork` claims the fork in the journal and emits `session_updated` with `parent{kind:"fork"}`; `remove` moves `<id>.jsonl` and `<id>/` to the OS trash (D19, OQ5) and emits `session_removed`; `rename` emits `session_updated` with `title.source: "user"`; `announce` never throws; `invalidate` drops what is cached of a session. `Ownership.load()` runs once at factory time; `origin`/`prompt` are synchronous over it; the journal is bounded (D17) at `<stateDir>/owned.jsonl`.
- **Consumes**: `ClaudeSdk` via `deps.services.sdk` (`listSessions`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents`, `forkSession`, `renameSession`; `configRoot()` to find a file under `projects/*/` without encoding a path, D15), `CatalogFeed`, `TerminalPresence` (a row's status for a session a terminal writes stays `unknown`, D16), the `LiveOverlay` passed to each call. Cross-lane helpers of lane B (`mapping/tool-results.ts` `toolResultOf`, `tool-titles.ts` `toolTitle`, `file-changes.ts` `fileChangesOf`, `images.ts` `imageRefsOf`/`imageAt`), so a tool result reads the same live and in history; until B lands they return empty values.
- **Fills**: `owned.ts`, `store/session-store.ts`, `list.ts`, `list-cursor.ts`, `rows.ts`, `info.ts`, `transcript-index.ts`, `transcript-page.ts`, `items.ts`, `attachments.ts`, `mutations.ts`, `trash.ts`, `children.ts`.
- **Exit**: rules 5–8 against fixture transcripts in a temp config dir (`writeFixtureSession`; extend it in `T/store/`), a 50 MB file and a 500-session project (with the memory watchdog, AGENTS.md test hygiene); a `cut` test; a child ref test; a journal test (D37: `clientRequestId` exactly for recorded prompts, image names back).
- **SDK facts**: §3 rows 1, 2, 7, 14, 15, 18 (ties: `sessionId` **descending**; D15's keyset must order the same way); research 04 §3 (64 KiB head/tail, 5 MiB post-compaction scan); D15, D16, D17, D18, D19, D20, D33/D36, D37.
- **Must not touch**: `live/`, `mapping/`, the SDK directly (only `services.sdk`).

### B · Mapping (D50–D59)

- **Owns**: `CC/mapping/*`; tests in `T/mapping/`.
- **Entry point**: `CLAUDE_CODE_MAPPING: MappingPort` (`mapping/index.ts`) = `{createMapper: createFrameMapper, turnOutcome}`.
- **Implements**: `MappingPort`, `FrameMapper` (`ports/mapping.ts`). `map(frame)` returns the display events of one frame in order and never throws; it never emits what the host owns: `run_started`/`run_finished`, a `user_message` for a send the host noted (`noteSend(uuid)`), `interaction_*`, `queue_changed`, `model_changed`, `mode_changed`. `settle(outcome)` finishes every open block (its text so far) and tool (`aborted` when the outcome is) so nothing is open at rest. `MappedEvent.agentId` marks an event of a subagent's own stream (D20); B decides (D50s) whether a subagent's work is also shown in the parent's stream with `parentToolCallId`. `turnOutcome(result)` is D31. **No `plan_updated`** (D38).
- **Cross-lane pure helpers B owns, signatures frozen**: `toolTitle(toolName, input)` (`tool-titles.ts`), `fileChangesOf(toolName, input, toolUseResult)` (`file-changes.ts`), `toolResultOf(block, toolUseResult, place, toolName)` → `{outcome, result}` (`tool-results.ts`), `imageRefsOf(content, entryUuid)` and `imageAt(content, part)` (`images.ts`). Used by A (history), E (previews) and G (tail).
- **Consumes**: `ids.ts` (`blockId`, `toolCallId`, `toolResultItemId`, `imageAttachmentId`, `childRef`), `bounds.ts`, `json.ts`, SDK types only (never `ClaudeSdk`: mapping is pure).
- **Fills**: every file in `mapping/`; `state.ts`'s fields are B's to choose.
- **Exit**: table tests from the recorded frames (`readFrameFixture`, all 21 scenarios), every `SDKMessage` variant (`d.ts:5604`) covered or listed as ignored; each mapped sequence passes `streamViolations` (`CT/testing/stream-rules.ts`) with `CLAUDE_CODE_TRAITS`.
- **SDK facts**: 08-spike Q3 (aborted frames), Q5 (`assistant` before `content_block_stop`), Q13 (retry has no finish frame; compaction frame order); PLAN facts 6–10; D7 (B emits nothing for runs), D18, D24, D31.
- **Must not touch**: anything outside `mapping/`.

### C · Catalogue (D60–D69)

- **Owns**: `CC/models/*`, `CC/modes.ts`, `CC/commands.ts`, `CC/status.ts`, `CC/process/probe.ts`, `CC/process/version-check.ts`; tests in `T/catalogue/`.
- **Entry point**: `createCatalogue(deps: CatalogueDeps): CatalogueAccess` (`models/catalog.ts`).
- **Implements**: `CatalogueAccess` (`ports/catalogue.ts`): `initialize(cwd)` (a host's answer, else the cache: memory then `<stateDir>/catalog.json`, 24 h, else a probe, D6); `observe(cwd, init)` (a host's own initialize refreshes the cache and is checked against `services.expectedCliVersion`, D3); `invalidate(cwd?)` (emits `catalog_invalidated`); `models`, `commands`, `modes`; `model(cwd, id)` (undefined for an unlisted model → D's `setModel` answers `not_found`); `listedModelId(cwd, wire)` (via `ModelInfo.resolvedModel`, D11); `status()` never fails.
- **Consumes**: `ClaudeSdk.query` (probe with `createInbox()`, `close()` in `finally`), `services.cli`, `services.cliEnv`, `services.stateDir`, `services.clock`, `permission-modes.ts`, `ids.ts` `commandId`.
- **Fills**: `models/catalog.ts`, `catalog-cache.ts`, `thinking.ts`, `modes.ts`, `commands.ts`, `status.ts`, `process/probe.ts`, `process/version-check.ts`.
- **Exit**: rules 1–4, 20 (catalogue parts), 21 (listing); status cases: missing binary (`services.cli.found === false`), signed out, policy refusal.
- **SDK facts**: §3 row 10; 08-spike Q11 (five rows, effort `low…max`, `supportsAutoMode`, a retired id remapped); `d.ts:1442-1482` `ModelInfo`, `d.ts:4783` `SDKControlInitializeResponse`, `d.ts:9781` `SlashCommand` (`builtin`), `d.ts:113` `AgentInfo`.
- **Must not touch**: `live/` (C never starts a host), `process/` files other than its two.

### D · Live session (D70–D79)

- **Owns**: `CC/live/*` except `live-state.ts`, `CC/process/options.ts`; tests in `T/live/`.
- **Entry point**: `createLiveSessions(deps: LiveDeps): LiveSessions` (`live/registry.ts`).
- **Implements**: `LiveSessions` (+ `LiveOverlay`) (`ports/live.ts`), `HostView` for ops, `AskHost` for the desk (`ports/asks.ts`). `open(new)`: the session id is minted before the CLI starts (D2), claimed in the journal (`ownership.claim`), the initial modes from `NewSessionOptions.modes` (default `DEFAULT_PERMISSION_MODE`, never omitted, fact 5). `open(existing)`: resume in a host or attach to the running one (one host per session, D1); `close()` detaches only (rule 25). `openChild`: watch-only, forwarded from the parent's host (`MappedEvent.agentId`). `withHost`: on the host, else a transient host (resume, empty inbox, `close()` in `finally`, D23); `unsupported` for a session a terminal writes (`terminal.writing`). Input D38 does not declare is refused `unsupported`, never dropped (rule 13): a `file` attachment (a file goes as a mention). Every prompt: `uuid = sendUuid(clientRequestId)` (D37), `origin: {kind:"human"}` (D9), `mapper.noteSend(uuid)`, `ownership.notePrompt(...)` with image names, the `user_message` event. Run boundaries per D7 (`idle` only). Stop = `interruptQuery(query, {cancelQueued: true})` (D8), queued input back as `input_returned`. A finished run: `store.invalidate(id)` then `store.announce(id, this)` (the catalogue row flips running → idle, §8). Every host's `initialize` goes to `catalogue.observe(cwd, init)`; `commands_changed` to `catalogue.invalidate(cwd)`. `system/elicitation_complete` → `desk.elicitationComplete(id)`; run end → `desk.withdrawRun(runId)`; process end → `desk.expireAll()`. `custom_tools`: `services.customTools?.sessionServers()` merged into `mcpServers` at every host start (D30).
- **Consumes**: `ClaudeSdk.query`, `services.*`, `SessionStore` (`locate`, `lastChainUuid`, `invalidate`, `announce`), `Ownership`, `CatalogueAccess` (`model`, `modes`, `listedModelId`, `observe`, `invalidate`), `TerminalPresence`, `MappingPort` (injected: tests may pass a stand-in), `AskDeskFactory` (injected), `createInbox`, `LiveState`, `interruptQuery`, `asCommandLifecycle`, `permission-modes.ts`, `ids.ts`.
- **Fills**: `live/registry.ts`, `host.ts`, `consumer.ts`, `run-tracker.ts`, `prompt-desk.ts`, `queue.ts`, `settings.ts`, `input.ts`, `abort.ts`, `compaction.ts`, `shutdown.ts`, `child-router.ts`, `process/options.ts`.
- **Exit**: rules 10–19, 22, 24–26 against the real CLI (`T/live/`, the spike rig and `T/conformance/session-router.ts` are the test bed); D5's options asserted from `fakeClaudeSdk().started`; `FakeQuery` for unit tests.
- **SDK facts**: §3 rows 4–7, 9; PLAN facts 1–6; 08-spike Q2–Q4, Q10; D1–D12, D23, D30.
- **Must not touch**: `ui/`, `mapping/` (use the port), `store/`, `live/live-state.ts`.

### E · Asks (D80–D89)

- **Owns**: `CC/ui/*`; tests in `T/asks/`.
- **Entry point**: `createAskDesk: AskDeskFactory` (`ui/desk.ts`).
- **Implements**: `AskDesk` (`ports/asks.ts`). `canUseTool`/`onElicitation`: never throw (a throw is a denial, Q7), never resolve `null` (blocks forever), idempotent per `requestId` (redelivery, fact 13; the CLI's id maps to a minted interaction id, D39); an ask raised while `host.activeRunId()` is defined blocks that run. `answer`: `answerProblem` first (`CT/answer-check.ts`), `stale` for a resolved id, `not_found` for an unknown one; `cancel{stopRun:true}` → deny with `interrupt: true` and `host.abortRun()`; `cancel{stopRun:false}` → a plain deny so the run goes on. The withdrawal paths: the callback's `signal` (the CLI cancelled), `elicitationComplete(id)` (an unanswered URL ask), `withdrawRun(runId)`, `expireAll()`. No timer anywhere (D14). Option payloads (`PermissionUpdate[]` per option id) stay in the desk; `modeAfter` becomes `updatedPermissions: [{type:"setMode", mode, destination:"session"}]` (D25) with `host.planModeOptions()` as the request's `modeOptions`; D sees the mode change in the next frames and emits `mode_changed`.
- **Consumes**: `AskHost` (`live`, `activeRunId`, `abortRun`, `planModeOptions`, `now`), `ids.ts` `mintInteractionId`, `bounds.ts`, `json.ts`, B's `toolTitle`/`fileChangesOf` for previews.
- **Fills**: `ui/desk.ts`, `permission.ts`, `questions.ts`, `plan.ts`, `elicitation.ts`. (No `dialogs.ts`: D5 passes no `onUserDialog`.)
- **Exit**: rule 23 for each of the six declared kinds; a test that no ask resolves without a human answer, a cancel or a CLI withdrawal; the lock-screen shape (a plain allow/once and deny/once option, research 06 §6).
- **SDK facts**: §3 row 12; `d.ts:228` `CanUseTool` (`suggestions`, `title`, `description`, `defaultToNo`, `suppressAlwaysAllowRule`, `requestId`), `d.ts:2594-2613`, `d.ts:750-769`, `d.ts:1545`; 08-spike Q6, Q7, Q13; D13, D14, D25.
- **Must not touch**: `live/` (the desk reaches its host only through `AskHost`).

### F · Ops (D90–D99)

- **Owns**: `CC/ops/*`; tests in `T/ops/`.
- **Entry point**: one function per op, `(deps: OpsDeps, op: <Kind>Op) => Promise<BackendCallResult>` (`call-op.ts` dispatches; `rewindFiles`, `sessionSettings`, `changedFiles`, `refreshModels`, `configFiles`, `configFile`, `settingsOverview`, `mcpServers`, `plugins`, `tasks`, `contextUsage`, `customTools`, `customTool`).
- **Implements**: the ops of D22, D23, D30 under PLAN §8: `ActionList` ops (`mcp_servers`, `plugins`, `tasks`, `custom_tools`, `context_usage`, `settings_overview`; unknown row `not_found`, action not offered `invalid_input`), file ops (`config_file`, `custom_tool`: revision CAS → `stale`, unparsable JSON → `invalid_input`, managed → `unsupported`, an id never named → `not_found`, `truncated` never `editable`), scoping (live state by `sessionId` → `not_found` for an unknown one; files by `cwd`; custom tools by neither). Live ops reach a host through `deps.live.withLiveHost` (tasks: `undefined` host = no tasks) or `withHost` (rewind, MCP status, context usage, plugin reload). History-rewriting ops emit `transcript_invalidated` (none of Claude Code's does today: `rewritesHistory` is false for all thirteen). `custom_tools`/`custom_tool` with `services.customTools` undefined answer `unsupported` (the traits then do not declare them).
- **Consumes**: `OpsDeps` (`services` incl. `sdk`, `customTools`, `stateDir`; `catalog`; `store`; `live`; `catalogue`), `bounds.ts`, `json.ts`, B's `fileChangesOf` (changed files), `ClaudeSdk.resolveSettings`/`filterEscalatingDefaultMode`, `HostView.query` control methods (`rewindFiles`, `mcpServerStatus`, `toggleMcpServer`, `reconnectMcpServer`, `reloadPlugins`, `stopTask`, `getContextUsage({detail:"summary"})`, `updateSettings` for its two keys, D34).
- **Fills**: every file in `ops/` (`config-paths.ts` included).
- **Exit**: rule 9 (every op answers in kind; an op naming a random session → `not_found`), rule 30 (the four refusals for `config_file` and `custom_tool`), per-op tests in a temp config dir, including a refused write of invalid JSON and a revision conflict.
- **SDK facts**: 08-spike Q8 (`updateSettings`), research 05 (paths, `~/.claude.json` MCP toggles, `enabledPlugins`), `d.ts:3227` `rewindFiles` (live query, `enableFileCheckpointing`), `d.ts:3128`, `d.ts:3193`, `d.ts:3264`, `d.ts:3318`.
- **Must not touch**: `live/` internals (only the two `with*Host` calls), `store/` internals, the custom-tools implementation (only `CustomToolsPort`).

### G · Terminal (D100–D109)

- **Owns**: `CC/terminal/*`, `server/cc-terminal-hook.ts` (when D26 is unblocked); tests in `T/terminal/`.
- **Entry point**: `createTerminalWatch(deps: TerminalDeps): TerminalWatch` (`terminal/watch-only.ts`).
- **Implements**: `TerminalWatch` + `TerminalPresence` (`ports/terminal.ts`): `writing(id)` true when another process wrote the session's file in the last 10 s and `deps.hosted(id)` is false, and always false when `services.terminal.watch === false`; `openWatchOnly(ref, stored, sink)` → an `OpenSession` without `control`, fed by a positional tail translated per research 04 §7; one watcher per project directory under `configRoot()/projects/`; "continue here" is lane A's `fork` (D19); `start`/`dispose`. `runExternally` and `externalLive: true` (rule 27) only once the tail proves `run_started{external}`…`run_finished` with a second CLI writing the session.
- **Consumes**: `TerminalDeps` (`services`, `catalog`, `mapping`, `hosted`, `locate`), `LiveState`, B's helpers.
- **Fills**: `watch-only.ts`, `project-watch.ts`, `tail.ts`, `jsonl-lines.ts`, `translate.ts`, `hook-asks.ts`.
- **Exit**: a second CLI process writing a session shows live on a watch-only open; rule 27 once declared (a trait change goes through the plan owner).
- **SDK facts**: research 04 §7 (no lock, no pid file; `bridge.d.ts` is Remote Control), §3 row 17.
- **Must not touch**: `live/`, `store/`; D26 until §9 is decided.

### H · App (D110–D119)

- **Owns**: `lib/agent/ui/panels/` (`action_list_view.dart`, `config_file_editor.dart`, registry entries), the composer's prompt-suggestion chip, the plan-approval mode picker; tests in `test/agent/`.
- **Implements**: rendering by shape of `ActionList` (`CT/action-list.ts`) and `EditableFile` (`CT/editable-file.ts`), `extension{prompt_suggestion}` (`CT/extensions.ts`), `PlanApprovalRequest.modeOptions` / `PlanApprovalReply.modeAfter` (`CT/interactions.ts`, `interaction-replies.ts`).
- **Consumes**: the generated contract only (`lib/contract/generated/`); nothing of the bridge adapter.
- **Exit**: widget tests with the scripted bridge; `dart run tool/check_agent_core.dart`; `dart run tool/mutate_agent_core.dart --check`; `flutter analyze`; `dart format`.
- **Must not touch**: the bridge; `lib/agent/` may never name the backend (app-core rules).

---

## 7. Who owns every method and rule

| `AgentBackend` / `SessionControl` member | Delegates to | Lane |
|---|---|---|
| `status` | `catalogue.status()` → `status.ts` | C |
| `listSessions`, `getSession`, `readTranscript`, `readAttachment` | `store.*(…, live)` | A (+ D's overlay) |
| `listModels`, `listModes` | `catalogue.models/modes` | C |
| `listCommands` | `catalogue.commands(cwd)`; a session's cwd from `store.locate` | C (+ A) |
| `open(new)`, `open(existing)` | `live.open` | D |
| `open(child ref)` | `live.openChild` | D (+ B's `agentId`) |
| `open(terminal writing)` | `terminal.openWatchOnly` | G (+ A's `locate`) |
| `rename`, `fork` | `store.rename/fork` | A |
| `delete` | `live.end` then `store.remove` | D, A |
| `call` | `call-op.ts` → `ops/*` | F |
| `dispose` | terminal → live → store → sdk → catalog | foundation |
| `prompt`, `abort`, `setModel`, `setThinking`, `setMode`, `compact`, `cancelQueued` | the host | D |
| `answer` | the host's `AskDesk.answer` | E |

Rules: 1 C+foundation · 2–4 C · 5–8 A · 9 F · 10–11 D+B · 12 B+D · 13–14 D+A+B · 15–19 D · 20 C+D · 21 C+D · 22 D+B · 23 E+D · 24–26 D · 27 G (not declared) · 28 D · 29 D (only if `cancelCompaction`) · 30 F.

---

## 8. Step 5 join points

What integration checks across lanes, beyond the conformance suite (PLAN §6 Step 5):

1. **A finished run flips the row `running → idle`**: D calls `store.invalidate` + `store.announce` at `run_finished`; A's row reads `LiveRow.status`; the app's `RunCompletionWatcher` fires and opens the right chat.
2. **A pending ask reaches the daemon feed, and a lock-screen allow/deny answers it**: E offers a plain allow/once and deny/once option; D keeps the session open while the ask is pending (keep-open); `BridgeCore.answer` reaches `SessionControl.answer`.
3. **A subagent's live work shows under its parent and in its own child chat**: B's `MappedEvent.agentId` and `tool_updated{child_session: childRef(...)}`; D's child router; A's child rows and transcripts (`listSubagents`, `getSubagentMessages`).
4. **A watch-only session turns controllable after "continue here", and the phone's fork opens**: G's watch-only open; A's `fork` claims and announces; D opens the fork.
5. **Every op is reachable from the More sheet or the item menu, and every result renders**: F's results; H's panels; `rewind_files` on a user message item.
6. **Offline cache shows a CC session list and transcript read-only**: A's rows and pages are stable (`idStability: "stable"`).
7. **Ids meet**: D's live `user_message.messageId` = A's transcript item id = the send uuid (D37); B's live block ids = A's history block ids (`<message.id>:<index>`, the index counted the same way live and in history); image refs read back by A for ids D and B minted.
8. **Catalogue meets live**: D's `setModel` validates through C's `model()`; `init.model` goes through C's `listedModelId` before a `model_changed`; a host's `initialize` reaches `catalogue.observe`.
9. **Every stub is gone**: the §1 grep; then delete the `describe.skip` in `T/conformance/conformance.test.ts`, and replace the not-built assertions of `T/foundation/backend_skeleton.test.ts` (its capability checks stay).

---

## 9. Contract and core gaps

- **D26 (terminal permission asks) cannot be answered on a watch-only session.** D21 opens a session a terminal writes without `control`; every answer — a phone's (`core/controlled.ts:57-61`) and one from outside the phones (`core/bridge-answer.ts:31-32`) — goes through `SessionControl.answer` and is refused `unsupported` when `control` is absent. A `control` whose other methods refuse would set `controllable: true` (the composer shows, D21 is broken). Step 3 stopped here: the port is typed (`TerminalAskHandler`, `TerminalOptions.hookAsks`), `terminal/hook-asks.ts` is a stub, nothing is wired. Decision needed from the plan owner: e.g. an answer path on `OpenSession` outside `control`, or a `SessionCapabilities` member for "watch-only, asks answerable". D26 is the optional lane after v1, so nothing else waits on it.

No other part of the adapter needs something the contract or core cannot express.

---

## 10. The conformance driver

`T/conformance/` — complete except for what only the lanes can prove; the suite is `describe.skip` until Step 5.

| File | What |
|---|---|
| `conformance.test.ts` | `runConformance("claude-code", kit.factory, 15_000)` inside `describe.skip(<reason>)`; `afterEach(kit.dispose)` (fails on any escape), `expectNoOrphans()` |
| `driver.ts` | `ClaudeCodeConformanceDriver` (`ConformanceDriver`), `claudeCodeConformanceKit(timeoutMs)` |
| `world.ts` | `ClaudeWorld`: `createClaudeHome()`, the scripted endpoint with the session router's routes, the CLI from `resolveClaudeCliPath(defaultClaudeCliEnvironment())`, factory options with `configDir` = the temp home (D36), `stateDir` in the temp root, `memoryCustomTools()`; `restart` = dispose + rebuild over the same home |
| `session-router.ts` | per-session scripts by `X-Claude-Code-Session-Id`, gates (`gate`/`release`), a held compaction, the requests each session sent — proven by `session_router.test.ts` |
| `scenarios.ts` | `Scenario` → script steps (below) |
| `delivered.ts` | the newest main request's last user message → `DeliveredInput` |
| `backend-calls.ts` | each op's call; file and tool ids from the adapter's own `config_files`/`custom_tools` listings |
| `observed-backend.ts` | the backend with `open` wrapped: controls by session id, last-emission time (`quiesce`) |
| `elicit-server.ts` | stdio MCP server with `ask_form`, `ask_url`, `ask_confirm`, user-scope in the temp home, its tools allowed — proven by `elicit_server.test.ts` |
| `model-echo.ts` | wire model → listed id via a probe's `ModelInfo.resolvedModel` |
| `memory-custom-tools.ts` | `CustomToolsPort` over a map, one tool seeded |

**Decisions in the driver.** `seedSessions` runs real sessions through the backend (rows are `origin: "broski"` with real history; fixture transcripts are lane A's tests). `quiesce` waits until no session emitted for 300 ms. `runExternally` returns false (`externalLive: false`). `slow_retry` → `false` (`cancelRetry` is not a method, so rule 29 never asks for it); `slow_compaction` holds the next `/compact` side request until `release`. `plan` and `plan_proposal` features → `false` (not declared). `plan_approval` switches the session to `plan` through its control first (`setMode("permissions", "plan")`, so lane D's `setMode` must work for rule 23's plan cases). `agentName` = `general-purpose` (a built-in agent, Q11).

| Scenario | Steps (08-spike evidence) |
|---|---|
| reply | one streamed text |
| tool | Read `<cwd>/README.md`, then text (needs no permission in `default`) |
| hold | one answer gated until `release`/abort |
| interaction tool_permission | Write `conformance.txt` in `default` (Q7 fixture:permission-allow), then text |
| interaction questions | AskUserQuestion (fixture:ask-user-question), then text |
| interaction plan_approval | in `plan`: Write the plan file the reminder names, ExitPlanMode `{}` (Q6), then text |
| interaction form / external_url / confirm | `mcp__elicit__ask_form` / `ask_url` / `ask_confirm` (Q13), then text |
| feature thinking / usage / children | thinking + text / text / foreground Agent call (fixture:subagent), then text |
| echo_model | request 1: text = listed model id + Read (so a request 2 follows); request 2 gated: text = listed model id |

**Unverified until the suite runs** (integration checks first): `delivered()` parsing of `@path`, `@agent-…` and `<command-name>` against what the CLI really sends; that the CLI's first-run trust prompt or onboarding does not interfere with a user-scope `.claude.json` holding only `mcpServers` (the elicit test passed with it); timing of `quiesce` on a loaded machine.

---

## 11. Traps

- **`expect(p).rejects` hangs** with a worker-backed `ClaudeSdk` (§1). Use `.then(ok, err)`.
- **Two listed models that resolve to the same wire id** (`default` and `opus` may both be `claude-opus-5-5`) make `echo_model` ambiguous: rule 20 uses the first two listed models. Lane C (D60s) must list so that the first two resolve differently, or choose ids that are wire ids. `model-echo.ts` assumes the listed id is `ModelInfo.value`; if C chooses another id, the echo follows C.
- **The first listed command that starts a run must reach the model as that command** (rule 13): a built-in like `/compact` or `/clear` reaches no main request. Lane C orders commands (a project command first, or built-ins that do not reach the model answered `handled` by D); the world writes `.claude/commands/conformance.md`.
- **Frame uuids**: D37 proves that a send's uuid is its entry's uuid; that every `user`/`assistant` frame's `uuid` is its transcript entry's (which `TranscriptCut.lastUuidBefore` needs when D tracks it from frames) is unverified: lane D proves it in its first real-CLI test or reads `store.lastChainUuid` at run start instead.
- **cwd canonical**: the core hands the adapter a canonical cwd; temp dirs on macOS are `/private/var/…`; `createClaudeHome` realpaths its root, and rows must carry the same string (rule 5 compares `row.cwd === driver.cwd`).
- **The CLI starts per host**: 0.2–3 s (Q1). Lanes D and F should not start a transient host where a cached answer or `undefined` host serves (tasks of a session nobody hosts are none).
- **MCP servers start with every host**: the conformance world configures one user-scope server, so every CLI it starts spawns it (≈50 ms).
- **No test reads the real `~/.claude`**: always a temp `configDir` (D36) and `claudeTestEnv`; `assertTempClaudePath` guards both helpers.
- **`plan: false`** (D38): B must not emit `plan_updated`; a TodoWrite call (older models) is an ordinary tool call.
- **Comments**: the repo's tooling refuses an edit with more than 0.5 comment lines per line of code; contracts live in this file and the ports' short doc comments.
