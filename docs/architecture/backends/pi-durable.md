# Pi Durable Backend — Experimental

> Source of truth: `packages/bridge/src/connectors/pi-durable/`, `packages/bridge/src/handlers/pi_durable*.ts`,
> `packages/bridge/src/runtime/pi-durable-*.ts`, `packages/bridge/src/types/pi-durable.ts`.
> Related: [pi.md](pi.md) (the stable Pi backend), `AGENTS.md` (the runtime abstraction).

`pi-durable` is Broski's 5th backend (`BroskiBackend = … | "pi-durable"`). It is **experimental** and hidden
behind the app's Experimental toggle (`AgentType.piDurable`).

It is not a second copy of the Pi backend. The stable Pi backend runs an in-process `AgentSession` and keeps
state in memory plus `~/.pi` session files. Pi Durable runs the `@earendil-works/pi-durable` **`Harness`** over
**JSONL storage** that commits every turn, so a bridge that crashes or is killed resumes the run instead of
losing it. The two backends share the pi *model runtime* and nothing else.

## Module map

| Area | Files |
|------|-------|
| Connector | `connectors/pi-durable/` (8 modules) — `index`, `harness-host`, `session-store`, `storage-lock`, `permissions`, `session-runtime`, `model-runtime`, `agent-setup` |
| Handler | `handlers/pi_durable.ts` (router) + `handlers/pi_durable/` (6) — `host`, `ops`, `view`, `events`, `transport`, `read-models` |
| Runtime | `runtime/pi-durable-runtime-event-mapper.ts`, `pi-durable-runtime-read-models.ts`, `pi-durable-partial-message.ts` |
| Contract | `types/pi-durable.ts` — the `pd_*` client/server message pairs |
| Tests | `__tests__/pi_durable/` (`harness-host`, `mapper`, `session-store`, `storage-lock`, `handler`, `handler_stream`) + fixture `fixtures/pi-durable-events.jsonl` |

`PiDurableHarnessHost` (`harness-host.ts`) owns every open harness in the bridge process: one JSONL storage per
session, a shared `ModelRuntime`, our permission extension, and an idle timeout (`PI_DURABLE_IDLE_TIMEOUT_MS`,
15 min). Nothing in the connector knows about the WebSocket.

## Storage layout

```
~/.broski/pi-durable/<sessionId>/
  meta.json              { id, cwd, title?, createdAtMs, updatedAtMs, model?, thinkingLevel? }
  main.jsonl             one line per atomic commit: {"format":1,"type":"commit","seq":N,"writes":[…]}
  doc-<id>.jsonl         document revisions — pi.live, pi.inbox, pi.usage, pi.provider, pi.agent
  task-<id>.jsonl        live task checkpoints; deleted once the task is terminal
```

- Session ids match `^[A-Za-z0-9_-]{1,64}$`; deletion is containment-checked against the durable root
  (`PiDurableContainmentError`). A plain Q&A turn is ~6 commits; a 2-tool turn is ~32–47.

## The lock (one process per storage)

pi-durable has **no** cross-process guard — "one process owns a storage at a time" is our contract, enforced by
`storage-lock.ts`:

- create `.broski-storage.lock` with `O_CREAT|O_EXCL` and `{ pid, startedAtMs }`;
- on `EEXIST`, read the holder pid and refuse while `kill(pid, 0)` succeeds; if the pid is dead, unlink and
  retry once (stale reclaim);
- acquire **before** `openNodeJsonlStorage`, release **after** `harness.close()` + `storage.close()`.

Reclaim must stay automatic: a `SIGKILL`ed bridge leaves the file behind, so refusing on any existing file
would permanently brick the session. Any second process (including `broski-bridge --attach`) must respect it.

## WebSocket contract

| Client → Bridge | Bridge → Client | Payload |
|-----------------|-----------------|---------|
| `pd_create_session` | `pd_session_created` | `{ cwd, model?, thinkingLevel?, title? }` → `BroskiSessionSummary` |
| `pd_chat` | `pd_chat_accepted` | `{ sessionId, content, images?, requestId?, whenBusy? }` → `{ submissionId }` |
| `pd_compact` | `pd_compacted` | `{ sessionId, instructions? }` → `boolean` |
| `pd_get_transcript` | `pd_transcript` | `{ sessionId, limit?, cursor? }` → `{ messages, nextCursor? }` |
| `pd_permission_response` | `pd_permission_resolved` | `{ sessionId, requestId, decision, reason? }` → `boolean` |
| `set_view` (`agent: "pi-durable"`) | `runtime_state` / `runtime_event` | attach / detach |

- **`pd_chat` is exactly-once on `requestId`**: repeating the same `requestId` returns the same submission
  instead of running the prompt twice. `whenBusy` is `"steer"` or `"followUp"`.
- `pd_get_transcript` returns the newest `limit` committed entries oldest-first (`PI_DURABLE_TRANSCRIPT_LIMIT`
  = 200); `nextCursor` walks *backwards*, so paging forwards means reading pages in reverse.
- Unified messages are supported: `unified_list_sessions`, `unified_list_projects`, `unified_list_models`,
  `unified_list_skills`, `unified_set_model`, `unified_abort`, `unified_delete_session`.
- Availability/auth surface through `router.ts` as the `"pi-durable"` agent status.

## Attach is snapshot-first (no replay buffer)

