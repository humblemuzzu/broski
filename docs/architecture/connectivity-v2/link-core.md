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

## Migration (client)

The daemon takes exactly one handshake per connection: after `Accepted::resume`/`fresh` every wire
unit on that connection goes to the session, so a connection that carried a session can never
handshake again. Moving a connected link onto a second connection is therefore make-before-break:

- `migrate(identity, server)` needs a connected link and returns msg1 for the new connection: a
  Connect-mode `Hello` resuming the current session. The current transport keeps sealing and opening
  frames on the old connection meanwhile.
- `complete_migration(msg2, now_ms)` takes the new connection's msg2. The session attaches to the new
  transport exactly as a resume after a drop does (frames the peer already holds are dropped, the rest
  re-queued) and `Connected { resumed }` is reported. Frames that crossed the old connection after
  msg1 need no bookkeeping: the peer re-sends what this side had not received and this side drops
  duplicates by seq; the peer cannot have acknowledged anything past its own `Welcome.next_expected`,
  so the attach always fits the window.
- An error from `complete_migration`, `abandon_migration`, and `disconnect`/`connect` all end the
  migration; the first two leave the current connection carrying the session. `Welcome { resumed:
  false }` replaces the session as any fresh answer does.

`core/tests/migration.rs` proves the lossless move with frames in flight both ways on the old
connection, a failed migration that leaves the old connection working, a fresh answer, and the
preconditions.

## Finding the machine on the LAN

The daemon advertises DNS-SD service `_broski-link._tcp` in `local.` on its LAN listener port, with
TXT `id=<32-hex machine id>` and `v=1`. That is what the phone browses while the link it holds does
not answer.

```
link status: not connected, app in front
  -> the phone's LAN search
       one continuous browse, open until the link is up again or the app goes back
       keep only adverts whose TXT id is the machine's, and whose v is 1
       routes = "<host>:<port>" for what is left, newest first
  -> the machine record grows those routes, and the link session is told the new endpoint
```

Browsing is the platform's, not a socket: `NWBrowser` on Apple platforms and `NsdManager` on
Android. iOS needs `_broski-link._tcp` in `NSBonjourServices`; Android needs the multicast permission
(`CHANGE_WIFI_MULTICAST_STATE`). The browse lives with the platform code, which tells the link session about the result.

A browse is **not** a one-shot. A machine that is restarted comes back on another LAN port, and the
phone redialling the address in its record never learns that. So the browse runs for as long as the
link is down and the app is in front, and every advert that resolves to an address not being dialled
is handed to the link at once (`Session::lan_discovered`): a waiting link drops its pending backoff and
races the new candidates immediately, so a moved machine is reached in a second instead of after the
app resumes.
It stops when the link connects, when the app goes to the background, when no machine is selected,
and when the link is closed (revoked: there is nothing left to look for). `inactive` is a call or
permission prompt, not the background, so it does not stop the browse.

An advert is a hint and nothing more. The Noise handshake authenticates the machine on the socket,
so a spoofed advert costs a dial that fails in `msg2`, never a session with something else. What
answers is written into the record (`Event::RecordChanged`) so the next connect tries it first. The
record keeps every route the machine advertises or reports in `routes` now, then up to 4 routes it
had before (`LAN_ROUTE_HISTORY_MAX`), newest first: a machine that moves back to an address it used
earlier is dialled there without waiting for an advert. Only routes the session would dial (a
`host:port` on a private network) are kept. A route reported again inside `lan_redial_interval` (2 s)
is not a reason to dial again, so a chatty responder cannot spin the link. A `lost` event never tears
a connection down: a machine that stopped advertising may still answer.

The status copy stays honest while this runs, and it is the app's: "looking" while a browse is open
and nothing for this machine has been advertised yet — "Looking for <machine> on this network…";
nothing advertised for 8 s makes it "absent" — "<machine> is offline". When an advert is live the app
shows the link's own connecting copy instead. A browse that cannot run at all (no radio,
or iOS local-network permission off) says so once and leaves the record's routes and the relay as the
only way through.

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
- Deferred: neither side rekeys or pauses its session; the daemon's session table is its own
  problem. Only the client migrates (above); the daemon simply accepts the resume on the new
  connection.

The phone never calls this crate directly: `broski-link-session` drives it, the client core
`broski-client` runs the sessions, and the apps reach the client through the UniFFI facade
`broski-mobile` ([mobile-packaging.md](../mobile-packaging.md)).

## What the phone is told when a link closes

The phone side is `broski-link-session` ([link-session.md](link-session.md)); this is the behaviour it carries.

`Status.close_code` is the code the machine closed the session with (`session/src/close.rs`, the
daemon's own numbers in `packages/link/daemon/src/session/close_codes.rs`): 1000 normal, 4001 the
daemon is shutting down (the phone reconnects when it is back), 4002 bridge overflow, 4003 revoked,
4004 idle expired, 4005 session error (the session could not carry on, so the phone starts a new
one). A 4002 or a 4005 makes the next connect report `session_reset`, because the bridge forgot this
phone's view even when the link session itself resumes; a 4003 ends the session as
`LinkState::Revoked` and nothing dials again until the phone pairs again. While it reconnects, the
app shows the code as its own detail line (`Mac is restarting`, `Session reset`, `Session timed
out`).

## The phone's outbound queue

The previous phone client's rules, which `broski-link-session` keeps (`session/src/outbound.rs`): the
phone never lets the link session hold unbounded work. Its outbound queue keeps messages in order in
8 MiB:

- A message the session is not ready for waits at the head and is retried on
every pump, so a burst survives backpressure — an ACK frees the window and the
whole queue drains in order. Nothing behind it overtakes it.
- A message larger than the bound is refused before it is queued (`TooLarge`);
a message that pushes the queue past the bound is refused (`QueueFull`). Both come back from
`send_bridge` at once.
- A protocol error other than "no session"/"not connected" drops that
one message (`Rejected`) and the queue keeps draining.
- A new session clears the queue and reports `SessionReset` once per dropped message, with its tag,
so the app resyncs instead of feeding stale frames to a live session.

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
