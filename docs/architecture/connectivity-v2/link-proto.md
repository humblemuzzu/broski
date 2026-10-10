# link-proto — Broski Link framing and reliability

Crate `packages/link/proto` (`broski-link-proto`). Library only, sans-IO: no sockets, no tasks, no
clock — time arrives as `now_ms`. One `Session` is one logical phone-to-machine session and outlives
connections. Each connection runs its own Noise handshake; after it, every Noise transport message
carries one link frame. `max_frame` is 65000 by default, 65519 (`MAX_PLAINTEXT`) in the running engine.

## Frame (plaintext inside one Noise message)

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | kind |
| 1 | 1 | flags |
| 2 | 4 | stream (BE u32) |
| 6 | 8 | seq (BE u64) |
| 14 | 8 | ack (BE u64) |
| 22 | .. | payload |

| Kind | Value | Payload |
|---|---|---|
| DATA | 1 | one message fragment |
| ACK | 2 | empty |
| PING | 3 | empty |
| PONG | 4 | empty |
| CLOSE | 5 | reason code, BE u16 |

Flags: bit0 `MORE` (the message continues in the next DATA frame), bit1 `DEFLATE` (the *reassembled*
message is raw deflate). Every other flag bit, every unlisted kind, a frame shorter than the 22-byte
header and a frame longer than `max_frame` are decode errors. `ack` is on every frame; `seq` is
meaningful on DATA only and is 0 elsewhere.

## Hello / Welcome (handshake payloads)

Hello is 6 bytes, 30 when resuming:

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | version = 1 |
| 1 | 1 | flags, bit0 = resume present |
| 2 | 4 | caps |
| 6 | 16 | resume: session id |
| 22 | 8 | resume: next_expected |

Welcome is 30 bytes: version = 1, flags with bit0 = resumed, session id (16), `next_expected` (BE
u64), caps (BE u32). Both are strict — wrong version, reserved bits, short buffer, trailing bytes all
fail. `caps` is opaque to this crate.

## Ordering and fragmentation

All streams share one seq space per session, and one message's fragments are never interleaved with
another's. `send` assigns consecutive seqs, sets `MORE` on every fragment but the last, compresses
the whole message when that shrinks it, and buffers the encoded frames. A receiver accepts only
`seq == next_expected`: below is a duplicate (dropped, acked again), above is an error, because a
connection delivers frames in order — a gap is a bug or an attack.

## Acks

- A standalone ACK carries `next_expected`. It is queued at once after `ack_every_frames` (16) or
  `ack_every_bytes` (64 KiB) of DATA since the last ack, at the next timeout for a duplicate or once
  `ack_delay_ms` (25) has passed, and never for less than one DATA frame.
- Every transmitted frame carries the sender's current `next_expected`, patched in at transmit time,
  and counts as acking — a frame sent while a delayed ack is pending releases it.
- An ack drops every unacked frame below it from both the retransmit buffer and the send queue; an
  ack past what was ever sent is clamped to `next_seq`.

## Keepalive

- Nothing transmitted for `ping_idle_ms` (15 s) queues a PING; every transmitted frame, and the PING
  itself, restarts that timer.
- Nothing received for `dead_after_ms` (45 s) emits `Event::Dead` once. Any received frame starts a
  new silence, which may report again. PING is answered with PONG.

## Resume

1. The connection dies. Both sides `detach()`: unsent frames and the timers go, the unacked buffer,
   the receive frontier and a half-reassembled message stay.
2. Handshake again with Noise. The phone's `Hello` carries `resume { session_id, next_expected }`
   for the session it wants back.
3. The machine answers `Welcome { session_id, resumed, next_expected, caps }`. `resumed = true` means
   the id matched and the window check below passed; `false` means the caller starts a fresh session.
4. Each side calls `attach(peer_next_expected)`: frames below that seq were received and are dropped,
   everything from there to `next_seq` is re-queued in order carrying a fresh ack, and the idle and
   dead timers restart at `now_ms`.
5. `peer_next_expected > next_seq` (the peer saw frames this session never sent) or `< base_seq` (it
   is behind a window already released as received) is `Error::ResumeMismatch`; the caller starts a
   new session, so a stale peer or a restarted process can never resume into the wrong stream.
6. Frames the receiver missed are retransmitted from the sender's buffer; the receiver drops any
   duplicate by seq. Nothing is lost, nothing arrives twice, order holds — verified by a test that
   drops the connection 50 times at random points during 500 messages.

## Limits

| Bound | Default | Enforced |
|---|---|---|
| frame | 65519 engine / 65000 crate | decode rejects longer; `send` fits payloads into `max_frame - 22` |
| message | 32 MiB | reassembly buffer and inflate output, both checked before growing |
| unacked bytes | 16 MiB | `send` returns `Backpressure` and queues nothing |
| deflate | level 1, threshold 1024 B | attempted at or above the threshold, used only if smaller |
| ack / ping / dead | 25 ms / 15 s / 45 s | timers only, no wire cost |

`Backpressure` is the bridge's shedding signal: it drops or resyncs rather than growing without
bound.

## Why ordered per connection, and why resume

Noise records must be opened in order, exactly once, so a relay cannot reorder or replay anything on
a connection — that is why a seq gap is fatal instead of a reason to buffer. Loss is therefore a
*connection* event: home Wi-Fi dies, mobile data through the relay comes up, and the session survives
because both ends speak the resume handshake and retransmit the small window they were holding.
Keeping the fast path a counter check and making resume the only recovery path is what lets a phone
that walks out of the house keep its session.

## Measured

Apple M4 Pro, `cargo test --release -p broski-link-proto --test perf -- --ignored --nocapture`:

- 64 KiB messages, deflate attempted (level 1, incompressible payload): **~335 MB/s**, ~185 µs per send
- 64 KiB messages, deflate skipped (`compress_threshold = usize::MAX`): **~13.5 GB/s**, ~4.5 µs per send
- 200 B messages: **~70 ns** per send
- Deflate still dominates incompressible payloads; raise `compress_threshold` for those streams.
