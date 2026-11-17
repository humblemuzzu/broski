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

The project is being rebuilt; the plan is [`docs/rebuild/PLAN.md`](docs/rebuild/PLAN.md). The bridge, the link stack
and both apps work today and are not yet published. The previous Flutter app lives on branch `final-flutter`.

## Development

```bash
cd packages/bridge && bun install && bun dev     # the bridge; bun test runs its tests
cd packages/link && cargo test --workspace       # the link stack and BroskiCore
scripts/build-ios-app.sh                         # the iOS app (builds BroskiCore first)
scripts/send-ios-to-phone.sh                     # installs it on your iPhone over Tailscale
```

Every build, test and the architecture rules are in [`AGENTS.md`](AGENTS.md).

## License

[MIT](LICENSE)
