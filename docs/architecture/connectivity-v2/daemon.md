# broski-link-daemon — the machine-side daemon

`packages/link/daemon` (crate `broski-link-daemon`, binary `broski-link`). One unix-only process
on the user's machine: it is the transport and the authorisation layer that terminates TLS at the
relay, speaks the link protocol to each paired phone, and pipes bridge JSON. AI logic stays in the
bridge.

## Process model

One tokio multi-thread runtime. Long-lived tasks:

| Task | One per | Job |
|---|---|---|
| routes scan | process | re-scans LAN addresses every 10 s, and re-announces after a change |
| mDNS advertisement | process | publishes `_broski-link._tcp` for the phone to browse |
| bridge supervisor | `--bridge-cmd` | owns the bridge child process |
| control socket | process | line-delimited JSON on `<home>/control.sock` |
| LAN listener | process | `/v1/identity` and the `/v1/link` upgrade |
| relay client | process | one machine socket, reconnects forever |
| bridge feed client | process | one socket to the bridge's unix socket: busy and agent activity |
| session actor | device id | one link session plus its bridge connection |
| relay channel drain | relay channel | frames to and from the machine socket |
| bridge reader + writer | session | two tasks over the bridge websocket |
| responder | new connection | one Noise handshake, then hand over to the session |

A new LAN websocket or relay channel gets its own `Responder`: one handshake, then it either
resumes the device's session or starts a fresh one. Sessions are not shared.

## State, and what is private

`<home>` is `0700`; every file the daemon creates is `0600`.

| Path | Contents |
|---|---|
| `identity` | 3617-byte identity secret (X25519 + ML-KEM-768) |
| `state.json` | `{"relay_secret":"<b64url 32 B>","name":"<hostname>"}` |
| `devices.json` | paired devices: `id`, `name`, `platform`, `pub`, `role`, `relay_token_hash`, `paired_at`, and `push` — the device's `platform`, `token` and `key` once it registers for alerts |
| `letters_seen.json` | the ids of letters already handled (24 h, 10 000 entries) |
| `config.json` | optional, read only: `{"relay":<url\|null>,"lan_port":<n\|null>,"lan":<bool\|null>}` |
| `bridge.key` | 64 hex characters: this start's key for the bridge socket |
| `control.sock` | the control socket |
| `bridge.sock` | default bridge unix socket, created by the bridge |

Every state file is written the same way: a temporary file in the same directory, flushed to disk,
renamed over the target, and the directory flushed after it. A crash at any instant leaves one or
the other file whole, never half of both. A `devices.json`, `state.json` or `letters_seen.json`
that cannot be read is renamed `<name>.corrupt-<unix secs>` with a warning and the daemon starts
without it; `identity` is the exception — regenerating it would unpair every device, so the daemon
refuses to start and names the file to restore.

`relay_token_hash` is `sha256(token)` as 64 hex characters. The plaintext token is minted on
pairing, sent to the phone once in `paired`, and never stored. No log line carries a secret, a
token or a payload byte: the daemon logs ids truncated to 8 characters and outcomes only.

## Link control stream (`STREAM_CONTROL`, id 0)

Machine to phone, one JSON object per link message:

| Message |
|---|
| `{"t":"paired","device_id":"<32 hex>","relay_token":"<43 b64url>","machine":{"id":"<32 hex>","name":"…","os":"macos","relay":"<url\|null>","lan":["<host:port>",…]}}` |
| `{"t":"routes","relay":"<url\|null>","lan":["<host:port>",…]}` |
| `{"t":"bridge","state":"up"\|"connecting"\|"starting"\|"down"\|"crashed","conn":<n>,"detail":<string\|null>}` |

Phone to machine: `{"t":"hello","name":"<≤64 B>","platform":"ios"|"android"|"web"}`,
`{"t":"bridge_restart"}`, `{"t":"push_register","platform":"apns"|"fcm","token":"…","key":"<b64url 32 B>"}`
and `{"t":"push_unregister"}`. `paired` is sent once, on the first attach after the connection that
paired; `routes` follows every attach and every change. `bridge` follows every change of
`(state, conn, detail)` and every attach. Unknown `t` is ignored in both directions, so a newer peer
never breaks an older one. The two push messages are the phone's only way to be woken while the
bridge is idle: see [push.md](push.md).

