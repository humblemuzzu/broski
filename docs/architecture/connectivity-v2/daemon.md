# broski-link-daemon — the machine-side daemon

`packages/link/daemon` (crate `broski-link-daemon`, binary `broski-link`). One unix-only process
on the user's machine: it is the transport and the authorisation layer that terminates TLS at the
relay, speaks the link protocol to each paired phone, and pipes bridge JSON. AI logic stays in the
bridge.

## Process model

One tokio multi-thread runtime. Long-lived tasks:

| Task | One per | Job |
|---|---|---|
| routes scan | process | re-scans LAN addresses every 10 s |
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
| `control.sock` | the control socket |
| `bridge.sock` | default bridge unix socket, created by the bridge |

`relay_token_hash` is `sha256(token)` as 64 hex characters. The plaintext token is minted on
pairing, sent to the phone once in `paired`, and never stored. No log line carries a secret, a
token or a payload byte: the daemon logs ids truncated to 8 characters and outcomes only.

## Link control stream (`STREAM_CONTROL`, id 0)

Machine to phone, one JSON object per link message:

| Message |
|---|
| `{"t":"paired","device_id":"<32 hex>","relay_token":"<43 b64url>","machine":{"id":"<32 hex>","name":"…","os":"macos","relay":"<url\|null>","lan":["<host:port>",…]}}` |
| `{"t":"routes","relay":"<url\|null>","lan":["<host:port>",…]}` |
| `{"t":"bridge","state":"up"\|"starting"\|"down"\|"crashed","detail":<string\|null>}` |

Phone to machine: `{"t":"hello","name":"<≤64 B>","platform":"ios"|"android"|"web"}`,
`{"t":"bridge_restart"}`, `{"t":"push_register","platform":"apns"|"fcm","token":"…","key":"<b64url 32 B>"}`
and `{"t":"push_unregister"}`. `paired` is sent once, on the first attach after the connection that
paired; `routes` follows every attach and every change, `bridge` only when its state changes.
Unknown `t` is ignored in both directions, so a newer peer never breaks an older one. The two push
messages are the phone's only way to be woken while the bridge is idle: see [push.md](push.md).

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

`daemon/src/pairing.rs` computes these and pins the vector; the Dart side mirrors it.

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
  session lives 600 s; a CLOSE from the phone, or a revoked device, ends it.
- The bridge connection belongs to the session, not to the network route: a phone that moves from
  LAN to relay keeps the same bridge websocket.

## Bridge supervision

Without `--bridge-cmd` the daemon only dials the socket it is given. With it, the daemon spawns the
command with `--link-socket <bridge-socket>`, forwards the child's stdout and stderr to the log,
and restarts it 1 s to 30 s after it exits, resetting the backoff once a run lasted 60 s.
`{"t":"bridge_restart"}` restarts it at once. State is `up` while a websocket is live, `starting`
before a child runs, `crashed` with the reason after one dies, `down` when nobody is listening.
The bridge websocket carries `x-broski-device-id`, `x-broski-role: owner` and, once known,
`x-broski-device-name`; a reader task and a writer task keep one slow direction from stalling the
other.

## Ports and CLI

Default LAN port `18275` (`--lan-port`, `config.json`, `0` = ephemeral). Control socket
`<home>/control.sock`, bridge socket `<home>/bridge.sock`, relay `wss://host[/path]`
(`/v1/machine` when the url has no path). `--home` defaults to `$BROSKI_LINK_HOME`, else
`~/.broski/link`.

```
broski-link run    [--home PATH] [--relay URL] [--lan-port PORT] [--no-lan] [--bridge-socket PATH] [--bridge-cmd PROGRAM [ARGS…]]
broski-link pair|status|devices|revoke     # pair prints the QR uri; status and devices take --json
```

## Bounds

| Queue | Bound | On breach |
|---|---|---|
| connection frames out, wire in | 64 each, per connection | the session detaches; a full out queue retries the one frame it holds |
| session commands | 64 | the responder stops forwarding and reports the connection lost |
| bridge messages out, in | 64 each | the reader/writer pair is torn down |
| bridge queue while the bridge is down | 16 MiB | the session is dropped |
| relay machine-socket outbox | 256 | the relay client logs and drops the connection |
| link unacked bytes / message / frame | 16 MiB / 32 MiB / 65519 | `Backpressure` ends the session / decode error |
| LAN connections, upgrades | 64 live, 20/s burst 40 per IP | 429 before the upgrade |
| LAN websocket message | 128 KiB | the connection is dropped |
| control request | 8 KiB, 10 s | the request is refused |
| paired devices | 32 | pairing is refused |
| pairing offer | 600 s, one at a time | the newer offer replaces it |
| backoff: bridge / relay / supervisor | 0.25–5 s / 0.5–30 s jittered / 1–30 s | — |
| link timers | ping 15 s, dead 45 s, ack 25 ms | the session detaches |

## Not done yet

- **mDNS** — no discovery. LAN candidates come from an interface scan, so a phone that cannot
  reach a candidate falls back to the relay.

Alerts, letters, the bridge feed and keep-awake are done: [push.md](push.md) has the wire formats,
the pinned vectors and what each test covers.
