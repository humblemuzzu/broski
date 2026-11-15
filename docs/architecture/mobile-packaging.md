# BroskiCore on the phones — how the Rust core is built, packaged and consumed

The iOS and Android apps share one Rust library, `libbroski_core`, built from the crate
`packages/link/mobile` (`broski-mobile`, lib `broski_core`). UniFFI 0.32.2 generates its Swift and
Kotlin bindings. This note covers the facade, the two packagings, what is generated and what is
committed, and how to regenerate everything.

```
packages/link/session   (broski-link-session: sockets, route race, resume, pairing, push crypto)
packages/link/contract  (broski-contract: contract models with UniFFI derives, frame codec, reducer)
packages/link/client    (broski-client: the phone's client core over both; no UniFFI dependency)
          └── packages/link/mobile  (broski-mobile → libbroski_core: the UniFFI facade)
                ├── scripts/build-ios-core.sh      → apps/ios/BroskiCore (XCFramework + Swift package)
                └── scripts/build-android-core.sh  → apps/android/core   (Android library module)
```

## 1. The facade

`broski-mobile` exports the client core ([mobile-core.md](mobile-core.md)) and nothing beside it but
the pure functions a notification handler or the pairing scanner calls without a `Phone`. Every
behaviour lives in the client, session and contract crates; each export is a one-line forward. It calls
`uniffi::setup_scaffolding!()`. Names below are Swift's, then Kotlin's where they differ.

### Objects

| Object | Members | Wraps |
|---|---|---|
| `Phone` | `Phone(identitySecret:config:) throws` (Kotlin `Phone(identitySecret, config)`), `deviceId()`, `start(record:) throws → Machine`, `pair(offer:) async throws → Machine`, `machine(id:) → Machine?`, `allMachines()`, `forget(id:)`, `inbox() → Inbox`, `pause()`, `resume()`, `networkChanged()` | `broski_client::Phone`; one per process, it owns the link runtime's thread |
| `Machine` | `id()`, `record() → MachineRecord`, `status() → MachineStatus`, `nextEvent() async → MachineEvent?`, `request(message:) async throws → ServerMessage`, `attach(session:) throws → SessionView`, `terminal(id:) throws → TerminalView`, `sessionList(backend:query:) throws → SessionList`, `backends() async throws`, `backendStatus(backend:) async throws`, `models(backend:cwd:includeUnavailable:) async throws`, `commands(backend:cwd:session:) async throws`, `modes(backend:cwd:) async throws`, `registerPush(platform:token:)`, `unregisterPush()`, `lanDiscovered(routes:)`, `restartBridge() throws` | `broski_client::Machine` |
| `SessionView` | `nextUpdate() async → SessionUpdate?`, `snapshot() → SessionSnapshot?`, `session() → SessionRef?`, `capabilities() → SessionCapabilities?`, `detach()` | `broski_client::SessionView` (`detach` is its `close`) |
| `TerminalView` | `id()`, `nextUpdate() async → TerminalUpdate?`, `summary() → TerminalSummary?`, `input(data:) async throws → ActionResult`, `resize(cols:rows:cellWidth:cellHeight:) async throws → ActionResult`, `detach()` | `broski_client::TerminalView` |
| `SessionList` | `rows() → SessionListUpdate`, `nextChange() async → SessionListUpdate?`, `loadMore() async throws`, `refresh() async throws`, `stop()` | `broski_client::SessionList` |
| `Inbox` | `rows() → [InboxRow]`, `nextChange() async → InboxUpdate`, `refresh() async`, `markSeen(machineId:session:)`, `seen() → SeenState`, `restoreSeen(state:)` | `broski_client::Inbox` |
| `MachineRecord` | `MachineRecord.fromBytes(bytes:) throws`, `toBytes()`, `id()`, `name()`, `os()`, `pairedAtMs()` | the session's `MachineRecord` and its stored form (`session/src/record_codec.rs`), opaque |

