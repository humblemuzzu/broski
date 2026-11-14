# Lane A · Store (D40–D49)

> **Historical record.** Written before the rebuild (`docs/rebuild/PLAN.md`). It may describe the old protocol, backend ops, custom tools, Pi Durable, the Flutter app or protocol minors, none of which exist now. The README beside it describes the current code.

> Merged in Step 5 (`cc/integrate`). This file is the lane's record as delivered; where the adapter [README](../README.md)'s integration decisions D120–D129 changed something here, the README wins.

Built on `cc/lane-a-store`. Files: `owned.ts`, `store/*` (33 files), tests in `src/__tests__/claude-code/store/`. Citations as in STEP-3 (`d.ts:N` = `sdk.d.ts`, `mjs:N` = `sdk.mjs` line, minified: the function is named).

## Decisions

### D40. A list page is ordered from `readdir`/`stat`, and only its own rows are read

`listSessions({offset, limit})` re-reads every row before `offset`: `Hwe` parses candidate after candidate and only then `if(a<n){a++;continue}` (`mjs:117`). A deep page of the SDK's own paging therefore costs `offset + limit` lite reads, not the plan's `limit + 32`. The store lists `projects/*/<uuid>.jsonl` with `readdir` + `stat().mtime.getTime()` (what `ig` and `J0` do: `mjs:117`, `if(e.mtime)i.lastModified=e.mtime`), orders them like `$we` (`mtime` desc, `sessionId` **descending**; `byNewest`), starts after the keyset `(lastModified, sessionId)`, and reads **only the rows of the page** with `getSessionInfo` (one 128 KiB lite read each, `Q0`/`Gi`). A candidate the SDK hides (`undefined`: sidechain, no summary) is skipped and the next one read, in batches of at most 32. The cursor holds the position of the last *consumed candidate*, so a hidden file is never scanned twice.

- Scoped lists (`SessionQuery.cwd`): no path is encoded. `ProjectDirs` learns which `cwd`s each project directory holds from rows already read; a directory whose rows lie in another cwd is `out` and is skipped without a read (re-enumerated no more). A directory never read is `unknown` and read on first meet. The row's own `cwd` must equal the query's (or its realpath): the SDK's `dir` option would also fold worktrees in (`includeWorktrees` default true, `d.ts:1158`); this list never does.
- Differences from `listSessions`, accepted: a session the SDK hides because another one `continued-in` it (`J0`, `q0`) is listed here; two cwds that encode to one project directory are told apart only by the first row read there (the SDK's own `EL` check has the same blind spot).
- Cost measured (`store/scale.test.ts`, 500 sessions of 2 entries, one cwd, limit 50): **50 lite reads per page on every page**, 3–54 ms per page, peak RSS 69–145 MiB over two runs; `list.test.ts` asserts `≤ limit + 32` and `listSessions` never called. The SDK's own offset-450 page took 18 ms on those tiny files (page-cache hot): the saving is in reads (500 vs 50), not wall time at this size.
- Every page re-enumerates the files of the non-`out` directories (readdir + stat only).

### D41. The transcript is what the SDK's reader shows; four things D18 expected are not in it

Verified in `mjs:114` `$R` (the only constructor of a `SessionMessage`) and by running the real CLI (`real_cli.test.ts` dumps `Object.keys` of every entry):

1. **No `tool_use_result`.** A `SessionMessage` carries `type, uuid, session_id, message, parent_tool_use_id, parent_agent_id` plus `timestamp`, `origin`, `isCompactSummary`, `is_meta`, … (runtime fields the `.d.ts` type, `d.ts:6809`, does not declare). The structured `toolUseResult` (`structuredPatch`, `gitDiff`, `exitCode`) is dropped. **Closed by D41a:** the store reads it from the raw file and hands it to `toolResultOf`.
2. **System entries are `{type, uuid, timestamp}`** with `includeSystemMessages: true` (probe: `compact_boundary` and `turn_duration` are indistinguishable). **Closed by D41a/D41b:** the store asks for them and reads what they say from the raw file.
3. **A compaction** is the `isCompactSummary` user entry (it survives `pwe`, `mjs:114`): one `compaction` item, `summary` = its text, `id` = its uuid, no `trigger`/`tokensBefore`/`tokensAfter` (the boundary entry that held them is a system entry). The chain starts at the summary; what it replaced is not in the chain (real `/compact`: `real_cli_compaction.test.ts`).
4. **The CLI's own slash-command entries** (`<command-name>/compact</command-name>…`, `<local-command-stdout>Compacted </local-command-stdout>`) read as a `user_message` with the command as typed and a `notice` with the output (`local-commands.ts`), instead of tag soup.

`message.id` shared across entries is the API message: an entry's blocks are numbered after the blocks of the same `message.id` before it in the chain (`blockId`, the live stream's numbering; real CLI: thinking `:0`, text `:1`, the call is the third block and has its own id).

