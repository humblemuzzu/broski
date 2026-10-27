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
| pending frames | 4096 | scaled from the byte cap (32 768 at 32 MiB) |
| largest single frame | none | 8 MiB (`BROSKI_LINK_MESSAGE_MB`, clamped 1..8 MiB) |
| close code | `1013 backpressure` | `4013 link overflow` |

`BROSKI_WS_BACKPRESSURE_MB` sets Bun's own `backpressureLimit` for the network listener; the shed
above is the queue's `NETWORK_MAX_PENDING_BYTES`, which is what closes a `1013`. For a link socket
Bun's guard is off and the queue enforces its own window.

A paused link client is never closed at 4 MiB; it closes only once the bridge would have to hand it
more than its own window. One queue (`utils/runtime-send-queue.ts`) is the single scheduler for the
reply paths the phone sees: held deltas, held payloads, direct writes and broadcasts all read the
socket's own limits, and the limits themselves come from `server/link-send-policy.ts`.

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
request id (and without one when the frame is pre-serialised and its caller passed none):

```json
{"type":"error","code":"response_too_large","requestId":"<the request's id>","bytes":12345678,"limit":8388608,"message":"Response too large for the link; request a smaller page"}
```

and the bridge logs `[Link] response_too_large type=<message type> bytes=<n> limit=<n>`. The check
sits in the send queue, so it covers every reply and every broadcast without per-handler code.
Pre-serialised frames carry the request id their caller gives them (`sendRaw` has none, the Pi
Durable `sendPayload` path passes the reply's own), and are never written either. Anything already
held is written first, so a refusal can never overtake the frames produced before it.

A `runtime_event` is the exception: it is **shrunk** instead of refused, because a dropped
`tool_finished` or `agent_finished` leaves a card running or a turn spinning forever. The largest
string in its `data` is cut to fit — tool output, result, content, text — and replaced with
`"…[truncated by the bridge: <n> bytes]"`, with `truncated: true` on the event and on its `data`.
An event with nothing string-shaped left to cut goes out as its type and ids only, still marked
`truncated`. Network sockets have no frame cap: the phone's own client already refuses what it
cannot parse, and their behaviour is unchanged. The
feed socket is not on this path at all: it writes its own bounded frames, whose title and body
`server/link-feed/format.ts` truncates.

A `batch` is only built when the merged frame still fits; otherwise its parts go out as separate
frames. Text deltas are capped at 32 KB by the coalescer long before either limit matters.

## Transcript paging

The shared contract in `types/transcript-page.ts` covers all four transcript readers, OpenCode
included, so the app pages every backend's history the same way:

```json
{"type":"get_session_messages","sessionId":"<id>","projectPath":"<path>","limit":80,"before":"<nextCursor>"}
{"type":"session_messages","data":[...],"sessionId":"<id>","hasMore":true,"nextCursor":"<message id>"}
```

`nextCursor` is the `id` of the oldest message in the page, and `before` names the boundary the next
(older) page ends at, so paging always walks backwards from the tail and a cursor stays valid when
the session grows at the end. A cursor that names the oldest message answers an empty page with
`hasMore: false`. No `limit` and no `before` answers the whole transcript with no
`hasMore`/`nextCursor`, exactly what an app that sent no limit saw before, still subject to the 8 MiB
frame cap above.

A page is **turn-aligned**: it starts at the message that opened its oldest turn, not at the `limit`th
message from the tail, so a page never opens on an answer whose prompt is still on the page before
it. `utils/turn-aligned-page.ts` is the one cut every reader uses — Pi and Codex user turns, Claude
Code prompts that are not tool-result carriers, OpenCode user messages. The step back is bounded by
`TURN_EXTENSION_MAX` (200) messages, so a page is at most `limit + 200` messages, and a turn longer
than that opens mid-turn: the rest of it is one page away.

A page is also measured in bytes before it is answered (`utils/transcript-page-fit.ts`): the newest
messages that fit `TRANSCRIPT_PAGE_MAX_BYTES` (6 MiB, leaving the 8 MiB frame room for the envelope)
are kept, and a single message larger than a whole page is cut down with
`…[truncated by the bridge: <n> bytes]` instead of being dropped or failing the page. Cutting the
page by bytes happens after the turn cut, so a page whose turn does not fit the frame opens mid-turn
rather than never arriving.

A page's `nextCursor` names the boundary of what was **actually returned**, after the turn extension
and any byte trimming, so the next page ends exactly where this one begins: no gap, no duplicate.

A Pi transcript pages the session's whole leaf-to-root path, not the agent's compaction-cut context:
a compaction is a `compactionSummary` marker at the point it happened and the entries it summarised
stay above it, so the first prompt of a long compacted session is reachable. A `context_edit` is
applied to the entry it rewrites rather than paging the session's edited and unedited text. When the
tree cannot be trusted (a non-string id, a looping parent chain) the file is paged in written order.

A cursor that names no message of that session (the session was rewound, compacted, or the app is
looking at another one) answers the **newest** page with `cursorUnknown: true` from the same single
fetch, for every backend including Pi. The app replaces its transcript with that page instead of
prepending a page that does not sit before what it holds.

The bridge windows the fetched list itself instead of passing `limit`/`before` to the OpenCode
server: a server that honoured neither would answer the whole transcript (the reply this page exists
to keep small), and one that honoured `before` differently would hand out a boundary the app cannot
resume from (`connectors/opencode/oc-transcript-page.ts`).

## Session list paging

Every list of sessions, threads or projects takes the same page contract as a transcript, so one
reply can never grow with the number of sessions a machine has recorded:

```json
{"type":"pi_list_sessions","limit":100,"before":"<nextCursor>"}
{"type":"pi_sessions","data":[...],"hasMore":true,"nextCursor":"<opaque>"}
```

`pi_list_sessions`/`pi_sessions`, `cc_list_sessions`/`cc_sessions`, `cx_list_threads`/`cx_threads`,
OpenCode's `list_sessions`/`sessions` and `unified_list_sessions`/`unified_sessions` all use it, out
of one implementation (`utils/session-list-page.ts`). `limit` defaults to 100 and is clamped to 500.
Rows are ordered newest-modified first with `id` breaking ties, and `nextCursor` is base64url of
`[modified, id]` — a place in that order, not a distance from the top, so a session created between
two pages is neither duplicated nor skipped: it sorts above the cursor and appears on the next first
page. A cursor this bridge did not mint answers the newest page. No `limit` and no `before` answers
the whole list with no `hasMore`/`nextCursor`, as before.

A list row carries a preview, never the whole first message: every free-text preview field is cut to
`SESSION_PREVIEW_MAX_CHARS` (280, code points, with `…`) by `utils/session-preview.ts`. The Pi
`firstMessage`, a Codex `preview` and every runtime `title` go through it. OpenCode summaries also
drop the file-sized parts of a diff (`summary.diffs[].before`/`after`, `revert.diff`/`snapshot`) and
the fields the app never reads.

A session list is never broadcast whole. A state change that used to re-send `runtime_sessions` for
every session sends one row instead:

```json
{"type":"runtime_session_updated","backend":"pi","session":{...}}
{"type":"runtime_session_removed","backend":"pi","sessionId":"<id>"}
```

The app upserts or drops that row in its cached list, which also stops the poll loop the old
broadcast caused (a whole-list broadcast made the app invalidate the list, which re-read it).

## Untouched

Heartbeat (`4000 Heartbeat timeout`), auth, TLS, the daemon feed's own messages (`4001` on replace)
and the network listener's 4 MiB / `1013` shed are unchanged.

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
| phone outbound queue | 8 MiB | `linkOutboundQueueMax`, `packages/link_dart/lib/src/connection/link_outbound_queue.dart` | — |
| phone inbound frame | 15 MiB | `_maxIncomingMessageBytes`, `lib/services/websocket_service.dart` | — |

Only the two rows with a mirror have to agree: the bridge never builds a frame the daemon would
have to drop, and the phone's queue stays inside the window it sends into. Everything else is a
budget of its own, and a message a limit refuses is reported to its sender rather than dropped.