No object has a method named `close` or `destroy`: Kotlin objects already have both, from
`AutoCloseable` and UniFFI's `Disposable`, and they release the handle. The client's `close` of a
view is exported as `detach`, of a list as `stop`; a machine is ended through `Phone.forget`.

### Functions

| Function | Wraps |
|---|---|
| `newIdentitySecret() throws → Data` (`ByteArray`) | `broski_client::new_identity_secret` |
| `parsePairingOffer(uri:) throws → PairingOffer { machineId, name, expiresAt }` | `Offer::parse`: what the scanner shows and checks before `Phone.pair` |
| `openNotification(record:data:) throws → PushNotification` | `push::open_notification` |
| `decisionLetter(record:decision:backend:session:request:) throws → LetterRequest { url, headers, body }` | `push::decision_letter` |

### Values

- **The client's**, restated under `#[uniffi::remote]` in `mobile/src/values.rs` (the compiler checks
  each restatement against `broski-client`, so they cannot drift): `PhoneConfig`, `MachineStatus`,
  `ContractState`, `MachineEvent`, `SessionUpdate`, `SessionChange`, `ViewEnd`, `TerminalUpdate`,
  `SessionListUpdate`, `InboxRow`, `InboxState`, `InboxUpdate`, `SeenState`, `SeenMarker`, `LinkFailure`,
  and the error `ClientError`.
- **The session's**, restated the same way in `mobile/src/link.rs` and `push.rs`: `LinkStatus` (its
  `Status`), `LinkState`, `WaitReason`, `LinkRoute` (`Route`), `BridgeStatus`, `BridgeState`,
  `SendFailure`, `Platform`, `PushPlatform`, `PushNotification`, `PushDecision`.
- **The facade's own**: `PairingOffer`, `HttpHeader`, `LetterRequest`.
- **The contract's** models are external types: `broski-contract` derives `uniffi::Record`/`Enum` behind
  its `uniffi` feature and sets up its own scaffolding, and the bindgen emits its bindings next to the
  facade's (`ClientMessage`, `ServerMessage`, `SessionRef`, `SessionSnapshot`, …).

In Kotlin an enum without data is an `enum class` (`WaitReason.RETRY`, `LinkFailure.MACHINE_UNREACHABLE`,
`InboxState.NEEDS_YOU`) and one with data a sealed class (`ContractState.Ready(bridgeVersion)`, an
`object` for each case without data, `ContractState.Waiting`). Every failure is `ClientError`: in Swift an
enum whose cases keep their Rust names (`ClientError.Link(failure: .identity, detail:)`), in Kotlin the
sealed `ClientException` (`ClientException.Link`, with `failure` and `detail`). A case's text is `detail`,
never `message`, because UniFFI's Kotlin exception class already overrides `Throwable.message` and a
field of that name would not compile (`uniffi_bindgen-0.32.2/src/bindings/kotlin/templates/ErrorTemplate.kt`).

### What the facade no longer exports

The first facade exported the session crate directly: `LinkRuntime`, `DeviceIdentity`, a single-use
`PairingOffer` object with `pair(runtime, identity, offer, options)`, `LinkSession` with `LinkEvent` and
`SessionOptions`, `encodeFrame`/`decodeFrame`, and a flat `CoreError`. The client owns all of that now
(its `Phone` holds the runtime and the identity and starts every session, and its machines encode and
decode every frame), so an app that used them would run a second, unmanaged path beside the client's.
They are gone; `ClientError.Link` keeps the distinctions `CoreError` drew (`LinkFailure`).

### Subscriptions, cancellation and threads

