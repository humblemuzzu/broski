# Broski for Android

The native Android app: Kotlin, Jetpack Compose, Material 3 Expressive. It renders and sends; everything
below the UI is BroskiCore (`:core`, [mobile-core.md](../../docs/architecture/mobile-core.md),
[mobile-packaging.md](../../docs/architecture/mobile-packaging.md)). Product and design spec:
[design.md](../../docs/rebuild/design.md).

## Build, run, test

From the repository root, with `ANDROID_HOME="$HOME/Library/Android/sdk"` and
`JAVA_HOME="$(/usr/libexec/java_home -v 17)"` exported:

```bash
scripts/build-android-core.sh            # :core's bindings and libraries; rerun after any change under packages/link
cd apps/android
./gradlew :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :core:testDebugUnitTest
./gradlew :app:lint
./gradlew :app:installDebug              # onto the running emulator or device
cd ../.. && scripts/test-android-real-machine.sh   # instrumented tests against a real machine (below)
```

| What | Version |
|---|---|
| AGP / Gradle / Kotlin | 9.5.1 / 9.6.0 / 2.4.21 (AGP's built-in Kotlin, the Compose and serialization compiler plugins) |
| SDK | minSdk 26, targetSdk 36, compileSdk 37 for `:app` (Compose 1.12, material3 1.5 and lifecycle 2.11 refuse less; `:core` stays on 36) |
| Compose | BOM 2026.09.00 with material3 and material3-adaptive-navigation-suite 1.5.0-rc01 (Expressive) |
| Navigation | androidx.navigation3 1.2.1 and lifecycle-viewmodel-navigation3 2.11.0 |
| Storage | DataStore 1.3.0 (Preferences) under an Android Keystore AES-256-GCM key |
| QR | Google Code Scanner `play-services-code-scanner` 16.1.0 (no camera permission) |

Install `platforms;android-37.0` next to the packages [mobile-packaging.md §4](../../docs/architecture/mobile-packaging.md#4-android)
lists. The emulator used here: `emulator` 37.2.13 and `system-images;android-36;google_apis_playstore_ps16k;arm64-v8a`
(Play services, for the Code Scanner), AVD `broski-api36` on the `pixel_8` profile.

A release build is minified and resource-shrunk by R8 with `:core`'s consumer rules (JNA and the UniFFI
bindings kept); it carries `libbroski_core.so` for arm64-v8a and x86_64 only, the ABIs the core is built for.
It is unsigned: sign it with your own key to install it.

## Tests

- **JVM** (`app/src/test`): the vault over a real DataStore file and real AES-GCM with a software key
  (round trip across a restart, nothing in the clear, a value that does not open is an error and never a
  first run, a value moved under another name does not open); the pairing flow over the host build of the
  real core with the facade's fixture offer (preview, expiry, wrong code, empty clipboard, an unreachable
  machine that stores nothing and can be tried again, a sentence for every `LinkFailure`); inbox sections
  from real `InboxRow` values; `MachineHealth` from `MachineStatus`; NSD routes.
- **Instrumented** (`app/src/androidTest`): the vault under the real Keystore key; `RealMachineTest`, the
  whole first run against a real machine.

`scripts/test-android-real-machine.sh` starts `packages/link/testkit`'s `test-machine` (the real daemon and
the real bridge on its fake backend; needs cargo, Bun and `bun install` in `packages/bridge`), reverses its
LAN port into the device with `adb reverse` so the app dials exactly the `127.0.0.1:<port>` route the offer
names, clears the app's data, and runs `connectedDebugAndroidTest` with the offer and the served directory
as instrumentation arguments. `RealMachineTest` puts the link on the clipboard, taps **Paste pairing link**,
**Pair with …**, waits for the inbox, starts a Pi session on the bridge through the app's own `Machine`,
and finds its row in the inbox. Without those arguments it is skipped.

## Layout

```
app/src/main/kotlin/com/muzammil/broski/
  app/        BroskiApplication, MainActivity, BroskiApp (splash → welcome or shell), Shell (navigation
              bar / rail + NavDisplay), Navigator (one back stack per tab), Routes, Features
  design/     theme (dynamic colour, the blue-violet fallback, semantic colours, expressive motion),
              JetBrains Mono, haptics, agent marks, machine status chips, buttons, rows, empty and
              message screens, notices, command blocks, relative time
  core/       AppCore (vault, settings, the one Phone), PhoneSession (machines, inbox, actions),
              MachineState / MachineHealth, vault/ (Keystore key, AES-GCM, DataStore), settings/,
              platform/ (foreground, network, NSD discovery)
  feature/welcome, feature/pairing, feature/inbox, feature/machines, feature/settings
```

