# Broski for iOS

The native iPhone and iPad app: SwiftUI for iOS 26+, Swift 6 language mode, Liquid Glass. The product
and design spec is [`docs/rebuild/design.md`](../../docs/rebuild/design.md); the core it renders is
BroskiCore ([`BroskiCore/`](BroskiCore), [`docs/architecture/mobile-packaging.md`](../../docs/architecture/mobile-packaging.md)).

```
apps/ios/
  Broski/          the app (XcodeGen project.yml; Broski.xcodeproj and build/ are build outputs)
  BroskiCore/      the Swift package of the Rust core, built by scripts/build-ios-core.sh
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
  group, the seen state back into a new phone's inbox, a launch with the machine unreachable that
  shows the cached inbox (`inbox-cache.json`) with nothing to answer, a cache the core refuses that
  does not stop the launch, start over, a launch that never replaces an identity), pairing (`PairingTests`: every `LinkFailure`'s words and next step, a pasted offer's
  preview, a pairing with the fixture machine that cannot be reached), the inbox's sections from
  `InboxRow` values, Approve and Deny offered only for the options a row's `pending` carries, the
  row's "<agent> wants to run <command>", and `MachineSummary`'s words. They read `packages/link/mobile/tests/fixtures`
  from the checkout and use keychain services of their own. The workspace (`WorkspaceTests`, over
  `ScriptedMachine`, a stand-in for `Machine.request` answering with the generated contract types):
  paging that asks for each page once, every rejection's words with the Mac's own beneath (git's
  for a refused checkout), the git lists from a status, stage → commit reading the status again,
  not-a-repository, text / image / binary reads, `folderToOpen`'s navigation. The terminal
  (`TerminalTests`, over a scripted `TerminalChannel`): output in order with a reset starting the
  screen over, cancelling the pump detaching the view, keystrokes one request at a time joined while
  one is out and sizes replaced, a refused keystroke worded. Push (`PushTests`): the pinned push
  vector opened as the extension opens it (title, body, the Mac as subtitle, thread, `approval`,
  `userInfo`), a kind turned off in the app group arriving quietly, the relay's offline alert, a
  push that does not open keeping the relay's text and no actions, and a decision posted to a real
  HTTP listener on 127.0.0.1 with exactly the core's URL path, headers and body (and a 507 as a
  failure). The Live Activity (`LiveRunTests`): who is focused, the summary, at most four rows, the
  elapsed time across states. `PushFixtureInstall` runs only for the end-to-end script.
- **`UITests/`** (scheme `BroskiE2E`): `scripts/e2e-ios-app.sh` starts `packages/link/testkit`'s
  `test-machine` (the real daemon and the real bridge on its fake backend; needs Bun and
  `bun install` in `packages/bridge`), seeds four sessions, reinstalls the app with a clean keychain,
  puts the pairing link on the simulator's pasteboard, and runs the tests: pair from the pasted link,
  see the history as idle, add a session through the machine (`{"seed":…}` appended to the file the
  machine reads) and see it as done, pull the inbox to refresh (the list stays whole, and the script
  fails unless the app logged that the core answered the refresh), then Machines, Settings, dark appearance and the largest text
  size; then the machine runs the fourth session as a terminal would (`{"run":<session>,
  "scenario":"permission"}`, the session from `BROSKI_E2E_ASK_SESSION`): its row shows "Pi wants to
  run bash" under Needs you with no chat opened, a swipe offers Deny and Approve, and Approve sends
  the row leaving Needs you. `RunEndToEndTests`: a third session scripted to `hold` is started through the app's core
  (`E2EPrompt`), shows as working, the Live Activity shows it in Notification Center, Stop ends the
  run on the machine (the row leaves Working; the script fails unless the app logged the stop).
  `WorkspaceEndToEndTests` (the script makes `project/` in the served root a repository with a
  commit, `notes.md` modified, `todo.txt` untracked and a branch `feature`): the root, the folder,
  the file, the diff, stage by swipe, commit, the log, a checkout; a new terminal where `echo
  broski | tee broski.txt` is typed and the file appears on the machine, then the terminal again
  from the list; dark and the largest text size. Then the script installs the push fixture's record
  (`PushFixtureInstall`) and `NotificationEndToEndTests` receives a `simctl push` of the relay's
  body, long-presses it for Allow and Deny, and denies: the core's letter cannot reach
  relay.example, and the app says so. Screenshots land in `apps/ios/Broski/build/e2e/screenshots`. The test daemon never
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
  Shared/      what the extensions compile too: Keychain, MachineRecordStore, NotificationPreferences,
               PushContent; LiveActivity/ (RunActivityAttributes, StopRunIntent) for the widget
  Extensions/
    NotificationService/  opens each push with the core (Shared without LiveActivity/, BroskiCore)
    Widgets/              the Live Activity: Lock Screen and Dynamic Island (Shared/LiveActivity only)
  Sources/
    App/           BroskiApp, AppDelegate (the APNs token), RootView, AppTabs, Route,
                   IdentityProblemView
    Core/          AppModel, MachineModel, InboxModel, PhoneStorage, MachineSummary, LanDiscovery,
                   PathWatcher, NotificationAccess, PushNotifications, LiveRuns, WorkspaceRequests,
                   WorkspaceProblem, Preferences, Logging, E2EPrompt (Debug only)
    DesignSystem/  Palette, Typography, Metrics, Motion, Haptics, GlassControls, AgentMark,
                   BroskiMark, Indicators, StatusChip, Banner
    Features/      Welcome, Pairing, Inbox, Machines, Settings,
                   Workspace/ (WorkspaceScreen, routes, home; Files/, Git/, Terminal/)
  Tests/  UITests/
```