Updates are pulled: one loop per subscription, one reader at a time, no foreign callbacks (foreign
traits also warn under Swift 6, mozilla/uniffi-rs#2929). A pull ends with `nil`/`null` once its
subscription has: `SessionView` and `TerminalView` after their last update or `detach()`, `SessionList`
after `stop()`, `Machine.nextEvent` once the machine is forgotten, replaced by a new pairing or revoked.
`Inbox.nextChange` never ends; it lives as long as the phone.

**Swift: a cancelled task does not cancel its pull.** UniFFI 0.32.2 awaits a Rust future in
`withUnsafeContinuation` with no cancellation handler (`templates/Async.swift`; `Helpers.swift` even
`fatalError`s on a cancelled call), so `await view.nextUpdate()` goes on after its `Task` is cancelled,
and what it takes still reaches the task: nothing is lost, but nothing stops either. A loop ends by
ending its subscription, which a SwiftUI `.task` does from its cancellation:

```swift
.task {
    await withTaskCancellationHandler {
        while let update = await view.nextUpdate() { model.apply(update) }
    } onCancel: {
        view.detach()
    }
}
```

The inbox's and each machine's event loops belong to the app's model, for the life of the phone and of
each machine.

**Kotlin: a cancelled coroutine cancels its pull.** The bindings suspend in
`suspendCancellableCoroutine` and free the Rust future when the coroutine is cancelled
(`templates/Async.kt`), which drops the client's wait; an update leaves its queue only in the poll that
returns it, so the next pull gets everything that came after. One window remains: a cancellation that
lands after Rust finished the poll and before the coroutine resumed discards that one result with the
future (`uniffi_core-0.32.2/src/ffi/rustfuture/future.rs` keeps it until `complete`, and `free` drops
it). Hence:

- a `SessionView` or `TerminalView`, whose updates are deltas, lives exactly as long as its loop: open it
  in the coroutine and detach it in `finally` (in a ViewModel: open in `init`, loop in `viewModelScope`,
  detach in `onCleared`);
- a loop over state (`Inbox`, `SessionList`, `Machine` events) starts from the getters (`rows()`,
  `status()`, `record()`, `seen()`) and then applies each update.

```kotlin
viewModelScope.launch {
    val view = machine.attach(session)
    try {
        while (true) apply(view.nextUpdate() ?: break)
    } finally {
        view.detach()
        view.close()
    }
}
```

Kotlin's `close()` releases the handle, but a pull in progress holds its own (an async call clones the
handle into its future), so `close()` alone does not end a loop; `detach()`/`stop()` does.

**Threads.** UniFFI polls an exported future on the caller's executor and starts no runtime; the client
waits only on `Notify`s and `oneshot`s and runs its timers on the link runtime, its one thread
(`broski-link`), so no async export blocks the caller's thread. The synchronous methods take a lock
briefly and may be called from the main thread. Every object is `Send + Sync` (Swift
`@unchecked Sendable`).

### Lifecycle and what the app persists

- **First run:** `newIdentitySecret()`, stored in the Keychain or the Keystore before anything else.
  Every launch: `Phone(identitySecret:config:)`. A stored secret that fails (`ClientError.Link` with
  `.identity`) is surfaced, never replaced: a new identity orphans every pairing.
- **Pairing:** `parsePairingOffer` for the scanner (the machine's name, `expiresAt`, and whether
  `machineId` is already paired, which a new pairing replaces), then `phone.pair(offer:)`; persist
  `machine.record().toBytes()` at once, and again at every `MachineEvent.recordChanged` (the event
  carries no record: the record holds the relay token and push key, and reaches the app only as the
  opaque object).
- **Launch:** `inbox().restoreSeen(state:)` with the stored `SeenState` (markers and the machines whose
  history is marked), before any machine starts, then `phone.start(record:)` for each stored record.
  Persist `InboxUpdate.seen` whenever it is not `nil`.
- **While running:** `phone.pause()`/`resume()` with the app's foreground, `networkChanged()` on a path
  change, `machine.lanDiscovered(routes:)` from `NWBrowser`/`NsdManager`, `machine.registerPush` on every
  machine when the token changes and on each new pairing.
