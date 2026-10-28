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
`isStreaming || isCompacting || isRetrying || pendingMessageCount > 0` — what
`runtime/pi-runtime-bootstrap.ts` already uses. `agent_finished` clears it; `error` deliberately does
not, since a mid-turn error would report a false `done`; a session that never finishes is forgotten by the 30 min session TTL.

| backend | approval | attention | busy |
|---|---|---|---|
| claude-code | `permission_requested` | — (AskUserQuestion is a permission request) | ✓ |
| opencode | `permission_requested` | `user_input_requested` (`question.asked`) | ✓ `session_state_changed` |
| codex | `permission_requested` (`requestApproval`) | `user_input_requested` (elicitation) | ✓ |
| pi | — | — | ✓ |
| pi-durable | `permission_requested` | — | — |

Every kind comes from `BroskiRuntimeEvent`s the bridge already maps; nothing is parsed per backend.

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
| pi-durable | the `requestId` | `pd_permission_response` | `allow` | `deny` |

A request is answerable only while its alert is outstanding: the feed holds one record per announced
id (10 min, 512 ids) and closes it on the first decision, so a repeated tap can never answer twice.
`error` is `unknown backend`, `unknown request`, `already answered`, `unsupported`, `no longer
pending` (the backend had already dropped it), or the handler's own message.

**Unsupported.** `pi` reports no approval, so every `pi` decision is refused with `unsupported`. So
is a request that needs an *answer* rather than a decision — an `attention` alert, and Claude Code's
`AskUserQuestion`, whose reply is that question's own input.

## Tap points

`tapRuntimeEvent(event)` sits where a *complete* event leaves the mapping layer. The mappers build the
envelope with `enrichRuntimeEvent` and only then spread `request`/`delta` onto it, so the tap is at
each envelope site instead: `server/streams.ts`'s coalescer callback (Claude Code, Codex, Pi,
hand-built broadcasts), `server/opencode-events.ts`'s `enqueueSdkEvent`, and
`handlers/pi_durable/transport.ts`'s `broadcastPiDurablePermission`.

## Known gaps

- **Pi approvals/input.** Pi maps permission prompts and extension dialogs to `backend_event`
  (`extension-ui-request`), so they produce no alert.
- **Pi busy.** `ensureStreamBridge` is created per cwd by the first request that touches it, so a Pi
  session started in a cwd the bridge has never served is invisible.
- **Pi Durable busy/done.** Durable events are mapped per attached socket
  (`attachPiDurableView` → `host.watch`), so no phone watching means no stream; its approvals do
  reach the feed, without a cwd.
