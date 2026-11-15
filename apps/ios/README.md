# Broski for iOS

The native iPhone and iPad app: SwiftUI for iOS 26+, Swift 6 language mode, Liquid Glass. The product
and design spec is [`docs/rebuild/design.md`](../../docs/rebuild/design.md); the core it renders is
BroskiCore ([`BroskiCore/`](BroskiCore), [`docs/architecture/mobile-packaging.md`](../../docs/architecture/mobile-packaging.md)).

```
apps/ios/
  Broski/          the app (XcodeGen project.yml; Broski.xcodeproj and build/ are build outputs)
  BroskiCore/      the Swift package of the Rust core, built by scripts/build-ios-core.sh
  carryover/       the Flutter app's push code, for the notification feature
```

## Build, run, test

Xcode 27.2, XcodeGen 2.46 (`/opt/homebrew/bin/xcodegen`), and what `scripts/build-ios-core.sh` needs
(the Rust iOS targets). From the repository root:

```bash
scripts/build-ios-app.sh                     # BroskiCore if stale, xcodegen, build for any simulator
scripts/build-ios-app.sh device              # any iOS device (team FGYQ983C57, automatic signing)
scripts/build-ios-app.sh device --unsigned   # without a provisioning profile
BROSKI_SIMULATOR="iPhone Duo" scripts/build-ios-app.sh --test   # the unit tests
BROSKI_SIMULATOR="iPhone Duo" scripts/e2e-ios-app.sh            # the real-machine run below
```

`build-ios-app.sh` rebuilds BroskiCore whenever a file under `packages/link` is newer than the
XCFramework. To work in Xcode: `xcodegen generate --spec apps/ios/Broski/project.yml --project apps/ios/Broski`,
then open `apps/ios/Broski/Broski.xcodeproj` (scheme `Broski`).

The target builds with `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`, `SWIFT_APPROACHABLE_CONCURRENCY`
(which adds `InferIsolatedConformances` and `NonisolatedNonsendingByDefault` to Swift 6) and
`MemberImportVisibility`, and treats warnings as errors.

### Tests

- **`Tests/`** (scheme `Broski`, Swift Testing, hosted by the app in the simulator): the keychain in
  both groups (`PersistenceTests`: the identity secret opens the same phone, records in the shared
  group, the seen state back into a new phone's inbox, start over, a launch that never replaces an
  identity), pairing (`PairingTests`: every `LinkFailure`'s words and next step, a pasted offer's
  preview, a pairing with the fixture machine that cannot be reached), the inbox's sections from
  `InboxRow` values, and `MachineSummary`'s words. They read `packages/link/mobile/tests/fixtures`
  from the checkout and use keychain services of their own.
- **`UITests/`** (scheme `BroskiE2E`): `scripts/e2e-ios-app.sh` starts `packages/link/testkit`'s
  `test-machine` (the real daemon and the real bridge on its fake backend; needs Bun and
  `bun install` in `packages/bridge`), seeds two sessions, reinstalls the app with a clean keychain,
  puts the pairing link on the simulator's pasteboard, and runs the tests: pair from the pasted link,
  see the history as idle, add a session through the machine (`{"seed":…}` appended to the file the
  machine reads) and see it as done, pull the inbox to refresh (the list stays whole, and the script
  fails unless the app logged that the core answered the refresh), then Machines, Settings, dark appearance and the largest text
  size. Screenshots land in `apps/ios/Broski/build/e2e/screenshots`. The test daemon never
  advertises itself, so the script advertises its LAN port the way `discovery.rs` does (`dns-sd -P`,
  TXT `id`, `v=1`) and fails unless the app logged that its browse found the machine.
  iOS 27 simulators cannot show the paste prompt, so the script grants "Paste from Other Apps"
  through the simulator's TCC database (`kTCCServicePasteboard`); `simctl privacy` has no such
  service.

## Layout

