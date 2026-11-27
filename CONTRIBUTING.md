# Contributing

Start with [`ARCHITECTURE.md`](ARCHITECTURE.md) for the map. [`AGENTS.md`](AGENTS.md) holds every rule in full; this
page is the short path.

## Prerequisites

Development happens on macOS (the only host Broski supports today).

| Part | Needs |
|---|---|
| Bridge (`packages/bridge`) | Bun 1.4.4 or newer (CI uses 1.4.4). `bun install` brings Pi 1.6.0 and the Claude Agent SDK's own `claude`, which the tests run; no agent account is needed. Antigravity's live tests are opt-in and run your own `agy` only on your Gemini API key (`BROSKI_TEST_AGY=1` with `GEMINI_API_KEY`), never on a Google sign-in. |
| Link stack (`packages/link`) | A stable Rust toolchain. `cargo test -p broski-client` also needs `bun install` in `packages/bridge`: it runs the real bridge. |
| iOS | Xcode 27.2 with its Metal Toolchain (`xcodebuild -downloadComponent MetalToolchain`), XcodeGen 2.46, and the Rust targets `aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios`. |
| Android | JDK 17; the Android SDK (`platforms;android-36`, `platforms;android-37.0`, `build-tools;36.0.0`) and NDK 28.2.13676358; cargo-ndk 4.1.2; the Rust targets `aarch64-linux-android`, `x86_64-linux-android`. `scripts/build-android-terminal.sh` downloads Zig 0.17.1 itself and caches it in `~/.cache/broski`. |

Nothing sets `ANDROID_HOME` or `JAVA_HOME` for you; export them per command, for example
`export ANDROID_HOME="$HOME/Library/Android/sdk" JAVA_HOME="$(/usr/libexec/java_home -v 17)"`.

Rust builds go to `packages/link/target`, or to `$CARGO_TARGET_DIR` when it is set (a relative one is relative to
`packages/link`); the scripts in `scripts/` follow it, and `scripts/clean-workspace.sh --deep` never prunes one
outside the repository. `broski install` looks for `broski-link` beside the `broski` binary, in `~/.broski/bin` and
under `packages/link/target/release`, not in `$CARGO_TARGET_DIR`: pass `--link-bin <path>` then.

Install the pre-commit hook (biome and typecheck for bridge files, `cargo fmt --check` for link files, the agent-text
check for app files):

```bash
git config core.hooksPath .githooks
```

## Checks

Run what covers your change; CI (`.github/workflows/ci.yml`) runs all of it.

```bash
cd packages/bridge
bun run typecheck
bun run lint
bun run check:layers
bun run contract:check     # after a schema change, run `bun run contract:gen` first
bun test                   # about 5 minutes; real CLIs against scripted endpoints
bun run mutate:core        # long; `--check` only verifies the mutants still match their files

cd packages/link
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo clippy -p broski-contract --all-targets -- -D warnings
cargo test --workspace
```

Mobile, from the repository root (rerun both core scripts after any change under `packages/link`):

```bash
scripts/build-ios-core.sh && (cd apps/ios/BroskiCore && swift test)
BROSKI_SIMULATOR="iPhone Duo" scripts/build-ios-app.sh --test     # any simulator name you have
scripts/build-ios-app.sh device --unsigned

scripts/build-android-core.sh
scripts/build-android-terminal.sh
(cd apps/android && ./gradlew :core:assembleDebug :core:assembleRelease :core:testDebugUnitTest :terminal:testDebugUnitTest)
scripts/check-android-alignment.sh apps/android/core/build/outputs/aar/core-release.aar
(cd apps/android && ./gradlew :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :app:lint)
```

Shut simulators and emulators down when you are done (`xcrun simctl shutdown all`); `scripts/clean-workspace.sh`
reports and clears build caches.

## Test rules

