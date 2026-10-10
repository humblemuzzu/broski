# Broski Link relay protocol

`broski-relay` (Rust, `packages/link/relay/`) is the rendezvous both endpoints dial **out** to. It moves
opaque frames between a machine daemon and its paired devices and never inspects them. It also stores
opaque letters for a machine that is asleep, forwards opaque pushes to APNs/FCM, and can raise one
content-free alert of its own when a machine that said it was working goes away.

```
device ──TLS──▶ relay ◀──TLS── machine        payload bytes are Noise-encrypted end to end
```

**What the relay can see:** machine id, device id, connection timing, frame sizes, channel ids, the
`open`/`close`/`ok`/`err`/`status` control messages, the sha256 of machine secrets and device tokens
(only hashes are stored), letter metadata (which device wrote how many bytes, when, how long they sat
before collection), push metadata (platform, device push token, kind, collapse id, priority, byte
count) and watch state (that a machine is working, when it went away, whether it alerted).
**What it cannot see:** plaintext, Noise keys, agent traffic, message history. Letter bodies and push
bodies are opaque blobs it only moves and stores; the phone decrypts push bodies in its Notification
Service Extension. It never logs headers, tokens, payload bytes or payload lengths.

## Endpoints

| Method | Path | Auth | Result |
|---|---|---|---|
| WS | `/v1/machine` | `x-broski-machine: <machine_id>`, `authorization: Bearer <machine_secret>` | upgrade, else 400/401/429 |
| WS | `/v1/device` | `x-broski-machine`, `x-broski-device`, `authorization: Bearer <device_token>` | upgrade, else 401/429 |
| GET | `/v1/identity/<machine_id>` | none | `200 {"pub":"<b64url>"}` or 404 |
| GET | `/v1/status/<machine_id>` | the two device headers + bearer | `200` status JSON, else 401 |
| POST | `/v1/letters` | the two device headers + bearer | `202 {"id":N,"delivered":bool}`, else 401/413/429/507 |
| POST | `/v1/push` | none | `200 {"ok":true}`; 400/404/429/502 on failure; **404 unless the relay has provider keys** |
| GET | `/healthz` | none | `200 ok` |

Ids are 32 lowercase hex characters. Secrets and tokens are base64url-no-pad of 32 random bytes and
are hashed with sha256 before storage or comparison (constant-time). A machine id is the lowercase hex
of the first 16 bytes of `sha256(public_bundle)`, so the identity message is self-certifying against
the id the machine registered with. First connect of an unknown `machine_id` registers it; a known id
requires a matching secret. 429 means the per-IP upgrade bucket is empty.

## Frames

Binary frames carry `[u32 big-endian channel id][payload]` on the machine socket. The relay strips the
channel id when forwarding to the device and prepends it when forwarding from the device; the payload
itself is forwarded byte for byte. Text frames are JSON control messages; on the device socket they are
ignored.

## Control messages

Relay → machine:

| Message | Meaning |
|---|---|
| `{"t":"open","ch":N,"device":"<id>"}` | channel N is now bound to that device |
| `{"t":"close","ch":N}` | channel N is dead (device left, was revoked, or was too slow) |
| `{"t":"ok","req":N}` | the machine's request N succeeded |
| `{"t":"err","req":N,"code":"<snake_case>"}` | the machine's request N failed |
| `{"t":"letter","id":N,"device":"<id>","data":"<b64url>","created_at":<unix ms>}` | a stored letter for this machine |

Machine → relay:

| Message | Meaning |
|---|---|
| `{"t":"identity","req":N,"pub":"<b64url>"}` | publish the machine's public identity bundle |
| `{"t":"allow","req":N,"device":"<id>","token_hash":"<64 hex>"}` | authorise a device by sha256 of its token |
| `{"t":"revoke","req":N,"device":"<id>"}` | drop the device; a live device socket is closed with 4003 |
| `{"t":"close","ch":N}` | close the device socket bound to channel N (4000) |
| `{"t":"sleep"}` | the machine is going away; devices are told `asleep`. Cleared by any later machine frame or reconnect |
| `{"t":"letter_ack","id":N}` | the letter with that id was handled; the relay deletes it |
| `{"t":"alert_targets","req":N,"targets":[{"device":"<id>","platform":"apns"\|"fcm","token":"<push token>"}]}` | replace this machine's offline-alert targets (max 32) |
| `{"t":"watch","on":true\|false}` | the machine is working; `true` arms the offline alert below |
| `{"t":"push","req":N,"platform":"apns"\|"fcm","token":"<push token>","kind":"approval"\|"done"\|"attention"\|"generic","data":"<b64url, ≤3072 bytes decoded>","collapse":"<≤64 chars, optional>","priority":"high"\|"normal"}` | send one opaque push to a device |

