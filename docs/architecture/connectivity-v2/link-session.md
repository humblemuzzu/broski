# link-session — the phone side of Broski Link

Crate `packages/link/session` (`broski-link-session`). The async client the native apps' shared Rust
core uses for every paired machine: it owns the sockets and drives the sans-IO `Link`
([link-core.md](link-core.md)). It replaces the deleted Dart `link_dart` package (branch
`final-flutter`), whose behaviour is the spec; where this crate differs, the section says so and why.
It does no storage I/O and exposes plain Rust; the later `mobile` crate wraps it in UniFFI.

## Runtime

`LinkRuntime` is one current-thread tokio runtime on one dedicated thread (`broski-link`), shared by
every session of the app. A phone holds a handful of sessions whose work is socket I/O and a few
microseconds of AEAD per frame, so one thread keeps up; it parks in the kernel whenever no socket or
timer is due, and no work stealing wakes a second core for a frame. UniFFI never starts a runtime and
polls futures on the foreign caller's thread (`docs/rebuild/research/uniffi.md`), so every async entry
point (`pair`) spawns its work onto this thread and awaits the `JoinHandle`, which any executor can
poll. `Session::next_event` needs no runtime at all: it waits on a `tokio::sync::Notify`. Dropping the
last `LinkRuntime` clone stops the thread, which drops every task and socket on it. `handle()` lets the
client core (`broski-client`) run its own tasks and timers on the same thread.

## API

| Item | What it is |
|---|---|
| `DeviceIdentity::{generate, from_secret, secret, id, public_bundle}` | the phone's static identity, one per install; the app keeps the 3617-byte secret in the Keychain/Keystore |
| `Offer::parse(uri)`, `.machine_id()`, `.name()`, `.expires_at()`, `.is_expired(now)` | a scanned `broski://pair?v=2&…` (parsing is `crypto::PairingOffer`); the secret is wiped on drop |
| `pair(&runtime, &identity, offer, options) -> Result<Paired>` | verifies the machine, pairs, waits for `paired`; `Paired { session, record }` |
| `Session::start(&runtime, &identity, record, options)` | a stored machine |
| `session.next_event().await -> Option<Event>` | the pull subscription; `None` after the session ended and every event was read; one reader |
| `session.status()` | the current `Status` snapshot |
| `session.send_bridge(frame, tag) -> Result<(), SendFailure>` | one contract frame for `STREAM_BRIDGE` |
| `session.register_push(platform, token)`, `unregister_push()`, `restart_bridge()` | control messages |
| `session.pause()`, `resume()`, `network_changed()`, `lan_discovered(routes)`, `close()` | lifecycle |
| `push::open_notification(&record, data)`, `push::decision_letter(&record, …)` | pure functions for the notification handlers |
| `PairingCredentials::derive(secret)` | the offer's one-time relay device |
| `SessionOptions { device_name, platform, timings }`, `Timings` | the `hello` and every window; tests shrink the windows |

`Event` is `Status(Status)`, `Bridge(Vec<u8>)`, `BridgeStatus(BridgeStatus)`, `RecordChanged(MachineRecord)`
and `SendFailed { tag, reason }`. A `Status` with `LinkState::Connected { resumed, session_reset }` is the
connect event. `LinkState` is `Connecting`, `Connected`, `Waiting(Retry | Paused | MachineOffline |
MachineAsleep | RelayRefused)`, `Revoked` and `Closed`; `Status` also carries the route, its `host:port` or relay host,
the relay's `last_seen` and the machine's last close code. Statuses repeat nothing except a session
reset, which always reaches the app (`link_status_reporter.dart`).

## Records and secrets

The session never stores anything. `MachineRecord` (id, name, os, public bundle, this phone's device
id, relay, relay token, LAN routes, push key `K`, pairing time) is what the app persists in secure
storage; `pair` returns the first one and every `Event::RecordChanged` replaces it. `relay_token` and
`push_key` are secrets, so the record's `Debug` redacts them. `K` is 32 random bytes generated at
pairing and kept for the record's life, because a new key would make every push sealed before it
unreadable (`push_key_store.dart`). `Session::start` refuses a record whose bundle is not its id's,
whose push key is not 32 bytes, whose relay is not `ws`/`wss`, or whose device id is not the identity's.

