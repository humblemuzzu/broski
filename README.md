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

*A phone remote for [Claude Code](https://claude.ai/code) and [Pi](https://github.com/mariozechner/pi-coding-agent)*

[![License](https://img.shields.io/github/license/humblemuzzu/broski?style=flat)](LICENSE)

</div>

> This project is not built by the Anthropic or Pi teams. It is an independent client that drives their SDKs and
> CLIs.

## What it is

Broski lets you chat with the coding agents running on your computer from your phone: stream their answers and tool
calls, approve or deny their permission prompts, answer their questions, start, resume, fork and rename sessions,
and follow sessions you started in the computer's terminal.

```
Phone ←Broski Link (Noise end-to-end; LAN or blind relay)→ broski-link daemon ←unix socket→ bridge ←SDK→ Claude Code, Pi
```

- **Bridge** (`packages/bridge/`, Bun/TypeScript): hosts the agents on your machine and speaks the backend contract.
  It drives the `claude` you installed; it never bundles an agent.
- **broski-link** (`packages/link/`, Rust): the daemon that pairs phones by QR code and carries their encrypted
  sessions, directly on the LAN or through a relay that never sees plaintext.
- **Apps**: native iOS (SwiftUI) and Android (Jetpack Compose) apps are being built. The previous Flutter app lives
  on branch `final-flutter`.

## Status

The project is being rebuilt; the plan is [`docs/rebuild/PLAN.md`](docs/rebuild/PLAN.md). The bridge and the link
stack work today; the phone apps do not exist yet on this branch.

## Development

```bash
cd packages/bridge
bun install
bun dev
bun test

cd packages/link
cargo test --workspace
```

Contributor guidelines and the architecture rules are in [`AGENTS.md`](AGENTS.md).

## License

[MIT](LICENSE)