Phase 4.2 adds `feature/chat`, `feature/composer`, `feature/workspace` and `feature/notifications`.

## Core wiring

- **One `Phone`**, owned by `AppCore` (created in `BroskiApplication.onCreate`), started on `Dispatchers.IO`:
  the identity secret from the vault, or `newIdentitySecret()` stored first on a first run; a secret that
  is stored but does not open, or that the core refuses, stops the app with a plain screen and is never
  replaced. Then `inbox().restoreSeen(...)` with the stored seen state, then `phone.start(...)` for each
  stored record. The splash screen stays until this and the settings are read.
- **Vault** (`core/vault`): one Preferences DataStore file, each value sealed with AES-256-GCM under the
  Keystore key `broski.vault.v1`, the value's name as associated data: `identity`, `machine:<id>` (the
  record's `toBytes()`, stored at pairing and at every `RecordChanged`), `seen` (each non-null
  `InboxUpdate.seen`). Backups and device transfer exclude the app's data: the key never leaves the device.
- **Loops**: one per subscription in `AppCore`'s `SupervisorJob` scope for the life of the process: the
  inbox (`rows()` first, then `nextChange()`), and per machine its events (`status()` and `record()` first,
  then `nextEvent()` until it ends). Screens observe `StateFlow`s.
- **Lifecycle**: `ProcessLifecycleOwner` start/stop → `phone.resume()`/`pause()` and NSD discovery on/off; a
  process started in the background starts paused. `ConnectivityManager` default-network changes →
  `networkChanged()` (not the first network at registration).
- **LAN discovery**: `NsdManager` browses `_broski-link._tcp`, resolves with `registerServiceInfoCallback`
  on API 34+ and one `resolveService` at a time below, checks TXT `v=1`, and hands `host:port` routes
  (IPv4 first, link-local IPv6 left out) to `machine.lanDiscovered` for TXT `id`. At targetSdk 36 it needs
  no permission beyond `INTERNET`.

## Integration points for Phase 4.2

- **`app/Features.kt`** is the one place 4.2 plugs its screens in: `BroskiFeatures = Features(session = …,
  workspace = …, newSession = …)`. Each slot gets a `FeatureContext` (`phone: PhoneSession`, `navigate`,
  `back`). The shell offers a destination only once its slot is filled: the Workspace tab, opening an inbox
  row (`SessionRoute`), the Inbox's large New session FAB and the empty inbox's New session button.
- **`SessionRoute(machineId, backend, sessionId)`** (`app/Routes.kt`; `.session` is the `SessionRef`) opens
  the chat. The chat calls `phone.markSeen(route.machineId, route.session)` when it opens and when it is
  left, and `phone.machine(id)` for views (`attach` in the coroutine, `detach()` in `finally`, as
  mobile-packaging.md §1 says).
- **More routes**: add them to the sealed `Route` in `app/Routes.kt` (serializable; restored after process
  death) and register them where `Shell.kt` registers the slots.
- **New session**: the sheet gets `dismiss`; it calls `navigate(SessionRoute.of(machineId, session))`.
- **Notifications** (4.2): the `POST_NOTIFICATIONS` ask belongs at the moment a pairing succeeds, as on iOS
  (design.md, First run and pairing): `PairingEffects` in `feature/pairing/PairingFlow.kt`, `Paired`
  branch. The FCM service reads records with `AppCore.vault` (`MachineRecord.fromBytes`) and the local
  preferences with `AppCore.settings` (`NotificationKind`).
- **Design system**: `design/` (`BroskiTheme.semantic`, `Haptic`, `AgentMark`, `MachineStatusChip`,
  `groupedListItemColors`, `PrimaryButton`/`SecondaryButton`/`QuietButton`, `SectionHeader`, `EmptyState`,
  `Notice`, `MessageScreen`, `CommandBlock`, `MonoFamily`/`TextStyle.mono()`, `relativeTime`).
