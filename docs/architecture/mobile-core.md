# The mobile core — `broski-client`

Crate `packages/link/client` (`broski-client`). The phone apps' client core in Rust: the
[contract](contract/README.md) over the [link session](connectivity-v2/link-session.md), session views
kept by the contract's reducer, each machine's catalog, the inbox across machines, and terminals. The
iOS and Android apps reach it through the UniFFI facade crate `packages/link/mobile` (`broski-mobile`);
this crate has no UniFFI dependency. It does no storage I/O: records, the identity secret and the
inbox's seen state goes in and comes out as values.

```
SwiftUI / Compose ── broski-mobile (UniFFI) ── broski-client ── broski-link-session ── daemon ── bridge
                                                    └── broski-contract (models, reducer)
```

## Threading

- Every machine runs one **pump** task on the session crate's `LinkRuntime` (one thread for the app): it
  is the only reader of the machine's `Session`, and applies every event under the machine's one lock,
  so an answer, the events after it and the views they feed are never seen out of order. A bridge frame
  over 64 KiB is decoded on the runtime's blocking pool, awaited in order.
- **Every object** (`Phone`, `Machine`, `SessionView`, `TerminalView`, `SessionList`, `Inbox`) is
  `Send + Sync`, held in an `Arc`, and takes `&self`; every public value is owned data. `exported.rs` does
  not compile when an object is not `Send + Sync` or an async method's future is not `Send`.
- **Any executor**: UniFFI polls an async method on the Swift or Kotlin thread, which runs no tokio. A
  deadline is a sleep spawned onto the link runtime and awaited through its `JoinHandle` (made inside
  the spawned task: a `Sleep` finds its timer when it is constructed), aborted when the wait is dropped;
  waits for news are `tokio::sync::Notify`, which needs no runtime (`wait.rs`, tested by polling from a
  thread with no runtime).
