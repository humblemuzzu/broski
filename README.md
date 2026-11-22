<div align="center">

```

   ██████╗ ██████╗  ██████╗ ███████╗██╗  ██╗██╗
   ██╔══██╗██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██║
   ██████╔╝██████╔╝██║   ██║███████╗█████╔╝ ██║
   ██╔══██╗██╔══██╗██║   ██║╚════██║██╔═██╗ ██║
   ██████╔╝██║  ██║╚██████╔╝███████║██║  ██╗██║
   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝

```

**Your AI coding agents, in your pocket.**

*A phone remote for [Claude Code](https://claude.ai/code) and [Pi](https://github.com/earendil-works/pi)*

[![License](https://img.shields.io/github/license/humblemuzzu/broski?style=flat)](LICENSE)

</div>

> This project is not built by the Anthropic or Pi teams. It is an independent client that drives their SDKs and
> CLIs.

## What it is

Broski is a phone remote and inbox for the AI coding agents on your Mac. The iOS app (SwiftUI) and the Android app
(Jetpack Compose) are native, and both run the same Rust core. The phone reaches the Mac end-to-end encrypted with
Noise (hybrid X25519 + ML-KEM-768): directly on the LAN when it can, otherwise through a relay that forwards
ciphertext it cannot read. On the Mac, Broski drives the `claude` and `pi` you already installed, with your config
and extensions; it bundles no agent. Agents plug in through an open backend contract, so adding one needs no app
update.

```
   iOS app (SwiftUI)                 Android app (Compose)
          └─────────────┬─────────────────────┘
                BroskiCore (Rust, UniFFI)
                        │  Broski Link: Noise (X25519 + ML-KEM-768), LAN or blind relay
              broski-link daemon (Rust, launchd)
                        │  unix socket ~/.broski/link/bridge.sock
                 bridge (Bun / TypeScript)
                        │  SDK / RPC
          Claude Code · Pi · any AgentBackend
```

## Status

Unreleased and in active development. There are no App Store or Play Store builds, no published bridge package and
no hosted relay yet: you build everything from this repository. The plan and scope are in
[`docs/rebuild/PLAN.md`](docs/rebuild/PLAN.md); the unlaunched Flutter prototype is archived on branch `final-flutter`.

## Quickstart (from source)

On the Mac you need Bun 1.4.4 or newer, a Rust toolchain, and Claude Code or Pi installed and signed in.

```bash
git clone https://github.com/humblemuzzu/broski && cd broski
(cd packages/link && cargo build --release --locked -p broski-link-daemon)   # builds broski-link
cd packages/bridge && bun install
bun bin/broski.ts install                     # registers broski-link as a launchd user service; it runs the bridge
../link/target/release/broski-link pair       # prints a pairing QR code and link
```

Then build the app and pair it:

- **Android** (JDK 17 and the Android SDK; versions in [`CONTRIBUTING.md`](CONTRIBUTING.md)):
  `scripts/build-android-core.sh && scripts/build-android-terminal.sh && (cd apps/android && ./gradlew :app:installDebug)`.
- **iOS** (Xcode and XcodeGen): `scripts/build-ios-app.sh` builds for the simulator. Signing for your own iPhone is
  covered in [`CONTRIBUTING.md`](CONTRIBUTING.md#ios-signing).

In the app, scan the QR code or paste the `broski://pair?…` link. With no relay configured the phone reaches the Mac
only on the same network; to reach it from anywhere, run your own relay
([`packages/link/relay/README.md`](packages/link/relay/README.md)). `broski-link status` and
`bun bin/broski.ts doctor` diagnose the link and the bridge.

## Features

- **Inbox** across all paired Macs: permission prompts, questions and finished runs, with Approve and Deny on the row.
  Push notifications with Allow and Deny on the lock screen (needs a relay with push keys).
- **Chat**: streamed answers, thinking and tool calls; diffs with word-level emphasis; Broski's own markdown formatter
  and code highlighting. Start, resume, fork and rename sessions; steer or queue a prompt while a run is going.
- **Questions and alerts**: Broski's Pi extension adds a `broski_ask` tool for stock Pi (suppressed automatically when a
  cooperating user extension already provides phone questions, and handed off cleanly if resumed in a terminal). The
  bridge also serves an authenticated loopback HTTP MCP endpoint (`/mcp`) offering `broski_ask`, `broski_notify` (wired
  for Claude Code) and `broski_propose_plan` to plugin and future adapters.
- **Prompt cache timer**: the time left on the agent's prompt cache, when the agent reports its lifetime, and the
  latest request's cache hit ratio.
- **Files, git and a terminal** for the session's folder: browse, read and search files; status, diff, stage, commit,
  branches, checkout and log; a terminal on libghostty.
- **Dictation** through xAI's speech-to-text with your own API key, or the phone's own recognizer without one.
- **Terminal sessions**: follow sessions you started in the Mac's terminal, and answer Claude Code's terminal
  permission prompts from the phone.
- **Live Activity** (iOS) and **Live Update** (Android) while agents work, and Claude and Antigravity plan usage.

## Supported agents

- **Claude Code**, through the Claude Agent SDK (0.3.328) driving your installed `claude`.
- **Pi**, over `pi --mode rpc` with your installed `pi` (tested against Pi 1.5.2).

Every agent is an `AgentBackend` behind the backend contract
([`docs/architecture/contract/README.md`](docs/architecture/contract/README.md)), and the apps never branch on which
one it is. Third-party adapters can be loaded as plugins from `~/.broski/config.json` (`broski-bridge/plugin`); Codex,
Gemini CLI, Cursor, Grok, OpenCode and the shared ACP adapter are not built yet, and how to add them is documented in
[`docs/architecture/open-source-blueprint.md`](docs/architecture/open-source-blueprint.md#4-part-iii--complete-guide-to-adding-any-new-agent-later).

## Security model

Broski is a personal tool: you own the phone and the Mac. A paired phone can do what you can do at the Mac's
terminal: run agents, commands and a shell, and read and write files. Pair only phones you own.

- **Pairing** is a QR code carrying the Mac's key fingerprint, a one-time secret and an expiry. The first pairing
  consumes the secret.
- **Encryption**: every session is Noise end to end (hybrid X25519 + ML-KEM-768), with the Mac's fingerprint pinned
  from the QR code.
- **The relay is blind**: it forwards encrypted frames and sees ids, timing, sizes and push metadata, never plaintext
  ([`relay-protocol.md`](docs/architecture/connectivity-v2/relay-protocol.md)).
- **Revocation** is per device: `broski-link devices` lists them, `broski-link revoke <id prefix>` removes one.
- **No exposure of the bridge**: it listens on a unix socket guarded by a key the daemon rewrites at every start, and
  on 127.0.0.1 only, behind a bearer token (and TLS, which compiled builds force). No VPN, tunnel or port forwarding
  is involved.

Design: [`docs/architecture/connectivity-v2/`](docs/architecture/connectivity-v2/).

## Platform support

- **Host**: macOS only today (a launchd service). Linux would need a `systemd` user service and a port of the
  macOS-specific parts; contributions are welcome.
- **Phones**: iOS 26 and later; Android 8.0 (API 26) and later.

## Development

```bash
scripts/dev-daemon.sh restart                    # single clean daemon + bridge in tmux (stops prior ones)
cd packages/bridge && bun install && bun test    # bridge tests
cd packages/link && cargo test --workspace       # link stack and BroskiCore tests
scripts/build-ios-app.sh                         # build the iOS app (rebuilds BroskiCore if stale)
scripts/install-ios-wifi.sh                      # install on your iPhone over Wi-Fi / USB
scripts/send-ios-to-phone.sh                     # serve an iPhone install page over Tailscale (--stop to tear down)
scripts/clean-workspace.sh                       # audit build caches and processes (--apply / --deep to clean)
```

- [`ARCHITECTURE.md`](ARCHITECTURE.md): the map of the code.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): setup, checks, test rules, adding an agent.
- [`AGENTS.md`](AGENTS.md): every build, test and architecture rule.

## License

[MIT](LICENSE)
