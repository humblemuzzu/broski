# BroskiCore on the phones — how the Rust core is built, packaged and consumed

The iOS and Android apps share one Rust library, `libbroski_core`, built from the crate
`packages/link/mobile` (`broski-mobile`, lib `broski_core`). UniFFI 0.32.2 generates its Swift and
Kotlin bindings. This note covers the facade, the two packagings, what is generated and what is
committed, and how to regenerate everything.

```
packages/link/session   (broski-link-session: sockets, route race, resume, pairing, push crypto)
packages/link/contract  (broski-contract: contract models with UniFFI derives, frame codec, reducer)
          └── packages/link/mobile  (broski-mobile → libbroski_core: the UniFFI facade)
                ├── scripts/build-ios-core.sh      → apps/ios/BroskiCore (XCFramework + Swift package)
                └── scripts/build-android-core.sh  → apps/android/core   (Android library module)
```

## 1. The facade

`broski-mobile` is a thin wrapper: every behaviour lives in the session and contract crates
([link-session.md](connectivity-v2/link-session.md), [contract §3](contract/README.md)). It calls
`uniffi::setup_scaffolding!()` and exports:

| Export | Kind | Wraps |
|---|---|---|
| `LinkRuntime()` | object | `LinkRuntime`: the one thread every session runs on; one per process |
| `DeviceIdentity.generate()`, `.fromSecret(secret)`, `.secret()`, `.id()` | object | `DeviceIdentity` |
| `PairingOffer.parse(uri)`, `.machineId()`, `.name()`, `.expiresAt()` | object | `Offer`; `pair` takes its one-time secret, a second `pair` throws `OfferUsed` |
| `pair(runtime, identity, offer, options) async → PairedMachine { session, record }` | function | `pair` |
| `LinkSession.start(runtime, identity, record, options)` | object | `Session::start` |
| `LinkSession.nextEvent() async → LinkEvent?`, `.status()`, `.sendBridge(frame, tag)`, `.restartBridge()`, `.registerPush(platform, token)`, `.unregisterPush()`, `.pause()`, `.resume()`, `.networkChanged()`, `.lanDiscovered(routes)`, `.end()`, `.machineId()` | methods | `Session` (`end` is `close`, renamed because Kotlin objects already have `close()` from `AutoCloseable`) |
| `MachineRecord.fromBytes(bytes)`, `.toBytes()`, `.id()`, `.name()`, `.os()`, `.pairedAtMs()` | object | `MachineRecord` and its stored form (`session/src/record_codec.rs`) |
| `openNotification(record, data) → PushNotification` | function | `push::open_notification` |
| `decisionLetter(record, decision, backend, session, request) → LetterRequest { url, headers, body }` | function | `push::decision_letter` |
| `encodeFrame(message: ClientMessage) → bytes`, `decodeFrame(bytes) → ServerMessage` | functions | `broski_contract::{encode_frame, decode_frame}` |
| `CoreError` (flat: every case carries the Rust message), `SendFailure` | errors | `broski_link_session::Error`, `SendFailure` |

Rules the facade keeps:

