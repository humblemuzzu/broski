# Repository Guidelines

## What Broski Is

Broski is a **phone remote for the AI coding agents on your computer**. You chat with Claude Code or Pi running on
your Mac, answer their permission prompts and questions, and watch sessions started in the Mac's terminal, from
your phone.

```
Phone (native app, Phase 4) ←Broski Link (Noise e2e; LAN or relay)→ broski-link daemon (Rust, your Mac) ←unix socket→ Bridge (Bun/TS) ←SDK / RPC→ {Claude Code, Pi}
```

The repository is mid-rebuild on branch `rebuild` (plan: [`docs/rebuild/PLAN.md`](docs/rebuild/PLAN.md)). The
Flutter app is gone; the tree it lived in is preserved on branch `final-flutter` (`git show final-flutter:<path>`).
Phase 1, the cut, is done: what is here is the bridge, the link stack, the shared phone core packaged for both
native apps, and the iOS and Android apps: their foundations (Phase 4.1), and the workspace, push
notifications and live status (Phase 4.2); the chat is being built.

- **Bridge** (`packages/bridge/`) — TypeScript on the user's machine. Hosts the agents through their SDKs and speaks
  the backend contract to the daemon over `~/.broski/link/bridge.sock`. Every socket upgrade must quote the key the
  daemon wrote to `~/.broski/link/bridge.key` (`x-broski-link-key`, 32 random bytes hex, `0600`, rewritten at every
  daemon start and re-read per upgrade — `server/link-key.ts`). Its TCP listener is loopback-only (127.0.0.1, TLS
  and a local bearer token) and serves local things only: the Claude Code permission hook (`/cc-terminal-hook`),
  the dev-server preview proxy (`/proxy/<port>`, `/proxy-ws/<port>`) and `GET /`, a status probe that answers
  `{"status":"ok","version":…}`; a WebSocket upgrade with the bearer token reaches the same connection handler as a
  link socket.
- **The bridge's environment** — a service start inherits only `PATH` and `HOME`, so at startup the bridge asks the
  user's login shell once (`platform/shell-env.ts`: one interactive `env -0` between markers, 10 s timeout,
  process-group kill) and runs every agent and PTY with the result. A compiled binary never takes `BROSKI_*`/`BUN_*`
  from a shell.
- **broski-link daemon** (`packages/link/daemon/`, Rust) — a launchd (macOS) / systemd (Linux) service installed by
  `broski install`; supervises the bridge, terminates the Noise session with each paired phone, dials the relay.
  Windows is not supported.
- **Relay** (`packages/link/relay/`) — blind rendezvous both sides dial out to. It forwards encrypted frames and
  never sees plaintext.
- **Link session** (`packages/link/session/`, crate `broski-link-session`) — the phone side of the link for the
  shared native-app core: its own tokio runtime, pairing from a QR offer, the LAN/relay route race, resume,
  make-before-break LAN migration, the outbound queue, pause/resume, and the push-key and letter crypto the
  notification handlers use. No storage I/O: secrets and `MachineRecord`s go in and come out as values. Doc:
  [`docs/architecture/connectivity-v2/link-session.md`](docs/architecture/connectivity-v2/link-session.md).
- **Mobile core** (`packages/link/client/`, crate `broski-client`) — the phone apps' client over a link session:
  `hello` per bridge socket, requests matched to answers with the bridge's deadline, session views kept by the
  contract's Rust reducer and handed to the UI as a snapshot then bounded change records (at most 30 batches a
  second), each machine's catalog and session lists, the inbox across machines (with views it holds on waiting
  sessions so a row can offer the backend's own Approve/Deny, and its last known rows and what the person has
  seen as plain data for the app to persist), and terminal views that reattach from their last byte.
  UniFFI-shaped (owned values, `Arc` objects, pulled subscriptions) but with no UniFFI dependency: the facade
  `packages/link/mobile` exports it. Doc: [`docs/architecture/mobile-core.md`](docs/architecture/mobile-core.md).
- **Rendering** (`packages/link/render/`, crate `broski-render`) — what both apps draw identically: markdown as
  flat keyed blocks of styled runs (pulldown-cmark), code as spans by token kind (syntect with the grammars
  vendored in `render/syntaxes/`, compiled by its `build.rs`), and diffs with word emphasis and side-by-side rows.
  Pure, bounded, no UniFFI dependency. Doc: [`docs/architecture/rendering.md`](docs/architecture/rendering.md).