- Subscriptions are **pulled**, as litter does it (`docs/rebuild/research/uniffi.md`): `next_update`,
  `next_change`, `next_event`. The app runs a loop per subscription. A pull dropped before it returns
  loses nothing, since an update is only taken in the poll that returns it, and closing a view or list
  wakes a pull in progress to return `None`. How Swift and Kotlin cancel a pull differs:
  [mobile-packaging.md §1](mobile-packaging.md#subscriptions-cancellation-and-threads).

## API

The Rust names; the apps call them through the facade, whose names and lifecycle
[mobile-packaging.md §1](mobile-packaging.md#1-the-facade) lists (`close` is `detach` or `stop` there,
and a machine ends through `Phone.forget`).

| Object | What it is |
|---|---|
| `Phone::new(identity_secret, PhoneConfig)` | the app's one client; `new_identity_secret()` makes a secret on first run; `with_timings(…, Timings)` is for tests |
| `phone.start(MachineRecord)`, `pair(offer_uri) -> Machine` | a stored machine, or a new pairing, whose `record()` the app persists at once |
| `phone.machine(id)`, `all_machines()`, `forget(id)`, `inbox()`, `pause()`, `resume()`, `network_changed()` | machines and the app's lifecycle, passed to every machine |
| `machine.request(ClientMessage) -> ServerMessage` | any contract request; the answer is the `….result` message |
| `machine.attach(SessionRef) -> SessionView`, `terminal(TerminalId) -> TerminalView` | views; `session_list(backend, SessionQuery) -> SessionList` |
| `machine.backends()`, `backend_status(b)`, `models(b, cwd, include_unavailable)`, `commands(b, cwd, session)`, `modes(b, cwd)` | the catalog, cached |
| `machine.status() -> MachineStatus`, `next_event() -> MachineEvent`, `record()` | status for the UI; at `RecordChanged` the app persists `record()` (the event carries no record, which holds secrets) |
| `machine.register_push(platform, token)`, `unregister_push()`, `pause()`, `resume()`, `network_changed()`, `lan_discovered(routes)`, `restart_bridge()`, `close()` | the link session's own calls |
| `view.next_update() -> SessionUpdate`, `snapshot()`, `session()`, `capabilities()`, `close()` | a chat screen's data |
| `terminal.next_update() -> TerminalUpdate`, `input(bytes)`, `resize(cols, rows, cell_w?, cell_h?)`, `summary()`, `close()` | a terminal screen's data |
| `list.rows()`, `next_change()`, `load_more()`, `refresh()`, `close()` | one session list |
| `inbox.rows()`, `next_change() -> InboxUpdate`, `refresh()`, `mark_seen(machine_id, session)`, `seen()`, `restore_seen(state)`, `restore_cache(bytes)`, `answer(machine_id, session, interaction_id, option_id) -> AnswerOutcome` | the home screen |

Every failure is a `ClientError`: `Refused{code, detail}` (the bridge's `error{…}`), `Rejected{code,
detail}` (a result's `Rejected`, from the helpers that return nothing on success; every other helper
returns the result union itself), `Incompatible`, `LinkReset`, `Timeout`, `NotSent{failure}`,
`Overloaded`, `InvalidRequest`, `UnexpectedAnswer`, `Revoked`, `Closed`, `Link{failure, detail}` (the link
session refused; `LinkFailure` says what: `Identity`, `Offer`, `OfferExpired`, `Record`,
`MachineUnreachable`, `FingerprintMismatch`, `PairingRejected`, `PairingTimeout`, `Push`, `Randomness`,
`Runtime`). A case's text is `detail`, never `message`, which Kotlin's exceptions already have. The
identity secret and the offer the app hands in are wiped once read. The contract's
models are `broski-contract`'s generated types; the session crate's `MachineRecord`, `Status`,
`BridgeStatus`, `Platform`, `PushPlatform` and `Timings` are re-exported as they are.

## The contract client

- **One hello per bridge socket.** The daemon keeps one bridge socket per link session and counts them
  (`conn` in its bridge status). A link session that resumes keeps its socket and everything this phone
  set up on it. A new link session (`Connected{resumed: false}` or `session_reset`) or a new `conn` is a
  socket that knows nothing of this phone: the client sends `hello` (the contract crate's generated
  `PROTOCOL_VERSION`, the app's name and version), and once it is answered attaches every view again,
  then sends the requests it held. A bridge socket that goes down (`state != up`) is gone too.
  `ContractState` says `Waiting`, `Ready{bridge_version}`, `Refused{message}` or
  `Incompatible{message}` (another major: every request fails `Incompatible` until a bridge that
  matches takes the link).
- **A refused hello is said again.** A hello the socket refuses for any reason but the version (the
  bridge's `error{…}`, an answer of another type, or the link not taking it) is `Refused{message}`,
  and the client says hello again on the same socket after 1 s, doubling with each refusal up to 30 s
  (at least the bridge's 10 s for `rate_limited`), until the socket goes or a hello is answered.
  Requests stay held meanwhile.
- **Requests** get ids the client mints (any `requestId` in the message is replaced) and are matched to
  answers by them. While no bridge socket has agreed on the protocol, requests are held and go out in
  the order they were made, after the views' attaches, so a held prompt finds its session viewed. Hello,
  attaches and detaches are the client's own: `request` refuses them (`InvalidRequest`).
- **Deadlines.** The bridge answers every request within `REQUEST_DEADLINE_MS`; the client stops waiting
  15 s after that (`Timeout`), which frees a waiter whose link is gone. A request sent on a socket that
  is lost, or caught by a link session reset, fails `LinkReset`, never silently; one the link session
  refuses fails `NotSent`. An answer `rate_limited` was not served and is sent again after the bridge's
  10 s refusal, within the same deadline.
- **Bounds.** At most 256 callers' requests wait at once (`Overloaded` past it).

## Session views

`attach(session)` returns a view at once; the stream attaches when the bridge is ready. Views of one
session share one stream (one attachment on the bridge); the last view to close detaches it. At most
32 sessions are viewed at once, the bridge's own bound.

- **Attach and resume** (core README §6). The first attach asks for a snapshot; every later one resumes
  the position held (`{epoch, seq}`), so the bridge replays what was missed in the same epoch or sends a
  snapshot. A replay of a position this phone does not hold starts over without a resume.
- **Seq.** An event at or below the position held is a repeat and is dropped; one past `seq + 1` is a gap:
  the stream attaches again from the position held. Events that arrive while an attach is out are left
  to its answer, which the bridge builds from the same log.
- **Replacement.** `session_replaced{session}` is the stream's last event (and an attach answered
  `replaced{session}` says the same of a phone that was away): the stream follows, attaching to `session`
  without a resume, also when it names the same session (erratum 8). A stream that goes on as a session
  another stream views hands its subscribers to that stream.
- **Ending.** A catalog `session_removed` ends the view (`ViewEnd::Removed`); an attach the bridge
  refuses ends it `Refused{message}`; a machine closed or revoked ends every view.

### The update protocol

`next_update()` returns, in order:

- `Reset{session, capabilities, snapshot, status}` — start over from this state: the first update, and
  after a `resynced`, a reattach answered with a snapshot, a replacement followed, or a subscriber that
  fell behind.
- `Changes{changes, status}` — apply the records in order; the UI's state then equals `view.snapshot()`
  at the moment the batch was taken.
- `Ended{reason}` — nothing follows.

Each `SessionChange` assigns what the reducer produced; the UI never computes:

| Record | The UI's state |
|---|---|
| `RunChanged{run}` | `run = run` (a run started with no items, ended, or lost items to a retraction or replacement) |
| `RunItemAppended{item}`, `RunItemReplaced{index, item}`, `RunItemsDropped{count, dropped_items}` | push; replace at `index`; remove the first `count` and set `droppedItems` |
| `BlockOpened{block}`, `BlockTextChanged{block_id, text}`, `BlockClosed{block_id}` | push; set that block's text; remove it |
| `ToolOpened{tool}`, `ToolChanged{tool}`, `ToolClosed{tool_call_id}` | push; replace the tool with that id; remove it |
| `InteractionAdded{interaction}`, `InteractionRemoved{interaction_id}` | push; remove |
| `QueueChanged`, `ModelChanged`, `ModesChanged`, `UsageChanged`, `CompactionChanged`, `RetryChanged`, `OutcomeChanged` | assign the field(s) |
| `NoticeShown`, `ErrorShown`, `ExtensionReceived`, `InputReturned{texts}` | show; the state holds none of them (`InputReturned`: put the texts, joined by blank lines, in front of the composer's text) |

Streaming text and tool progress are not queued per delta. A `block_delta` or `tool_updated` marks its
entry; when the UI takes a batch, each marked entry still open becomes one `BlockTextChanged` or
`ToolChanged` with its value at that moment, placed after the batch's records. A burst of a thousand
deltas is one assignment of the newest text. Batches come at most 30 a second (33 ms apart; the first
after a pause at once). A subscriber that leaves more than `MAX_LIST_ITEMS` records untaken gets the
whole snapshot instead (`Reset`), which costs no more than the records it replaces. A snapshot is never
sent per token.

`view/tests.rs` proves it: every case of the bridge's `reducer_trace.json` (the contract's own reducer
fixtures: streaming, tools, retractions, a run past 1,000 items, text past the cut, surrogate edges,
settings, resyncs) is applied and taken after every event, only at the end, and at eight
pseudo-random batchings each; after every batch the UI replica (`tests/common/replica.rs`, the code a
Swift or Kotlin model mirrors) equals the view's snapshot, and with a batch per event every update but
the first is records, not a snapshot. The integration tests hold the same equality over the real bridge.

## Catalog

- `backends()` and `backend_status(b)` are kept until the bridge says otherwise: `status_changed`
  updates a status, and a backend not yet listed lists the backends again. `models`, `commands` and
  `modes` are kept per (backend, directory, …) until `catalog_invalidated` for that backend and scope;
  an answer asked for before an invalidation is not kept. Each cache holds 64 entries and starts over
  past them. `MachineEvent::BackendsChanged`, `BackendStatusChanged` and `CatalogInvalidated` tell a
  screen to read again.
- `session_list(backend, query)` pages newest first (50 a page), one row per session, and stays current
  by the rows the catalog sends: `session_updated` puts a row into every list whose query it matches
  (backend, the directory when the query names one, and the parent: none for a query without one) and
  out of every other; `session_removed` takes it out. `query.cwd` must be spelled as the bridge spells
  directories (a row's `cwd`, `workspace.info`, `fs.list`), since rows are matched by it. A list holds at
  most `MAX_CATALOG_ITEMS` rows. `load_more` and `refresh` fetch their page on the link runtime, so a caller
  that stops waiting (Kotlin frees the future of a cancelled coroutine) does not strand the list: the page
  still merges and the next `load_more` works.
- **A new bridge socket** forgets everything above (its catalog spoke while this phone was not listening),
  lists the backends again and reloads every list from its first page.

## Inbox

Each machine keeps, per backend, a list of its newest `MAX_PAGE_LIMIT` top-level sessions; the inbox
joins every machine's. A row is `{machine_id, machine_name, session, title, cwd, state, updated_at,
ask, command, pending, cached}`, the backend being the session's.

| State | When |
|---|---|
| `NeedsYou` | a view of the session holds a pending interaction; unviewed, its row is `waiting_for_user` |
| `Working` | a run, a compaction or a retry, by the view; unviewed, its row is `running` |
| `Done` | otherwise, when the row's `updatedAt` is past the person's marker, or there is no marker |
| `Idle` | otherwise |

Rows sort by state in that order, then newest first.

**Views the inbox holds.** The bridge's rows carry a status, not the interactions, so each machine keeps
a view open, for the inbox, on its newest sessions whose row is `waiting_for_user`: at most 8
(`MAX_HELD_SESSIONS`, newest `updatedAt` first), which leaves the app at least 24 of the bridge's 32.
A held view is a stream like a screen's (one attachment per session; a screen and the inbox share
it) with no subscriber queue: it costs the snapshot and nothing per event. It goes when its row stops
waiting, when a newer waiting session takes its place, or when the machine ends; a stream a screen
still reads stays for the screen. Nothing changes while the inbox's lists are not all loaded (a new
bridge socket lists everything again, and dropping views it is about to want back would only churn).
A held session the bridge refused stays ended, and is not attached again on every event, until its row
stops waiting. The policy runs after every event and every page (`machine/holds.rs`).

**What a row says of its ask.** `ask` is the first pending interaction's title and `command` the
command of its tool permission's command preview, exactly as the agent wrote it, for any viewed
session ("Claude Code wants to run `npm test`" is the app's wording of them). `pending` is what can be
answered from the row: `{interaction_id, kind, allow?, deny?}`, present while the session's stream is
attached (a detached stream's snapshot may hold an ask that was answered meanwhile). For a tool
permission, `allow` is the backend's first option with `effect: allow`, `scope: once` and a message
that is not `required`, offered only when the request asks for no grants (an allow must choose some);
`deny` is its first `effect: deny` option that does not stop the run and needs no message. Both are
the backend's own `PermissionOption`s, never made up, and both are absent when the session takes no
answers here (`SessionCapabilities.answer`) or the request is `deliberate`. Any other kind has neither:
the app opens the chat for it.

**Answering from the row.** `answer(machine_id, session, interaction_id, option_id)` sends
`interaction.answer` with a `tool_permission` reply of that option, no message, no edited input and no
grants, only when `option_id` is the row's `allow` or `deny` (`InvalidRequest` otherwise). It returns
`Accepted`, `Stale` ("Already answered elsewhere": the bridge refused it `stale`, or the ask is no
longer the session's first pending one, or the inbox stopped viewing the session because its row
stopped waiting, in which case the bridge is not asked), or `Rejected{code, detail}`; a link failure is
a `ClientError`. It only ever sends what the person tapped.

**The last known inbox.** `InboxUpdate.cache` carries the inbox as bytes for the app to persist and
hand back to `restore_cache` at its next start, before any machine starts (with `restore_seen`): JSON
`{version: 1, rows}` of each row's text and state (never `pending`), the top `MAX_CACHED_ROWS` (100)
rows within `MAX_CACHE_BYTES` (64 KiB), a title, ask or command cut at 300 characters. A new cache goes
out when that content changed, at most every `CACHE_INTERVAL` (2 s; a change inside the interval goes
out when it ends, in an update that may carry nothing else), and never before a machine has joined
the phone, so the empty inbox of a launch does not overwrite the stored one. A machine whose lists
have not loaded since the start shows its restored rows (`cached: true`, no `pending`; `NeedsYou` and
`Working` as last known, `Done` and `Idle` by the seen markers); its own rows replace them once its
lists load, and `forget` drops them. Restored rows show only for machines started; bytes of another
version, or not a cache, are refused `InvalidRequest` and change nothing (the next cache replaces
them). **What the person has seen** is `SeenState{markers, read_machines}`. A marker is
`{machine_id, session, seen_at}`, `seen_at` being the row's `updatedAt` when the person looked: `mark_seen`
sets one. `read_machines` are the machines whose history is already marked. `InboxUpdate.seen` carries the
whole state whenever it changed, for the app to persist and hand back to `restore_seen` at its next start,
before it starts any machine. The inbox settles a machine by itself, on a task of the link runtime, the
first time its rows are all in during a run, whether or not the UI reads the inbox: a machine not in
`read_machines` gets a marker for every row (a first pairing does not show its history as done) and joins
them, with or without rows; for one in them, markers of sessions no longer listed are dropped, which keeps
them bounded by the rows. So a session that appears or finishes after that is `Done` however late the UI
looks, and a machine that had no session at its first read is not marked again at the next start.
`next_change()` delivers the rows when they or the seen state changed, at most 30 times a second.
`refresh()` is pull to refresh: each machine whose link is connected and whose bridge agreed on the
protocol reloads every inbox list from its first page, and each machine whose link waits to dial dials
now (a link that is down would only hold the requests until their deadline). It returns once the
reloads are answered; the rows arrive through `next_change()` as always.

## Terminals

`terminal(id)` attaches from the first byte the bridge still holds; one view per terminal per phone (a
second ends the first). `next_update()` returns `Output{data, reset}`: raw bytes that follow the
previous update's with nothing missing or repeated, unless `reset`: the UI clears its emulator, then
writes `data`. The first output has `reset`, and so does a reattach after the bridge no longer held
everything missed (its replay keeps the newest `MAX_TERMINAL_OUTPUT_BYTES`). After a link that started
over the view attaches again from the offset just past the last byte received, so it gets exactly what
it missed. A seq that does not match what was received, or data that is not base64, is a gap: the view
attaches again from the offset received.

A UI that takes nothing (a backgrounded app) never makes the view wait on the bridge: when more than
`MAX_TERMINAL_OUTPUT_BYTES` is waiting, the oldest bytes go, the newest `MAX_TERMINAL_OUTPUT_BYTES` stay,
and the next `Output` has `reset`. The offset received still counts every byte, so live output goes on in
step and nothing is asked of the bridge (a full replay is about as large as the limit, so asking again
would overflow again almost at once, over the relay too). That update's `data` begins at an arbitrary
byte, as a bridge replay after a gap does: inside an escape sequence, or in the middle of a UTF-8
character. The UI writes it as it is and needs no repair:
libghostty's parser is the vt100.net DEC ANSI state machine, which starts in the ground state and has a
transition for every byte, so the tail of a cut sequence prints as the text it is (`31m`), and its UTF-8
decoder replaces an ill-formed sequence with U+FFFD, as Ghostty's `UTF8Decoder.zig` documents (read on
Ghostty `main` on 2026-11-15, not on a pinned libghostty release, and not run). At worst a few stray
characters show at the start of the first line, until a full-screen program redraws on a resize.
The updates end with `Exited{exit_code, signal}` or `Failed{message}`. `input(bytes)` sends the emulator's
bytes in order, `MAX_TERMINAL_INPUT_BYTES` per request; `resize` carries cells and, when known, cell pixels.

## Machines

`start(record)` and `pair(offer)` run a machine; `forget(id)` closes its link session on the machine and
drops its seen markers. A machine paired again replaces the one before, which stops reading its link
session without telling the machine. Dropping the last handle (views, lists and terminals hold one)
stops a machine quietly: the daemon keeps its link session for a later start. `MachineStatus` carries
the link's `Status` (connecting, connected over the LAN or the relay, waiting and why, revoked, closed),
the daemon's bridge status, and the `ContractState`. A machine's events are coalesced (the newest
status, record and backends; one entry per backend status and per invalidation), so the queue is bounded
however long it goes unread.

## Bounds

| What | Bound |
|---|---|
| Callers' requests waiting | 256 |
| A request's wait | `REQUEST_DEADLINE_MS` + 15 s |
| Sessions viewed | 32 |
| Records one subscriber leaves untaken | `MAX_LIST_ITEMS`, then a snapshot |
| Batches | 30 a second |
| A session list | `MAX_CATALOG_ITEMS` rows; the inbox's lists `MAX_PAGE_LIMIT` |
| Catalog caches | 64 entries each |
| Terminal views | `MAX_TERMINALS`; untaken output `MAX_TERMINAL_OUTPUT_BYTES` |
| Seen markers | the inbox's rows |
| Views the inbox holds | 8 per machine |
| The inbox cache | 100 rows, 64 KiB, one every 2 s |

## What the UI does, and does not

- It applies updates as the table says and renders; it never runs a reducer, never derives a run's items
  from events, and never decides whether a session is `NeedsYou`.
- It keeps one pull loop per subscription and cancels it when the screen goes; it closes views it no
  longer shows.
- It builds requests from the generated types and the view's `session()`; it never re-validates an answer
  (the bridge runs `answerProblem`), never answers for the person, and shows `expiresAt` without acting on it.
- When `run` goes from a value to none it reads the transcript's newest page (contract README §8).
- It persists the identity secret, a new machine's `record()` and its `record()` at every `RecordChanged`,
  `InboxUpdate.seen` and `InboxUpdate.cache`.
- It offers Approve and Deny on a row only for `pending.allow` and `pending.deny`, and answers with
  `Inbox.answer` on the person's tap.
- It calls `mark_seen` when the person opens a session and when they leave it.

## Tests

`cargo test -p broski-client`. The unit tests: the update protocol against the reducer trace, coalescing,
pacing and the fall-behind snapshot (`view/tests.rs`); attach, resume, gaps, repeats, replacements and
merges (`view/stream_tests.rs`); terminal offsets, reattach, gaps, the newest kept past the bound, exit (`terminal/state_tests.rs`);
request ids, held order, lost sockets and the bound (`requests.rs`); a request's deadline, the bound on
waiting requests, the client's own requests refused, a closed machine refusing everything, a refused
hello said again after a pause that grows (`machine/tests.rs`, on a machine whose link never comes
up); list paging, row matching and bounds
(`catalog/lists.rs`); invalidation (`catalog/state.rs`); waiting from a thread with no runtime
(`wait.rs`); `Send`/`Sync` (`exported.rs`). The stream and terminal tests ask for an attach as the machine
does, which sends one only for a view that `needs_attach()`, so every `Next::Attach` must leave its view
detached.

The integration tests run the real daemon and relay in-process and the real bridge (Bun,
`packages/bridge/scripts/dev-fake-bridge.ts`, its core serving the contract's fake backend) on the
daemon's unix socket, as a child with a temp `HOME` that is also the only directory it serves, all from
`broski-link-testkit` (`Mac`, `FakeBridge`), which the session and facade crates' tests share; the bridge's dependencies must be installed (`bun install` in
`packages/bridge`). Every wait pulls updates or events; the polls are of a file the terminal writes and, in one inbox test,
of the seen state, which is state and not an update.

- `chat.rs` — a run streams into a view as records and the UI's copy equals the snapshot; the finished run
  is in the transcript; a permission ask is answered once (a second answer is `stale`) and the run
  finishes; queued and steered input land, a start while busy is `busy`, a queued item is cancelled, Stop
  ends the run.
- `resilience.rs` — a phone's link dropped mid-run while the run streams and asks, then restored: the
  link session resumes, the view never reattaches, and its state equals another phone's; a bridge restart
  brings the view back from a snapshot of the new epoch and a run on the new bridge works; a machine that
  starts over resets the link, a request caught by it fails `LinkReset`, and the view resumes its stream.
- `catalog.rs` — rows follow a create, a rename and a delete, and stay out of another directory's list;
  status, models, modes and commands are read and kept; a `load_more` whose future is dropped after one poll
  still lands its page, and the next `load_more` reads the one after.
- `inbox.rs` — a first pairing shows the machine's history as seen; across two machines a session moves
  needs you → done and another working → done, ordered by state then newest first, and `mark_seen` makes
  one idle with the marker the app persists; a session that appears after the history was in but before
  the UI reads the inbox is still done; a machine with no history at its first read, restarted from the
  persisted state, shows a session finished meanwhile as done; a refresh sends one first-page request
  per inbox list (counted through the ids the machine gives its requests) and does not wait on a machine
  whose link is down.
- `inbox_asks.rs` — a permission a terminal-started run asks (the fake bridge's `run`, no phone
  prompting) makes its row need you with the ask, the command and the backend's allow-once and deny,
  with no view the test opened; an option the row does not offer is refused; two answers at once are
  one `Accepted` and one `Stale`; the run finishes and a late answer is `Stale`. Ten waiting sessions:
  the eight newest have their ask, the inbox holds 8 of the 32 views (the app's 25th attach fails), each
  answered from its row lets the next one in, and once none waits the app attaches 32.
- `inbox_cache.rs` — over the relay, a phone restarted with its machine offline shows the cached rows
  (the waiting one `NeedsYou` with its ask and command and no `pending`), the machine's own rows
  replace them once it is back, and `forget` drops them; a forgotten machine takes its cached rows,
  bytes of another version are refused and leave the restored rows in place.

Unit tests: which sessions are held (newest 8, the next one in when one stops waiting, a refused one
not attached again, all let go; a screen's view outliving the hold; `machine/holds_tests.rs`), what a
row offers (`inbox/pending.rs`), an ask offered only while attached (`view/stream_tests.rs`), the cache's
round trip, bounds, interval and version (`inbox/cache.rs`), and no cache before a machine joins
(`inbox/mod.rs`).
- `workspace.rs` — `workspace.info`, `fs.list`, `fs.read` and `git.status` on a temp repository; a terminal
  echoes input and takes a resize; across a machine restart a terminal's view gets exactly the bytes it
  missed, each line once, equal to the bridge's own replay; a program that writes three times what the
  bridge replays while the UI pulls nothing leaves a view that starts over from the newest lines, none
  missing or repeated, and goes on, with the machine sending no request but the test's own (counted
  through the ids the machine gives its requests, which the bridge echoes).

## Limits

- The inbox shows each backend's newest `MAX_PAGE_LIMIT` top-level sessions. A session never marked is
  `Done` once idle (unless its machine's first read marked it).
- `Done` means a row's `updatedAt` moved past the marker, and `updatedAt` is the backend's last-modified
  time, not the end of a run. Pi's is the newest user or assistant message
  (`backends/pi/store/session-head.ts`), which a rename does not move (`live/host-row.ts`). Claude Code's
  is the session file's mtime (`store/enumerate.ts`: the listing orders and pages by it from `stat` alone),
  and `renameSession` appends a `custom-title` entry to that file (the SDK's `sdk.d.ts`), so renaming a
  seen Claude Code session makes it `Done` again; so would a tag. A probe of the pinned SDK (0.3.325) in a
  throwaway config directory moved `lastModified` across a rename. The contract carries no field for the
  end of a run and none was added: the adapter would have to open and scan each session file to fill it,
  which its listing avoids (it reads only the rows of the page asked for), and only Claude Code records a
  run's end at all (a `turn_duration` entry in the file; Pi has none, contract README §11.2). The real
  fix, if the extra `Done` after a rename proves to matter, is a `lastRunEndedAt` on `SessionSummary`
  that both adapters fill (Pi from its newest assistant message), with the marker holding it in place of
  `updatedAt`.
- Live inbox detail (`ask`, `command`, `pending`, a non-blocking interaction) exists only for sessions
  a view is open on: the bridge's catalog rows carry a status, not the interactions. The inbox holds
  views on the 8 newest waiting sessions per machine; an older waiting row shows `NeedsYou` with no ask
  until one of them stops waiting.
- Built in release for `aarch64-apple-ios`, `aarch64-apple-ios-sim` and, with cargo-ndk 4 and NDK
  r28, `aarch64-linux-android`; nothing runs the crate on a device yet.