- **Notification handlers** read the record from the shared Keychain or Keystore:
  `MachineRecord.fromBytes`, `openNotification`, and `decisionLetter` for a lock-screen decision, which
  they `POST` themselves. They create no `Phone`.
- **Unpairing:** `phone.forget(id:)`, then delete the stored record.

### Tests

`packages/link/mobile/tests/facade.rs` runs the exports with no machine to reach, over fixtures the Swift
and Kotlin tests share (`tests/fixtures`: a QR offer written by the daemon's encoder, the stored record
and device secret of that pairing, the push vectors of [push.md](connectivity-v2/push.md)).
`tests/phone.rs` drives the exported API as an app does against the real daemon and the real bridge
(`broski-link-testkit`): pair from a scanned offer, a run streaming into a view whose UI copy (the
client's `tests/common/replica.rs`) equals the snapshot, the inbox with a home-screen loop and its seen
state, a session list, a terminal, then a new `Phone` from the stored identity, record and seen state
that finds the session seen, and `forget`.

## 2. Building

Both scripts build with the cargo profile `mobile` (release, no debug info, LTO, one codegen unit)
and run the workspace's own bindgen (`packages/link/uniffi-bindgen`, UniFFI `=0.32.2` like the
library, so the checksums match) in library mode against the host cdylib, with the global config
`packages/link/mobile/bindgen.toml`. `scripts/lib/broski-core.sh` holds what they share.

They live in the repository's `scripts/` because they span `packages/link` (input) and `apps/`
(output), and both the app builds and CI call them from the root.

| Output | Written by | Committed? |
|---|---|---|
| `apps/ios/BroskiCore/BroskiCoreFFI.xcframework` | `build-ios-core.sh` | no (gitignored) |
| `apps/ios/BroskiCore/Sources/BroskiCore/Generated/*.swift` | `build-ios-core.sh` | no |
| `apps/android/core/src/main/jniLibs/<abi>/libbroski_core.so` | `build-android-core.sh` | no |
| `apps/android/core/src/generated/kotlin/uniffi/**` | `build-android-core.sh` | no |
| `apps/android/core/src/test/native/libbroski_core.{dylib,so}` | `build-android-core.sh` | no |
| `packages/link/mobile/bindgen.toml`, the scripts, `Package.swift`, the Gradle build, the tests | hand-written | yes |

Bindings and binaries are build outputs: the bindings must match the library byte for byte (UniFFI
checks API checksums at load), they are large (the contract alone is ~700 KB of Swift), and the
scripts reproduce them byte for byte from `packages/link` (about two minutes for iOS and one for
Android from an empty cargo target on an M-series Mac, seconds when cargo is warm). Committing them would let a stale copy
pass review. The cost is that each app build runs its script first (and CI does, §5).

**Regenerate after any change under `packages/link`:**

```bash
scripts/build-ios-core.sh                                   # macOS with Xcode
ANDROID_HOME="$HOME/Library/Android/sdk" scripts/build-android-core.sh
```

## 3. iOS