### D41a. Raw-file enrichment of entries the SDK returned (the rule)

(D40–D49 are all taken, so the follow-up is D41a and D41b.)

The SDK's reader is the only reader of history: it decides which entries exist, their order, and every page. After a whole-chain read the store makes **one streamed pass over that session's own file** (`raw-scan.ts`, 1 MiB positional reads, never `readFile`; a child's pass is over its own agent file) and records, **keyed by the `uuid` of an entry the SDK already returned**, (a) the byte span of the line that holds a `toolUseResult` and (b) the facts of `system` entries (D41b). Lines of entries the chain does not hold (before a compaction, other branches) are skipped by uuid. Nothing is listed, ordered, paged or counted from the raw file.

- **Pass cost:** a line is searched for two byte markers (`"toolUseResult":`, `"type":"system"`) and decoded only when one is there; a `system` line is parsed (≤ 64 KiB), a result line is *not* parsed: its entry uuid is taken from the text before the marker (the CLI writes `uuid` before `toolUseResult`; a second search of the whole line if not), and read time checks it. Lines over 8 MiB are skipped, not held.
- **Read:** a page opens the file, reads the span of each tool-result entry it shows, parses it, checks `entry.uuid` equals the one asked for (a rewritten file gives nothing, not another entry's result), and passes `entry.toolUseResult` through `boundedJson` (strings ≤ 1 MiB, lists ≤ 1,000, depth ≤ 64). One page reads at most 32 MiB of spans; past it, entries show without their structured result.
- **Bounds:** ≤ 100,000 spans and ≤ 20,000 system facts per session (oldest dropped), ≤ 4 MiB of notice text (oldest dropped); the index keeps two numbers per result, not the result.
- **An entry that answers more than one tool call gets none** (its single `toolUseResult` could belong to either).
- **What reaches the helper is what the live frame carried:** the real CLI's `tool_use_result` for Read, Edit, Write and Bash equals the history value (`real_cli_tool_results.test.ts`); recorded frames' results equal it for every tool in `fixtures/frames` (`tool_results.test.ts`). `toolResultOf(block, toolUseResult, {entryUuid, blockIndex}, toolName)` is called exactly as before with the real value; `fileChangesOf` is lane B's, inside `toolResultOf`.
- **Cost** (50 MB file of 32,845 entries with a `toolUseResult` on every tool result and a `turn_duration` per turn): first page 165–175 ms → 210–222 ms (+≈45 ms), peak RSS 572–726 MiB → 594–632 MiB, later pages ≤ 73 → ≤ 83 ms. The compacted file: 153–167 → 173–201 ms.

### D41b. `system` entries become run boundaries and notices

The store reads with `includeSystemMessages: true` (sessions only: `getSubagentMessages` has no such option and returns user/assistant entries), so the SDK's chain holds the `system` entries in their place; the raw file says what each is. `turn_duration` → `run_boundary{completed}`; `informational`, `away_summary` and `local_command` (its `<local-command-stdout>`) → `notice` (level from the entry; the stdout/stderr tag decides `local_command`'s); `compact_boundary` → no item, its `trigger`/`preTokens`/`postTokens` go to the compaction item that follows it (`trigger`, `tokensBefore`, `tokensAfter`). Other subtypes show nothing. Facts about the chain this brings:

- A `system` entry **after the last user or assistant entry is not in the SDK's chain** (`Ed` walks from the newest user/assistant tip): a run's `turn_duration` shows once something follows it, and `lastChainUuid` never names a system entry.
- A real SDK-driven session (`entrypoint: sdk-ts`) wrote `compact_boundary` and `local_command` here but no `turn_duration` in the runs tried; interactive CLI transcripts have them (research 04 §2.2). `turn_duration` is covered by fixtures only.
- During a run the previous run's `turn_duration` lies after the cut (it was written after the cut's entry), so it appears when the run ends.
- Cost: none beyond D41a's pass (system lines are the few small ones).
- Verified by run against the real CLI: `compact_boundary` (`compactMetadata.trigger/preTokens/postTokens`) and `local_command` (`content` = `<local-command-stdout>…`). **Not seen in a real run, taken from research 04 §2.2 and covered by fixtures only:** `turn_duration`, `informational`, `away_summary`. The SDK accepts a fork at a system entry's uuid (`system_items.test.ts`).