`attachPiDurableView` (`handlers/pi_durable/view.ts`): open the session (which **resumes** work a crash left
behind), register the socket as a watcher of that session's permission prompts, stream the attach snapshot as
`runtime_state` + `runtime_event`, then every later commit batch. The socket detaches on view switch or close,
and `shutdown()` closes views + host. `set_view` still returns `false` so the shared session-view handler keeps
its bookkeeping.

Pi Durable deliberately does **not** use `utils/runtime-replay-buffer.ts`: the snapshot is the reconnect view,
and late joins cost ~0 ms, so the bridge attaches lazily with the phone and detaches when the last one leaves.

## Permission flow (the phone is the approval UI)

1. `permissions.ts` installs an extension with `hooks: [hook(ToolTask, { beforeTool })]`.
2. Read-only tools auto-allow (`read`, `ls`, `list`, `grep`, `find`, `glob`, `search`, `tree`, `webfetch`);
   everything else is `"ask"`.
3. An asked call raises `permission_requested` (`options: ["allow", "deny"]`) and awaits
   `pd_permission_response` before the call is admitted.
4. The verdict is memoised under `approval:<taskId>` **before** returning, so a crash-recovery rerun of the same
   call reuses it instead of re-prompting.
5. Deny returns `{ block: reason }` (the model sees `Tool call blocked: …`); allow returns `undefined`. A denied
   call still produces a `pi.tool-result`, so it surfaces as `tool_finished` with `isError: true` — the mapper
   does **not** currently mark `backendData.denied`, so "denied" and "failed" look the same to the app.
6. The await is tied to the hook's context, so an aborted turn or a dropped phone blocks the call instead of
   hanging the run. `canRequestPermissions` is `true`; `canRequestUserInput` is `false`.

## Event mapping gotchas

- **`message_update.changes` is not a flat delta stream.** It is a list of message-relative changes:
  `text_start` / `thinking_start` / `toolcall_start` (the block as it stands after that commit), `*_delta`
  (appends), `block` (whole-block replacement), `message` (whole partial). The final answer can arrive **only**
  inside `text_start.block`, so a naive "emit every `*_delta`" mapper silently drops text.
- Therefore `runtime/pi-durable-partial-message.ts` (`PartialMessageDiff` / `PiDurableEventBridge`) owns
  whole-block text reconstruction. It is not optional.
- Streaming tool arguments are dropped; tool args arrive complete on `tool_execution_start`.
- `message_start` carries the current partial (thinking included), not an empty block. Seeding it can
  double-render on a re-attach that followed a snapshot — dedupe by `messageId`/`entry.id`.
- `tool_execution_update.output` is `{ set }` or `{ trimStart?, append? }`. `tool_execution_end.entry` is absent
  when the tool task faulted, was orphaned, or aborted.
- `agent_started`/`agent_finished` fire twice per run (`run_*` and `turn_*`), like the stable Pi backend, so the
  reducer's idempotency assumptions carry over.
- `auto_retry_end` / `compaction_end` are thin: `retry_finished.success` and `compaction_finished.aborted`
  cannot be populated from them — derive from the next `message_end`/`stopReason`, or accept partial UI.
- `entry_appended` never fired in testing; read `entries()` / the snapshot instead. Never trust streamed text as
  the transcript — reconcile with the committed `EntryRecord` on `message_end`/snapshot, keyed on `entry.id`.

## Models and cost

One `ModelRuntime` per bridge process (`connectors/pi-durable/model-runtime.ts`), shared as
`HarnessOptions.models`. It reads the existing `~/.pi/agent/auth.json`, so OAuth/subscription logins work with
no new auth flow. `pi.usage` reports **catalog list price** — a subscription-backed session shows a misleading
cost unless the app labels it "included in plan".

## Limitations

- Experimental API; pin the four `@earendil-works/*` packages at `1.1.0`.
- **One process per storage** (our lock). Two harnesses on one JSONL directory is unsupported.
- **No terminal-Pi interop.** Separate storage root (`~/.broski/pi-durable`); it does not read or write
  `~/.pi/.../sessions`, and a session cannot be shared between the two backends.
- A crash loses at most ~100 ms of streamed text (`settings.progress.partialIntervalMs`); the committed
  `EntryRecord` has it, so reconcile rather than trusting the stream.
- `bash` is `replay: "unsafe"`, so a crash mid-command yields `Tool bash was interrupted...` rather than a
  rerun. Only idempotent custom tools should be marked `replay: "safe"`.
- **Bun 1.3.5 only, JSONL only.** `openNodeSqliteStorage` fails under Bun (`No such built-in module:
  node:sqlite`).
- Subagent/fork/handoff paths map onto `ConversationRecord.owner` and `EntryRecord.head`, but the Flutter side
  of that mapping is not verified end to end.

## Release blocker: compiled bridge builds

A `bun build --compile` binary serving Pi Durable **must** call `registerBunOAuthFlows()` from
`@earendil-works/pi-ai/bun-oauth` at startup, or pi OAuth model calls fail with `Cannot find module
'./anthropic.js'`. The package ships `bun-oauth.js`; nothing imports it.

`grep -rn registerBunOAuthFlows packages/` returns nothing today, so this is unwired. The other mandatory step
from the spike — ad-hoc re-signing, without which macOS kills Bun 1.3.5's linker-signed output (`Killed: 9`, exit
137) — is already handled by `scripts/build.sh` (`codesign -f -s -`).
