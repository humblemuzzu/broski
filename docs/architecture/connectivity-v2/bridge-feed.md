# bridge-feed — the daemon's activity feed on the link socket

The Rust `broski-link` daemon must know what the machine's agents are doing while no phone is
attached: to push when one needs approval or finishes, and to keep the machine awake (`watch`).
What the bridge may send on this socket, and how far behind it may let the daemon fall, is in
[link-transport.md](link-transport.md).

## Connection

Upgrade the link unix socket with `x-broski-role: link-daemon` and the key the daemon wrote to
`~/.broski/link/bridge.key` in `x-broski-link-key`; no device id is required and a present one is
ignored.

The key is what a unix socket file cannot be: the socket is owner-only, but any process running as
the same user can still reach it. The daemon rewrites 32 random bytes, hex, mode `0600`, at every
start and passes `--link-key-file` to the bridge it supervises; the bridge re-reads that file on
every upgrade (so a bridge that outlives a daemon restart follows the new key without one of its
own) and answers **403** for a missing or wrong key, logging the rejection and never the key. A
bridge started without a key file is the dev case: it keeps the old unkeyed behaviour and says so
once. The feed is no device — out of `state.sockets`, no broadcasts, not counted
against `linkMaxClients`, no bridge requests — and everything it writes is ignored except
`{"type":"link_feed_ping"}` → `{"type":"link_feed_pong"}` and `link_decision`. One at a time: a new
feed closes the old with **4001**.

## Messages

```json
{"type":"link_busy","busy":true}
{"type":"link_event","kind":"approval","backend":"claude-code","session":"<id>","cwd":"<basename>","title":"<≤80>","body":"<≤200>","at":<unix ms>,"request":"<id>"}
```

A frame the feed cannot take is never held: Bun reports a dropped send (`0`) or one over the
socket's `backpressureLimit` (`-1`), and the bridge closes the feed with **4013** instead, so the
daemon redials a clean one rather than losing an alert in silence.

A feed that attaches is told everything it missed that is still true: `link_busy` with the current
value, then — byte for byte as they first went out — every `link_event` whose request is still
outstanding. An approval the phone may not have seen before the socket dropped reaches the daemon
again instead of being forgotten; one that was answered is not repeated.

`link_busy` goes out on connect with the current value, then on every change: `true` immediately,
`false` after a 3 s debounce so a handover between sessions does not flap. `kind` is `approval`
(pending permission request), `attention` (user input requested) or `done` (busy → idle for 5 s, body
= first line of the final answer). Once per request id; `cwd` is the basename, title and body are
single-line, truncated, with no secrets or file contents. `request` is on `approval` and `attention`
only: it is the id a decision on this alert must echo.

## Busy

Working means `agent_started`, or a `session_state_changed` whose state satisfies
`isStreaming || isCompacting || isRetrying || pendingMessageCount > 0`. `agent_finished` clears it; `error` deliberately does
not, since a mid-turn error would report a false `done`; a session that never finishes is forgotten by the 30 min session TTL.

| backend | approval | attention | busy |
|---|---|---|---|
| claude-code | `permission_requested` | — (AskUserQuestion is a permission request) | ✓ |
| opencode | `permission_requested` | `user_input_requested` (`question.asked`) | ✓ `session_state_changed` |
| codex | `permission_requested` (`requestApproval`) | `user_input_requested` (elicitation) | ✓ |
| pi (contract) | a pending `tool_permission` interaction | every other pending interaction | ✓ an active run |

Every kind of the first three comes from `BroskiRuntimeEvent`s the bridge already maps; nothing is parsed per backend. A
backend served through the contract (Pi) never produces one: its sessions reach the feed through the core's observer
(below).

## Contract sessions

The core (`src/core/`, [core README](../core/README.md) §19) tells an observer of every event of every session it has open,
with the live state before and after the event and a way to read the session's row from its backend (`describe()`: title,
cwd; nothing when the backend gives none or does not answer in time). The seam installs
`server/link-feed/feed.ts`'s `contractFeedObserver`; `contract-tap.ts` turns what it sees into the feed's messages, and
the same `LinkFeedTracker` and `LinkFeedRequests` carry them, so debounce, once-per-id and the 30 min TTL are the ones above.
`backend` is the session's backend id (`pi`) and `session` its session id; both reach the phone in the push, which is how a
tap finds the conversation.

| What the core observed | The feed says |
|---|---|
| a run is active (`after.run`) | `link_busy true` (idempotent per event, so a session whose track was forgotten, or whose snapshot was replaced by a `resynced`, is busy again) |
| `run_finished` with outcome `completed` | busy clears (3 s debounce); after 5 s idle one `done`, body = first line of the newest top-level `text` block of the run (an open block is newer than a finished one; thinking and subagent blocks never); a run with no text, such as a `!` command, is told by its newest top-level call (`bash: npm test`, with `(exit code N)` when that was not 0); `Turn finished` when there is neither. The alert's `at` is the time the core observed the run end |
| `run_finished` `error` / `limit` | `done` with `Run failed: <code>` / `Run stopped at its <limit> limit` — the backend's message is never quoted |
| `run_finished` `aborted` / `suspended` / `deferred`, or a `resynced` that drops the run | busy clears, no `done`: the person stopped it, or it will resume |
| a new run within the 5 s | no `done` (the timer is cleared by the run) |
| a pending interaction of kind `tool_permission` | `approval`, `request` = the interaction id; body = `<tool>: <command, paths or host from the preview>`, else the input's quotable keys, else the reason/title. File changes are named by path, never by diff |
| any other pending interaction (`questions`, `form`, `plan_approval`, `external_url`, `choice`, `confirm`, `text`) | `attention`, `request` = the interaction id; body = its title, else its body |
| the interaction ends for any reason (`answered`, `withdrawn`, `expired`, `cancelled`), seen as `interaction_resolved` or as a `resynced` that no longer holds it | the alert's record is closed: no decision reaches it (`no longer pending`) and a redialing feed is not told of it again |

