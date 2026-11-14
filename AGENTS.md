# Repository Guidelines

## What Broski Is

Broski is a **phone remote for the AI coding agents on your computer**. You chat with Claude Code or Pi running on
your Mac, answer their permission prompts and questions, and watch sessions started in the Mac's terminal, from
your phone.

```
Phone (native app, Phase 4) ←Broski Link (Noise e2e; LAN or relay)→ broski-link daemon (Rust, your Mac) ←unix socket→ Bridge (Bun/TS) ←SDK→ {Claude Code, Pi}
```

The repository is mid-rebuild on branch `rebuild` (plan: [`docs/rebuild/PLAN.md`](docs/rebuild/PLAN.md)). The
Flutter app is gone; the tree it lived in is preserved on branch `final-flutter` (`git show final-flutter:<path>`).
Phase 1, the cut, is done: what is here is the bridge, the link stack, and the iOS push code carried over for the
native apps.

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
- **Carried-over iOS code** (`apps/ios/carryover/`, [`apps/carryover/README.md`](apps/carryover/README.md)) — the
  notification service extension, push crypto, keychain item and push action handling from the Flutter app, with
  the bundle ids, team, entitlements and keychain groups the native apps must keep.
- **Connection:** direct over the LAN when reachable, otherwise through the relay. No VPN, tunnel, port forwarding
  or public exposure of the bridge.
- **Auth layers:** QR v2 pairing (`broski://pair?v=2&h=<fingerprint>&s=<one-time secret>&e=<expiry>&n=<name>[&r=<relay>][&l=<lan>]`),
  Noise end-to-end encryption (hybrid X25519 + ML-KEM-768) with the machine fingerprint pinned from the QR,
  per-device revocable authorisation on the daemon, and the bridge link key. Design docs:
  `docs/architecture/connectivity-v2/`.
- **Agents:** Claude Code and Pi, nothing else. The bridge drives the user's own installed `claude`; it never
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
- **Generated files are never edited by hand**: `src/contract/contract.schema.json` and `contract-fixtures/*.json`
  come from the zod schemas via `bun run contract:gen`; CI runs `bun run contract:check`.
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
  backends/pi/   the Pi adapter (Pi SDK in process; Phase 2 moves it to `pi --mode rpc`)
  backends/claude-code/  the Claude Code adapter (Claude Agent SDK driving the user's `claude`)
  server/        wiring: listeners, the contract seam, the link feed, the Claude Code hook receiver
  workspace/     files, git and PTY, protocol-free; Phase 3 serves them over the contract
  transport/     send queue and frame limits
  platform/ config/ doctor/ wizard/ commands/ lifecycle/ logging/  the CLI and service around the bridge
packages/link/   the Rust link stack: crypto, proto, core, ffi, daemon, power, relay
apps/ios/carryover/  iOS push code kept for Phase 4
docs/architecture/   contract, core, backends, connectivity-v2
```

Keep files under 400 lines and functions under 50; a new concern gets a new file, not a branch in an old one.

## SDK notes

- **Claude Code** (`@anthropic-ai/claude-agent-sdk` 0.3.316, exact pin). The SDK spawns a native `claude`; the bridge
  runs the user's installed one, found from the `claudeCode.cliPath` config key or `PATH`
  (`server/claude-cli-path.ts`). Tests use the SDK's own platform package (`testClaudeBinary()`), run the real CLI
  against a scripted endpoint in a temp home, and never touch the real `~/.claude`. The installed `.d.ts` wins over
  any doc.
- **Pi** (`@earendil-works/pi-coding-agent` 1.4.0, with `pi-ai` / `pi-agent-core` 1.4.0, exact pins). Models and auth
  come from `~/.pi/agent` through `ModelRuntime`; a listing calls `refresh({ allowNetwork: false })` and reads
  `getAvailable()`, as `pi --list-models` does (`backends/pi/models/model-runtime.ts`). `enabledModels` is resolved by
  `resolveModelScopeWithDiagnostics()` — never parse `settings.json` by hand.
- Use the SDK's exported types; never `as any`. Do not keep fallbacks for an SDK's old response shapes.

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
```

`broski install` registers the daemon; `broski-link pair` shows the QR; `broski-link status` and
`broski-bridge doctor` diagnose.

**CI** (`.github/workflows/ci.yml`): the bridge job (Bun 1.4.2: frozen install, typecheck, biome errors, layers,
contract check, tests, the perf budget in `bench/`) and the link job (fmt, clippy, tests on Ubuntu and macOS).
**Pre-commit** (`.githooks/pre-commit`): biome errors and typecheck when bridge files are staged, `cargo fmt --check`
when link files are.

## Test hygiene

- **Never touch real user data.** Tests must not read or write `~/.pi`, `~/.broski` or `~/.claude`; inject temp roots
  (config paths, the Pi adapter's `agentDir` / `$PI_CODING_AGENT_DIR`). `safety/real-home-guard` fails a test that
  reaches the real home.
- **Drive a real agent with a scripted model, not a mock of it**: the scripted OpenAI- and Anthropic-compatible
  endpoints in `__tests__/helpers/`, Pi's faux provider in a throwaway agent dir.
- **Bound long scripts over real data** with a memory watchdog.
- Delete tests whose subject was deleted; write tests that prove behaviour at a real seam, not to raise a count.

## Coding conventions

- 2-space indentation in docs, tabs in TypeScript (biome), `UpperCamelCase` types, `lowerCamelCase` values.
- Error handling at real I/O boundaries, not defensive checks for impossible states.
- No filler comments: a comment says what a careful reader would otherwise get wrong.