## Pairing

1. The offer must not be expired (`>=` its expiry second).
2. Every address the offer names is asked for the machine's bundle at once, 1.5 s each
   (`machine_bundle_fetcher.dart`): `http://<lan>/v1/identity` and the relay's
   `https|http://<relay>/v1/identity/<machine id>`, over hyper on the session's TLS config. The first
   bundle whose SHA-256 is the offer's fingerprint wins; a bundle that is not is disqualified, never used
   (`FingerprintMismatch` when that was all there was, else `MachineUnreachable`).
3. A session starts in Pair mode with the offer's routes. Its relay socket authenticates as the offer's
   one-time device: `device_id = hex(sha256("broski-pair-id" ‖ S)[..16])`,
   `token = b64url(sha256("broski-pair-token" ‖ S))` (`daemon/src/pairing.rs`; the pinned vector and a
   comparison with the daemon's own functions are tests). The secret is used until a handshake completes.
4. The machine's `paired` is accepted only for the machine the offer pins and this phone's device id;
   the record takes the reported routes, keeps the offer's LAN routes as history, and from then on the
   relay is dialled with the device's own id and token. The daemon retires the offer's relay device right
   after `paired`, the relay closes that socket (its 4003 is not a revocation for a pairing socket), and
   the session comes back on its own token and resumes its session. No `paired` within 20 s is
   `PairingTimeout`.

## Routes

- **LAN** (`machine_endpoint.dart`): `ws://<host:port>/v1/link`, only for a `host:port` on a private
  network (loopback, RFC 1918, CGNAT, IPv6 ULA and link-local, `localhost`, `.local`). The Noise
  handshake authenticates the machine either way; the rule keeps a spoofed advert or a tampered offer
  from making the phone dial arbitrary internet hosts.
- **Relay**: `wss://<relay host[:port]>/v1/device` with `x-broski-machine`, `x-broski-device` and
  `authorization: Bearer <token>` (`relay-protocol.md`). Plain `ws://` only to a private host, so a
  tampered record cannot put the bearer token on the wire in clear. The relay's `{"t":"status"}` text
  frames are the machine's presence: a relay socket starts its handshake only once the machine is
  `online` (the relay drops what a device sends to an absent machine), waits 10 s for the first status,
  and reports `Waiting(MachineOffline | MachineAsleep)` while it keeps the socket open.
- **TLS**: rustls 0.23 on the ring provider, with Mozilla's roots compiled in (webpki-roots 1). ring
  builds for iOS and Android with the target's C toolchain alone; the provider is named explicitly
  because the process default is ambiguous whenever another crate in the binary enables aws-lc-rs.

## Connecting

| Rule | Value | Source |
|---|---|---|
| race | every LAN candidate and the relay at once; LAN wins if it opens before the relay's grace window ends, the relay after | `route_race.dart`, `route_dialer.dart` |
| grace / LAN dial / relay dial | 300 ms / 4 s / 12 s | `route_dialer.dart` |
| handshake | msg2 within 8 s of msg1 | `link_handshake.dart` |
| retry | the first failure after a connect switches to the other configured route at once; later ones back off 0.5 s doubling to 10 s, ±20 %, racing both | `route_retry.dart`, `backoff.dart` |
| network change | every socket is dropped and both routes raced again; the link session resumes | `link_engine.dart` `_reconnectNow` |
| LAN probe | while the relay carries the link, one LAN candidate at a time (1.5 s each) every 15 s | `lan_probe.dart`, `lan_probe_policy.dart` |
| discovered routes | merged into the record; a route seen again inside 2 s is ignored | `lan_search.dart` |

A probe that opens a LAN socket while the link is connected migrates **make-before-break** with
`Link::migrate` (link-core.md § Migration): the relay keeps carrying the session until the LAN
handshake lands, then it is closed. The Dart engine instead detached the session and kept the relay
socket as a "fallback" to re-handshake on if the LAN handshake failed — which cannot work, since the
daemon takes one handshake per connection, and which made a LAN address answering for another machine
(a second Mac on a reused DHCP address) flap the link on every probe. Here such an address costs the
link nothing and is probed again only after the interval.

`Connected { resumed: false }` after an earlier session means the machine started a new session: every
message still queued for the old one is reported as `SendFailed { reason: SessionReset }` with its tag,
and the status carries `session_reset: true`. A 4002 or 4005 close makes the next connect report
`session_reset` even when the link session resumed (`link_close_code.dart`). Each connect queues the
phone's `hello` (`platform: ios|android`) and, if the app registered one, its push registration, ahead
of any bridge backlog, so a machine that restarted is told again.

## Lifecycle

- **pause** closes the socket in use, so the daemon sees the phone leave and pushes its alerts again,
  and reports `Waiting(Paused)`. Nothing dials while paused. A race already in flight may finish: its
  socket waits, and a `resume` within 15 s uses it instead of dialling again; a later resume, or a socket
  that closed meanwhile, dials afresh (`app_pause.dart`).
- **close codes**: 4003 on the link, or a 4003 websocket close from the relay on a device-token socket,
  is `Revoked`: terminal, nothing dials again, the events end. 1000, 4001, 4004 and a lost socket
  reconnect.
- **a refused token**: the relay answers the upgrade of a device it does not hold with 401, which the
  dial reports as a typed refusal, not a string. A device revoked while it had no socket open is such a
  device, and so is one the machine has not published to the relay yet (it does that after a pairing,
  asynchronously, and not while it is offline), so one 401 is not revocation. A race that ends with
  the relay's 401 and no connected route reports `Waiting(RelayRefused)` and retries on the usual
  backoff; once `Timings::relay_refusal_window` (5 min) has passed since the first refusal and at least
  5 refusals were seen, with no connection or accepted relay token in between, the session ends as
  `Revoked` (without a close code). A pairing's own one-time relay device is never judged this way. `close()` sends the machine a CLOSE 1000, so it ends its side instead of keeping it for a
  resume; dropping the `Session` stops quietly and the machine keeps the session for 600 s.
- **ended sessions** report every message still queued as `SendFailed { reason: Closed }`, and
  `send_bridge` answers `Closed`.

## Control stream

Parsed strictly (`bridge_link_status.dart`, `machines_provider.dart`): a known `t` with fields off the
contract is refused, never defaulted; an unknown `t` or a non-object is ignored. `bridge` needs a state
string (unknown values become `BridgeState::Unknown`) and a non-negative integer `conn`; a non-string
`detail` is dropped. `routes` needs a `ws`/`wss` relay or null and a list of non-empty strings.
`paired` needs 32-hex ids, a relay token of 32 b64url bytes and string names.

## Queues and backpressure

| Bound | Value | On breach |
|---|---|---|
| outbound queue | 8 MiB (`OUTBOUND_QUEUE_MAX`) | `TooLarge` / `QueueFull` from `send_bridge` |
| sealed frames per socket writer | 64 | the next sealed frame waits in the engine, nothing is read past it |
| frames from all sockets to the engine | 64 | the socket readers wait, TCP pushes back |
| unread events | 8 MiB of bridge frames or 1024 events | the engine stops reading sockets until the app is under half of both |
| websocket message | 128 KiB | the socket is dropped |

The outbound queue keeps order: a message the link refuses for backpressure or a missing session waits
at the head and is retried on every pass; any other refusal drops that message alone (`Rejected`).
Nothing leaves while no handshake has completed, so a new session can never silently drop what the
app sent (link-core.md § The phone's outbound queue).

## Push and letters

`push::open_notification(record, e)` opens a machine push: `notify_key = HMAC-SHA256(K,
"broski-notify-v1")`, `nonce ‖ ChaCha20-Poly1305` with the machine id as AAD (`push.md`).
`push::decision_letter(record, allow|deny, backend, session, request)` builds the relay `POST`
(`/v1/letters` on the record's relay, the device headers and bearer token, `application/octet-stream`)
whose body is a `decision` letter sealed under `letter_key = HMAC-SHA256(K, "broski-letter-v1")` with
AAD `machine_id:device_id`, a random 32-hex id and the current time. The notification handlers (the iOS
service extension, Android's message handler) send it themselves; the same `http` rule as the relay
socket applies.

## Verified

`cargo test -p broski-link-session`: 56 unit tests and 26 integration tests, stable over repeated runs.
The crate builds for `aarch64-apple-ios` and `aarch64-apple-ios-sim` in release, with ring as the only
TLS provider in the graph (no aws-lc). Every integration test runs
the real daemon (`broski_link_daemon::run`) and, where a relay is involved, the real relay
(`broski_relay::serve`) on loopback, with a bridge stand-in on the daemon's unix socket that echoes
device frames and answers the daemon's feed; a TCP forwarder in front of the LAN listener delays,
holds, cuts and drops connections. The daemon, relay and forwarder harness is the crate
`broski-link-testkit`, which the client's tests (`mobile-core.md`) share. Waits pull events until the expected one arrives; the one fixed
window is the probe-loop test's absence check.

- `pairing.rs` — pairs over the LAN with the daemon's own offer (record contents, fresh session, the
  `hello` stored, bridge headers); pairs entirely over the relay and resumes on its own token after the
  machine retires the offer's device; a stored record reconnects in Connect mode; another machine on
  the offer's address is `FingerprintMismatch`; nobody answering is `MachineUnreachable`; an expired
  offer is refused; the pairing credentials equal the daemon's for 32 secrets; a record for another
  identity, bundle or a short key does not start.
- `routes.rs` — LAN wins only inside the grace window (150 ms wins, 900 ms loses); a LAN dial that never
  answers loses to the relay well before its own timeout; cutting the LAN moves the link to the relay
  with every message once and in order, and restoring it brings the link back by the probe, on the same
  bridge socket; a relay link takes a route `lan_discovered` reports and records it; a LAN address
  answering for another machine leaves the relay link untouched and is not probed again.
- `resume.rs` — five drops mid-stream lose and repeat nothing in either direction and keep the bridge
  socket; a network change re-races with exactly one new socket and resumes; a restarted machine is
  reported offline by the relay, then the session resets and the messages queued meanwhile are
  reported with their tags.
- `lifecycle.rs` — revocation on the link (4003) and by the relay alone (websocket 4003) end the session
  as `Revoked`, after which nothing dials; pause detaches the phone at the daemon and resume resumes; a
  dial in flight at pause serves a quick resume with no new socket, and a stale one is replaced; the
  outbound queue's bounds and its reports on close; `close` ends the session on the machine.
- `bridge.rs` — a 1 MiB frame and 50 small ones round-trip in order; the daemon's bridge status arrives.
- `push.rs` — the registered key reaches `devices.json` and opens what the daemon's own push code seals;
  a decision letter opens with the daemon's letter code, is accepted by the relay, reaches the bridge as
  `link_decision` and is acknowledged.
- `refusal.rs` — a device revoked at the daemon while the phone is paused sees the relay's 401s as
  `Waiting(RelayRefused)` and then `Revoked`; a token the relay has not been told of yet is refused six
  times, never judged revoked, and connects as soon as the relay knows it.
- `multi.rs` — two machines on one runtime are independent.
- unit tests — the Dart tests ported (route race, backoff, route retry, outbound queue, LAN probe
  policy, bridge status, machine endpoint), pinned push and letter vectors, strict control parsing, and
  a `wss://` dial to the real relay's rustls listener with a throwaway certificate (and its refusal under
  the production roots).

## Known gaps

- A device revoked while it had no socket open learns it from the relay's 401s (above), but only over a
  record that has a relay: the LAN listener drops an unknown device without a reply, which looks like an
  unreachable machine, so a LAN-only record keeps retrying with backoff until the app forgets the
  machine.
- Mozilla's roots are compiled in; a relay behind a private CA would need the platform verifier
  (`rustls-platform-verifier`, which on Android needs JNI initialisation from the app).
- The `wss://` path is proven at the transport (a dial to the relay's TLS listener); the end-to-end
  session tests run the relay over `ws://` on loopback.
- `aarch64-linux-android` is not built here: no NDK is installed on this machine. The one native
  build step is ring's, which needs the NDK's `aarch64-linux-android-clang` as its C compiler — the same
  toolchain cargo-ndk supplies for the linker; nothing needs cmake, perl or Go.