```
Broski/
  project.yml
  Resources/   Info.plist, Broski.entitlements, Assets.xcassets (AppIcon, AccentColor)
  Shared/      code the app shares with its future extensions: Keychain, MachineRecordStore
  Sources/
    App/           BroskiApp, RootView (welcome or tabs; the pairing sheet), AppTabs, Route,
                   IdentityProblemView
    Core/          AppModel, MachineModel, InboxModel, PhoneStorage, MachineSummary, LanDiscovery,
                   PathWatcher, NotificationAccess, Preferences, Logging
    DesignSystem/  Palette, Typography, Metrics, Motion, Haptics, GlassControls, AgentMark,
                   BroskiMark, Indicators, StatusChip, Banner
    Features/      Welcome, Pairing, Inbox, Machines, Settings
  Tests/  UITests/
```

Every target globs its folders: a new folder under `Sources/Features` needs no project edit.

## Core wiring

**`AppModel`** (`@Observable`, main actor, one per process) owns the `Phone`.

- **Launch** (`BroskiApp.init` → `start()`): the identity secret from the keychain, or on the very
  first run `newIdentitySecret()` saved before anything else. Never replaced on an error: a keychain
  failure, a refused identity, or pairings without an identity show `IdentityProblemView`, whose
  Start Over (confirmed) is the only path that removes the identity. Then `inbox().restoreSeen` with
  the stored seen state, the inbox loop, `phone.start(record:)` for each stored record (one that
  does not start is listed under Machines as unreadable, to forget), the path monitor and LAN
  discovery.
- **Persistence** (generic passwords, readable after first unlock, this device only):

  | What | Service / account | Access group |
  |---|---|---|
  | identity secret | `com.muzammil.broski` / `identity-secret` | the app's own (first entitlement) |
  | inbox `SeenState` (JSON, backends as wire names) | `com.muzammil.broski` / `inbox-seen` | the app's own |
  | each `MachineRecord.toBytes()` | `com.muzammil.broski.machine` / machine id | `BroskiKeychainGroup` = `<team>.com.muzammil.broski.push`, shared with the notification extension |

  A record is written right after pairing and at every `MachineEvent.recordChanged`, removed on
  forget; the seen state whenever `InboxUpdate.seen` is not `nil`.
- **Loops**: one per subscription, as `Task`s on the main actor. `InboxModel` pulls
  `Inbox.nextChange()` for the life of the phone (it never ends). Each `MachineModel` pulls
  `Machine.nextEvent()` until the core ends it (forgotten, replaced by a new pairing, revoked):
  status, record persistence, backends and their statuses. Neither is cancelled from Swift, which
  would not end the pull anyway (mobile-packaging.md §1); views and lists that 4.2 opens must detach
  in `withTaskCancellationHandler`'s `onCancel`.
- **Lifecycle**: `scenePhaseChanged` → `phone.resume()` on active, `phone.pause()` on background;
  `PathWatcher` (`NWPathMonitor`) → `phone.networkChanged()` when the path changes after its first
  report.
