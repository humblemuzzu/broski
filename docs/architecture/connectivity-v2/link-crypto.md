# link-crypto — Broski Link end-to-end crypto

Crate `packages/link/crypto` (`broski-link-crypto`). Library only, sans-IO: no sockets, no
async, no clock, no config. It owns the handshake, the static identity format and the QR v2
pairing offer. The relay never runs it; the relay forwards opaque bytes.

## Suite

| Piece | Choice |
|---|---|
| Handshake | Noise `hybridIK` (X25519 + ML-KEM-768), two messages |
| PSK modifier | `psk1`, Pair mode only |
| Cipher | AES-GCM, 16-byte tags |
| Hash | SHA-256 |
| Library | `clatter` 2.2.0 — `alloc`, `getrandom`, `use-25519`, `use-aes-gcm`, `use-rust-crypto-ml-kem`, `use-sha` |

Exported suite string: `Noise_hybridIK_X25519+MLKEM768_AESGCM_SHA256`. clatter's own protocol
name — the string hashed into the transcript — is `Noise_hybridIKpsk1_25519+MLKEM768_AESGCM_SHA256`
for Pair and `Noise_hybridIK_25519+MLKEM768_AESGCM_SHA256` for Connect; a unit test pins both.

## Keys

Public bundle, 1217 bytes: `[1][X25519 public 32 B][ML-KEM-768 encapsulation key 1184 B]`.

- `fingerprint()` = SHA-256 over those 1217 bytes.
- `id()` = lowercase hex of `fingerprint[..16]`, 32 chars. This is the machine id and the device
  id everywhere (relay routing, device lists, reconnects).
- `from_bytes` rejects any length other than 1217 and any version other than 1.

Identity secret, 3617 bytes, returned as `Zeroizing<Vec<u8>>`:
`[1][X25519 secret 32 B][ML-KEM-768 decapsulation key 2400 B][ML-KEM-768 encapsulation key 1184 B]`.
The encapsulation key is stored because clatter's `Kem` trait cannot re-derive it from a
decapsulation key. Secrets zeroize on drop and `Debug` prints only the id.

## QR v2

```
broski://pair?v=2&h=<b64url fp 32 B>&s=<b64url secret 32 B>&e=<unix secs>&n=<%name>[&r=<%relay url>][&l=<host:port,host:port>]
```

- base64url without padding; `n` and `r` are percent-encoded UTF-8.
- `h` and `s` must decode to exactly 32 bytes; `e` must parse as `u64`.
- `name` at most 64 bytes; `l` at most 8 entries, each `host:port` with a host of
  `[A-Za-z0-9._-]` and a port in 1..=65535 (hostnames and IPv4 literals, no IPv6 literals).
- `r` must start with `ws://` or `wss://`.
- Parsing is strict: unknown, duplicate and missing parameters, broken percent escapes and
  non-UTF-8 names all fail closed. `to_uri` does not enforce the limits — the producer must keep
  `name` within 64 B and the LAN list within 8 entries, or the phone rejects the QR.
- `is_expired` compares with `>=`: true at exactly the expiry second.

## Wire format

```
msg1 = [protocol_version = 1][mode: 1 = Pair, 0 = Connect][Noise message 1]
msg2 = Noise message 2, no framing
```

Measured with empty payloads, identical for both modes: **msg1 = 3570 B**, **msg2 = 3424 B**.

- msg1: 2 B header, ML-KEM ciphertext to the responder static 1088 B, KEM ephemeral public key
  1184 B, DH ephemeral 32 B, encrypted DH static 48 B, encrypted KEM static 1200 B, payload tag 16 B.
- msg2: ML-KEM ciphertext to the initiator ephemeral 1088 B, ciphertext to the static 1104 B,
  KEM ephemeral public key 1184 B, DH ephemeral 32 B, payload tag 16 B.
- Handshake payloads are opaque bytes, capped at `MAX_HANDSHAKE_PAYLOAD` = 4096 B per message.

Limits: `MAX_NOISE_MESSAGE` = 65535 (clatter), `MAX_PLAINTEXT` = 65519 (65535 minus the 16-byte
tag). Longer input is rejected in this crate; clatter panics above `MAX_MESSAGE_LEN`.

## Pairing-secret binding

Pair mode uses clatter's `noise_hybrid_ik_psk1` pattern, not a prologue mix, so no fallback was
needed. The PSK token sits at the end of message 1, so the pairing secret is mixed into the
chaining key before message 1's payload is encrypted: a wrong secret makes the **responder's**
read of message 1 fail and the responder never writes a reply. Verified by test.

The prologue is `b"broski-link/v1" || mode byte`, the same on both sides, so it domain-separates
the protocol and makes a message minted in one mode undecryptable in the other — the plaintext
mode byte cannot be rewritten. `psk` adds no wire bytes, hence the identical message sizes.

## Caller contract

- Exactly two handshake messages, both before any transport record.
- One `Transport` per connection. Noise counter nonces require in-order, exactly-once delivery;
  replayed, reordered or truncated records fail AEAD and are dropped.
- A failed `open` does not advance the receive counter, so a corrupt record cannot desynchronise
  the stream. Framing, size limits and rate limiting stay the caller's job.
- `read_first` returns the initiator's static bundle and the mode kind; accepting or rejecting is
  caller policy (rejection = drop the `Responder`).
- Pair mode with no secret from the closure is an error, never a downgrade to Connect.

## Threat notes

- The relay sees sizes and timing only. It holds no keys and cannot read or forge records.
- The initiator pins the responder's full bundle before message 1, and the responder's static
  keys authenticate that message: an active MitM that does not hold the pinned static keys fails.
- ML-KEM-768 protects a recorded handshake against a future quantum attacker; X25519 covers a
  break of ML-KEM. Both must fall for the session key to fall.
- The QR contains the pairing secret and the fingerprint, so QR confidentiality is pairing
  confidentiality. The secret is 32 bytes, single-use by policy, and time-limited by `expires_at`.
- Static keys are long-lived and stored as one versioned blob. Rotation is the caller's job and
  changes the id.
- Nothing here persists nonces or a replay window, so replayed message 1 is stopped by responder
  policy alone (a pairing offer is consumed once).
- Handshake cost is ~545 µs and message 1 is 3.5 KB: cheap enough to accept, expensive enough to
  rate-limit.
- Every record costs a 16-byte tag and at most 65519 B of plaintext, so larger payloads are
  chunked by the caller.

## Measured

Apple M4 Pro, `cargo test --release -- --ignored --nocapture`, empty handshake payloads, averages
of 200 handshakes and 256 transport round trips across three runs:

- full Connect handshake (start + read_first + reply + finish): **545–620 µs**
- seal + open of 65519-byte messages into reused buffers: **98–102 MB/s**, 613–638 µs per round