`err` codes: `bad_identity`, `bad_device`, `too_many_devices`, `bad_target`, `too_many_targets`,
`bad_request`, `push_unconfigured`, `push_token_invalid`, `push_rejected`, `push_failed`,
`rate_limited`, `db_error`. Unknown `t` is ignored (forward compatibility); malformed JSON, or a known
`t` missing a required field, closes the socket with 1008. `allow` and `revoke` are idempotent;
re-allowing an existing device is always permitted. `watch` and `letter_ack` answer `ok` only when a
`req` is present; `alert_targets` and `push` report field problems as `err` instead of closing the
socket.

Relay → device, text:

```json
{"t":"status","machine":"online"|"offline"|"asleep","last_seen":<unix ms or null>}
```

Sent on connect and again whenever the machine's state changes.

## Letters

`POST /v1/letters` stores one opaque letter from a device for its machine, so a prompt can be queued
while the Mac sleeps and lock-screen Approve/Deny works without an open session. The body is the raw
bytes (`application/octet-stream`); the relay never parses them. The reply is
`202 {"id":N,"delivered":bool}`, true only when the letter was handed to a machine socket that is
attached right now; it is stored either way and removed only when the machine acks its id.

Delivery is at-least-once: the relay sends every pending letter in `id` order when a machine socket is
established and redelivers anything unacked on the next connect, so the machine must dedup by `id`.
`letter_ack` is the only way to retire one.

Limits: 64 KiB per letter (413 `letter too large`), 100 letters and 1 MiB total per machine
(507 `{"error":"mailbox_full"}`), 60 letters/hour per device (429 `rate limited`), 24 h TTL. Expiry is
enforced twice: an expired letter is never delivered, and a sweep every 10 min deletes expired rows.
Auth is the device headers of `/v1/device`; a wrong token, unknown device or malformed id is 401.

## Push

A machine asks the relay to send one opaque push (`{"t":"push"}` above) and gets `ok` once the
provider accepted it. Provider work happens off the socket loop, at most 64 calls in flight; the
machine gets 120 pushes/min and a relay at its ceiling answers `rate_limited` rather than queueing.

- APNs (HTTP/2, ES256 JWT from the `--apns-key` .p8, cached and refreshed every 50 min): headers
  `apns-topic=<bundle id>`, `apns-push-type=alert`, `apns-priority` 10 for `high` / 5 for `normal`,
  `apns-collapse-id` when given. Body:
  `{"aps":{"alert":{"title":"Broski","body":"New activity"},"mutable-content":1,"category":"<kind>","sound":"default"},"m":"<machine id>","k":"<kind>","e":"<data b64url>"}`
  `sound` is present only for `approval` and `attention`; the text is the fallback the phone replaces
  after its Notification Service Extension decrypts `e`.
- FCM HTTP v1 (RS256 service-account JWT exchanged for an OAuth2 token, cached until 60 s before
  expiry): `{"message":{"token":...,"data":{"m":...,"k":...,"e":...},"android":{"priority":"HIGH"|"NORMAL","collapse_key":...}}}`
  — data-only, so the app decrypts and posts a local notification itself.

Provider answers map to `push_token_invalid` (APNs 410 or `BadDeviceToken`/`DeviceTokenNotForTopic`/
`Unregistered`, FCM `UNREGISTERED`/`INVALID_ARGUMENT` on 400/404), `push_rejected` (other provider 4xx)
or `push_failed` (network, 429, 5xx). Logs carry the machine id prefix, kind and outcome only.

## Relaying a push upstream

A relay configured **without** provider keys but with `--push-upstream <url>` forwards every push (its
request fields plus the machine id) to that URL, another relay's public `POST /v1/push`: that endpoint
takes `{"platform","token","kind","data","collapse","priority"}` plus an optional `"machine"` (sent by
a forwarding relay, empty when a caller omits it) and is rate limited per push token and per client IP.
It exists only on a relay with provider keys, so a keyless relay answers 404 and keyless chains cannot
loop; an upstream failure maps back exactly like a provider failure. This endpoint has no
authentication: only point `--push-upstream` at relays you control.

## Offline alerts

The one push the relay builds on its own. The machine registers up to 32 targets with `alert_targets`
(stored, replacing the previous list) and sets `watch:true` while an agent is working. If the machine
socket then disappears (close or liveness timeout) or the machine sends `sleep`, and it has not come
back within 60 s, the relay pushes kind `offline` to every target: `data` = b64url of
`{"machine":"<id>","state":"offline"|"asleep","since":<unix ms>}`, `collapse` = `offline-<first 8 of
machine id>`, priority `high`. A reconnect, any frame after a `sleep`, or `watch:false` cancels it, and
`watch` resets to false after alerting and on reconnect. The payload is relay knowledge only — no
ciphertext, no device ids — so it leaks nothing; with push unconfigured, no alert is armed.

