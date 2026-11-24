# broski-relay

The rendezvous a Mac and its phones both dial out to when they cannot reach each other on the LAN. It forwards
Noise-encrypted frames between a machine socket and its device sockets, stores opaque letters for a machine that is
asleep, and sends opaque pushes to APNs and FCM. It never sees plaintext. What it can and cannot see, every endpoint,
limit and close code: [`docs/architecture/connectivity-v2/relay-protocol.md`](../../../docs/architecture/connectivity-v2/relay-protocol.md).

Broski runs no public relay. Without one, a phone reaches its Mac only on the same network. This page is how to run
your own.

## What it needs

- A host both the Mac and the phone can reach, with a DNS name and a TLS certificate for it. Phones dial `wss://`;
  they accept plain `ws://` only to a loopback or private address.
- The relay at the **root** of that name. The phone always dials `/v1/device` on the relay's host and port, whatever
  path the URL carries, so a relay behind a path prefix is unreachable from the phone.
- One TCP port (examples use `8765`) and a directory for its SQLite database.

## Build and run

From source, in `packages/link`:

```bash
cargo build --release --locked -p broski-relay
sudo install -d -o "$USER" -m 700 /var/lib/broski
target/release/broski-relay --listen 0.0.0.0:8765 --db /var/lib/broski/relay.db
```

`target/` is `$CARGO_TARGET_DIR` when that is set. The database file is created when missing; its directory is not.
`RUST_LOG` sets the log level (`info` by default); logs carry ids cut to 8 characters, never tokens, payloads or keys.

With Docker, from `packages/link` (the build context is the whole Cargo workspace):

```bash
docker build -f relay/Dockerfile -t broski-relay .
docker run -d --name broski-relay --restart unless-stopped \
  -p 127.0.0.1:8765:8765 -v broski-relay:/data broski-relay
```

The image runs `broski-relay --listen 0.0.0.0:8765 --db /data/relay.db` as an unprivileged user; arguments after the
image name replace those defaults. `relay/Dockerfile.dockerignore` keeps `target/` out of the build context.

Check it: `curl http://127.0.0.1:8765/healthz` answers `ok`.

## Options

| Flag | Meaning |
|---|---|
| `--listen <addr:port>` | Address to listen on (required) |
| `--db <path>` | SQLite database, created when missing in a directory that exists (required) |
| `--tls-cert <pem>` `--tls-key <pem>` | Serve TLS itself; both or neither |
| `--apns-key <p8>` `--apns-key-id <kid>` `--apns-team-id <team>` `--apns-topic <bundle id>` | Push to iOS through APNs; all four together |
| `--apns-sandbox` | Use the APNs sandbox host (development builds of the app) |
| `--fcm-service-account <json>` | Push to Android through FCM |
| `--push-upstream <url>` | Forward pushes for any platform this relay has no provider keys for to another relay's `/v1/push`; `https://` unless it is on loopback |
| `--register-token-file <path>` | Only machines that present the token in this file (16+ characters) may register; machines already registered are unaffected |

`broski-relay --help` prints the same list.

## TLS

Either put a reverse proxy in front of the relay, or give the relay the certificate.

**Caddy** (gets and renews the certificate itself; proxies WebSockets with no extra setting):

```
relay.example.com {
	reverse_proxy 127.0.0.1:8765
}
```

**nginx**:

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;
    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

The relay pings every socket every 20 s, so proxy idle timeouts of a minute or more do not cut a quiet link.

Behind a proxy the relay sees every client as the proxy's address: it reads the TCP peer, not `X-Forwarded-For`. Its
per-address limits (WebSocket upgrades: burst 10, then 30 a minute; `/v1/push`: 120 a minute) are then shared by all
clients. That is enough for one Mac and a few phones; for more, serve TLS from the relay:

```bash
broski-relay --listen 0.0.0.0:443 --db /var/lib/broski/relay.db \
  --tls-cert /etc/letsencrypt/live/relay.example.com/fullchain.pem \
  --tls-key /etc/letsencrypt/live/relay.example.com/privkey.pem
```

The certificate is read once at start: restart the relay after each renewal.

## Keep strangers off your relay

Without a register token, any machine on the internet may register with a relay it can reach and use it as its own.
For a relay that serves only your Macs, write a long random token to a file only the relay's user can read and start
the relay with it:

```bash
openssl rand -hex 32 > /var/lib/broski/register-token && chmod 600 /var/lib/broski/register-token
broski-relay --listen 0.0.0.0:8765 --db /var/lib/broski/relay.db --register-token-file /var/lib/broski/register-token
```

Then give each Mac the same token (below). A Mac registered before the token was set keeps working without it.

## Point the Mac at it

The daemon reads the relay URL from `~/.broski/link/config.json` at start:

```json
{ "relay": "wss://relay.example.com", "relay_register_token": "<the token, if the relay has one>" }
```

With a token in it, keep the file private: `chmod 600 ~/.broski/link/config.json`. The daemon refuses a `ws://` relay
URL that is not on loopback: the machine's relay secret would cross the network in the clear.

Restart the daemon (`broski restart`, or `bun bin/broski.ts restart` in `packages/bridge` when running from source;
a daemon started by hand takes `broski-link run --relay wss://relay.example.com`). `broski-link status` shows whether
the relay is connected. Pairing offers made after that carry the relay (`r=` in the `broski://pair` link), and the
daemon sends its routes, the relay among them, to every phone each time it attaches, so phones paired earlier learn it
the next time they reach the Mac.

## Push

Push is off unless the relay has provider keys or an upstream. Notifications, the lock-screen Allow and Deny, and the
relay's offline alert all need it.

- **iOS**: an APNs key (`.p8`) of the Apple team the app is signed with, and the app's bundle id as `--apns-topic`.
- **Android**: the Firebase project's service account JSON, for the Firebase project built into the app
  ([`apps/android/README.md`](../../../apps/android/README.md#push-firebase)).
- **Upstream**: with `--push-upstream https://<other relay>/v1/push`, every push for a platform this relay has no keys
  for (APNs or FCM) goes to that relay, which must have them.

A relay with provider keys serves `POST /v1/push` to anyone, unauthenticated and rate limited, so anyone who knows a
device's push token can send that device a push through it. Only point `--push-upstream` at relays you control.

## What the database holds

Hashes of machine secrets and device tokens, each machine's public key and last-seen time, letters (device
ciphertext, deleted on delivery or after 24 h) and the push tokens of offline-alert targets. Letters and push tokens
can be replayed to APNs or FCM by anyone who can read the file: keep it private to the relay's user.