### D42. The index, the cursor, the cut

- **Index** (`TranscriptIndex`, 8 sessions): built from one full `getSessionMessages` (the only way to learn `count`; `N0` builds the whole chain and `HR` slices it after, `mjs:114`), kept while the file's `(size, mtimeMs)` hold. It keeps, per chain position: uuid, type, `message.id`, block base and count; and maps `tool_use` id → name / call position / result position and uuid → position. A page is one `offset`/`limit` read **checked against the index** (`ChainSnapshot.window`): a mismatch rebuilds once and serves from that fresh read, so a file that changed between is never paged wrongly. The request that builds the index serves its page from the same array (no second SDK call). Whole-chain reads are single-flight per session and queued across sessions (`FullReads`): two phones asking for one session share one read, and two big sessions never peak together (`full_reads.test.ts`).
- **Cursor** `{u: entry uuid, k?: items of that entry still to show}` (kind `transcript`, scope = the session id). Uuids survive appends; a cursor whose entry left the chain is `stale`. A page counts items, an entry may hold several (a message with three blocks, a user entry with results and text), so a page can end inside an entry; pages of 1 equal one page of 200 (tests, also over real CLI files).
- **`LiveRow.cut`**: nothing after the entry `lastUuidBefore`; `null` → empty page; a cut the chain lost (a compaction removed that entry mid-run) → **empty page** (the live snapshot holds the run), not an error: the cut cannot be located, and refusing would break reads at every `/compact`.
- Memory: the index build holds the whole parsed chain once per file change. 50 MB transcript, 37,332 entries, worker-backed SDK (tests): first page 215–269 ms, **peak RSS 781–909 MiB** (+690…818 over a 91 MiB baseline, two runs) without compaction; **478 MiB** with a compaction a third in (the SDK keeps only post-boundary bytes above 5 MiB, `RL`); later pages ≤ 110 ms for 200 items. Production runs the session functions in process (no worker clone), so its peak is the SDK's own. The index itself keeps uuids only.

### D43. Fork lineage is ours; fork points

`forkSession` leaves no link (`SF` stamps `forkedFrom` on entries, not exposed). `ForkLinks` keeps `forkId → sourceId` in `<stateDir>/forks.jsonl` (bounded read, `Ownership.claim` has no parent argument) and rows read it. `fork(at)`: `through` an item = the entry holding it (`upToMessageId` is inclusive, `d.ts:875`, 08-spike Q9), **through a tool call = its result entry** (never a dangling call), `before` = the entry before; nothing before the first → `invalid_input`; an item inside the run in progress (past the cut) → `invalid_input`; with no `at` and a run active, the fork is of the finished part (`cut.lastUuidBefore`; `null` → `invalid_input`). The fork is claimed in the journal and announced with `session_updated{parent:{kind:"fork"}}`.

### D44. Delete → the OS trash, by `rename`, with the location from `services.cliEnv`

`trash.ts`: macOS `<HOME>/.Trash/<name>` (` 2`, ` 3`… before the extension on a clash, like Finder), Linux `<XDG_DATA_HOME or HOME/.local/share>/Trash/{files,info}` with `info/<name>.trashinfo` reserved with `O_EXCL` first (percent-encoded `Path=`, local `DeletionDate`). A move is `rename` only: `EXDEV` or any failure → `backend_error` and the file stays; no copy, no `rm`. **Tests cannot reach the real trash**: `HOME`/`XDG_DATA_HOME` come from `services.cliEnv` (the environment the CLI is given; tests pass a temp one), and with no absolute `HOME` there it refuses instead of asking `os.homedir()`. The transcript moves first (the session leaves the list); its `<id>/` directory second, best effort (a failure there leaves harmless orphans and the delete still counts). No Finder "Put Back" metadata (a plain rename). Other platforms → `unsupported`.