- **BroskiCore** (`packages/link/mobile/`, crate `broski-mobile`, library `libbroski_core`) — the UniFFI 0.32.2
  facade both apps call: thin wrappers over the client core (`Phone`, `Machine`, `SessionView`, `TerminalView`,
  `SessionList`, `Inbox`), its values restated with `#[uniffi::remote]`, the rendering functions, and the pure
  push and offer functions the notification handlers and the scanner call; updates pulled (`nextEvent`/`nextUpdate`/`nextChange`, no
  foreign callbacks), `MachineRecord` opaque and stored as bytes.
  `scripts/build-ios-core.sh` makes `apps/ios/BroskiCore` (XCFramework + Swift package) and
  `scripts/build-android-core.sh` the `apps/android` `:core` module; bindings and binaries are build outputs,
  never committed. Doc: [`docs/architecture/mobile-packaging.md`](docs/architecture/mobile-packaging.md).
- **iOS app** (`apps/ios/Broski/`, XcodeGen `project.yml`; the `.xcodeproj` is a build output) — SwiftUI for
  iOS 26, Swift 6 with main-actor default isolation, Liquid Glass. `Sources/App` (entry, tabs, `Route`),
  `Sources/Core` (`AppModel` owning the `Phone`, keychain persistence, the inbox and machine pull loops, scene
  phase, `NWPathMonitor`, `NWBrowser` LAN discovery, push registration and decisions, the Live Activity),
  `Sources/DesignSystem`, `Sources/Features/*` (Workspace: files, git, a libghostty terminal), `Shared/` (what
  its extensions compile), `Extensions/` (the notification service extension, the Live Activity widget). Doc:
  [`apps/ios/README.md`](apps/ios/README.md).
