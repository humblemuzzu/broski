# link-transport — what the bridge will and will not do to a link socket

The phone reaches the bridge only through `broski-link`: one websocket per phone session on the
unix socket, plus one feed socket (`kind: "link"` / `"link-daemon"`, see
[bridge-feed.md](bridge-feed.md)). The phone-facing kind carries the policy below; the feed writes
its own bounded frames (see the end). A socket that arrives through the loopback TCP listener keeps
the behaviour it had.

The principle: **nobody kills a connection because the other side is slow.** A link socket's peer is
the daemon, not the app. The daemon holds the phone's 16 MiB window, stops reading this socket once
that window is 8 MiB full, and starts again below 4 MiB — that is expected, not a fault. Closing the socket does not make the
app resync either: only the daemon can tell the phone to.

## Two windows

| | network / loopback TCP | link (unix) |
|---|---|---|
| unsent bytes before the bridge acts | 4 MiB (`NETWORK_MAX_PENDING_BYTES`) | 32 MiB (`BROSKI_LINK_BACKPRESSURE_MB`, clamped 8..256 MiB) |
| frames the queue holds while that window is full | — (shed at the 4 MiB) | up to one more window of 32 MiB (`maxHeldBytes`) |
| pending frames | 4096 | scaled from the byte cap (32 768 at 32 MiB) |
| largest single frame | none | 8 MiB (`BROSKI_LINK_MESSAGE_MB`, clamped 1..8 MiB) |
| close code | `1013 backpressure` | `4013 link overflow` |

`BROSKI_WS_BACKPRESSURE_MB` sets Bun's own `backpressureLimit` for the network listener; the shed
above is the queue's `NETWORK_MAX_PENDING_BYTES`, which is what closes a `1013`. For a link socket
Bun's guard is off and the queue enforces its own window.

A paused link client is never closed at 4 MiB; it closes only once the bridge holds more for it than its own
window plus the second window of held frames. One queue (`transport/send-queue.ts`, over `transport/socket-sender.ts`)
is the single scheduler for every frame the phone sees: direct writes and held frames read the socket's own limits, and
the limits themselves come from `server/link-send-policy.ts`.

## Bun semantics this relies on

From `bun-types/serve.d.ts`:

- `send()` returns a `ServerWebSocketSendStatus`: `0` means the message was **dropped**, `-1` means
  **backpressure** was applied, `> 0` is the number of bytes sent. `-1` does **not** mean the frame
  was held — uWS drops a message once the socket is at its `backpressureLimit`, which is why the
  bridge never lets a link socket get there.
- `getBufferedAmount()` reports the bytes Bun still has buffered for the socket.
- `backpressureLimit` is "the maximum number of bytes that can be buffered on a single connection";
  `closeOnBackpressureLimit` is "whether to close the connection when `backpressureLimit` is
  reached", default `false`, and Bun chooses that close code itself — never 4013.

So the link ingress sets `backpressureLimit` to the link window and `closeOnBackpressureLimit:
false` (`startLinkIngress` spreads `connections.websocketConfig` and overrides only those two), and
the send queue enforces the window instead: before writing a frame to a link socket it checks
`getBufferedAmount() + frameBytes <= window`. A frame that would not fit is **held** in the queue, behind
anything already held so nothing overtakes it, and written when the daemon has read (`drain`, retried every
16 ms). Bun's own limit is therefore never reached and nothing is silently dropped.

The daemon stops reading the socket whenever the phone's window is full, so a burst of requests that arrives
together (an app that reconnects with a queue of them) is answered faster than it can be sent. That burst is
held, not punished: the socket is closed with `4013 link overflow` only when the held frames themselves reach a
second window (`maxHeldBytes`, 32 MiB) or their count reaches the frame cap. The log line
names the numbers — `[Link] Closing link socket (overflow) buffered=…B held=…B frames=…` — and nothing
else, so a close can be traced to what was queued.

Every other outcome is accounted for the same way: a frame is delivered, held (queued until `drain`), or the socket is
closed with `4013`.

## One frame too large for the link

The bridge core fits every message to `linkMessageLimitBytes` before it reaches the queue (core README §9), so a frame
past the limit is a fault, not a case the queue serves. The queue still refuses one on a link socket: it is **not**
written, and the bridge logs `[Link] frame too large for the link: bytes=<n> limit=<n>` (`onTooLarge` in
`server/state.ts`). Anything already held is written first, so a refusal can never overtake the frames produced before
it. Network sockets have no frame cap.

The feed socket is not on this path at all: it writes its own bounded frames, whose title and body
`server/link-feed/format.ts` truncates.

Paged reads (`sessions.list`, `transcript.read`) have no page contract of their own on the link: a page is read again
with a smaller size when it is too large (core README §9, step 5), and the cursor rules are the contract's (contract
README §11.1).

## Idle sockets

A client socket that stays silent is closed by Bun's `idleTimeout` (`BROSKI_WS_IDLE_TIMEOUT_SECONDS`, clamped 30..600,
120 s by default). For a link socket that closes the bridge's side of the daemon's socket, not the phone's link
session: the daemon hands its queue back and redials, and the phone resyncs on the `conn` change
([daemon.md](daemon.md)). The daemon's own feed answers `link_feed_ping` with `link_feed_pong`.

## Untouched

Auth, TLS, the daemon feed's own messages (`4001` on replace) and the network listener's 4 MiB /
`1013` shed are unchanged.

## Every limit, where it lives, and who must match

| Limit | Value | Authoritative source | Mirrored by, which must not exceed it |
|---|---|---|---|
| link unacked window | 16 MiB | `Config.max_unacked_bytes`, `packages/link/proto/src/config.rs` | — |
| largest whole frame | 64 KiB ciphertext | `CONFIG.max_frame` = `crypto::MAX_PLAINTEXT`, `packages/link/core/src/lib.rs` | — |
| largest link message | 32 MiB | `Config.max_message`, `packages/link/proto/src/config.rs` | — |
| session bridge read gate | 8 MiB high / 4 MiB low | `BRIDGE_READ_HIGH`/`_LOW` = window ÷ 2 and ÷ 4, `packages/link/daemon/src/limits.rs` | — |
| one bridge message | 8 MiB | `LINK_MAX_MESSAGE_BYTES` = the read gate, `packages/link/daemon/src/limits.rs` | `BROSKI_LINK_MESSAGE_MB` (`server/limits.ts`, clamped 1..8) |
| bridge queue while the bridge is down | 16 MiB (4002) | `BRIDGE_PENDING_BYTES` = the window, `packages/link/daemon/src/limits.rs` | — |
| link send window (bridge side) | 32 MiB | `BROSKI_LINK_BACKPRESSURE_MB`, `server/limits.ts` | — |
| network unsent budget | 4 MiB (1013) | `NETWORK_MAX_PENDING_BYTES`, `transport/send-limits.ts` | — |

Only the row with a mirror has to agree: the bridge never builds a frame the daemon would have to drop. The phone
side's own limits belong to the client core (`docs/rebuild/PLAN.md`, Phase 3). Everything else is a budget of its own.