### D45. The owner journal

`<stateDir>/owned.jsonl`, lines `{k:"s",i}` and `{k:"p",s,u,n}` (image names, `null` for none), `0600` in a `0700` directory. Memory bounds: 20,000 sessions, 50,000 prompts, 100 names of ≤ 256 chars per prompt; the file is read from its last 32 MiB, rewritten (temp file + `rename`) when it passes 140,000 lines. A damaged line is skipped. All writes are serialised and never throw. **JavaScriptCore trap found on the way:** dropping the oldest entry of a `Set`/`Map` one insert at a time is quadratic (150,000 inserts into a 20,000-entry set: 3.6 s); `store/bounded.ts` lets a collection overshoot by an eighth and cut it back in one pass (`boundedGrowth`), and bulk loads trim once. Every LRU in the store uses it.

### D46. Children (subagents)

Ids from `listSubagents` (`mjs:117` `TF`/`OF`, recursive over `subagents/`), file and sidecar from a bounded scan (≤ 2,000 files, depth ≤ 8) of the same directory. Row: title = sidecar `description` (else `agentType`, else the id), `source` = `agentType`, `createdAt` = birth time, `updatedAt` = file mtime, `cwd`/`origin` = the parent's, `status` from the overlay else `unknown`. The sidecar's `toolUseId` links an `Agent`/`Task` call to its child (`ToolCallItem.childSession`, also read by `wF` as `parent_tool_use_id`, `mjs:117`). The history of a child is `getSubagentMessages` (a whole-file read per call, `wF`), paged by the same index. A child's own transcript has no `childSession` links. Children of a child: an empty page. `rename`/`fork`/`remove` of a child → `unsupported`.

### D47. Rows

`title.source`: `customTitle` → `user`; `summary === firstPrompt` → `first_prompt`; else `generated`. **The SDK's `summary` prefers `lastPrompt` over `firstPrompt`** (`ml`, `mjs:115`: `customTitle‖aiTitle‖lastPrompt‖summary‖firstPrompt`): in a session with several prompts and no AI title the title is the *last* prompt, labelled `generated` (real CLI: `real_cli.test.ts`). `status` is the overlay's or `unknown` (a session a terminal writes, or nobody hosts). `archived` is false and `archived: true` lists nothing. `modelId` only from the overlay. `origin` from the journal.

### D48. `lastChainUuid` of a session with no transcript file is `null`

The port says "null for a session with none". A session minted before its CLI ran (D2) has no file; lane D reads the chain's end at run start and needs `null`, not `not_found`. Any other failure is returned.

### D49. What the store emits