## Channel lifecycle

One machine socket per id (a new authenticated one closes the old with 4001). One device socket per
`(machine, device)` pair, same rule. Channels are allocated per machine socket: non-zero, unique while
in use, never reused within a session. The relay opens a channel when a device connects to an online
machine and again for every waiting device when the machine (re)connects. If the machine goes offline its
channels are dropped, the device socket stays connected and receives `offline`; while it is offline the
device's binary frames are dropped silently. Device sockets never block each other or the machine.

## Close codes

| Code | Sent by the relay when |
|---|---|
| 1001 | no frame from the peer within the liveness timeout |
| 1008 | malformed control message on the machine socket |
| 1009 | a WebSocket message exceeded the size limit |
| 1012 | the relay is shutting down (SIGINT/SIGTERM); clients should reconnect |
| 4000 | the machine asked to close that channel |
| 4001 | a newer socket replaced this one |
| 4003 | the device was revoked |
| 4008 | the socket was too slow (its outbound queue overflowed) |

## Limits

| Limit | Value | On breach |
|---|---|---|
| WebSocket message | 256 KiB | close 1009 |
| allowed devices per machine | 32 | `err` `too_many_devices` |
| upgrade rate per IP | 30/min, burst 10 | HTTP 429 before the upgrade |
| outbound queue, device socket | 4 MiB | close that device (4008) |
| outbound queue, machine socket | 8 MiB | close the device that was sending (4008) |
| socket outbound queue | 512 messages | treated as an overflow |
| ping / liveness | ping every 20 s, checked every 5 s | close 1001 after 45 s without a frame |
| `last_seen` flush | at most every 30 s, plus on disconnect | — |
| letter | 64 KiB body, 100 letters and 1 MiB per machine, 60/hour per device | 413, 507 `mailbox_full`, 429 |
| letter lifetime | 24 h (swept every 10 min) | never delivered, then deleted |
| offline alert targets | 32 per machine | `err` `too_many_targets` |
| machine pushes | 120/min | `err` `rate_limited` |
| `/v1/push` | 30/min per push token, 120/min per client IP | HTTP 429 |

Queues are per socket and bounded, so no socket can stall another. The in-memory machine registry is
not garbage collected; its growth is bounded only by the per-IP upgrade rate.

## Persistence

SQLite (`--db <path>`, WAL, schema created on startup), written from a dedicated thread:

```sql
machines(id PK, secret_hash BLOB, pub BLOB NULL, last_seen INTEGER NULL, created_at INTEGER)
devices(machine_id, device_id, token_hash BLOB, created_at, PK(machine_id, device_id))
letters(id INTEGER PK AUTOINCREMENT, machine_id, device_id, data BLOB, created_at)
alert_targets(machine_id, device_id, platform, token, PK(machine_id, device_id))
```

Only hashes are stored for secrets and tokens. Letters are the device's ciphertext and
`alert_targets.token` is a device push token: both are opaque, both can be replayed to APNs/FCM by
anyone who reads the database file, and both are deleted when no longer needed (a letter on ack or TTL
expiry, alert targets when the machine replaces its list). `last_seen` is kept in memory and flushed at
most every 30 s and on disconnect, so a restart can answer `/v1/status` and `/v1/identity` for offline
machines. Live sockets, channels, `asleep`, `watch` and armed alerts are not persisted; letters
survive a restart until they expire.

## CLI

```
broski-relay --listen 0.0.0.0:8765 --db /var/lib/broski/relay.db [--tls-cert cert.pem --tls-key key.pem]
             [--apns-key AuthKey.p8 --apns-key-id <kid> --apns-team-id <team> --apns-topic <bundle id> [--apns-sandbox]]
             [--fcm-service-account service-account.json] [--push-upstream https://relay.example/v1/push]
```

Without `--tls-cert/--tls-key` the relay speaks plain HTTP/WebSocket; production deployments terminate
TLS in front of it (or pass the PEM pair, which enables rustls directly). Push is off unless APNs keys,
a Firebase service account or an upstream relay is configured; `--apns-endpoint`, `--fcm-endpoint` and
`--fcm-token-endpoint` are hidden test overrides of the provider base URLs. `RUST_LOG` controls tracing
output; ids are truncated to 8 characters in logs, and tokens, payloads and keys are never logged.