- **LAN discovery** (`LanDiscovery`, `NWBrowser` for `_broski-link._tcp`): runs only while the app is
  active and a pairing exists (so the Local Network prompt comes after pairing). A result whose TXT
  `v` is `1` and `id` names a paired machine is resolved by a short TCP connection to the service
  (IPv4, the core's routes carry no IPv6 zone) and reported as `host:port` to
  `machine.lanDiscovered(routes:)`. A browse refused with `kDNSServiceErr_PolicyDenied` sets
  `denied`, which Machines explains with a link to Settings.
- **Pull to refresh** (`InboxModel.refresh()`, awaited by the inbox's `.refreshable`): the core's
  `Inbox.refresh()`, which reloads every ready machine's sessions from the first page, dials a link
  that is waiting to dial, and returns once the reloads are answered. The rows arrive through the
  inbox loop like any change.

## Screens

- **Welcome**: the sentence, the two Mac commands, **Scan Pairing Code** (`.glassProminent`) and
  **Paste Pairing Link** (`.glass`) in one `GlassEffectContainer`.
- **Pairing** (one sheet over the root): VisionKit scanner (QR, guidance, highlighting), or why it
  cannot run (unsupported, camera denied) with paste offered; the clipboard read once on tap
  (`Clipboard.read`: empty, refused or text); offer preview with name, live expiry countdown,
  "Already paired"; progress in a glass card; every `LinkFailure` worded (`PairingProblem`) with its
  next step; success haptic; the notification permission ask with its one-line why. The ask is this
  feature's; registering with APNs is the notifications feature's.
- **Inbox**: sections Needs you / Working / Done / Idle from the core's order, machine status chips,
  rows (agent mark, title, ask, machine · folder or the machine's status, relative time, state mark),
  rows of an unreachable machine dimmed, empty states (connecting, unreachable, no sessions, nothing
  working), the "n agents working" bottom accessory (iOS 26.1+) that filters to working, a failure
  haptic when a machine is lost, a needs-you badge on the tab.
- **Machines**: per Mac its link (LAN / relay / waiting and why / revoked), last seen, bridge and
  agent versions, Restart Bridge when the bridge is down or crashed, Forget with the confirm
  sentence; Pair Another (scan or paste); unreadable pairings; the Local Network hint.
- **Settings**: notification kinds (`Preference.notify*`, local), appearance (system / light / dark),
  About (app version and build, core version and protocol, each Mac's bridge), the privacy line.

## Design system (for Phase 4.2)

| File | What |
|---|---|
| `Palette` | accent (`AccentColor`, blue-violet, AA in light and dark), needs you / working / done / failed / caution, neutral mark colors; `InboxState.title/.tint`, `BackendId.displayName/.monogram` |
| `Typography` | `Font.screenTitle`, `.rowTitle`, `.rowDetail`, `.code`, `.codeSmall` (all Dynamic Type) |
| `Metrics` | `Spacing` (4-pt grid), `Radius` |
| `Motion` | `Motion.spring/snappy/crossfade`, `(reduceMotion:)` variants, `AnyTransition.rise`, `.springAnimation(value:)` |
| `Haptics` | `HapticMoment` (the design table) and `.haptic(_:trigger:)` / `.haptic(_:trigger:when:)` |
| `GlassControls` | `.primaryActionStyle()` (`.glassProminent`), `.secondaryActionStyle()` (`.glass`), `.glassCard()`, `WideLabel`, `GlassCapsuleBar` (the composer's capsule and its send/stop accessory in one container) |
| `AgentMark`, `BroskiMark` | agent monograms; the app's mark |
| `Indicators` | `StateIndicator`, `LiveIndicator`, `RelativeTime`, `Date(unixMilliseconds:)` |
| `StatusChip`, `Banner` | status capsules with tone and symbol; inline notices with one action; `.dimmed(_:)` |

## Where Phase 4.2 plugs in

- **Opening a session**: add `case session(machineId: String, session: SessionRef)` (and the
  workspace's cases) to `Route` in `Sources/App/Route.swift` and its view to `RouteDestination`;
  then make the row in `InboxScreen`'s `ForEach` a `NavigationLink(value:)` with
  `.matchedTransitionSource` for the zoom transition. Until then an inbox row is not a link: tapping
  it does nothing, and no placeholder screen exists.
- **Seen**: the chat calls `AppModel.markSeen(machineId:session:)` when it opens and when it leaves.
- **New session**: the Inbox toolbar's `.glassProminent` button and the empty state's action go in
  `InboxScreen.toolbar` and `InboxEmptyState`.
- **Workspace tab**: add a case to `AppTab` and a `Tab` in `AppTabs` (`Sources/App/AppTabs.swift`).
- **Notifications**: after `NotificationAccess.ask()` grants, register with APNs and call
  `machine.registerPush` for every `AppModel.machines`; read `Preference.notify*` before showing one.
- **Extensions**: the notification service extension compiles `Shared/` and reads a record with
  `MachineRecordStore().record(id:)` (rewrite `carryover/Shared/PushKeychainItem.swift`'s lookup to
  it). Targets go in `project.yml` beside `BroskiTests`, as its header comment says.

## Not verified here

- On a device: the camera scanner, the Local Network prompt and its denial (the simulator has no
  local network privacy), the paste prompt, and APNs.
- `tabBarMinimizeBehavior` and the working accessory: the iPhone 17 Pro and 18 Pro device types
  refuse the iOS 27.1 runtime, and the one that takes it (iPhone Duo) lays the tab bar out as a
  side bar; and the fake backend runs nothing without a prompt, so no session was working.
