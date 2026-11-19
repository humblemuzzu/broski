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

Broski lets you chat with the coding agents running on your computer from your phone: stream their answers and tool
calls, approve or deny their permission prompts, answer their questions, start, resume, fork and rename sessions,
follow sessions you started in the computer's terminal, browse files and git, open a terminal, and dictate.

```
Phone ←Broski Link (Noise end-to-end; LAN or blind relay)→ broski-link daemon ←unix socket→ bridge ←SDK / RPC→ Claude Code, Pi
```

- **Bridge** (`packages/bridge/`, Bun/TypeScript): hosts the agents on your machine and speaks the backend contract.
  It drives the `claude` and `pi` you installed; it never bundles an agent.
- **broski-link** (`packages/link/`, Rust): the daemon that pairs phones by QR code and carries their encrypted
  sessions, directly on the LAN or through a relay that never sees plaintext; and BroskiCore, the Rust core both
  apps share (the link's phone side, the client, the markdown formatter, dictation).
- **Apps** (`apps/ios/`, SwiftUI; `apps/android/`, Jetpack Compose): native, over BroskiCore.

## Status

Broski v1 is in active development and not yet published; the architecture and scope live in
[`docs/rebuild/PLAN.md`](docs/rebuild/PLAN.md). It currently supports Claude Code and Pi and is built around an
extensible backend contract so more agents can be added over time without changing the mobile apps. The unlaunched
Flutter prototype is archived on branch `final-flutter`.

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

Every build, test and the architecture rules are in [`AGENTS.md`](AGENTS.md).

## License

[MIT](LICENSE)
