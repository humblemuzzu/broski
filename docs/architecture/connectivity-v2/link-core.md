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

## Finding the machine on the LAN

The daemon advertises DNS-SD service `_broski-link._tcp` in `local.` on its LAN listener port, with
TXT `id=<32-hex machine id>` and `v=1`. That is what the phone browses when the routes its machine
record holds do not answer.

```
link status: not connected, or connected over the relay
  -> LinkDiscovery (lib/services/link/discovery/)
       browse 3 s (linkDiscoveryWindow) with the platform's own Bonjour
       keep only adverts whose TXT id is the machine's, and whose v is 1
       routes = "<host>:<port>" for what is left
  -> machine record grows those routes (machine_store), and the isolate gets them
     through LinkConnection.updateEndpoint as LinkSetEndpoint
```

Browsing is the platform's, not a socket: `NWBrowser` on Apple platforms and `NsdManager` on
Android, through `bonsoir`, on the **main isolate** — a platform channel cannot live in the link
isolate, so the main isolate browses and the isolate is told about the result. iOS needs
`_broski-link._tcp` in `NSBonjourServices`; Android needs nothing beyond the plugin's own manifest
(`CHANGE_WIFI_MULTICAST_STATE`).

An advert is a hint and nothing more. The Noise handshake authenticates the machine on the socket,
so a spoofed advert costs a dial that fails in `msg2`, never a session with something else. What
answers is written into the record, so the next connect tries it first, and discovery is rate
limited (`linkDiscoveryInterval`) and skipped entirely while the link already carries LAN.

`browseHelps` and `DiscoveryScheduler` (`discovery_scheduler.dart`) are the decision, and
`LinkDiscovery` (`link_discovery.dart`) is the browse: one at a time, filtered, persisted. A status
change, a network change and a resume are the three things that ask it to look again.

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
  -3 backpressure, -4 not ready (no handshake has completed), -99 panic.
  `bl_client_poll_transmit` and `bl_client_poll_event` use 1/0 for produced/none.
- `bl_client_handle` eats whole wire messages: msg2 first, then one sealed frame each.
- `bl_abi_version` is 3; `bl_sha256` is unchanged.

## The phone's Dart API (`packages/link_dart`)

`LinkConnection` owns the isolate; these are what the app sees.

| Member | Carries |
|---|---|
| `status` | `LinkStatus`: state, route, `lastSeen`, `resumed`, `sessionReset`, `closeCode` |
| `bridgeStatus` | `BridgeLinkStatus { state, conn, detail }` from control `{"t":"bridge"}` |
| `sendFailures` | `LinkSendFailure { reason, stream, bytes, count, tag }` for every message the link did not send |
| `control` | the raw control maps, including `t:"bridge"` and `t:"routes"` |
| `sendBridge` / `sendControl` | fire and forget; a refusal arrives on `sendFailures` |

`sendFailures.reason` is `queueFull`, `tooLarge`, `rejected` or `sessionReset`, so
the app can tell a busy phone from a message the protocol cannot carry. `tag` is
the sender's own name for the message — the app passes the request id — so a
refused request fails at once instead of waiting out its timeout. A message over
the queue bound is refused before it reaches the isolate at all.
`bridgeStatus` parsing is strict: a `t:"bridge"` without a non-negative integer
`conn` is ignored and logged rather than given a default, so a malformed status
never moves the resync state machine.

`LinkStatus.closeCode` is the code the machine closed the session with
(`LinkCloseCode`, the daemon's own numbers in
`packages/link/daemon/src/session/close_codes.rs`): 1000 normal, 4001 the daemon
is shutting down (the phone reconnects when it is back), 4002 `bridgeOverflow`,
4003 revoked, 4004 idle expired, 4005 `sessionError` (the session could not carry
on, so the phone starts a new one). A 4002 or a 4005 makes the next connect
report `sessionReset`, because the bridge forgot this phone's view even when the
link session itself resumes; a 4003 ends the link as `closed` and the phone stops
dialling until it pairs again. While it reconnects, the app reads the code as its
own detail line (`Mac is restarting`, `Session reset`, `Session timed out`).

## The outbound queue (`linkOutboundQueue`)

The isolate never lets the Rust session hold unbounded work. `_outbound` keeps
messages in order in `linkOutboundQueueMax` = 8 MiB:

- A message the session is not ready for waits at the head and is retried on
every pump, so a burst survives backpressure — an ACK frees the window and the
whole queue drains in order. Nothing behind it overtakes it.
- A message larger than the bound is refused before it is queued (`tooLarge`);
a message that pushes the queue past the bound is refused (`queueFull`).
- A `LinkProtocolException` other than "no session"/"not connected" drops that
one message (`rejected`) and the queue keeps draining.
- A new session clears the queue and reports `sessionReset` with the count it
dropped, so the app resyncs instead of feeding stale frames to a live session.

That bound is the phone's own budget: it stays inside the Rust ceiling
(`Config.max_unacked_bytes` 16 MiB, `max_message` 32 MiB in
`packages/link/proto/src/config.rs`), but it is not the machine's reply cap. A
message that fits here can still be refused on the far side — the daemon drops a
bridge message over `LINK_MAX_MESSAGE_BYTES` (8 MiB) and the bridge answers
`response_too_large` for a reply over its own limit — which is why a refusal is
reported to the caller with its tag instead of being assumed impossible.
`docs/architecture/connectivity-v2/link-transport.md` has the table of every
limit and which ones must match.

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
