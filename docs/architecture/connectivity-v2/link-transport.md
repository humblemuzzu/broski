# link-transport — what the bridge will and will not do to a link socket

The phone reaches the bridge only through `broski-link`: one websocket per phone session on the
unix socket, plus one feed socket (`kind: "link"` / `"link-daemon"`, see
[bridge-feed.md](bridge-feed.md)). Both kinds get the policy below; a socket that arrives through
the loopback TCP listener keeps the behaviour it had.

The principle: **nobody kills a connection because the other side is slow.** A link socket's peer is
the daemon, not the app. The daemon holds the phone's 8 MiB window and, when the phone falls behind,
it stops reading this socket — that is expected, not a fault. The app's own resync loop
(`set_view` + `lastRuntimeSeq`) belongs to the phone, and only the daemon can trigger it.

## Two windows

| | network / loopback TCP | link (unix) |
|---|---|---|
| unsent bytes before the bridge acts | 4 MiB (`BROSKI_WS_BACKPRESSURE_MB`, 128 KiB..64 MiB) | 32 MiB (`BROSKI_LINK_BACKPRESSURE_MB`, clamped 8..256 MiB) |
| pending frames | 4096 | scaled from the byte cap (32 768 at 32 MiB) |
| largest single frame | none | 8 MiB (`BROSKI_LINK_MESSAGE_MB`, clamped 1..16 MiB) |
| close code | `1013 backpressure` | `4013 link overflow` |

A paused link client is never closed at 4 MiB; it closes only once the bridge would have to hand it
more than its own window. `send()` is the single scheduler for both: held deltas, held payloads and
direct writes all read the socket's own limits (`utils/runtime-send-queue.ts`, limits chosen by
`server/link-send-policy.ts`).

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
`getBufferedAmount() + frameBytes <= window`, and closes with `4013 link overflow` when the frame
would not fit. Bun's own limit is therefore never reached, nothing is silently dropped, and the only
close a slow link peer ever sees is the one the bridge chose.

Every other outcome is accounted for the same way: a frame is delivered, held (deltas merged into one
`batch`, payloads queued on `drain`), or the socket is closed with `4013`.

## One frame too large for the link

A reply larger than `linkMessageLimitBytes` is **not** written. The requester gets, with its own
request id:

```json
{"type":"error","code":"response_too_large","requestId":"<the request's id>","bytes":12345678,"limit":8388608,"message":"Response too large for the link; request a smaller page"}
```

and the bridge logs `[Link] response_too_large type=<message type> bytes=<n> limit=<n>`. The check
sits in the send queue, so it covers every reply and every broadcast without per-handler code.
Pre-serialised frames (`sendRaw`, the Pi Durable `sendPayload` path) carry no request id; they get the
same error frame without one, and are never written either. Network sockets have no frame cap: the
phone's own client already refuses what it cannot parse, and their behaviour is unchanged.

A `batch` is only built when the merged frame still fits; otherwise its parts go out as separate
frames. Text deltas are capped at 32 KB by the coalescer long before either limit matters.

## Transcript paging

The shared contract in `types/transcript-page.ts` now covers all four transcript readers, OpenCode
included. `types/transcript-page.ts` names the page; OpenCode's handler and connector implement it:

```json
{"type":"get_session_messages","sessionId":"<id>","projectPath":"<path>","limit":80,"before":"<nextCursor>"}
{"type":"session_messages","data":[...],"sessionId":"<id>","hasMore":true,"nextCursor":"<message id>"}
```

`nextCursor` is the `id` of the oldest message in the page, and `before` names the boundary the next
(older) page ends at, so paging always walks backwards from the tail and a cursor stays valid when
the session grows at the end. No `limit` and no `before` (or a cursor that names no message of that
session) answers the whole transcript with no `hasMore`/`nextCursor` — exactly what an app that sent
no limit saw before, still subject to the 8 MiB frame cap above.

The bridge windows the fetched list itself instead of passing `limit`/`before` to the OpenCode
server: a server that honoured neither would answer the whole transcript (the reply this page exists
to keep small), and one that honoured `before` differently would hand out a boundary the app cannot
resume from (`connectors/opencode/oc-transcript-page.ts`).

## Untouched

Heartbeat (`4000 Heartbeat timeout`), auth, TLS, the daemon feed's own messages (`4001` on replace)
and the network listener's 4 MiB / `1013` shed are unchanged.