`build-ios-core.sh` builds `libbroski_core.a` for `aarch64-apple-ios`, for the simulator
(`aarch64-apple-ios-sim` and `x86_64-apple-ios`, joined with `lipo`, because a build for "any iOS
Simulator" compiles both architectures) and for the host, generates the Swift bindings, writes the
modulemap, and runs `xcodebuild -create-xcframework`:

```
apps/ios/BroskiCore/
  Package.swift                      swift-tools 6.2: iOS 26, macOS 15 (host tests)
  BroskiCoreFFI.xcframework/         ios-arm64 · ios-arm64_x86_64-simulator · macos-arm64
    <slice>/libbroski_core.a
    <slice>/Headers/{broski_contractFFI.h, broski_coreFFI.h, module.modulemap}
  Sources/BroskiCore/Generated/      broski_contract.swift, broski_core.swift
  Tests/BroskiCoreTests/             Swift Testing over the real library
```

`Package.swift` declares `.binaryTarget(name: "BroskiCoreFFI", path: "BroskiCoreFFI.xcframework")`
and the Swift target `BroskiCore` holding the generated files. The Phase 4 app and its notification
service extension add the package as a local dependency and link the `BroskiCore` product; there is
one Rust library in the app, which avoids the duplicate `rust_eh_personality` and modulemap clashes of
several UniFFI XCFrameworks.

**One C module, owned modulemap.** Swift compiles all generated files into one module, which UniFFI
requires for external types; so both crates' headers belong to one C module, `BroskiCoreFFI`.
`bindgen.toml` names that module for every crate, gives each crate its own header file
(`ffi_module_filename`; otherwise the second header overwrites the first), and turns UniFFI's
per-crate modulemaps off. The script writes the one modulemap:

```
module BroskiCoreFFI {
    header "broski_contractFFI.h"
    header "broski_coreFFI.h"
    export *
}
```

It leaves out the `use "Darwin"`, `use "_Builtin_stdbool"`, `use "_Builtin_stdint"` lines of UniFFI's
template (`uniffi_bindgen-0.32.2/src/bindings/swift/templates/ModuleMapTemplate.modulemap`), which
mozilla/uniffi-rs#2917 reports make `canImport(<module>FFI)` false under Xcode 26/27. With Xcode 27.2
(Swift 6.4.2) the bug did **not** reproduce for this package: the same XCFramework with those three
lines added still built with `swift build` and with `xcodebuild` for the simulator and devices. The
lines are left out anyway because nothing needs them: the headers include only `<stdbool.h>`,
`<stddef.h>` and `<stdint.h>`, and the package builds without the lines on every platform.

**Swift 6.** The package builds in Swift 6 language mode, and its checks pass `-warnings-as-errors`: UniFFI 0.32.2
marks objects `@unchecked Sendable` (they are `Arc`s of `Send + Sync` Rust types) and records and
enums `Sendable`, and no export is a foreign trait, so the async-trait warning of #2929 never arises.

**Tests** (`Tests/BroskiCoreTests`, Swift Testing over the real library): with no machine to reach, a
phone from a new and from a broken secret, the offer and the stored record, a pairing that says why it
failed, a stored machine that retries its dial and ends when forgotten (a contract request and a
`SessionRef` crossing both ways), a pull that outlives its cancelled task and still delivers the next
update, the `withTaskCancellationHandler` loop that detaches its view, the seen state, and the push
vectors; `Support.swift` holds the Swift `Replica`, the model code an app's chat screen mirrors. On the
host only (`#if os(macOS)`), `RealMachineTests.swift` runs `packages/link/testkit`'s `test-machine`
(`cargo run`: the real daemon, and the real bridge on Bun, as `cargo test -p broski-client` needs them),
pairs with it, and holds the Swift replica of a streamed run equal to the view's snapshot.

**Checks:** `swift test -Xswiftc -warnings-as-errors` in `apps/ios/BroskiCore` (host; needs cargo, Bun
and `bun install` in `packages/bridge`); `xcodebuild test -scheme BroskiCore
-destination 'platform=iOS Simulator,…'` runs the suite but the real-machine test in the simulator;
`xcodebuild build-for-testing -scheme BroskiCore -destination 'generic/platform=iOS Simulator'` and
`… 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO` link the test bundle against each slice.

## 4. Android

### Toolchain (macOS, no Android Studio)

Everything lives in the home directory; nothing is installed system-wide and no shell profile is
edited, so export the variables per command:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk" JAVA_HOME="$(/usr/libexec/java_home -v 17)"
```

| Component | Version | Where |
|---|---|---|
| SDK command-line tools | 21.0 (`commandlinetools-mac-15641748_latest.zip`) | `$ANDROID_HOME/cmdline-tools/latest` |
| `platform-tools`, `platforms;android-36`, `build-tools;36.0.0` | 37.0.1, 36, 36.0.0 | `$ANDROID_HOME` |
| `ndk;28.2.13676358` (r28c) | 28.2.13676358 | `$ANDROID_HOME/ndk/28.2.13676358` |
| `cargo-ndk` | 4.1.2 (`cargo install cargo-ndk --version 4.1.2 --locked`) | `~/.cargo/bin` |
| Gradle | 9.6.0 through the committed wrapper (`apps/android/gradlew`, SHA-256 pinned) | `~/.gradle/wrapper/dists` |
| JDK | 17 (Temurin) | `/usr/libexec/java_home -v 17` |

Install: unzip the command-line tools into `$ANDROID_HOME/cmdline-tools/latest`, then
`sdkmanager --licenses` and `sdkmanager --install "platform-tools" "platforms;android-36"
"build-tools;36.0.0" "ndk;28.2.13676358"` ([research/android.md](../rebuild/research/android.md)).

### The module

`build-android-core.sh` runs `cargo ndk --platform 26 -t arm64-v8a -t x86_64 -o
apps/android/core/src/main/jniLibs build -p broski-mobile --profile mobile` with the catalog's NDK,
builds the host library, generates the Kotlin bindings into `core/src/generated/kotlin`, and copies the
host library to `core/src/test/native` for the JVM tests.

The NDK is the catalog's, `$ANDROID_HOME/ndk/<version>`; `ANDROID_NDK_HOME` serves only when that one is
not installed (the script says so), because a CI runner presets it to its image's own, older NDK. The
script exports the chosen path as `ANDROID_NDK_HOME` and `ANDROID_NDK_ROOT`, the variables `cargo ndk`
reads first, so no preset reaches it; `check-android-alignment.sh` picks its `llvm-readelf` the same way.

```
apps/android/
  settings.gradle.kts         repositories; include(":app", ":core")
  build.gradle.kts            the Kotlin Gradle plugin 2.4.21 on the build classpath (AGP 9's built-in
                              Kotlin otherwise uses its own 2.2.10); AGP declared, not applied
  gradle/libs.versions.toml   AGP 9.5.1, Kotlin 2.4.21, compileSdk 36, minSdk 26, NDK, JNA, coroutines
  gradle/wrapper/             Gradle 9.6.0
  core/
    build.gradle.kts          com.android.library, namespace com.muzammil.broski.core
    consumer-rules.pro        R8 rules every consuming app applies
    src/main/jniLibs/         libbroski_core.so per ABI (generated)
    src/generated/kotlin/     uniffi.broski_contract, uniffi.broski_core (generated)
    src/test/kotlin/          the JVM tests
  app/                        the Android app (apps/android/README.md)
```

AGP 9 compiles Kotlin itself (built-in Kotlin), so no `org.jetbrains.kotlin.android` plugin is
applied; the generated directory joins the `main` source set through
`sourceSets.named("main") { kotlin.directories += "src/generated/kotlin" }`. The bindings are
generated with `android = true`: objects are cleaned by `android.system.SystemCleaner` from API 34 and
by JNA's cleaner below it (hence `androidx.annotation`), and the async exports need
`kotlinx-coroutines-core`.

**JNA.** `net.java.dev.jna:jna:5.19.1@aar` is an `api` dependency (the bindings expose JNA types).
Not 5.14.0: its `libjnidispatch.so` for x86_64 has 4 KB LOAD alignment (`0x1000`; arm64 `0x10000`),
which fails 16 KB-page devices; 5.17.0 is the first release aligned to `0x4000` on both ABIs, and
5.19.1 also restores support for older Android releases.

**No library override.** In library mode the bindgen names the library it read (`broski_core`) as
every component's `cdylib_name` (`uniffi_bindgen/src/bindings/kotlin/mod.rs`), and the APK carries
`libbroski_core.so`, so JNA resolves it by that name with no `uniffi.component.<name>.libraryOverride`
property and no `System.loadLibrary` call. The JVM tests load the host build the same way, by name,
with `jna.library.path` pointing at it. On the emulator (API 36, arm64-v8a) the app loads it the same
way, in debug and in a minified release build.

**R8** (`core/consumer-rules.pro`, applied by every app that minifies): JNA's own rules from its FAQ
("JNA on Android"), because its AAR ships none —

```
-dontwarn java.awt.*
-keep class com.sun.jna.* { *; }
-keep class * extends com.sun.jna.* { *; }
-keepclassmembers class * extends com.sun.jna.* { public *; }
```

— and the bindings kept whole, because JNA registers their native functions by name and reads their
structures' field order from annotations: `-keepattributes RuntimeVisibleAnnotations,AnnotationDefault`,
`-keep class uniffi.broski_contract.** { *; }`, `-keep class uniffi.broski_core.** { *; }` (scoped to
this library's packages rather than every `uniffi.**`). The AAR carries them as `proguard.txt`. The
app's release build, minified with them, starts its `Phone` from the vault, decodes stored records,
reconnects and fills the inbox from a real machine on the emulator (apps/android/README.md).

**16 KB pages.** NDK r28 links with 16 KB max page size by default, and `cargo ndk` uses its linker.
`scripts/check-android-alignment.sh <aar|apk>` fails unless every `.so` inside has LOAD segments
aligned to at least `0x4000` (read with the NDK's `llvm-readelf`).

**Tests** (`core/src/test/kotlin`, JUnit over the host library): the Swift suite's cases with no machine
to reach, where cancelling a coroutine ends its pull at once and the next pull still gets the update
that came after, and `detach()` ends a pull in progress. The real-machine pairing is the Swift suite's
only: both bindings come from the same library metadata, and the JVM tests stay free of cargo and Bun.

**Checks** (from `apps/android`): `./gradlew :core:assembleDebug :core:assembleRelease
:core:testDebugUnitTest`, then `scripts/check-android-alignment.sh core/build/outputs/aar/core-release.aar`.

## 5. CI

`.github/workflows/ci.yml`:

- `link` — fmt, clippy and tests of the whole workspace, which includes `broski-mobile` and therefore
  the contract with its UniFFI derives, plus clippy of the contract without them.
- `ios-core` (`macos-26`) — `build-ios-core.sh`, Bun and the bridge's dependencies (for the
  real-machine test), `swift test -Xswiftc -warnings-as-errors`, and `build-for-testing` for the
  simulator and for devices.
- `android-core` (`ubuntu-latest`) — the catalog's NDK and SDK packages through the runner's
  `sdkmanager` (the catalog's NDK wins over the runner's preset `ANDROID_NDK_HOME`), `cargo-ndk` 4.1.2, `build-android-core.sh`, both assembles and the JVM tests, and the
  alignment check of the release AAR.

## 6. Adding to the API

A new capability belongs in `broski-client` first; the facade then forwards it with a
`#[uniffi::export]` item in `packages/link/mobile/src/`. Objects are `#[derive(uniffi::Object)]`
newtypes over the client's `Arc`s, returned as `Arc<Self>`; async methods await only what the client
awaits (a `Notify`, a `oneshot`, a timer on the link runtime), never block; streams are objects with an
`async fn next_…() -> Option<…>` the app pulls and a `detach`/`stop` that ends a pull in progress. A
type another UniFFI crate already derives needs no code; a plain Rust type of the client or the session
crate is restated with `#[uniffi::remote]`, which the compiler checks against it. No method may be
named `close` or `destroy`, and no error field `message` (§1). Then
rerun both scripts: Swift and Kotlin pick the new API up from the regenerated bindings with no change
to the packaging.
