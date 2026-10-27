# link-core — Broski Link connection engine

Crate `packages/link/core` (`broski-link-core`). It joins `broski-link-crypto` (Noise `hybridIK`,
`Transport`) and `broski-link-proto` (`Session`, frames, `Hello`/`Welcome`) into one sans-IO link: no
sockets, no async, no clock. Time arrives as `now_ms` and the caller owns the transport.

`CONFIG` pins `proto::Config::max_frame` to `crypto::MAX_PLAINTEXT` (65519) so that a sealed frame is
at most 65535 bytes — exactly one Noise message. Stream ids: `STREAM_CONTROL` = 0 (link level),
`STREAM_BRIDGE` = 1 (bridge JSON, opaque here).

## Wire sequence

One binary WebSocket message carries exactly one unit.

```
phone (Link client)                        machine (daemon, Link server)
  connect() -> msg1
    [2-byte crypto header][Noise msg1, payload = Hello { resume?, caps: 0 }]
  ---------------------------------------> Link::accept(identity, msg1, pairing_secret)
                                             -> Accepted { peer, mode, resume }
                                           allowlist check on Accepted.peer.id()
                                           Accepted::resume(&mut link) or Accepted::fresh(...)
  msg2 = [Noise msg2, payload = Welcome { session_id, resumed, next_expected, caps: 0 }]
  <---------------------------------------
  handle_wire(msg2) -> Connected { resumed }

  every later message: Transport.seal(one proto frame) / Transport.open -> Session::handle_frame
  <--------------------------------------->
```

## Link state machine

| state | entered by | session | transport | poll_transmit |
|---|---|---|---|---|
| idle | `Link::client` | none | none | `None` |
| handshaking | `connect` | kept, detached | none | `None` |
| connected | msg2, `Accepted::resume`, `Accepted::fresh` | attached | yes | one sealed frame |
| detached | `disconnect` | kept, detached | none | `None` |
| closed | `close`, or a CLOSE from the peer | kept | unchanged | the queued CLOSE only |

`send` works in every state that has a session. While detached the frames wait inside the session and
`attach` re-queues them after the next handshake; a `handle_wire` error means drop the connection.
`poll_timeout`/`handle_timeout` drive acks, PING/PONG and the 45 s `Dead` report.

`unacked_bytes` is the outbound window and the only flow-control surface a caller has: `send` fails
with `Backpressure` rather than growing the window past `max_unacked_bytes`, so a caller watching it
stops reading its source instead of dropping the session. The daemon reads its bridge socket above
8 MiB unacked only after acks take it back under 4 MiB.

## Resume vs fresh

- `connect` puts `Hello { resume: Resume { session_id, next_expected } }` in msg1 whenever a session
  exists, so a first connect sends a 6-byte Hello into a 3576-byte msg1 and a resume sends 30 bytes
  into 3600.
- The machine answers `Welcome`. `resumed = true` only when the offered session id matches the
  session it holds and `Session::attach` accepts the peer's frontier; then both sides attach and only
  the frames the peer missed cross the wire.
- `resumed = false` (no session, unknown id, or a `ResumeMismatch`) means a new session id and a new
  seq space. The client replaces its session, so **every queued and unacked message of the old
  session is dropped** and the app must resync. `Connected { resumed: false }` is that signal, and it
  is also what the first connect reports.
- A mismatch is refused, never repaired: a peer claiming a frontier nobody sent is stale or hostile,
  so `Accepted::resume` returns `Error::Proto(ResumeMismatch)` and the daemon answers with
  `Accepted::fresh`. That is why `resume` takes `&mut self` — the accepted handshake stays usable.
- Deferred: neither side rekeys, migrates, or pauses its session; the daemon's session table is its
  own problem.

## FFI ownership (`packages/link/ffi`, `include/broski_link.h`)

- `BlBuf` is Rust-owned. `bl_buf_free` takes the struct back by value; the pointer is invalid
  afterwards. An empty result has `ptr == NULL, len == 0`, which `bl_buf_free` accepts.
- Input pointers are borrowed for the call only: secrets are copied into `Zeroizing` buffers and the
  identity into the `BlClient`. The library never frees caller memory. NULL is valid only with
  `len == 0`.
- `BlClient` is opaque, owns one `Link` plus the device identity, is not thread-safe, and is freed
  once with `bl_client_free`. Dart wraps it in a `Finalizer`.
- Return codes: 0 ok, -1 invalid argument, -2 protocol/crypto (`bl_last_error` has the message),
  -3 backpressure, -99 panic. `bl_client_poll_transmit` and `bl_client_poll_event` use 1/0 for
  produced/none.
- `bl_client_handle` eats whole wire messages: msg2 first, then one sealed frame each.
- `bl_abi_version` is 2; `bl_sha256` is unchanged.

## Measured

Apple M4 Pro, `cargo test --release --test perf -- --ignored --nocapture`, three runs per cell;
run-to-run variance on this machine is 10 to 30%, so read these as bands.

Core end to end, client to server (send + seal + open + reassembly + acks):

| payload | deflate 6 | deflate 1 | sealed bytes per message at 1 |
|---|---|---|---|
| 64 KiB JSON-like | ~890 MB/s | 1.5 to 1.7 GB/s | 779 |
| 64 KiB random | 47 MB/s | 68 to 76 MB/s | 65612 |
| 200 B message | 5 to 8 us | 5 to 8 us | — |

The 200 B row is the noisiest: a message below the 1024 B threshold never deflates, so the level
cannot move it and the spread is the machine.

`proto` alone, 64 KiB incompressible with the deflate attempt: **87 to 90 MB/s at level 6, 240 to
330 MB/s at level 1**; deflate skipped ~9.5 to 10.5 GB/s and 200 B send ~75 to 81 ns either way,
because neither path deflates. Level 1 costs wire size where it matters — 779 bytes instead of 375
per 64 KiB JSON-like message — and buys 1.8 to 3.7x on the paths that do deflate.