`rename` → `session_updated` (title source `user`), `fork` → `session_updated` of the fork (parent fork), `remove` → `session_removed`. `rename`/`remove` have no `live` argument, so the event row uses the overlay of the latest call that had one (`StoreContext.live`; a hosted session's status is not reset to `unknown`). `announce` never throws. The store has no file watcher: a session a terminal changes is announced by lane G's watch, not here.

## SDK facts verified twice

| # | Fact | Declaration | Implementation / run |
|---|---|---|---|
| 1 | `getSessionInfo(id)` without `dir` searches every project; `undefined` for unknown, sidechain, no summary | `d.ts:904`, `:909` | `mjs:56` `ws` (loops `Mu(o)`), `mjs:117` `Q0` → `ml` (`isSidechain` → null; no title → null); run: `list.test.ts` (non-UUID and random id → `not_found`) |
| 2 | `lastModified` is the file's `stat().mtime.getTime()`, the same value the SDK sorts by | `d.ts:6150` | `mjs:56` `Gi` (`mtime:r.mtime.getTime()`), `mjs:117` `ig`/`J0` (`i.lastModified=e.mtime`); run: tie test compares our order to `listSessions` for limits 1, 2, 3, 200 |
| 3 | Ties: greater `sessionId` first | STEP-3 row 18 | `mjs:117` `$we`; `foundation/session_order.test.ts`; `list.test.ts` |
| 4 | The paged SDK listing re-reads rows before `offset` | `d.ts:1156` (offset "skip") | `mjs:117` `Hwe` (`a<n`→`continue` after `J0`); run: `scale.test.ts` counts 50 `getSessionInfo` per page |
| 5 | `getSessionMessages` returns the live chain oldest first; `offset`/`limit` slice that list | `d.ts:934`, `:939-947` | `mjs:114` `N0` → `HR`; run: `transcript.test.ts` index test, windows match the index |
| 6 | A `SessionMessage` at run time has `timestamp`, `isCompactSummary`, `is_meta`, `origin`; no `tool_use_result`; system entries have no `subtype`/`content` | `d.ts:6809` (declares none of them) | `mjs:114` `$R`; run: `Object.keys` of real CLI entries (`user`: `…timestamp, origin`), probe with a hand-written compaction |
| 7 | An `isCompactSummary` user entry is in the chain | — | `mjs:114` `pwe` (only `isMeta`/sidechain/team are dropped); run: `real_cli_compaction.test.ts` |
| 8 | `getSubagentMessages` reads the whole agent file; its `parent_tool_use_id` is the sidecar's `toolUseId` | `d.ts:971`, `:976` | `mjs:117` `wF` (`readFile`, sidecar `.meta.json`), `YR`; run: `children.test.ts`, `real_cli.test.ts` (a real sidecar has `description`, `agentType`, `toolUseId`) |
| 9 | `listSubagents` lists `agent-<id>.jsonl` recursively | `d.ts:1193` | `mjs:117` `TF`/`OF`; run: real CLI subagent listed |
| 10 | `forkSession(upToMessageId)` is inclusive, remaps uuids, titles the fork `… (fork)` | `d.ts:870-890` | `mjs:117` `kxe`/`SF`; run: `mutations.test.ts`, `real_cli.test.ts` fork through the first answer |
| 11 | `renameSession` appends a `custom-title` the next lite read sees as `customTitle` | `d.ts:3356` | `mjs:161` `J3`; run: `mutations.test.ts`, `real_cli.test.ts` |
| 12 | A send's uuid is the user entry's uuid | `d.ts:878-882` | run: `real_cli.test.ts` (item ids == the uuids of `spike.send`) |
| 13 | Block numbering: entries of one `message.id` are consecutive blocks | `ids.ts` `blockId` | run: real CLI (`msg_scripted_1:0` thinking, `:1` text, the call third) |
| 14 | The title prefers `lastPrompt` over `firstPrompt` | `d.ts:6143` ("custom title, auto-generated summary, or first prompt") | `mjs:115` `ml`; run: `real_cli.test.ts` |

## Port changes wanted (none blocks the lane)

1. `SessionStore.rename` and `remove` should take `live: LiveOverlay` like `fork`/`announce`; today the store remembers the latest overlay it was given (D49).
2. `Ownership.claim(sessionId, parent?)`, so the journal could hold the fork link and `forks.jsonl` could go (D43).

## For integration / other lanes

- **Lane B:** `toolResultOf` receives the entry's `toolUseResult` (D41a) as a bounded `JsonValue` (or `undefined`: no result, two calls in one entry, an oversize line, budget spent), exactly the object the live frame's `tool_use_result` holds; **`[needs lane B]` in `real_cli_tool_results.test.ts` is skipped (`test.if`) until the stub is gone and asserts the Edit diff, the Write `added` change and the Bash output: integration should see it run and pass.** `imageRefsOf` is used for user entries (the journal's names are applied in order to its refs, `nameImages`, unit-tested without B) and `imageAt` for `readAttachment`; `toolTitle` for `ToolCallItem.title`. Until B lands a history tool result reads `outcome: "failed"` with `error: "not built yet: lane B toolResultOf"` (the tests assert ids and kinds only): **re-check `transcript.test.ts` and `real_cli.test.ts` for the result's outcome and content after merging B.** The store names a call `Agent` for the old name `Task`; B should do the same live.
- **Lane D:** call `store.invalidate(sessionId)` when a run ends; `lastChainUuid` costs a full chain read when the file changed since the last one (the index is rebuilt); `lastChainUuid` is `null` for a session without a file (D48); pass the `LiveRow.cut` of a running session.
- **Lane G:** the store never lists or opens a terminal session specially; `status` stays `unknown`.
- Conformance world: rows carry `cwd` as the CLI wrote it (realpath); `seedSessions` sessions are `origin: "broski"` only after lane D's `ownership.claim`.
