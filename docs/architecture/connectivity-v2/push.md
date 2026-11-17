# push — the daemon's alerts, letters and keep-awake

How `broski-link` wakes a phone that is not attached, takes a lock-screen decision while the bridge
is idle, and holds the machine awake while an agent works. All of it hangs off two device control
messages and the bridge feed; the crypto is RustCrypto (`chacha20poly1305`, `hmac`, `sha2`) and
nothing here needs a provider key on the daemon.

## What the phone registers

Device control stream (`STREAM_CONTROL`), phone to machine:

| Message | Meaning |
|---|---|
| `{"t":"push_register","platform":"apns"\|"fcm","token":"<push token>","key":"<b64url 32 B K>"}` | replaces this device's previous registration |
| `{"t":"push_unregister"}` | forgets it |

A registration with an unknown platform, a token that is empty, longer than 512 bytes or not
printable ASCII, or a `key` that is not the b64url of exactly 32 bytes is ignored (debug log, no
storage change). A stored one lands in `devices.json` on that device as `push:{platform,token,key}`
(`0600`); the plaintext key is never logged. Any successful change re-publishes the relay's alert
targets.

## Keys

Two keys are derived from the registered `K` and each is used for exactly one direction:

```
notify_key = HMAC-SHA256(key = K, msg = "broski-notify-v1")   # machine -> phone pushes
letter_key = HMAC-SHA256(key = K, msg = "broski-letter-v1")   # phone -> machine letters
```

## Push payload

The `data` of a relay `{"t":"push"}` is `base64url` of

```
nonce(12 random bytes) || ChaCha20-Poly1305-IETF(key = notify_key, nonce, plaintext, aad = machine_id)
```

`aad` is the ASCII machine id (32 lowercase hex). The plaintext is JSON in this field order:

```json
{"v":1,"kind":"approval","title":"…","body":"…","machine":"<machine name>","backend":"claude-code","session":"<id>","request":"<id>|null","at":1725000000000}
```

`machine` is the machine's *name*; the relay's own `m` field on the APNs body is the machine *id*.
The sealed payload is at most 3072 bytes because `body` is shortened on a character boundary until
it fits; a payload that cannot be made to fit at all is not sent.

| kind | when | priority | collapse |
|---|---|---|---|
| `approval` | a pending permission request | `high` | `a-` + the group |
| `attention` | a pending user-input request | `high` | `a-` + the group |
| `done` | a turn went from working to idle | `normal` | `d-` + the group |

The group is the bridge feed's `request` when it has one and the `session` otherwise, cut to its
first 40 printable-ASCII bytes — at most 42 characters, inside the relay's 64.

## Letters

The relay hands over `{"t":"letter","id":N,"device":"<id>","data":"<b64url>","created_at":ms}`. The
`data` is

```
nonce(12 random bytes) || ChaCha20-Poly1305-IETF(key = letter_key of that device, nonce, plaintext,
                                                  aad = machine_id + ":" + device_id)
```

and the plaintext is one of

```json
{"v":1,"id":"<32 hex>","at":ms,"kind":"decision","backend":"claude-code","session":"<id>","request":<any>,"decision":"allow"|"deny"}
{"v":1,"id":"<32 hex>","at":ms,"kind":"bridge","message":"<bridge JSON text>"}
```

A letter is rejected — debug log, then ack, so the relay retires it — when the device is unknown or
has no registration, the key or the b64url does not decode, the AEAD does not open, `at` is older
than the TTL (24 h) or more than 5 min in the future, or its `id` was already handled. Handled ids
live in `letters_seen.json` (`0600`), pruned past 24 h and capped at 10 000 entries. A letter that was
acted on, or rejected, gets `{"t":"letter_ack","id":N}`. A letter that opened but could not be acted
on — the bridge was unreachable, or never answered a decision — is not acked and its id is taken back
out of the seen list, so the relay's redelivery (on the machine socket's next attach) is handled like
new. At-least-once delivery plus the seen list is what makes this safe: the bridge refuses a second
decision for a request it has already settled.

- `decision` becomes `{"type":"link_decision","backend","session","request","decision"}` on the
  bridge feed, and the daemon waits up to 10 s for the bridge's
  `{"type":"link_decision_result","request","ok","error"}`, correlated on the echoed `request`.
- `bridge` is written verbatim on that device's bridge websocket: the one its session already holds
  when there is one, otherwise the single letter pipe the daemon keeps per device (four letters in
  flight, closed when idle).

## The bridge feed

One websocket per process on the bridge's unix socket, upgraded with `x-broski-role: link-daemon`
and no device id, reconnecting 0.25 s to 5 s (jittered) and re-dialling the moment the socket or the
liveness check fails. Every 30 s it sends `{"type":"link_feed_ping"}` and expects
`{"type":"link_feed_pong"}` within 5 s, so a half-open socket is noticed before it is trusted.

```json
{"type":"link_busy","busy":true}
{"type":"link_event","kind":"approval","backend":"claude-code","session":"<id>","cwd":"<basename>","title":"…","body":"…","at":ms,"request":"<id>"}
```

The feed stays up whether or not anything is asking it for something: a feed request inbox with no
senders left is not a reason to drop the socket the bridge reports on.

## Policy

`link_event` pushes to every paired device that has a registration **and** whose session is not
attached right now — an attached phone already saw the event on its link. The same
`(kind, request|session)` pair is never pushed twice inside 60 s, including across a feed reconnect,
so a bridge that repeats itself cannot wake a phone twice.

