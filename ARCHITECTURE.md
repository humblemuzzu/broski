# Architecture

Three programs and two apps. Everything an app shows comes from the bridge as backend-contract messages, over a link
the daemon encrypts.

```
apps/ios (SwiftUI)        apps/android (Compose)        native shells: screens, keychain/Keystore, push, scene life
        └──────────┬──────────────┘
         BroskiCore (packages/link/mobile, Rust via UniFFI)
           session · client · contract · render · voice
                   │  Broski Link: Noise (X25519 + ML-KEM-768), LAN or packages/link/relay
         broski-link daemon (packages/link/daemon)
                   │  ~/.broski/link/bridge.sock + link key
         bridge (packages/bridge, Bun/TypeScript)
           server/ ─ core/ ─ contract/ ─ backends/<id>/ ─ the user's claude, pi
```

## The bridge: four layers

`packages/bridge/src/`. One-way dependencies, enforced by `bun run check:layers`
(`scripts/contract-gen/layers.ts`):

| Layer | What it is | May import |
|---|---|---|
| `contract/` | The backend contract, protocol 1.0: zod schemas, the session reducer, `answerProblem`, the conformance kit (`testing/`) | `zod`, itself (`testing/` also `bun:test`) |
| `core/` | `BridgeCore`: the registry, one live stream per open session, replay, keep-open, the interactions desk, wire fitting, the bridge's own asks, fallbacks and clocks | the contract (not `testing/`), `zod`, `state/bounded-map`, `transport/send-limits`, itself |
| `adapter-kit/` | What adapters share: an asks ledger, page cursors, phone-safe text, a trash move, an image cache | the contract (not `testing/`), `zod`, `node:` built-ins, itself |
| `backends/<id>/` | One adapter per agent (`claude-code/`, `pi/`), reached only as an `AgentBackend` | the contract (not `testing/`), `adapter-kit/`, `zod`, `node:` built-ins, its own SDK, itself |

Around them, outside the layer rules: `server/` wires listeners, the contract seam (`server/contract-seam.ts`), the
daemon feed and the Claude Code hook; `mcp/` is the bridge's MCP server (`broski_ask`, `broski_notify`,
`broski_propose_plan`), not yet mounted; `workspace/` serves files, git and terminals behind the core's
`WorkspaceHost` port; `usage/` reads plan usage behind its `UsageReader` port.

## The Rust stack

`packages/link/`, one Cargo workspace:

| Crate | Role |
|---|---|
| `crypto`, `proto`, `core` | Sans-IO: the hybrid Noise IK handshake, identities and the QR offer; the reliability layer and its frames; the connection engine |
| `power` | macOS power primitives (sleep and wake events, stay-awake assertions); the daemon decides the policy |
| `daemon` (`broski-link`) | The Mac's service: pairing, LAN listener, relay client, bridge supervision, push |
| `relay` (`broski-relay`) | The blind rendezvous; self-hosting in [`relay/README.md`](packages/link/relay/README.md) |
| `session` | The phone side of the link: pairing, LAN/relay race, resume, migration |
| `client` | The phone's client over a session: requests, session views, inbox, terminals |
| `contract` | Generated contract models and a Rust port of the reducer, held equal to the TypeScript by fixtures |
| `render`, `voice` | Markdown, highlighting and diffs both apps draw; dictation's request and vocabulary |
| `mobile`, `push-mobile` | BroskiCore and BroskiPush, the UniFFI facades the apps link |
| `testkit`, `uniffi-bindgen` | The daemon/relay/bridge harness for tests; the bindings generator |

## The apps

- `apps/ios/Broski/`: SwiftUI for iOS 26, XcodeGen `project.yml`, over `apps/ios/BroskiCore` (built by
  `scripts/build-ios-core.sh`). [`apps/ios/README.md`](apps/ios/README.md).
- `apps/android/`: Kotlin, Compose, Material 3 Expressive; `:core` is BroskiCore (`scripts/build-android-core.sh`),
  `:terminal` is libghostty-vt (`scripts/build-android-terminal.sh`). [`apps/android/README.md`](apps/android/README.md).

Neither app branches on the agent: only on capabilities and the shape of the data.

## Where to read next

| Topic | Doc |
|---|---|
| The contract | [`docs/architecture/contract/README.md`](docs/architecture/contract/README.md) |
| The bridge core | [`docs/architecture/core/README.md`](docs/architecture/core/README.md) |
| Claude Code and Pi adapters | [`docs/architecture/backends/`](docs/architecture/backends/) |
| Link, daemon, relay, push | [`docs/architecture/connectivity-v2/`](docs/architecture/connectivity-v2/) |
| Mobile core and packaging | [`docs/architecture/mobile-core.md`](docs/architecture/mobile-core.md), [`docs/architecture/mobile-packaging.md`](docs/architecture/mobile-packaging.md) |
| Rendering and formatting | [`docs/architecture/rendering.md`](docs/architecture/rendering.md), [`docs/architecture/formatting.md`](docs/architecture/formatting.md) |
| Dictation, notifications | [`docs/architecture/dictation.md`](docs/architecture/dictation.md), [`docs/architecture/notifications.md`](docs/architecture/notifications.md) |
| Adding an agent | [`docs/architecture/open-source-blueprint.md`](docs/architecture/open-source-blueprint.md) Part III |