`title` is `<session title, or the backend's name> — <what happened>` (`finished`, `needs approval`, `needs input`,
`stopped with an error`, `stopped at a limit`), the name cut to 50 characters; `cwd` is the basename of the session's cwd.
The daemon's push carries `title`, `body`, `backend`, `session` and `request` but not `cwd`, so the title is what tells two
sessions of one backend apart.

A new interaction is announced once its session's row has been read (`describe()` is asynchronous); one that ends in that
time is never announced.

**Only sessions the core has open are seen.** A session is open while a phone views it and while it has work in flight
(a run, an ask, a compaction, a retry, queued input — the keep-open rule), so a run started from a phone or a pending
approval is always seen; a session nobody attached to since the bridge started, whose run a terminal `pi` began, is not
until the core opens it.

## Decisions

The feed is the one connection allowed to answer a pending request; a device socket's
`link_decision` is an unknown message like any other. The answer is applied by synthesizing the
exact message the phone sends for that backend and pushing it through the same message registry, so
no per-backend decision logic exists here.

```json
{"type":"link_decision","backend":"claude-code","session":"<id>","request":"<id>","decision":"allow"|"deny"}
{"type":"link_decision_result","request":"<id>","ok":true|false,"error":"<short>"|null}
```

`allow` is allow-once — the grant a single tap gives on the phone, never an always-allow.

| backend | `request` is | synthesized message | allow | deny |
|---|---|---|---|---|
| claude-code | the `toolUseId` | `cc_permission_response` | `once` | `reject` |
| opencode | the permission `id` | `permission_response` | `once` | `reject` |
| codex | the `requestId` | `cx_permission_response` | `once` | `reject` |
| pi (contract) | the interaction id | `CoreSeam.answer` → the core's interaction desk | the request's plain allow-once option | the request's plain deny-once option |

A decision on a contract session does not go through the message registry: the record the alert left in
`LinkFeedRequests` carries the session, the interaction and the two replies the verdicts stand for, built when the alert
was made (`contract-replies.ts`):

- **allow** is the option with `effect: allow`, `scope: once`, that does not stop the run and needs no message — never a
  `turn`, `session` or `always` grant. It grants every item of a requested permission profile, since an allow must grant
  a non-empty subset. It is not given at all when the request is `deliberate` (the contract: the UI must not offer a
  one-tap answer) or has no such option.
- **deny** is the `deny`, `once` option that does not stop the run and needs no message.
- A verdict without a reply is `unsupported`.

The reply goes to `BridgeCore.answer(session, answer)`: a person's answer from outside the phones attached to the session.
It meets the checks a phone's meets — `answerProblem` against the live interaction before any adapter sees it, first answer
wins, a rejected answer releases the claim — and a deadline (120 s, then `backend_error`). The feed never answers by
itself: a verdict is the daemon relaying a person's tap. The feed's own record closes at the first decision (as above), so a
repeat tap is `already answered` before it reaches the core; it opens again when the core could not apply the verdict
for a passing reason (`busy`, `backend_error`, any rejection but the three below), so the next tap can answer.

| the core's answer | `error` |
|---|---|
| accepted | `null` (`ok: true`) |
| `stale`, `not_found`, `closed` (answered on a phone meanwhile, withdrawn, the session closed) | `no longer pending`, and the record stays closed |
| `invalid_input` (`answerProblem` refused it) and any other rejection | the rejection's message |

For a contract record the checks run in this order: `already answered`, `no longer pending` (taken back by the backend or
answered elsewhere), `unsupported` (an `attention` alert, or a verdict without a reply). A backend the contract names but
the feed was never told of a request for is `unknown request`.

A request is answerable only while its alert is outstanding: the feed holds one record per announced
id (10 min, 512 ids) and closes it on the first decision, so a repeated tap can never answer twice.
`error` is `unknown backend`, `unknown request`, `already answered`, `unsupported`, `no longer
pending` (the backend had already dropped it), or the handler's own message.

**Unsupported.** A backend the feed does not know is refused with `unknown backend`; `unsupported` is
a request that needs an *answer* rather than a decision — an `attention` alert, and Claude Code's
`AskUserQuestion`, whose reply is that question's own input.

## Tap points

Contract sessions: `contractFeedObserver` (`server/link-feed/feed.ts`), handed to `BridgeCore` by
`server/contract-seam.ts` as its `observer`; the core calls it from the hub, after an event has reached every viewer
(core README §19). The seam's `answer` is passed to `attachLinkDecisionPath` by `server.ts`.

Runtime events: `tapRuntimeEvent(event)` sits where a *complete* event leaves the mapping layer. The mappers build the
envelope with `enrichRuntimeEvent` and only then spread `request`/`delta` onto it, so the tap is at
each envelope site instead: `server/streams.ts`'s coalescer callback (Claude Code, Codex,
hand-built broadcasts) and `server/opencode-events.ts`'s `enqueueSdkEvent`.

## Known gaps

- **A session no phone has opened, and none the keep-open rule holds, is not observed.** A run that a terminal `pi` starts on
  a session the bridge has not opened produces no alert until the core opens the session.
- **A replaced session's open alerts are not followed.** After `session_replaced` the pending interactions live on under the
  new session id, but the feed's records name the old one: a decision on them is `no longer pending`.
- **The alert is closed on the bridge only.** The daemon is not told that an approval was taken back: a notification already
  on a lock screen stays until the person acts on it, and then gets `no longer pending`.