Every target globs its folders: a new folder under `Sources/Features` needs no project edit. The
terminal emulator is [libghostty-spm](https://github.com/Lakr233/libghostty-spm) `2.2.2026111302`
(product `GhosttyTerminal`, pinned exactly: it wraps Ghostty's embedder API, which has no ABI promise).

## Core wiring

**`AppModel`** (`@Observable`, main actor, one per process) owns the `Phone`.

- **Launch** (`BroskiApp.init` → `start()`): the identity secret from the keychain, or on the very
  first run `newIdentitySecret()` saved before anything else. Never replaced on an error: a keychain
  failure, a refused identity, or pairings without an identity show `IdentityProblemView`, whose
  Start Over (confirmed) is the only path that removes the identity. Then `inbox().restoreSeen` and
  `restoreCache` with the stored seen state and cached inbox, `phone.start(record:)` for each stored
  record (one that does not start is listed under Machines as unreadable, to forget), the inbox loop
  (whose first rows are then the cached ones), the path monitor and LAN discovery.
- **Persistence** (generic passwords, readable after first unlock, this device only):

  | What | Service / account | Access group |
  |---|---|---|
  | identity secret | `com.muzammil.broski` / `identity-secret` | the app's own (first entitlement) |
  | inbox `SeenState` (JSON, backends as wire names) | `com.muzammil.broski` / `inbox-seen` | the app's own |
  | inbox cache (`InboxUpdate.cache`, bytes only the core reads) | `com.muzammil.broski` / `inbox-cache` | the app's own |
  | each `MachineRecord.toBytes()` | `com.muzammil.broski.machine` / machine id | `BroskiKeychainGroup` = `<team>.com.muzammil.broski.push`, shared with the notification extension |

  A record is written right after pairing and at every `MachineEvent.recordChanged`, removed on
  forget; the seen state and the cache whenever `InboxUpdate.seen` or `.cache` is not `nil` (the core
  hands a cache out at most every 2 s).
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
- **Push** (`PushNotifications`, the notification center's delegate from `start()`, before launch
  finishes, so a tap that launched the app arrives): whenever iOS allows notifications
  (`NotificationAccess.refresh()`, at every activation and after the ask) the app calls
  `registerForRemoteNotifications()`; `AppDelegate` hands the token over, and every machine gets
  `registerPush(platform: .apns, token:)`, again for each new pairing and each new token (the link
  session sends it at every connect). Categories: `approval` with **Allow**
  (`.authenticationRequired`) and **Deny** (`.destructive`); `attention`, `done`, `offline` without
  actions. A decision reads the machine's record from the shared keychain group, asks the core for
  `decisionLetter(record:decision:backend:session:request:)` and posts exactly the returned
  `LetterRequest` (URL, headers, body) under a background task; one that does not get through posts
  a local notification "Your answer didn't reach <Mac>". A tap sets `AppModel.sessionToOpen` (the
  tab shell switches to the Inbox). In front, a push for `AppModel.visibleSession` (the chat sets it
  while a session is on screen) does not banner, a quiet one goes to the list only.
- **Notification service extension** (`Extensions/NotificationService`, `Shared/PushContent`): reads
  the record of the relay's `m` with `MachineRecordStore().record(id:)`, opens `e` with
  `openNotification(record:data:)`, sets title, body, the Mac's name as subtitle, thread
  `<machine>/<session>`, category `approval` only for an approval with a `request`, and copies
  `machine`, `backend`, `session`, `request` into `userInfo`; the relay's own `offline` alert (plain
  JSON) reads "<Mac> is offline/asleep". A push that does not open keeps the relay's text and no
  actions. **Preferences** (Settings' Needs you / Done / Failures) live in the app group
  `group.com.muzammil.broski` (`NotificationPreferences`), which the extension reads; no push says a
  run failed (push.md), so Failures governs the offline alert. A kind turned off still arrives, as
  `.passive` without sound: dropping a push needs `com.apple.developer.usernotifications.filtering`,
  which Apple grants on request.
- **Live Activity** (`LiveRuns`, following `inbox.rows` through `Observations` for the life of the
  phone): one activity while any session is live, focused on a session that needs the person, else
  the most recently updated working one, with the others summarised ("3 live agents · 1 needs
  you", up to four rows); the elapsed time counts from when the app first saw the session live.
  When nothing is live it ends as Done and is dismissed after 8 s. Updates are at least 1 s apart
  and only when the state changes. Stop is `StopRunIntent` (`LiveActivityIntent`, run in the app's
  process), which sends `abort` through the core (`AppModel.stopRun`, resuming a paused link for
  it). Updates stop while the app is suspended: the relay sends no ActivityKit pushes yet, so the
  activity keeps its last state (its timer still counts) until the app runs again.
- **Workspace** (`WorkspaceRequests`): every request through `machine.request(message:)` with the
  generated contract types; an accepted value or a `WorkspaceProblem` (a sentence per contract §20.4
  code, the Mac's own words, git's for a refused checkout, as the detail). While a machine is not
  ready, workspace screens show its status, hold their loads (a request would wait out the core's
  deadline) and disable what changes it.
- **Terminal** (`TerminalModel`): `TerminalSurfaceView` over `InMemoryTerminalSession`; output from
  `machine.terminal(id:)` pulled by `TerminalPump` inside `withTaskCancellationHandler` (cancel →
  `detach()`); an `Output` with `reset` drops what Ghostty has not parsed and replays the data behind
  RIS (`ESC c`, which in Ghostty clears screen and scrollback), through `receiveReplay` so queries
  answered when the bytes were live are not answered again. Keystrokes and resizes (cells and cell
  pixels, bounded to 1–500) go through `TerminalOutbox`, one request at a time in order, keystrokes
  joined and sizes replaced while one is out. The view is attached only while the screen shows, the
  app is active and the machine is ready; returning attaches again from what the bridge holds.

## Screens

- **Welcome**: the sentence, the two Mac commands, **Scan Pairing Code** (`.glassProminent`) and
  **Paste Pairing Link** (`.glass`) in one `GlassEffectContainer`.
- **Pairing** (one sheet over the root): VisionKit scanner (QR, guidance, highlighting), or why it
  cannot run (unsupported, camera denied) with paste offered; the clipboard read once on tap
  (`Clipboard.read`: empty, refused or text); offer preview with name, live expiry countdown,
  "Already paired"; progress in a glass card; every `LinkFailure` worded (`PairingProblem`) with its
  next step; success haptic; the notification permission ask with its one-line why.
- **Inbox**: sections Needs you / Working / Done / Idle from the core's order, machine status chips,
  rows (agent mark, title, what the agent wants ("Claude Code wants to run npm test" from the row's
  `command`, else its `ask`), machine · folder or the machine's status, relative time, state mark),
  rows of an unreachable machine or from the cached inbox dimmed; Approve and Deny
  (`InboxRowActions`: trailing swipe without full swipe, context menu, VoiceOver actions) only for a
  row whose `pending` carries the backend's allow or deny, sent with `Inbox.answer` on the tap and
  disabled while it is on its way, `.success` for an approval sent, `.warning` for a denial or an ask
  answered elsewhere ("Already answered elsewhere." above the rows), `.error` for one that failed;
  empty states (connecting, unreachable, no sessions, nothing
  working), the "n agents working" bottom accessory (iOS 26.1+) that filters to working, a failure
  haptic when a machine is lost, a needs-you badge on the tab.
- **Machines**: per Mac its link (LAN / relay / waiting and why / revoked), last seen, bridge and
  agent versions, Restart Bridge when the bridge is down or crashed, Forget with the confirm
  sentence; Pair Another (scan or paste); unreadable pairings; the Local Network hint.
- **Settings**: notification kinds (`NotificationPreferences`, in the app group), appearance (system /
  light / dark), About (app version and build, core version and protocol, each Mac's bridge), the
  privacy line.
- **Workspace** (tab between Inbox and Settings): the Mac chosen from the title menu when several are
  paired (an unreachable one shows its status, dimmed, actions off); its folders (`workspace.info`)
  and terminals. **Files**: `fs.list` a page at a time (the next page loads as the list ends),
  hidden files on request, search by name under the folder (`fs.search`), a repository row when the
  folder is in one; the viewer (`FileTextView`: numbered monospaced lines; images inline; "Binary
  file · size"; how much a truncated read shows), Copy Path, Copy Text, Share. **Git**: branch and
  ahead/behind, Staged / Changes / Untracked with letters and +/− counts, swipe or menu to stage and
  unstage, Stage All / Unstage All, tap for the diff (`DiffTextView`: a file header with counts, hunk
  headers, old and new numbers, signed and tinted lines) or the untracked file, the newest ten
  commits, a commit field with **Commit** (`.glassProminent`) in a glass capsule; Branches with a
  confirmed checkout whose refusal shows git's words. **Terminal**: the list (newest first, swipe to
  close with a confirm), New Terminal in a folder, the emulator with a glass key row (esc, sticky
  ctrl, tab, arrows that repeat while held, `|`, `~`, `/`, the system Paste button); pinch zoom is
  Ghostty's and the size is kept for the next terminal. `AppModel.folderToOpen` switches to this tab
  and opens the folder (`WorkspaceNavigation.open`). `FileTextView` and `DiffTextView` are the one
  place each renders, so the core's highlighter and diff renderer replace their insides alone.

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
- **A tapped notification** sets `AppModel.sessionToOpen` and selects the Inbox tab; the chat opens
  it from there and sets it back to `nil`.
- **The session on screen**: the chat sets `AppModel.visibleSession` while it shows one and clears it
  when it leaves, so its pushes do not banner.
- **Starting a run** for the end-to-end run: `E2EPrompt` (Debug only) sends one prompt at launch; the
  composer replaces it, and the file goes.

## Not verified here

- On a device: the camera scanner, the Local Network prompt and its denial (the simulator has no
  local network privacy), the paste prompt, and APNs: no real push reached the app (it needs the
  relay's APNs key), so the token's registration with a machine is unproven end to end.
- The notification service extension on a delivered push: `simctl push` runs no service
  extension (the simulator's log shows the relay's placeholder delivered with no extension
  launched), so the extension's content is proven by `PushTests` on the shared `PushContent` it
  calls, not by a delivered notification. Allow (authentication required) was not tapped.
- The Live Activity in the Dynamic Island (the iPhone Duo device type has none) and its updates
  while the app is suspended (none come: the relay sends no ActivityKit pushes).
- `tabBarMinimizeBehavior` and the working accessory: the iPhone 17 Pro and 18 Pro device types
  refuse the iOS 27.1 runtime, and the one that takes it (iPhone Duo) lays the tab bar out as a
  side bar; and the fake backend runs nothing without a prompt, so no session was working.