- **Never touch real user data.** No test reads or writes `~/.broski`, `~/.pi` or `~/.claude`: inject temporary roots
  (config paths, Pi's `agentDir` / `$PI_CODING_AGENT_DIR`). `src/safety/real-home-guard.ts` fails a test that reaches
  the real home.
- **Drive real agents with scripted models, not mocks of them.** The scripted Anthropic- and OpenAI-compatible
  endpoints are in `packages/bridge/src/__tests__/helpers/` (`scripted-anthropic-server.ts`,
  `scripted-openai-server.ts`); Pi runs as the devDependency's real `pi` against the OpenAI-compatible one.
  Antigravity's live suite, conformance run and frame recorder run on the real `agy` only, opt-in and only on your own
  Gemini API key in a temp agy profile, never on a Google sign-in, where Google does not permit a program driving agy;
  CI starts no `agy`: its frame-level tests run on ACP's documented records, and `jobs_shutdown` on a stand-in process
  that hangs and speaks no ACP ([its notes](docs/architecture/backends/antigravity/README.md)).
- **Never mock the core.** Core tests drive the contract's fake backend (`helpers/core-rig.ts`, `helpers/core-bridge.ts`)
  and break adapters by wrapping it (`helpers/core-adapters.ts`).
- **Prove behaviour at a real seam.** Delete tests whose subject was deleted; do not write tests to raise a count.
- **No personal keys.** Builds and tests need no `.env.local`, API key or Apple account.

## Changes

- One concern per commit, messages as `type(scope): subject`, lowercase and imperative (`fix(relay): …`).
- Files under 400 lines, functions under 50; a new concern gets a new file.
- Never edit generated files by hand: `src/contract/contract.schema.json`, `contract-fixtures/*.json`, and
  `packages/link/contract/src/generated/` come from `bun run contract:gen`.
- Agent-written text in the apps goes through the formatter views, never a bare `Text`
  (`scripts/check-agent-text.sh`).
- No markdown, highlighting or rendering library in the core or the apps; the formatter is Broski's own.

## Adding a coding agent

See [`docs/adding-an-agent.md`](docs/adding-an-agent.md) for the complete guide, integration tiers, plugin contract, and conformance checklist, and [`docs/bridge-mcp.md`](docs/bridge-mcp.md) for how adapters use Broski's loopback `/mcp` tools.

Short summary of what every adapter does:

1. Write `packages/bridge/src/backends/<id>/` (`<id>` a lowercase slug) exporting a `BackendFactory` that builds an `AgentBackend`. Import only `contract/` (not `testing/`), `adapter-kit/`, `zod`, `node:` built-ins, and your agent's SDK (listed in `BACKEND_SDKS` in `scripts/contract-gen/layers.ts`).
2. Drive the user's installed agent and inherit their own setup; never bundle its binary.
3. Return expected failures as `Rejected` values, and keep every string and list within `src/contract/limits.ts`.
4. Pass `runConformance` (`src/contract/testing/`) against the real agent and a scripted model, as `src/__tests__/pi/conformance.test.ts` and `src/__tests__/claude-code/conformance/conformance.test.ts` do.
5. Register it in `packages/bridge/src/server/contract-backends.ts` (built-in), or ship it as a standalone plugin exporting `createBroskiAdapter` (`broski-bridge/plugin`) and list it under `adapters` in `~/.broski/config.json`. The core and mobile apps need no change.

## App identifiers & signing

Both native apps default to the `com.muzammil.broski` namespace and Bonjour service `_broski-link._tcp`.

### iOS

Simulator builds (`scripts/build-ios-app.sh`) and unsigned device builds (`scripts/build-ios-app.sh device --unsigned`) need no Apple account.

To sign and install on your own iPhone without editing tracked files:

```bash
cp apps/ios/Broski/Local.xcconfig.example apps/ios/Broski/Local.xcconfig
```

Set your own `DEVELOPMENT_TEAM` and `BROSKI_BUNDLE_PREFIX` (for example `com.yourname.broski`) in `apps/ios/Broski/Local.xcconfig`. `Signing.xcconfig` includes `Local.xcconfig` automatically, and `project.yml`, all three `Info.plist` files, all three `.entitlements` files, and the Swift app-group/background-task lookups read `$(BROSKI_BUNDLE_PREFIX)`.

Push notifications require an APNs key from your Apple Developer team on a relay you run ([`packages/link/relay/README.md`](packages/link/relay/README.md#push)). For TestFlight uploads via the `asc` CLI, see `scripts/release-ios-testflight.sh`.

### Android

Debug builds sign automatically with the Android debug keystore. Release builds (`./gradlew :app:assembleRelease`) produce an unsigned APK unless you provide signing credentials via Gradle properties or environment variables:

- `BROSKI_ANDROID_KEYSTORE` (or `-Pbroski.signing.storeFile=...`)
- `BROSKI_ANDROID_KEYSTORE_PASSWORD` (or `-Pbroski.signing.storePassword=...`)
- `BROSKI_ANDROID_KEY_ALIAS` (or `-Pbroski.signing.keyAlias=...`)
- `BROSKI_ANDROID_KEY_PASSWORD` (or `-Pbroski.signing.keyPassword=...`)

Cleartext LAN traffic is permitted in `network_security_config.xml` for Noise-encrypted LAN sessions to `broski-link`; relay traffic always uses `wss://`.