- **Android app** (`apps/android/app/`, [`apps/android/README.md`](apps/android/README.md)) — Kotlin, Compose,
  Material 3 Expressive, Navigation 3: welcome and pairing (Code Scanner or a pasted link), inbox, machines,
  settings, the Workspace (files, git, a terminal on libghostty-vt through the `:terminal` module's JNI shim),
  FCM pushes with Allow/Deny and a Live Update while agents work (`feature/notifications/`), and Approve/Deny
  from an inbox row, with the inbox's last known rows restored at launch. One `Phone` per process in
  `core/AppCore.kt`, its loops in `core/PhoneSession.kt`; the identity secret, records and seen state in a
  Keystore-sealed DataStore (`core/vault/`). Chat and New session plug into `app/Features.kt`.
- **Identifiers kept from the Flutter app** ([`apps/carryover/README.md`](apps/carryover/README.md)) — the bundle
  ids, team, keychain groups and Android application id the native apps keep.
- **Connection:** direct over the LAN when reachable, otherwise through the relay. No VPN, tunnel, port forwarding
  or public exposure of the bridge.
- **Auth layers:** QR v2 pairing (`broski://pair?v=2&h=<fingerprint>&s=<one-time secret>&e=<expiry>&n=<name>[&r=<relay>][&l=<lan>]`),
  Noise end-to-end encryption (hybrid X25519 + ML-KEM-768) with the machine fingerprint pinned from the QR,
  per-device revocable authorisation on the daemon, and the bridge link key. Design docs:
  `docs/architecture/connectivity-v2/`.
- **Agents:** Claude Code and Pi, nothing else. The bridge drives the user's own installed `claude` and `pi`; it never
  bundles an agent binary.

### Security context for audits

This is a **personal dev tool**: the user owns the phone and the machine. The bridge deliberately has broad
filesystem and process access, because that is its job.

**Intentional, not vulnerabilities:** PTY/terminal access from the phone; command execution through the agents and
the shell; file reading and writing; agent control (chat, approving and rejecting prompts); the QR carrying the
pairing secret (it is the pairing mechanism, shown only on the user's own screen and consumed by the first pairing);
the bridge reaching agent credentials; the authenticated loopback proxy to dev-server ports.

**Worth auditing:** the pairing lifecycle (secret consumption, expiry, device revocation, relay token storage);
Noise handshake correctness and relay blindness; loopback listener hardening (TLS, bearer token, bind address);
path traversal defences (realpath, symlinks, base paths); input validation (prototype pollution, size limits);
rate limiting and DoS protection. Compiled binaries disable every debug flag, force TLS on the loopback listener and
ignore env overrides that could weaken security.

## The backend contract

The wire shape between bridge and phone is the backend contract in `packages/bridge/src/contract/`, protocol
**1.0**. Spec: [`docs/architecture/contract/README.md`](docs/architecture/contract/README.md).

- **The UI never branches on the backend**, only on `Capabilities` / `SessionCapabilities` and the shape of the data.
  Backend extras arrive as typed `extension` events (today only Claude Code's `rate_limit`).
- **Adapters are reached only through `AgentBackend`.** The core never imports `backends/<id>/`; an adapter never
  sees sockets, phones or the wire.
- **The contract is a leaf**: `src/contract/` imports only `zod` and itself (its `testing/` may add `bun:test`);
  `src/backends/<id>/` imports only the contract, itself, `zod`, `node:` built-ins (not `node:module`) and its own
  SDK; no adapter reaches another adapter's directory. Every import specifier is a plain string.
  `bun run check:layers` enforces it.
- **Expected failures are values**: every adapter method that can fail returns `{status: "accepted", …} | Rejected`;
  `status()` never fails (its failures are `issues`). Every wire string, list and map is bounded
  (`src/contract/limits.ts`).
- **One protocol, no minors.** Nothing has shipped, so 1.0 changes in place; `hello` agrees on the major alone. Do
  not reintroduce per-minor views or stand-in frames.
- **Generated files are never edited by hand**: `src/contract/contract.schema.json`, `contract-fixtures/*.json`, and
  in `packages/link/contract/` the Rust models in `src/generated/` and the type registry in `tests/fixtures/generated/`
  come from the zod schemas via `bun run contract:gen`; CI runs `bun run contract:check`.
- **The phone core's contract** is the Rust crate `packages/link/contract` (`broski-contract`): the generated models
  (serde, and `uniffi::Record`/`Enum` behind its `uniffi` feature), the hand-written `JsonValue`, the frame codec, and
  a hand-written port of `session-reducer.ts` + `run-items.ts`. Its tests replay every fixture, so the fixtures hold it
  equal to the TypeScript: change the schema or the reducer, run `bun run contract:gen`, then `cargo test -p
  broski-contract` names the type, case and step the Rust must follow (contract README §3).
- **Every adapter passes the conformance suite** (`runConformance` in `src/contract/testing/`, each rule proven to
  fail by the broken adapters in `src/__tests__/contract_negative_*.test.ts`), and every answer goes through
  `answerProblem` before it reaches a backend.
- **Pi** (`src/backends/pi/`) and **Claude Code** (`src/backends/claude-code/`) are both registered in every bridge
  (`server/contract-backends.ts`). Claude Code's terminal permission prompts reach the phone through its
  `PermissionRequest` hook (`claudeCode.terminalAsks`, default true; `server/claude-code-*.ts`). Notes:
  [`docs/architecture/backends/pi/README.md`](docs/architecture/backends/pi/README.md),
  [`docs/architecture/backends/claude-code/README.md`](docs/architecture/backends/claude-code/README.md).

## The bridge core

`packages/bridge/src/core/` speaks the contract to every attached phone; doc:
[`docs/architecture/core/README.md`](docs/architecture/core/README.md).

- **Contract messages travel as `{"type":"contract","message":…}`**, the only frame a phone sends. The seam is
  `server/contract-seam.ts`; any other frame is answered `invalid_message`.
- **`src/core/` imports only itself, the contract (not its test kit), `zod` and `CORE_INFRASTRUCTURE`**
  (`state/bounded-map`, `transport/send-limits`; `scripts/contract-gen/layers.ts`).
- **Every contract request gets exactly one answer**, within 120 s even from an adapter that never answers; inbound
  frames are bounded (8 MiB, 50,000 JSON values, the contract's list and depth bounds) before the schema checks them.
- **No automatic answers.** An interaction ends only when a human answers or cancels it, or the backend withdraws it
  or lets it expire. Never add a timeout that answers for the user.
- **Keep-open**: a session with a run, a pending ask, a compaction, a retry or queued input stays open, viewed or not;
  only bridge shutdown closes a busy session.
- **Every frame fits the link** (`wire-fit.ts`): every message goes out through `fitMessage`/`fitEvent`, and fitting
  never cuts ids, cursors or image bytes.
- **The daemon's feed** (busy/done alerts, lock-screen decisions) reaches the core only through
  `CoreOptions.observer` and `BridgeCore.answer`; a feed decision is a human answer
  (`docs/architecture/connectivity-v2/bridge-feed.md`).
- **`BridgeCore.hold` / `release`** pin a session open with no client attached, so a terminal's ask gets keep-open,
  the feed and snapshots. A hold answers nothing and starts no timer.
- **A watch-only session may take answers and nothing else** (`OpenSession.answer`, `SessionCapabilities.answer`).
  Never give such a session a `control` to make its asks answerable.
- **Tests drive the fake backend** (`__tests__/helpers/core-rig.ts`, `core-bridge.ts`) and break adapters by wrapping
  it (`helpers/core-adapters.ts`); they never mock the core. `bun run mutate:core` checks that the core's tests fail
  on every guard removed, except the equivalent mutants it lists with their reasons.

## Where code lives

```
packages/bridge/src/
  contract/      the backend contract: zod schemas, reducer, answer check, conformance kit (testing/)
  core/          the bridge core on the contract
  backends/pi/   the Pi adapter (one `pi --mode rpc` per hosted session; no Pi package imported)
  backends/claude-code/  the Claude Code adapter (Claude Agent SDK driving the user's `claude`)
  server/        wiring: listeners, the contract seam, the link feed, the Claude Code hook receiver
  workspace/     files, git and terminals over the contract, behind the core's WorkspaceHost port (workspace-host.ts)
  transport/     send queue and frame limits
  platform/ config/ doctor/ wizard/ commands/ lifecycle/ logging/  the CLI and service around the bridge
packages/link/   the Rust link stack: crypto, proto, core, daemon, power, relay; contract (the phone core's models and reducer); session (the phone side of the link); client (the mobile core over it); render (markdown, highlighting and diffs for both apps); testkit (the daemon, relay, LAN and bridge harness the phone crates' tests share); mobile (BroskiCore, the UniFFI facade); uniffi-bindgen
apps/ios/BroskiCore/  the Swift package of BroskiCore (generated bindings + XCFramework, both from scripts/build-ios-core.sh)
apps/ios/Broski/  the iOS app (project.yml, Sources/{App,Core,DesignSystem,Features}, Shared, Extensions, Tests, UITests)
apps/android/    the Gradle build: :core, BroskiCore's Android library (bindings + .so from scripts/build-android-core.sh);
                 :terminal, libghostty-vt and its JNI shim (.so from scripts/build-android-terminal.sh);
                 :app, the Android app (app/ shell, design/, core/, feature/<screen>/)
scripts/         build-ios-core.sh, build-ios-app.sh, e2e-ios-app.sh, build-android-core.sh, build-android-terminal.sh,
                 test-android-real-machine.sh, check-android-alignment.sh
docs/architecture/   contract, core, backends, connectivity-v2, mobile-packaging
```

Keep files under 400 lines and functions under 50; a new concern gets a new file, not a branch in an old one.

## SDK notes

- **Claude Code** (`@anthropic-ai/claude-agent-sdk` 0.3.325, exact pin, released with CLI 2.1.325). The SDK's
  JavaScript spawns `claude`; the bridge embeds no binary and runs the user's installed one, found from the
  `claudeCode.cliPath` config key or the login shell's `PATH` (`server/claude-cli-path.ts`); a different version is a
  status warning. Tests run the SDK's own platform package (`testClaudeBinary()`; `BROSKI_TEST_CLAUDE_CLI` names
  another, such as the user's) against a scripted endpoint in a temp home, with an SDK bound to that home
  (`isolatedClaudeSdk`), and never touch the real `~/.claude`. After a pin bump, re-record the frame fixtures
  (`CC_SPIKE_RECORD=1`). The installed `.d.ts` wins over any doc.
- **Pi** runs as the user's own `pi` (config `pi.cliPath`, else `PATH`; `server/pi-cli-path.ts`), driven over
  `pi --mode rpc`; production code imports no `@earendil-works` package (`check:layers`), except the extension the
  adapter writes for `pi` (`backends/pi/host/extension/`), read by the rest only as text. Models, commands and settings
  come from Pi itself (`get_available_models`, `get_commands`, `get_state`). `@earendil-works/pi-coding-agent` 1.5.2 is
  an exact devDependency: the tests run its `pi`, and the docs and `dist/` of that version are where Pi facts are checked
  ([`docs/architecture/backends/pi/README.md`](docs/architecture/backends/pi/README.md)).
- Use the SDK's exported types (Pi's RPC frames: the zod schemas in `backends/pi/rpc/`); never `as any`. Do not keep
  fallbacks for an agent's old response shapes.

## Build and test

```bash
cd packages/bridge
bun install
bun dev                    # bridge with hot reload
bun run typecheck          # tsc --noEmit
bun run lint               # biome check src/ scripts/
bun test                   # ~5 minutes; real CLIs against scripted endpoints
bun run check:layers
bun run contract:gen       # after a schema change; contract:check verifies
bun run mutate:core        # mutation check of the core (long); --check only matches the mutants

cd packages/link
cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cargo clippy -p broski-contract --all-targets -- -D warnings   # the workspace lints it with its uniffi feature

# BroskiCore (rerun both scripts after any change under packages/link)
scripts/build-ios-core.sh                  # macOS + Xcode; then in apps/ios/BroskiCore: swift test
export ANDROID_HOME="$HOME/Library/Android/sdk" JAVA_HOME="$(/usr/libexec/java_home -v 17)"
scripts/build-android-core.sh              # cargo-ndk 4.1.2, NDK 28.2.13676358 under $ANDROID_HOME/ndk
scripts/build-android-terminal.sh          # Zig 0.17.1 + libghostty-vt 1.0.1 (pinned, cached in ~/.cache/broski)
(cd apps/android && ./gradlew :core:assembleDebug :core:assembleRelease :core:testDebugUnitTest :terminal:testDebugUnitTest)
scripts/check-android-alignment.sh apps/android/core/build/outputs/aar/core-release.aar
(cd apps/android && ./gradlew :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :app:lint)
scripts/test-android-real-machine.sh       # :app's instrumented tests against test-machine; a booted emulator or device

# iOS app (XcodeGen 2.46; builds BroskiCore first when packages/link changed)
scripts/build-ios-app.sh [simulator|device] [--unsigned]
BROSKI_SIMULATOR="iPhone Duo" scripts/build-ios-app.sh --test   # unit tests in the simulator
BROSKI_SIMULATOR="iPhone Duo" scripts/e2e-ios-app.sh            # pairs with test-machine, screenshots every screen
```

`cargo test -p broski-client` runs the real bridge (`bun scripts/dev-fake-bridge.ts`, the contract's fake backend in
its core) on an in-process daemon's socket, so it needs Bun and `bun install` in `packages/bridge`.

The Android SDK, NDK and command-line tools live in `~/Library/Android/sdk`; nothing is installed system-wide and no
shell profile sets the variables, so export `ANDROID_HOME` and `JAVA_HOME` (JDK 17) per command.

`broski install` registers the daemon; `broski-link pair` shows the QR; `broski-link status` and
`broski-bridge doctor` diagnose.

**CI** (`.github/workflows/ci.yml`): the bridge job (Bun 1.4.2: frozen install, typecheck, biome errors, layers,
contract check, tests, the perf budget in `bench/`), the link job (fmt, clippy, clippy of the contract crate without
its `uniffi` feature, the bridge's dependencies for the client's tests, tests on Ubuntu and macOS), `ios-core` (macOS 26: the iOS script, `swift test`, simulator and
device links), `ios-app` (macOS 26: an unsigned device build and the unit tests on a simulator the job creates) and
`android-core` (both Android scripts, both assembles, the core's and the terminal's JVM tests, the 16 KB alignment check, then the app's assembles, unit tests and lint).
**Pre-commit** (`.githooks/pre-commit`): biome errors and typecheck when bridge files are staged, `cargo fmt --check`
when link files are.

## Test hygiene

- **Never touch real user data.** Tests must not read or write `~/.pi`, `~/.broski` or `~/.claude`; inject temp roots
  (config paths, the Pi adapter's `agentDir` / `$PI_CODING_AGENT_DIR`). `safety/real-home-guard` fails a test that
  reaches the real home.
- **Drive a real agent with a scripted model, not a mock of it**: the scripted OpenAI- and Anthropic-compatible
  endpoints in `__tests__/helpers/`; for Pi, the devDependency's real `pi` against the OpenAI-compatible one, registered in
  a throwaway agent dir's `models.json`.
- **Bound long scripts over real data** with a memory watchdog.
- Delete tests whose subject was deleted; write tests that prove behaviour at a real seam, not to raise a count.

## Coding conventions

- 2-space indentation in docs and shell scripts, tabs in TypeScript (biome), 4 spaces in Swift and Kotlin,
  `UpperCamelCase` types, `lowerCamelCase` values.
- Error handling at real I/O boundaries, not defensive checks for impossible states.
- No filler comments: a comment says what a careful reader would otherwise get wrong.
