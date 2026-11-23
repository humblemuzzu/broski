# Broski for iOS

The native iPhone and iPad app: SwiftUI for iOS 26+, Swift 6 language mode, Liquid Glass. The core it renders is
BroskiCore ([`BroskiCore/`](BroskiCore), [`docs/architecture/mobile-packaging.md`](../../docs/architecture/mobile-packaging.md)).

```
apps/ios/
  Broski/          the app (XcodeGen project.yml; Broski.xcodeproj and build/ are build outputs)
  BroskiCore/      the Swift package of the Rust core, built by scripts/build-ios-core.sh
```

## Build, run, test

Xcode 27.2 with its Metal Toolchain (`xcodebuild -downloadComponent MetalToolchain`; BorderBeamKit's
and VoiceGlowKit's shaders need it), XcodeGen 2.46 (`/opt/homebrew/bin/xcodegen`), and what
`scripts/build-ios-core.sh` needs (the Rust iOS targets). From the repository root:

```bash
scripts/build-ios-app.sh                     # BroskiCore if stale, xcodegen, build for any simulator
scripts/build-ios-app.sh device              # any iOS device (automatic signing; see CONTRIBUTING.md#app-identifiers--ios-signing)
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
  group, the seen state and its unread marks back into a new phone's inbox (one stored before
  unread marks existed reading as none), pins and mutes that go with their machine or session, a launch with the machine unreachable that
  shows the cached inbox (`inbox-cache.json`) with nothing to answer, a cache the core refuses that
  does not stop the launch, start over (pins and mutes too), a launch that never replaces an identity), pairing (`PairingTests`: every `LinkFailure`'s words and next step, a pasted offer's
  preview, a pairing with the fixture machine that cannot be reached), the inbox's sections from
  `InboxRow` values (pinned rows once, right after Needs you, never above an urgent one), Approve and Deny offered only for the options a row's `pending` carries, the
  row's "<agent> wants to run <command>", and `MachineSummary`'s words. They read `packages/link/mobile/tests/fixtures`
  from the checkout and use keychain services of their own. The workspace (`WorkspaceTests`, over
  `ScriptedMachine`, a stand-in for `Machine.request` answering with the generated contract types):
  paging that asks for each page once, every rejection's words with the Mac's own beneath (git's
  for a refused checkout), the git lists from a status, stage → commit reading the status again,
  not-a-repository, text / image / binary reads, the terminals a folder lists (links resolved, `/work`
  not under `/w`), paths written from home and climbed to the root. The terminal
  (`TerminalTests`, over a scripted `TerminalChannel`): output in order with a reset starting the
  screen over, cancelling the pump detaching the view, keystrokes one request at a time joined while
  one is out and sizes replaced, a refused keystroke worded. Push (`PushTests`): the pinned push
  vector opened as the extension opens it (title, body, the Mac as subtitle, thread, `approval`,
  `userInfo`), a kind turned off in the app group arriving quietly, a muted session arriving quietly
  and only it, the relay's offline alert, a
  push that does not open keeping the relay's text and no actions, and a decision posted to a real
  HTTP listener on 127.0.0.1 with exactly the core's URL path, headers and body (and a 507 as a
  failure). The Live Activity (`LiveRunTests`): who is focused, the summary, at most four rows, the
  elapsed time across states. The chat: its rules (`ChatRulesTests`: the send button's face from
  running, content and the backend's prompt modes, follow-or-detach, the status lane, a photo fitted
  within what the prompt's 4 MiB has left or refused, returned input and a refused draft, slash
  commands), its rows (`ChatTimelineTests`: one fold per stretch of work with its line, a
  continuation, a result finding its earlier call, one row per formatted block, the live stretch and
  the open block streaming, the seam with the history), every interaction's reply
  (`InteractionAnswerTests`), and its model over `ScriptedSessionView` (UniFFI's mock constructor)
  and scripted answers (`ChatModelTests`: a prompt dimmed until its `user_message`, a queued one, a
  refused one back in the field, an ended run kept until the newest page holds it, a stale answer, a
  detached reader counting new messages, the view detached when the chat goes). Each of these fails
  when the rule it names is broken (checked by breaking each once). `ChatPerformanceTests` times 30
  batches over a 1,000-item run. Session Info (`SessionInfoTests`): the context's fill, only the token counts
  reported, the cost, the cache's countdown and its numbers. Dictation (`VoiceTests`): the core's request byte for byte to a local
  server, a refused key asking for Settings, which failures may record again, the key and settings round
  trip. `PushFixtureInstall` and `SessionMachineTests` run only for the
  end-to-end script: the latter pairs a phone of its own with a second test machine and plays
  `work`, `stream`, `permission`, `ask`, `hold` and `replace`, holding `SessionState` equal to
  `SessionView.snapshot()` (`stream` writes its text a part every 120 ms, so the open block's text
  changes across batches, and keeps its file edit; the other scenarios play within one batch interval).
- **`UITests/`** (scheme `BroskiE2E`): `scripts/e2e-ios-app.sh` starts `packages/link/testkit`'s
  `test-machine` (the real daemon and the real bridge on its fake backend; needs Bun and
  `bun install` in `packages/bridge`), seeds four sessions, makes a fresh simulator like
  `BROSKI_SIMULATOR` (deleted at exit: an uninstall leaves the app's notification answer behind,
  which would skip the pairing test's ask), puts the pairing link on the simulator's pasteboard, and runs the tests: pair from the pasted link,
  see the history as idle, add a session through the machine (`{"seed":…}` appended to the file the
  machine reads) and see it as done, pull the inbox to refresh (the list stays whole, and the script
  fails unless the app logged that the core answered the refresh), then Machines, Settings, dark appearance and the largest text
  size; then the machine runs the fourth session as a terminal would (`{"run":<session>,
  "scenario":"permission"}`, the session from `BROSKI_E2E_ASK_SESSION`): its row shows "Pi wants to
  run bash" under Needs you with no chat opened, a swipe offers Deny and Approve, and Approve sends
  the row leaving Needs you. `RunEndToEndTests`: a third session scripted to `hold` is started from
  its chat's composer, streams, the Live Activity shows it in Notification Center, Stop ends the
  run on the machine and the activity says Done (the app, woken in the background for Stop, keeps
  its link up until the run's end reaches the activity: `LiveRuns.settle`), the chat's lane and the
  row leave Working; the script fails unless the app logged the stop. `SessionEndToEndTests` (the fifth session, each test scripting its next run): a
  `work` run sent from the composer streams, its withdrawn draft gone and its notice and compaction
  kept; jump to latest after scrolling up; a permission denied with "Keep the build folder" and
  another allowed, its fold opened to the command and its output; a choice answered; a message queued
  behind a held run, cancelled, then Stop; dark and the largest text size; rename; a new session
  started in the folder the seeded sessions ran in, All Projects, a folder browsed to and selected,
  then sent and become its chat. `SessionScrollPerformanceTests` (a sixth session the machine runs 40 times as a
  terminal, past 1,000 items): the scroll signpost over flings through it, older pages loading back
  to the first answer, and the app's CPU while a `work` run streams into it (`XCTHitchMetric` runs
  too, but reports nothing on the simulator).
  `WorkspaceEndToEndTests` (the script makes `project/` in the served root a repository with a
  commit, `notes.md` modified, `todo.txt` untracked and a branch `feature`): a seeded session's chat,
  its Files (the root), the folder, the file, the diff, stage by swipe, commit, the log, a checkout;
  a terminal opened in `project/` where `echo broski | tee broski.txt` is typed and the file appears
  on the machine, then the terminal again from the folder's list; dark and the largest text size. Then the script installs the push fixture's record
  (`PushFixtureInstall`), `VoiceEndToEndTests` keeps words and a key in Settings › Voice and dictates
  into the composer, and `NotificationEndToEndTests` receives a `simctl push` of the relay's
  body, long-presses it for Allow and Deny, and denies: the core's letter cannot reach
  relay.example, and the app says so. Screenshots land in `apps/ios/Broski/build/e2e/screenshots`. The test daemon never
  advertises itself, so the script advertises its LAN port the way `discovery.rs` does (`dns-sd -P`,
  TXT `id`, `v=1`) and fails unless the app logged that its browse found the machine.
  iOS 27 simulators cannot show the paste prompt, so the script grants "Paste from Other Apps"
  through the simulator's TCC database (`kTCCServicePasteboard`); `simctl privacy` has no such
  service. The app's log is kept beside the screenshots as `app.log`.

## Layout

```
Broski/
  project.yml
  Resources/   Info.plist, Broski.entitlements, Assets.xcassets (AppIcon, AccentColor)
  Shared/      what the extensions compile too: Keychain, MachineRecordStore, NotificationPreferences,
               PushContent, Slug (the contract's open backend and plan ids); LiveActivity/
               (RunActivityAttributes, StopRunIntent, AgentBrand) for the widget
  Extensions/
    NotificationService/  opens each push with the core (Shared without LiveActivity/, BroskiCore)
    Widgets/              the Live Activity: Lock Screen and Dynamic Island (Shared/LiveActivity only)
  Sources/
    App/           BroskiApp, AppDelegate (the APNs token), RootView (the soft top scroll edge every
                   screen inherits; iOS 27 draws the automatic one as a hard band), AppTabs,
                   Route, IdentityProblemView
    Core/          AppModel, MachineModel, InboxModel, PhoneStorage, MachineSummary, LanDiscovery,
                   PathWatcher, NotificationAccess, PushNotifications, LiveRuns, WorkspaceRequests,
                   WorkspaceProblem, SessionState, ChatRequests, ChatProblem, Preferences, Logging;
                   Voice/ (dictation)
    DesignSystem/  Palette, Typography, Metrics, Motion, Haptics, GlassControls, AgentMark,
                   BroskiMark, Indicators, Orb, StatusChip, Banner, CodeColors, CodeFileView,
                   DiffView, Shimmer, FadingScroll
    Formatting/    the agent text formatter's views (FormattedText, FormatBlockView, tables, code)
    Features/      Welcome, Pairing, Inbox, Machines, Settings,
                   Chat/ (ChatScreen, ChatModel, PinnedPanel, ChatBottomBar; Transcript/, Work/,
                          Interactions/, Composer/, Header/, NewSession/),
                   Workspace/ (a session's files, reached from its chat: routes; Files/, Git/,
                              Terminal/)
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
  | pinned sessions (JSON, machine id, backend, session id) | `com.muzammil.broski` / `inbox-pinned` | the app's own |
  | each `MachineRecord.toBytes()` | `com.muzammil.broski.machine` / machine id | `BroskiKeychainGroup` = `<team>.com.muzammil.broski.push`, shared with the notification extension |

  A record is written right after pairing and at every `MachineEvent.recordChanged`, removed on
  forget; the seen state and the cache whenever `InboxUpdate.seen` or `.cache` is not `nil` (the core
  hands a cache out at most every 2 s). Pins and mutes (`SessionPreferences`) are written on each
  change and dropped when their machine is forgotten or the session deleted.
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
  run failed (push.md), so Failures governs the offline alert. A session muted from its chat or its
  row (`notifications.mutedSessions`) is checked once the push opens. A kind turned off or a muted
  session still arrives, as
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
- **Chat** (`ChatModel`, one per open chat): `machine.attach(session:)` when the chat first
  appears, pulled for the chat's life (a diff or a subagent's session pushed over it keeps it);
  the model's end cancels the pull, whose cancellation handler detaches the view.
  `SessionState` assigns every update as mobile-core.md's table says and reports what is not
  state (notices, errors, rate limits, returned input) and a run's end with the items it had,
  including those the ending batch added. Requests go through `ChatRequests`, each an accepted
  value or a `ChatProblem`; prompt and abort go while the view is attached, as the bridge
  requires. History is `transcript.read` a page of 100 at a time, newest first; a run's end reads
  the newest page again (an earlier read answering late is dropped) and keeps the ended run on
  screen until it lands; with stable ids the page replaces what it overlaps, otherwise the history
  starts over. `ChatTimeline` makes rows from items, one per formatted block of the agent's text
  (`FormatCache` formats a text once per text and streaming state, so while a text streams only it
  is formatted again), and `Highlighter` colours code once per text, off the main actor. A prompt carries a fresh `clientRequestId` and shows dimmed
  until its `user_message` arrives, as the same row (keyed by that request id); a queued prompt shows
  only in the queue above the composer; a refusal puts the draft back in front of anything typed since. Drafts are kept per session in
  `AppModel.drafts` while the app runs; a new session's first prompt goes there too, and its chat
  sends it once the view is attached. Models, commands and modes come from the catalog for the
  session's backend and folder, read again when `MachineModel.catalogChanges` moves. The field takes
  typing while the Mac is out of reach; only sending and the chips wait for it.
- **Dictation** (`Core/Voice`, [dictation.md](../../docs/architecture/dictation.md)): `AppModel.dictation`,
  one for the app, owned by the composer that started it (`DictationTarget`: the chat's draft or New
  session's). `DictationRecorder` records AAC at 16 kHz mono; on stop the session's names
  (`dictationTerms`, from `ChatModel.recentItems()` and `WorkspaceGlance`'s folder listing and git status)
  go with the file to xAI through `GrokTranscriber`, exactly as the core built the request. No key, or no
  connection: `OnDeviceTranscriber` (`DictationTranscriber`, the names as `contextualStrings`). The key
  is in the app's keychain (`xai-api-key`), the rest in `@AppStorage` `voice.*`. Leaving the app ends a
  recording and transcribes it in background time. While recording, the composer wears VoiceGlowKit's
  `VoiceGlow`, fed `Dictation.level` (the recorder's meter every 50 ms) through `levelProvider`, so no
  second microphone opens; sliding to cancel fades it.

## Screens

- **Welcome**: the sentence, the two Mac commands, **Scan Pairing Code** (`.glassProminent`) and
  **Paste Pairing Link** (`.glass`) in one `GlassEffectContainer`.
- **Pairing** (one sheet over the root): VisionKit scanner (QR, guidance, highlighting), or why it
  cannot run (unsupported, camera denied) with paste offered; the clipboard read once on tap
  (`Clipboard.read`: empty, refused or text); offer preview with name, live expiry countdown,
  "Already paired"; progress in a glass card; every `LinkFailure` worded (`PairingProblem`) with its
  next step; success haptic; the notification permission ask with its one-line why.
- **Inbox**: a row opens its chat; **New Session** (`.glassProminent`, and the empty state's
  action) pushes the new-session screen; a tapped notification's `sessionToOpen` opens its chat.
  Sections Needs you / Pinned / Working / Done / Idle from the core's order under quiet headers,
  Idle folded under its header while anything else is listed (open while searching or when it is
  all there is), machine status chips; no drawn title, the filter said at the bar's leading edge
  while on; one filter button in the bar (`InboxFilterMenu`: Working Only, agent, project from the
  recent folders, Mac once two are paired; the agent, Mac and folder kept in `inbox.*` defaults) and
  a search button beside it that turns the bar into the inbox's own field and close button
  (`InboxSearchField`, not `searchable`: the system's minimized search in a top bar draws a close
  button that never dismisses it) matching titles and folders; every row alike (agent mark, one line
  of title, a pin and a muted bell when set, a short age, the state mark in a column of its own),
  one that needs the person saying what the agent wants on a second line ("Claude Code wants to run
  npm test" from the row's `command`, else its `ask`), or the machine's status when it is away,
  rows of an unreachable machine or from the cached inbox dimmed; Approve and Deny
  (`InboxRowActions`: trailing swipe without full swipe, context menu, VoiceOver actions) only for a
  row whose `pending` carries the backend's allow or deny, sent with `Inbox.answer` on the tap and
  disabled while it is on its way; Mark as Read on a Done row, Mark as Unread on an Idle one and Pin
  on the leading swipe, those and Mute in the context menu; `.success` for an approval sent, `.warning` for a denial or an ask
  answered elsewhere ("Already answered elsewhere." above the rows), `.error` for one that failed;
  empty states (connecting, unreachable, no sessions, nothing
  working), the "n agents working" bottom accessory (iOS 26.1+) that filters to working, a failure
  haptic when a machine is lost, a needs-you badge on the tab.
- **Chat**: the header's title (tap to rename) over `agent · folder · machine`, the live mark and
  the run's elapsed time, or the machine's state in words; Files and the overflow, which opens on how
  full the context is: Pin, Rename, Copy Session ID, Mark as Unread (which leaves the chat without
  marking it seen again), Mute; Compact, Fork, Export (Share Conversation, Copy Conversation), Session
  Info (a sheet: the session, its model and settings, context and token use, cost, the prompt
  cache counting down); Delete with a confirm. The
  transcript, full bleed under the bar and the composer (`safeAreaBar`), a `UICollectionView`
  (`TranscriptController`) whose cells host the SwiftUI rows: the person's bubble (past seven lines it
  folds to five, fading under a chevron, a tap anywhere opening or folding it) with its time and copy, the agent's text one formatted block per row through `Sources/Formatting`
  ([formatting.md](../../docs/architecture/formatting.md)), one fold per stretch of work
  (`Worked for 2m · Ran 2 commands · 1 failed`, opening in place to 28 pt rows capped at 256 pt with
  faded edges, each opening to the command, its output and exit, its files and their diffs, a
  subagent's session; a turn that worked in more than one stretch folds all of it, the stretches and the
  agent's notes between them, under one `Worked for 40m · Edited 3 files · Ran 12 commands` line above
  its answer, which opens to the rows as a live run draws them, and Settings › Appearance › Collapse
  Agent Work, on by default, turns that off), notices, compaction and how a run ended as quiet lines, and one status lane
  (`Working`, `Waiting for your approval`, `Agent is working` / `New output will appear here`,
  `Compacting context…`, `Retrying in 8 s`) shimmering only on screen, in an active scene and
  without Reduce Motion. Every layout pass either holds the end (following, no finger down) or holds
  the row being read where it was on screen (`TranscriptCollectionView`), so older pages, rows
  measured late, a run's transcript replacing its live rows (`RowAliases` keeps their ids) and the
  bars changing never move the reader. Only a drag 24 pt toward older messages detaches; coming to
  rest within 48 pt of the end, a send, or Jump to latest follows (`FollowState`). Jump to latest
  floats over the transcript, counts new messages and snaps back with the alignment haptic. Pinned above the
  composer: notices and failures as quiet cards, the queue (cancellable where the backend allows),
  and the first pending ask, foldable to a pill: tool permission (the exact command, files, host or
  paths and the arguments, the backend's options with allow-once prominent, Deny beside "Tell
  <agent> what to do instead" sent as the reply's `message`, a deliberate request confirmed),
  questions (tabs, pick one or any, own words, secret masked), forms (native controls, fields
  shown as their conditions hold), plan approval (the plan, the mode to go on in, Reject with a
  note), Pi's choice, confirm and text; "Already answered elsewhere." for a stale answer; a
  watch-only session's asks shown without buttons. The composer is one glass surface in two shapes
  from one layout (`ComposerLayout`, so the field keeps its keyboard as it moves): at rest a capsule of
  `+`, "Type or hold to talk", the mic, and Stop while a run is live; touched or holding anything, the
  field ("Chat with Broski", one line growing to six) across the top over `+`, the model pill
  ("Opus 5.5 High": the model and its thinking level), any mode off its usual value (Plan, Accept
  edits…), the mic and the send button, an ink circle: Send, Queue (with Steer on a long press), or
  Stop; it appears with the first character, the mic ending the row before. Above the field: the
  slash commands while the text starts with `/`, `@` file matches, attached images with remove. The
  pill opens the model sheet: every model when the agent lists six or fewer, else the session's and
  the pinned ones (up to ten per agent, `ModelPreferences`, kept on the phone); Thinking and each
  mode as rows opening their lists; All Models, searchable by name, id and provider, a folding section
  per provider, a pin on each row. A model is picked with the level last chosen on it, model then
  level, and the pill shows the pick until the session reports it. The keyboard goes down after a
  send and when the transcript is tapped, and the composer rests again.
- **New session** (`Route.newSession`, laid out as the chat it becomes): the agent's mark and "What
  should we build?" where the transcript will be; above the composer, in one glass container, the
  projects (`Project.recent`: the folders this Mac's sessions ran in, whichever agent ran them, newest
  first, five shown, the chosen one lit, two of one name told apart by where they are) with **All
  Projects**, then the agent and folder pills. The list folds into the folder pill when the composer
  takes focus or a folder is picked. All Projects is a sheet: search, every project with its path
  from `~`, and **Choose Folder…**, a browser of the whole Mac from home (`fs.list` folders and
  links a page at a time, `fs.search` for folders under the one shown, the folders above it and home
  in the title menu, **Select**). What the person has not picked follows the Mac
  (`NewSessionModel.settle`): the newest session's folder, the agent last used there while it can
  run; a picked agent stays. The Mac is a title menu when several are paired. Send with no folder
  opens the list; Send creates the session (`session.create` with the chips' model, thinking and
  modes) and the screen becomes its chat in place, the first prompt handed over through
  `DraftStore`.
- **Machines**: per Mac its link (LAN / relay / waiting and why / revoked), last seen, bridge and
  agent versions, Restart Bridge when the bridge is down or crashed, Forget with the confirm
  sentence; Pair Another (scan or paste); unreadable pairings; the Local Network hint.
- **Formatting** (`Sources/Formatting`, [formatting.md](../../docs/architecture/formatting.md)): every
  string an agent wrote through `FormattedText`, `FormattedMessage` or the tool views in `Tools/`; tables
  fitted by `TableLayout` with a viewer, code blocks with wrap, copy and a viewer, the long-press answer
  menu with Select Text; Settings › Reading (`reading.*` in `@AppStorage`) and Settings › Formatting, the
  core's samples in every appearance.
- **Settings**: notification kinds (`NotificationPreferences`, in the app group), Voice (the xAI key,
  checked with xAI before it is kept; the language; send after dictating; project words; the person's
  own words), appearance (system / light / dark), About (app version and build, core version and protocol, each Mac's bridge), the
  privacy line.
- **A session's files** (no tab of their own: the chat's **Files** pushes the session's folder, and
  tool rows, answers' paths and "Open in Files" push a file; an unreachable Mac shows its status over
  them, loads held, actions off). **Files**: a repository row when the folder is in one, the
  terminals opened in it or below (`FolderTerminals`, read again each time the folder shows; swipe
  to close with a confirm), `fs.list` a page at a time (the next page loads as the list ends), hidden
  files on request, search by name under the folder (`fs.search`) in a field that stays at the top (one list through loading, entries and matches, so the field never shows then folds away), Open Terminal Here; the viewer (`FileTextView`: numbered monospaced lines coloured by the language
  the name says; images inline; "Binary file · size"; how much a truncated read shows), Copy Path,
  Copy Text, Share. **Git**: branch and ahead/behind, Staged / Changes / Untracked with letters and
  +/− counts, swipe or menu to stage and unstage, Stage All / Unstage All, tap for the diff
  (`DiffTextView` over the shared `DiffView`: a file header with counts, hunk headers, old and new
  numbers, signed and tinted lines with changed words tinted harder, side by side on a regular
  width) or the untracked file, the newest ten
  commits, a commit field with **Commit** inside one glass capsule, built like the composer (a 36 pt ink
  pill 8 pt in, so field and button share one height); Branches with a
  confirmed checkout whose refusal shows git's words. **Terminal**: the emulator with a glass key row (esc, sticky
  ctrl and tab fixed, then arrows that repeat while held, `|`, `~`, `/`, the system Paste button,
  scrolling under a fading edge when the row is narrow), a clear bar over the terminal's own
  background (`TerminalModel.background`); pinch zoom is
  Ghostty's and the size is kept for the next terminal.

## Design system

| File | What |
|---|---|
| `Palette` | accent (`AccentColor`, blue-violet, AA in light and dark), needs you / working / done / failed / caution, neutral mark colors; `InboxState.title/.tint` |
| `Typography` | `Font.screenTitle`, `.rowTitle`, `.rowDetail`, `.code`, `.codeSmall` (all Dynamic Type) |
| `Metrics` | `Spacing` (4-pt grid), `Radius` |
| `Motion` | `Motion.spring/snappy/crossfade`, `(reduceMotion:)` variants, `AnyTransition.rise`, `.springAnimation(value:)` |
| `Haptics` | `HapticMoment` (the design table) and `.haptic(_:trigger:)` / `.haptic(_:trigger:when:)` |
| `GlassControls` | `.primaryActionStyle()` (`.glassProminent`), `.secondaryActionStyle()` (`.glass`), `.glassCard()`, `WideLabel` |
| `AgentMark`, `BroskiMark` | an agent's mark from its bridge's `BackendDescriptor` (`MachineModel.brand(for:)`): Claude Code's and Pi's logos, any other agent its initials on its `accentHex` (slate without one), drawn by `AgentBrand`/`AgentLogo` in `Shared/LiveActivity`; the app's mark |
| `Indicators` | `StateIndicator`, `RelativeTime`, `Date(unixMilliseconds:)` |
| `Orb` | `Orb` and `LoadingOrb`: ThinkingOrbsKit's thinking orb, the only "under way" mark (agents working, thinking, connecting, loading; no `ProgressView` or animated symbol), sized with its text, still outside an active scene and under Reduce Motion |
| `StatusChip`, `Banner` | status capsules with tone and symbol (the connecting orb in progress); inline notices with one action; `.dimmed(_:)` |
| `CodeColors` | `TokenKind.color` (GitHub's light and dark syntax palettes), `CodeLine.attributed`, `Highlighter` (the core's `highlight` off the main actor, kept by text and language) |
| `CodeFileView` | `CodeFileView` (numbered, wrapping, lazy lines of a file) |
| `DiffView` | a `DiffFile`: unified on a compact width, `sideBySide` rows on a regular one, emphasised segments; `LineCounts` |
| `Shimmer` | `.shimmer(_:)`: the one live signal, a 72 pt band sweeping 1.35 s then resting 1.45 s, only on screen, in an active scene, never under Reduce Motion |

## The chat's seams

- **Opening a session**: `Route.session(machineId:session:)`, shown by `ChatScreen`, zooming out of
  the source whose id is its `SessionTarget` in the stack's `zoomNamespace`; `openSession` (from
  the inbox) pushes another session onto the same stack (a fork).
- **Seen**: the chat calls `AppModel.markSeen(machineId:session:)` when it appears and when it
  disappears, and sets `AppModel.visibleSession` while it is on screen.
- **The tab bar** is hidden in the chat (`toolbarVisibility(.hidden, for: .tabBar)`), and the
  working accessory is left out while a chat is on screen.

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