- **No foreign callbacks.** Events are pulled: the app runs `while let event = await session.nextEvent()`
  in one task (a `Task` in Swift, a coroutine in Kotlin) and cancels the task to stop. Cancelling loses
  no event: the wait is a `tokio::sync::Notify` polled on the caller's executor, and an event leaves the
  queue only in the poll that returns it. Foreign traits are avoided altogether (they warn under Swift 6,
  mozilla/uniffi-rs#2929).
- **Async never blocks the caller's thread.** UniFFI polls an exported future on the foreign thread
  and starts no runtime. `pair` hands its work to the session crate's `LinkRuntime` thread and awaits
  the join; `nextEvent` touches no tokio I/O or timer, only the `Notify`.
- **Secrets stay behind objects.** `MachineRecord` is opaque because it carries the relay token and
  the push key; the app stores `toBytes()` whole in the Keychain or the Keystore. `DeviceIdentity`
  hands its secret out only through `secret()`.
- **Session values are UniFFI remote types** (`LinkStatus`, `LinkState`, `WaitReason`, `LinkRoute`,
  `BridgeStatus`, `BridgeState`, `SendFailure`, `Platform`, `PushPlatform`, `PushNotification`,
  `PushDecision`): the facade restates each definition under `#[uniffi::remote]`, and the compiler
  checks the restatement against the session crate, so they cannot drift.
- **Contract types are external types.** `broski-contract` derives `uniffi::Record`/`Enum` behind its
  `uniffi` feature and sets up its own scaffolding; the facade uses `ClientMessage` and
  `ServerMessage` directly and the bindgen emits the contract's bindings next to the facade's.

`packages/link/mobile/tests/facade.rs` runs every export over fixtures the Swift and Kotlin smoke
tests share (`tests/fixtures`: a QR offer written by the daemon's encoder, the stored record and
device secret of that pairing, the push vectors of [push.md](connectivity-v2/push.md)).

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

**Swift 6.** The package builds in Swift 6 language mode with `-warnings-as-errors`: UniFFI 0.32.2
marks objects `@unchecked Sendable` (they are `Arc`s of `Send + Sync` Rust types) and records and
enums `Sendable`, and no export is a foreign trait, so the async-trait warning of #2929 never arises.

**Checks:** `swift test` in `apps/ios/BroskiCore` (host); `xcodebuild test -scheme BroskiCore
-destination 'platform=iOS Simulator,…'` runs the same suite in the simulator;
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

```
apps/android/
  settings.gradle.kts         repositories; include(":core") — the Phase 4 app joins as include(":app")
  build.gradle.kts            the Kotlin Gradle plugin 2.4.21 on the build classpath (AGP 9's built-in
                              Kotlin otherwise uses its own 2.2.10); AGP declared, not applied
  gradle/libs.versions.toml   AGP 9.5.1, Kotlin 2.4.21, compileSdk 36, minSdk 26, NDK, JNA, coroutines
  gradle/wrapper/             Gradle 9.6.0
  core/
    build.gradle.kts          com.android.library, namespace com.muzammil.broski.core
    consumer-rules.pro        R8 rules every consuming app applies
    src/main/jniLibs/         libbroski_core.so per ABI (generated)
    src/generated/kotlin/     uniffi.broski_contract, uniffi.broski_core (generated)
    src/test/kotlin/          the JVM smoke test
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
with `jna.library.path` pointing at it; loading on a device or emulator is first exercised by the
Phase 4 app.

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
this library's packages rather than every `uniffi.**`). The AAR carries them as `proguard.txt`; no
minified app has run them yet, so the Phase 4 app's release build on a device is their first real test.

**16 KB pages.** NDK r28 links with 16 KB max page size by default, and `cargo ndk` uses its linker.
`scripts/check-android-alignment.sh <aar|apk>` fails unless every `.so` inside has LOAD segments
aligned to at least `0x4000` (read with the NDK's `llvm-readelf`).

**Checks** (from `apps/android`): `./gradlew :core:assembleDebug :core:assembleRelease
:core:testDebugUnitTest`, then `scripts/check-android-alignment.sh core/build/outputs/aar/core-release.aar`.

## 5. CI

`.github/workflows/ci.yml`:

- `link` — fmt, clippy and tests of the whole workspace, which includes `broski-mobile` and therefore
  the contract with its UniFFI derives, plus clippy of the contract without them.
- `ios-core` (`macos-26`) — `build-ios-core.sh`, `swift test`, and `build-for-testing` for the
  simulator and for devices.
- `android-core` (`ubuntu-latest`) — the catalog's NDK and SDK packages through the runner's
  `sdkmanager`, `cargo-ndk` 4.1.2, `build-android-core.sh`, both assembles and the JVM tests, and the
  alignment check of the release AAR.

## 6. Adding to the API

A new export is a `#[uniffi::export]` item in `packages/link/mobile/src/`, wrapping a crate that owns
the behaviour. Objects are `#[derive(uniffi::Object)]` newtypes returned as `Arc<Self>`; async methods
await work on the `LinkRuntime` thread or a runtime-free primitive, never block; streams are objects
with an `async fn next_…() -> Option<…>` the app pulls. A type another UniFFI crate already derives
needs no code; a plain Rust type from the session crate is restated with `#[uniffi::remote]`. Then
rerun both scripts: Swift and Kotlin pick the new API up from the regenerated bindings with no change
to the packaging.