## Watch and keep-awake

`{"t":"watch","on":busy}` goes out after every relay (re)connect and on every change of the feed's
`busy`. While busy **and** the machine is on AC or has at least 30 % battery, the daemon holds a
`broski_link_power::AwakeAssertion`; it re-evaluates every 60 s, releases after 8 h of one continuous
hold, and re-arms only on the next false → true edge of `busy`. A platform without power integration
is logged once and skipped. `{"t":"alert_targets","req":N,"targets":[…]}` follows the same
connect-and-change rule, listing every device with a registration.

`PowerMonitor` (2 s grace) reports `WillSleep`: the daemon queues `{"t":"sleep"}` on the machine
socket and waits up to the grace for the write to land, so the relay can put the devices to sleep
before the machine goes down. `DidWake` needs no message.

## Bounds

| Queue | Bound | On breach |
|---|---|---|
| feed request inbox | 16 | the caller's wait expires |
| feed pending decisions | one per `request` value, one letter at a time | — |
| letter inbox | 128 | the letter is left for the relay to redeliver |
| seen letter ids | 10 000, 24 h | the oldest entry is dropped |
| push dedupe | pairs seen inside the 60 s window | — |

## Pinned vectors

`K` = `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`
(`AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8` in b64url), `machine_id` =
`00112233445566778899aabbccddeeff`, `device_id` = `ffeeddccbbaa99887766554433221100`, `nonce` =
`000102030405060708090a0b`.

| | value |
|---|---|
| `notify_key` | `505ae8693846c4ed5fa9bbc8bcf76ece21ce094f17fe9aeac073d747924c18aa` |
| `letter_key` | `4dadde591d18313f5a52adf5e141625d088ea72b897634b10a8ca81b81568acb` |

Push plaintext (`aad` = `machine_id`):

```json
{"v":1,"kind":"approval","title":"Approve Bash","body":"rm -rf /tmp/x","machine":"studio","backend":"claude-code","session":"s-1","request":"req-1","at":1725000000000}
```

`data` =
`AAECAwQFBgcICQoLGP7NBqpe6fhmcRNNJuVawmekWhPUZPom-mq8ZzhnTslXseBbcfqZqXlXJdPEbtDWLbFnH60g4K2bNEgCgUuQAopC812JSrEC3djnYEBxRERNasUc0ySeDbPOItHmHtxh-rLeWJ8SVgZbuFz2JfdxnOMDMjpPHuuH6EVTsd2PELEKAWhErt4BLWBPMtp8aF0itaJ76RGjuBepM0THYB5VVvEoLRstI-AyhPjpUijXNwBR_ziZedbO`

Letter plaintext (`aad` = `machine_id + ":" + device_id`):

```json
{"v":1,"id":"00112233445566778899aabbccddeeff","at":1725000000000,"kind":"decision","backend":"claude-code","session":"s-1","request":"req-1","decision":"allow"}
```

`data` =
`AAECAwQFBgcICQoLVRHy1XQgQ9n016Elt0wPN4w9zepY4Su0q5hZ-Z-pmP9Iklw4GjQfdHQF5acpnK-Vj2nA6gxu2Xdi--V9t4FbShNWUQDsTv_4COgt2Sf4JPgS-YHGQij1GWbZfFro6isfIQGmluu6P-hj6rh_FQIElavvQn8gpocOyk3CEWg2QyYp2plNM4Q_xFf3VigfFFbo_1ClYwgDYpD7PutLUC0IFrk6JmLev7WfDdpJqffKKGsU`

`daemon/tests/push_vectors.rs` pins all of these. The vectors were produced outside this crate with
Node's OpenSSL-backed ChaCha20-Poly1305 — `crypto.createCipheriv("chacha20-poly1305", key, iv,
{authTagLength: 16})`, whose `getAuthTag()` is appended after the ciphertext, exactly where
RustCrypto's `Aead::encrypt` puts it — so a wrong label, AAD or field order cannot pass by being
consistently wrong in Rust.

## Verified

Apple M4 Pro, macOS 27.0.1. `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D
warnings` and `cargo test --workspace` are clean.

- `daemon/tests/push_vectors.rs` (6) — both keys, the registered-key decoder, the push and letter
  ciphertexts, the field order, and that a letter for another machine, another device or a truncated
  payload never opens.
- `daemon/tests/alerts.rs` (1) — the real relay with a local HTTP/2 APNs mock (throwaway P-256 key)
  and a daemon whose feed is driven by the test: a detached registered phone gets exactly one push
  whose `data` opens with the key it registered and equals the documented JSON; a second identical
  event inside the window, and an event while the phone is attached, produce none; `done` is normal
  priority and silent; the registration is in `devices.json` at `0600` and reaches the relay as an
  alert target; both edges of `watch` reach the relay; the feed keeps its one connection across its
  pings.
- `daemon/tests/letters.rs` (4) — a decision letter becomes `link_decision` on the feed and is acked
  (the relay's row is gone); the same letter replayed and a letter 25 h old are acked without being
  acted on; a `bridge` letter arrives verbatim on the device's own bridge socket.
- `daemon/tests/power.rs` (1) — while the feed says an agent is working, `pmset -g assertions` lists
  `PreventUserIdleSystemSleep named: "broski-link: agent working"`, and it is gone after `busy:false`;
  the daemon keeps that one feed socket with no relay configured. Skipped with a printed reason on
  battery below 30 %.