`bridge` is about this session's own bridge socket, not the process: `up` only while that socket is
through its upgrade, `connecting` while the bridge answers but this socket is not, and otherwise the
process state — `starting`, `crashed` with the supervisor's detail, or `down` when nothing is
listening. `conn` counts the sockets this session has had. A reset socket is a new client to the
bridge and knows nothing of what the old one was shown, so the phone resyncs whenever `conn` moves;
that is the one signal it must not miss, which is why the count is per session and not process-wide
(the control socket's `status` keeps the process-wide view). The status an attach produces is not a
move: it is what that socket is at that moment (`connecting` while it dials, `crashed` if the bridge
is down), and the phone's own connect already resynced. The app adopts the first `up` of a link
silently and resyncs on every later change of `conn`; a `crashed` or `down` first status still
reaches the chip, it just fails nothing.

## Flow control

Nobody ends a connection because the other side is slow; the slowness travels back to whoever is
producing. The session reads its bridge socket only while `Link::unacked_bytes()` is below 8 MiB and,
once past it, not again until acks bring the window under 4 MiB. Not polling is what pushes back: the
reader blocks on a full four-message queue, the socket buffer fills and the bridge's write blocks.
Control messages have the remaining half of the 16 MiB window to themselves.

A message the link will not take is never a reason to end the session. Backpressure and a session
that does not exist yet both leave the message waiting — one slot for the bridge stream, so nothing
behind it is read, and a small ordered queue for control — retried on every pass, and the ack that
frees the window is what lets it go.

A bridge socket that dies hands back everything it never wrote, the message that failed included, the
session puts it at the front of its queue for the bridge and redials. So does a socket a rename or a
restart asks to retire: it is asked to hand its queue back first, and the new socket takes nothing
until that queue is in the session's own. A message larger than 8 MiB
(`LINK_MAX_MESSAGE_BYTES`, the whole unacked window has to fit one) drops the socket at once; the
bridge never sends one.

## Close codes

The session ends with a code that says why, and the code decides what the phone does next:

| Code | Meaning |
|---|---|
| 1000 | the phone closed, or the daemon echoes a close it was sent |
| 4001 | the daemon is shutting down |
| 4002 | the phone handed the session more for the bridge than its 16 MiB queue holds |
| 4003 | the device was revoked on this machine |
| 4004 | no phone attached for the whole idle limit |
| 4005 | the session's own crypto state could not carry on |

Before the connection is dropped, the session hands over everything it still holds and waits, for a
second at most, for the phone to acknowledge it — the CLOSE included. A socket closed with the
phone's own bytes still unread is reset by the kernel, and the phone would lose the very frame that
says why the session ended.

Only 1000 and 4003 end the link quietly. A 4002 or a 4005 makes the phone's next connect report
`sessionReset` and the app resyncs; a 4001, a 4004, a lost connection or a dead peer make it redial
and resync nothing more than the link's own reconnect does.

## Control socket (unix, one JSON line per request)

| Request | Reply |
|---|---|
| `{"cmd":"pair"}` | `{"uri":"broski://pair?v=2&…","expires_at":<unix secs>}` |
| `{"cmd":"status"}` | `{"machine":{"id","name"},"relay_connected":bool,"lan":[…],"bridge":{"state","detail"},"sessions":[{"device":"<8 hex>","route":"lan"\|"relay"\|null,"connected":bool}]}` |
| `{"cmd":"devices"}` | `[{"id","name","platform","role","paired_at"}]` |
| `{"cmd":"revoke","device":"<unique prefix, ≥8 chars>"}` | `{"ok":true,"device":"<full id>"}` |

Any failure answers `{"error":"<message>"}`. The server refuses to start when something still
answers on the socket path.

## Pairing over the relay

The phone has no relay token before it pairs, so every open offer registers a one-time device
derived from the offer's 32-byte secret `S`:

```
pairing_device_id = lowercase hex of the first 16 bytes of sha256("broski-pair-id" || S)
pairing_token     = base64url-no-pad of sha256("broski-pair-token" || S)          (32 bytes)
allow token_hash  = lowercase hex of sha256(pairing_token)                        (64 chars)
```

Test vector, `S = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`:

- `pairing_device_id = 13cf11d39c68f01194167dec02ae299b`
- `pairing_token = ftJ9gRzybv0NVMqryTFwpTALY9GjGlZ6a7MD4guui98`
- `token_hash = a3c01756f2877fbbbb15b876175a6729bdd60a7d7acba5b428fc3e8ccc24af09`

`daemon/src/pairing.rs` computes these and pins the vector; the phone side mirrors it.

Creating an offer — and reconnecting to the relay while one is open — sends
`{"t":"allow","device":<pairing_device_id>,"token_hash":<64 hex>,"req":N}`. Consuming, replacing
or expiring an offer revokes it. A relay channel whose `device` is the current pairing device may
only perform a Pair handshake: a Connect from it is dropped without a reply. A successful pair
allows the real device id, then writes the revoke on the machine socket **after** the `paired`
reply, so the relay closes the pairing channel only once the phone holds its real token.

## Sessions and resume

- A session belongs to exactly one device id. Another connection for the same id joins it; another
  device can never resume it (a stolen session id is refused and replaced with a fresh one).
- `Hello{resume{session_id, next_expected}}` resumes only when the id matches the session the
  daemon holds and the frontier is inside its window. Anything else starts a fresh session and the
  phone drops its old queue.
- A lost connection detaches the session: the link keeps the session id, the unacked window and a
  half-reassembled message, so only what the phone missed crosses the wire on resume. A detached
  session lives 600 s (`session_idle`); a CLOSE from the phone, or a revoked device, ends it.
- The bridge connection belongs to the session, not to the network route: a phone that moves from
  LAN to relay keeps the same bridge websocket.
- A **fresh** session starts with nothing carried over: the control messages parked for the old
  session, the one bridge message waiting for it, and the last bridge status it was told are all
  dropped, so a phone that just reset is never handed data for the session it lost. What the phone
  sent for the bridge is *not* dropped — those messages were acked to it, and the bridge still owes
  them (the queue is the session's, not the link's).
- A fresh session in place of one the daemon held is a phone that started over (the app was
  relaunched). Its bridge socket still holds the old process's hello and every session it viewed,
  which would keep streaming to the new one, so it is closed and a new one dialled (`conn` moves and
  the phone says hello again) — unless it still owes the bridge something the phone sent, in which
  case it is kept, as above.

## Bridge supervision

Without `--bridge-cmd` the daemon only dials the socket it is given. With it, the daemon spawns the
command with `--link-socket <bridge-socket> --link-key-file <home>/bridge.key`, forwards the child's
stdout and stderr to the log, and restarts it 1 s to 30 s after it exits, resetting the backoff once
a run lasted 60 s. `{"t":"bridge_restart"}` asks for a restart, at most once a second, and the
restart it gets counts against that backoff like any other early exit — a paired phone cannot
respawn the bridge faster than the supervisor itself would. A dial is the unix connect plus the websocket upgrade
and gives up after 5 s (`Durations::dial_timeout`, shrunk in tests), which counts as a failed dial:
the socket is dropped and the bridge backoff runs again.

The process-wide state is `up` while any websocket to the bridge is live — the daemon's own feed
socket counts, so a supervised bridge that is listening is `up` before any phone attaches —
`starting` before a child runs, `crashed` with the reason after one dies, and `down` when nobody is
listening. Without `--bridge-cmd` a `down` is only reported once it has lasted 750 ms: the feed
socket redials within a few hundred milliseconds, and a bridge that never went away must not flicker
through `down` while it does. `broski-link status` reports it as it is; each session reports its own socket against it
(see the control stream above), so a live feed never hides a session with no socket.

## The bridge link key

`bridge.sock` is a file any process on the machine can connect to, so the daemon proves which
client it is. On every start it mints 32 random bytes, writes them hex-encoded to `<home>/bridge.key`
(`0600`, inside the `0700` home, with the atomic write above) *before* it spawns or dials anything,
and sends them in the `x-broski-link-key` header of every websocket upgrade it makes: each session's
socket, the feed socket, and the letter pipe. A supervised bridge is told where the file is with
`--link-key-file` and refuses an upgrade that cannot present the current key. The key is regenerated
on every start, so a bridge still holding yesterday's key refuses this daemon until it is restarted
with it — which the supervisor does on its own.

The bridge websocket carries `x-broski-device-id`, `x-broski-role: owner`,
`x-broski-link-key` and, once known, `x-broski-device-name`, and accepts one message of at most
8 MiB. A reader task and a writer task
keep one slow direction from stalling the other; a close from the bridge is logged with its code and
reason. The socket stops counting towards `up` the moment its read side ends, and the writer is
stopped and drained right after, so a bridge that dies is reported as crashed instead of as a
bridge that is still there, and nothing it never wrote is lost. A supervised child counts as
`starting` for as long as it runs, so the last socket dying can report one `starting` before the
supervisor sees the exit and reports `crashed`.

## Ports and CLI

Default LAN port `18275` (`--lan-port`, `config.json`, `0` = ephemeral). Control socket
`<home>/control.sock`, bridge socket `<home>/bridge.sock`, relay `wss://host[/path]`
(`/v1/machine` when the url has no path). `--home` defaults to `$BROSKI_LINK_HOME`, else
`~/.broski/link`.

```
broski-link run    [--home PATH] [--relay URL] [--lan-port PORT] [--no-lan] [--no-advertise] [--bridge-socket PATH] [--bridge-cmd PROGRAM [ARGS…]]
broski-link pair|status|devices|revoke     # pair prints the QR uri; status and devices take --json
```

## Bounds

| Queue | Bound | On breach |
|---|---|---|
| connection frames out, wire in | 64 each, per connection | the session detaches; a full out queue retries the one frame it holds |
| session commands | 64 | the responder waits for room, and ends the connection only if the session takes nothing for 10 s |
| bridge messages out, in | 64 / 4 | waits: the writer blocks, the reader stops reading |
| bridge message | 8 MiB | the bridge socket is dropped and redialled (a warning carries the size) |
| bridge queue while the bridge is down | 16 MiB | the session is closed with 4002 |
| control backlog | 64 | a control message is dropped with a warning |
| relay machine-socket outbox | 256 | the relay client logs and drops the connection |
| relay channel inbound | 64 | the daemon waits, then closes the channel and tells the relay |
| letters in flight per device | 4, one socket | the letter is left for the relay to redeliver |
| link unacked bytes / message / frame | 16 MiB / 32 MiB / 65519 | the bridge read gate shuts at 8 MiB and opens at 4 MiB / decode error |
| LAN connections, upgrades | 64 live in all, 8 live per address, 20/s burst 40 per IP | 429 before the upgrade |
| LAN handshake | 10 s from the upgrade to msg1 | the socket is closed and its slot goes back |
| LAN websocket message | 128 KiB | the connection is dropped |
| control request | 8 KiB, 10 s | the line is cut at the limit and the request refused |
| paired devices | 32 | pairing is refused |
| pairing offer | 600 s, one at a time | the newer offer replaces it |
| backoff: bridge / relay / supervisor | 0.25–5 s / 0.5–30 s jittered / 1–30 s | — |
| bridge dial | 5 s | counted as a failed dial, retried on the bridge backoff |
| link timers | ping 15 s, dead 45 s, ack 25 ms | the session detaches |

## Discovery

The daemon advertises itself with mDNS/DNS-SD so the phone can find the machine without scanning:

| Record | Value |
|---|---|
| service type | `_broski-link._tcp` in `local.` |
| instance | `<display name> (<first 8 of the machine id>)`, sanitised to a DNS-SD label (printable, no `.`, at most 63 bytes, the id part always kept) |
| host | `<display name as a host label>-<first 8 of the machine id>.local.` |
| port | the port the LAN listener actually bound |
| TXT | `id=<machine id, 32 lowercase hex>`, `v=1` |

The advertisement covers every non-loopback address the LAN listener serves (loopback is disabled
on the responder): it follows the machine's interfaces itself, and the routes scan re-announces when
the address set changes. SRV and address records carry a 120 s TTL and the cache-flush bit, so a
new announcement replaces what a cache still holds.

The names carry the start of the machine id, so no other machine can own them, and probing is off:
a restarted daemon must never take the records its previous run left in caches for a rival and
rename itself (`… (2)`) away from the name phones already know. On the way out the advertisement
is withdrawn first, before any task stops: the daemon waits for the responder to confirm the
goodbye and for its 120 ms repeat to go out, so caches drop the old port at once. Daemons started
with `--no-advertise` (and every test daemon except the discovery tests) announce nothing.

The responder is the pure-Rust `mdns-sd` crate. It shares UDP 5353
with the system responder (`SO_REUSEADDR` + `SO_REUSEPORT`) and joins the mDNS group on each
interface, so macOS's own mDNSResponder keeps working and both answer queries; `daemon/tests/discovery.rs`
proves it by browsing for the daemon's own advertisement on the machine it runs on.
A host with no multicast interface still reaches the daemon through the LAN candidates in `routes`
or through the relay; the advertisement is an addition, never a requirement.

## Letters

A letter from the relay is acknowledged only when it was acted on or refused for good (unknown
device, a key that does not decrypt, a replay, outside the time window). One the bridge could not
be reached for is left unacknowledged so the relay hands it over again. A bridge-kind letter goes on
the device's own session socket when it has one; otherwise the daemon keeps one short-lived bridge
socket per device (`letters/pipe.rs`), which serves every letter for that device and is closed after
30 s with nothing to send, and reads what the bridge writes back while it is held.

Alerts, letters, the bridge feed and keep-awake are done: [push.md](push.md) has the wire formats,
the pinned vectors and what each test covers.
