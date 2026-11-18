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
scripts/build-android-terminal.sh        # :terminal's libghostty-vt and JNI shim; rerun after a change under terminal/src/main/c
cd apps/android
./gradlew :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest :core:testDebugUnitTest :terminal:testDebugUnitTest
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
| Terminal | libghostty-vt 1.0.1 built with Zig 0.17.1 by `scripts/build-android-terminal.sh` ([`docs/architecture/android-terminal.md`](../../docs/architecture/android-terminal.md)) |
| Push | `firebase-messaging` 26.0.2 (the version Firebase BoM 35.2.0 names), without the google-services plugin |
| Background work | WorkManager `work-runtime-ktx` 2.12.0, for decisions sent from a notification |
| Tests only | `androidx.test:rules` 1.7.0, `work-testing` 2.12.0, OkHttp `mockwebserver3` 5.5.1 (a relay stand-in on the device) |

Install `platforms;android-37.0` next to the packages [mobile-packaging.md §4](../../docs/architecture/mobile-packaging.md#4-android)
lists. The emulator used here: `emulator` 37.2.13 and `system-images;android-36;google_apis_playstore_ps16k;arm64-v8a`
(Play services, for the Code Scanner), AVD `broski-api36` on the `pixel_8` profile.

A release build is minified and resource-shrunk by R8 with `:core`'s and `:terminal`'s consumer rules (JNA,
the UniFFI bindings and the JNI shim's entry points kept); it carries `libbroski_core.so` and
`libbroski_terminal.so` for arm64-v8a and x86_64 only, the ABIs both scripts build. It is unsigned: sign it
with your own key to install it.

### Push (Firebase)

The build carries no Firebase project, and needs none: without one it builds and runs, and push is off
(`FirebasePush` logs "no Firebase project in this build"). To turn push on, the owner adds:

1. A Firebase project with an Android app for `com.muzammil.broski` (the release signing key's SHA-1 is not
   needed for FCM).
2. Its values as Gradle properties, in `~/.gradle/gradle.properties` (never committed):
   `broski.firebase.appId` (`1:…:android:…`), `broski.firebase.apiKey`, `broski.firebase.projectId` and
   `broski.firebase.senderId` (the project number). They become `BuildConfig.FIREBASE_*`, and
   `FirebaseApp.initializeApp` is called with them; no `google-services.json` and no google-services plugin.
3. The relay's FCM service account (`--fcm-service-account`, `packages/link/relay`), so the relay can send to
   the tokens the phone registers.

A device needs Google Play services for FCM (the `_playstore` emulator images have it).

## Tests

- **JVM** (`app/src/test`): the vault over a real DataStore file and real AES-GCM with a software key
  (round trip across a restart, nothing in the clear, a value that does not open is an error and never a
  first run, a value moved under another name does not open); which identity the phone opens with
  (made on a first run only, never over stored pairings; Start Over clears the vault); a handle on a
  forgotten machine stays usable and a cold start with the machine unreachable shows the cached inbox
  (`inbox-cache.json`) with nothing to answer (`PhoneSessionTest`); the pairing flow over the host build of the
  real core with the facade's fixture offer (preview, expiry, wrong code, empty clipboard, an unreachable
  machine that stores nothing and can be tried again, a sentence for every `LinkFailure`); inbox sections
  from real `InboxRow` values; Approve and Deny only for the options a row's `pending` carries, and each
  answer's haptic (`RowAnswerTest`); `MachineHealth` from `MachineStatus`; NSD routes; a new session's
projects from every agent's sessions and what it starts with before and after the person picks
(`NewSessionChoiceTest`). The files screens' models
  against a fake bridge answering in the contract's own result shapes (`FakeBridge`): listing pages by the
  cursor, hidden files, a forbidden folder, search after typing pauses; git status as the screen's lists,
  staging re-reads the status, a commit needs staged changes and a message, a refused checkout keeps git's
  words; file text by line and cut reads, diff rows, every rejection's reason; cell metrics and the grid,
  key events to the encoder's keys. Notifications: the facade's pinned push opened into an approval with
  its decision target, done and question pushes, the relay's offline alert, a decision crossing from the
  receiver to the worker, which run the Live Update follows. The chat, over real contract values and the
  host core's diffs: a batch that starts and ends a run is still seen to end (`LiveSessionTest`);
  the transcript's rows (one fold per stretch of work with its lead, duration, verbs and failures, keys that
  hold while a block streams and closes, a sent message one row from send to `user_message`, the copy
  under the answer, no key twice; `RowBuilderTest`); history pages and the newest page read again
  (`HistoryTest`); follow or detach and what the jump counts (`FollowTest`); the send button's one rule
  (`SendButtonTest`); each kind's reply, words only on an option that takes them and grants only on an allow
  (`RepliesTest`); images fitted to the prompt's 4 MiB (`ImageFitTest`); diff rows from `gitDiffFile` and
  `fileChangeDiff` with their word emphasis (`DiffRowsTest`); the rate limit's notices: when a refused
  request may go again, how much is used, silence when it is no concern (`ChatNoticesTest`). Dictation (`VoiceTest`): the core's request and its headers byte for byte to
  a local server, a refused key asking for Settings, which failures may record again, the key and settings
  round trip.
- **Instrumented** (`app/src/androidTest`): the vault under the real Keystore key; `StartupFailedTest`, the
  confirmation in front of Start Over; `NotificationsTest`, push without Firebase: the pinned push fed to
  `PushHandler` with its record in a Keystore-sealed vault posts an approval with Deny and Allow (Allow
  needing an unlocked phone), a kind turned off and an unknown machine post nothing, a letter reaches a
  `MockWebServer` relay on the device byte for byte as the core sealed it, and `DecisionWorker` sends a
  decision and says Denied, or says plainly that it could not; `DiffSheetTest`, a file change's diff as
  the chat opens it; `RealMachineTest`, against a real machine (below).

`scripts/test-android-real-machine.sh` starts `packages/link/testkit`'s `test-machine` (the real daemon and
the real bridge on its fake backend; needs cargo, Bun and `bun install` in `packages/bridge`), reverses its
LAN port into the device with `adb reverse` so the app dials exactly the `127.0.0.1:<port>` route the offer
names, clears the app's data, and runs `connectedDebugAndroidTest` with the offer and the served directory
as instrumentation arguments, leaving the app installed. It makes the served directory a git repository (a
commit, a second branch, a change and an untracked file) and runs `scripts/lib/test-machine-control.py`,
reversed into the device too, through which the tests send `test-machine` its `seed`, `run`, `script` and
`release` commands.

`RealMachineTest`'s steps run in name order, since an offer pairs once: (a) it puts the link on the
clipboard, taps **Paste pairing link**, **Pair with …**, waits for the inbox, starts a Pi session through
the app's own `Machine` and finds its row; (b) the machine seeds "Clean the build folder" and runs it as a
terminal would (`{"run":<session>,"scenario":"permission"}`: it waits on a permission no phone prompted),
the inbox finds "Pi wants to run bash" on the waiting row with no chat open, a long press shows Approve and
Deny, Approve makes the row leave Needs you, and nothing says "Already answered elsewhere."; (c) a seeded
session's Files lists the served folder, opens README.md and searches names; (d) every files screen in dark
and at font scale 2.0; (e) the folder's repository row opens Git, README.md's diff, stages it by swipe and
commits it, and the machine's own status and log confirm; (f) a terminal opened in the folder takes typed
`echo broski $((6*7))`, the emulator's screen (read back through the canvas's semantics) shows `broski 42`,
and the folder lists it to open again; (g) a held run on a seeded session raises the Live Update, and
its Stop aborts the run on the Mac and takes the Live Update away; (h) the chat's `LiveSession` against a
real view through the `work`, `permission`, `ask`, `hold` and `replace` scenarios, compared with
`view.snapshot()` after every update (a copy behind the view must be caught up by the next) and equal once
the stream is quiet; (i–p) a session opened from its row with `work` streamed in, a deny with "Tell Pi what
to do instead", an allow and its work row opened to the command and its output, an ask answered, a
message queued while a run holds and Stop, a rename and a draft kept across leaving, a new session in a
folder browsed to from All projects that becomes its chat, Jump to latest after reading up; (q) the chat in dark and at font scale 2.0; (r) about
a thousand transcript items scrolled to the first message and back with every frame's FrameMetrics
logged (`ScrollFlow`); (s) the header's Files opening the session's folder and `/review` picked from the
commands list. Screenshots of each screen (the inbox's row actions, light, dark, font scale 2.0, the
shade) land in `app/build/outputs/real-machine-shots`.
Without the arguments these tests are skipped.

After the tests the script stops the machine, force-stops the app and starts it cold, and fails unless
`uiautomator dump` shows the cached "Clean the build folder" row in the inbox; the cold start's screenshot
and dump join the others.

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
              platform/ (foreground, network, NSD discovery), voice/ (dictation)
  feature/welcome, feature/pairing, feature/inbox, feature/machines, feature/settings
  design/format  the formatter's views: FormattedText, FormattedMessage, FormatBlockView, FormatCache,
              tables (TableLayout, the viewer), code blocks, the answer menu, tools/ (a call's body,
              logs, arguments); Settings › Reading is LocalReading (formatting.md)
  design/code code coloured by the core's highlight, the line viewer, and the
              diff view (unified, side by side from 840 dp) the chat and the files screens share
  feature/chat   the chat: LiveSession (the view's records applied), SessionFeed (the view's loop and
              the transcript's pages), ChatActions (each request), transcript/ (rows, the
              bubble, the status lane, follow or detach), work/ (folds, rows, the diff sheet),
              interactions/ (the pinned cards and their replies), composer/ (field, chips, commands,
              images, the send rule), header/ (title, subtitle, Files, overflow and its dialogs)
  feature/newsession   New session, laid out as the chat it becomes: the projects (every agent's
              session folders) and All projects (search, a browser of the whole Mac from home),
              the agent and folder pills, the composer; settled() fills what is not picked
  feature/workspace   a session's files, reached from its chat: files/ (browser with the folder's
              repository and terminals, viewer, FileText), git/ (status,
              staging, commit, branches, log, diff), terminal/ (the byte pump, the renderer, IME,
              key row), WorkspaceClient (the §20 requests), WorkspaceFailure (their plain sentences)
  feature/notifications   FCM (PushService, FirebasePush, PushRegistration), PushHandler and Notifier,
              Allow/Deny (DecisionReceiver → DecisionWorker → postLetter), the Live Update and its Stop
terminal/     the :terminal module: libghostty-vt's JNI shim (src/main/c) and VtTerminal
```

## The chat

- **One view per chat**, attached in `ChatViewModel`'s scope and detached in its `finally`; every update is
  applied record by record to `LiveSession` (no reduction of the app's own) and the screen renders that.
  The transcript's newest page is read at open and again whenever a run ends (seen per record, so a run
  that starts and ends in one batch counts); the ended run's items stay on screen until that page holds
  them. Older pages load as the person nears the top.
- **Rows** (`RowBuilder`, on `Dispatchers.Default`): one per formatted block of the agent's words
  (`design/format`, [formatting.md](../../docs/architecture/formatting.md)), keyed by item id and the
  block's key, formatted again only when an item's text changed; a fold per stretch of
  work; notes between turns; newest first in a `LazyColumn` laid out from the bottom whose first item is
  the status lane, so new rows follow the end with no scroll call while a reader further up stays put.
- **Requests**: `prompt` and `abort` go only while the chat's view is attached (the bridge refuses them
  otherwise); New session creates the session, becomes its chat in place and hands it its first prompt
  (`FirstPrompts`), which it sends once its view's first update arrived.
- **Drafts** live in the vault (`draft:<machine>/<backend>/<session>`), sealed like the rest, written a
  moment after typing stops and when the chat goes; forgetting a machine deletes its drafts.
- **Catalog**: models, modes and commands from the machine's cached catalog, read again on
  `PhoneSession.catalogChanges` (the machine loop's `CatalogInvalidated` and `BackendsChanged`) and when
  the machine comes back online.
- **Dictation** (`core/voice/`, `feature/chat/composer/dictation/`,
  [dictation.md](../../docs/architecture/dictation.md)): `AppCore.dictation`, one for the process, reached by
  composers through `LocalDictation`. `DictationRecorder` (`MediaRecorder`, AAC 16 kHz mono) records; on
  stop the session's names (`dictationTerms`, from the chat's newest items and `WorkspaceGlance`) go with
  the file to xAI through `GrokTranscriber`, exactly as the core built the request. The key is sealed in
  the vault (`voice:xai-key`) and checked with xAI in Settings › Voice before it is kept; with none, the
  phone's own recognizer (`RecognizerIntent`) stands in. `RECORD_AUDIO` is asked on the first press.

## Core wiring

- **One `Phone`**, owned by `AppCore` (created in `BroskiApplication.onCreate`), started on `Dispatchers.IO`:
  the identity secret from the vault, or `newIdentitySecret()` stored first on a first run with nothing
  paired (`launchIdentity`); a secret that is stored but does not open, that the core refuses, or that is
  missing while records are stored stops the app with a plain screen and is never replaced. Its **Start
  Over…** (confirmed, `AppCore.startOver`) is the only thing that clears the vault and makes a new identity. Then `inbox().restoreSeen(...)` and `restoreCache(...)` with the stored seen state and cached
  inbox (`Vault.restoreInbox`), then `phone.start(...)` for each stored record, so the first rows are the
  cached ones. The splash screen stays until this and the settings are read.
- **Vault** (`core/vault`): one Preferences DataStore file, each value sealed with AES-256-GCM under the
  Keystore key `broski.vault.v1`, the value's name as associated data: `identity`, `machine:<id>` (the
  record's `toBytes()`, stored at pairing and at every `RecordChanged`), `seen` (each non-null
  `InboxUpdate.seen`), `cache` (each non-null `InboxUpdate.cache`, at most every 2 s; bytes only the core
  reads), `draft:<machine>/<backend>/<session>` (a chat's unsent text). Backups and device transfer exclude the app's data: the key never leaves the device.
- **Loops**: one per subscription in `AppCore`'s `SupervisorJob` scope for the life of the process: the
  inbox (`rows()` first, then `nextChange()`), and per machine its events (`status()` and `record()` first,
  then `nextEvent()` until it ends), whose reads (each backend's status) are its children. Forgetting a
  machine cancels and joins that loop, then calls `Phone.forget`; the `Machine` handle is never closed by
  the session, since a screen may hold it and the binding's cleaner releases it. Screens observe `StateFlow`s.
- **Answers from the inbox** (`feature/inbox/RowAnswer.kt`, `RowAnswerMenu.kt`): a row reads "<agent> wants to
  run <command>" from its `command`, else its `ask`; a cached row is dimmed like one of an offline machine.
  Approve and Deny exist only for the backend's own `pending.allow` / `pending.deny`: a long press (or a tap
  while no chat opens) shows them in a menu, and TalkBack gets them as custom actions. The tap goes through
  `PhoneSession.answer` (`Inbox.answer`); `Confirm` for an approval sent, `Reject` for a denial, an ask
  answered elsewhere (snackbar "Already answered elsewhere.") or a failure.
- **Lifecycle**: `ProcessLifecycleOwner` start/stop → `phone.resume()`/`pause()` and NSD discovery on/off; a
  process started in the background starts paused. `ConnectivityManager` default-network changes →
  `networkChanged()` (not the first network at registration).
- **LAN discovery**: `NsdManager` browses `_broski-link._tcp`, resolves with `registerServiceInfoCallback`
  on API 34+ and one `resolveService` at a time below, checks TXT `v=1`, and hands `host:port` routes
  (IPv4 first, link-local IPv6 left out) to `machine.lanDiscovered` for TXT `id`. At targetSdk 36 it needs
  no permission beyond `INTERNET`.

## How the screens plug into the shell

- **`app/Features.kt`** is the one place the feature screens plug in: `BroskiFeatures = Features(session =
  ChatScreen, newSession = NewSessionScreen)`. Each slot gets a `FeatureContext` (`phone: PhoneSession`,
  `navigate`, `back`). The shell offers a destination only once its slot is filled: opening an inbox row
  (`SessionRoute`), and the Inbox's large New session FAB and the empty inbox's New session button
  (`NewSessionRoute`). The navigation bar has Inbox and Settings.
- **`SessionRoute(machineId, backend, sessionId)`** (`app/Routes.kt`; `.session` is the `SessionRef`) opens
  the chat. The chat calls `phone.markSeen(route.machineId, route.session)` when it opens and when it is
  left, and `phone.machine(id)` for views (`attach` in the coroutine, `detach()` in `finally`, as
  mobile-packaging.md §1 says).
- **More routes**: add them to the sealed `Route` in `app/Routes.kt` (serializable; restored after process
  death) and register them where `Shell.kt` registers the slots.
- **New session**: once the session is created the screen shows its `ChatScreen` in place, the route kept
  through process death, so Back from the chat returns to the Inbox.
- **Open folder in Files**: `navigate(FilesRoute(machineId, path))`; the files routes are always registered,
  so they open from any tab.
- **Notification taps** come in as `OpenRequests` (`BroskiApplication.openRequests`, offered from
  `MainActivity`'s intent and `onNewIntent`); the shell opens the `SessionRoute` once `Features.session` is
  filled and the machine is paired, and the Inbox until then.
- **Design system**: `design/` (`BroskiTheme.semantic`, `Haptic`, `AgentMark`, `MachineStatusChip`,
  `groupedListItemColors`, `GroupedRow`, `PrimaryButton`/`SecondaryButton`/`QuietButton`, `SectionHeader`,
  `EmptyState`, `Notice`, `MessageScreen`, `CommandBlock`, `BroskiMotion.spring()`, `shimmer`,
  `MonoFamily`/`TextStyle.mono()`, `relativeTime`; `design/code`: `CodeBlock`, `CodeLines`, `DiffView`,
  `highlightedLines`).

## Notifications and the Live Update

- **Push**: the relay's FCM data message carries `m` (machine id), `k` (kind) and `e` (b64url).
  `PushService.onMessageReceived` hands it to `PushHandler`, which needs no `Phone` and no network: the
  machine's record from the vault, `openNotification(record, e)` (or, for `offline`, the relay's own alert),
  the person's switches in Settings (`NotificationKind`), then `Notifier` posts on the kind's channel (Needs
  you, high; Done; Mac offline), tagged by the request or session so a newer push replaces the older, and
  grouped by session under a summary. A notification shows when it reached the phone, not the Mac's `at`:
  the clocks differ, and Android drops a notification dated more than two weeks back.
- **Allow / Deny** on an approval (Allow needs the phone unlocked, `setAuthenticationRequired`) reach
  `DecisionReceiver`, which shows "Allowing…" at once and enqueues expedited `DecisionWorker`:
  `decisionLetter(record, decision, backend, session, request)`, POSTed by `postLetter` exactly as built
  (`HttpURLConnection`, its URL, headers and body), then "Allowed"/"Denied", or a plain sentence when the
  relay could not be reached after three tries. The release build allows no cleartext HTTP (letters go to
  the relay over TLS); the debug build allows `127.0.0.1` only, for the tests' relay stand-in.
- **Registration**: `PushRegistration` sends this install's FCM token to every machine once its link is up,
  to each machine paired later, and again when FCM rotates the token.
- **The ask**: when a pairing succeeds, a dialog with the one-line why, then the system's
  `POST_NOTIFICATIONS` question (Android 13+, only while not granted).
- **Live Update**: while any inbox row is Working, one ongoing notification summarises ("2 agents working
  · 1 needs you"), follows the run active most recently (agent, title, machine, elapsed since the phone saw
  it start) and offers Stop, which sends `abort` for that run through the app's own link. On Android 16 it is
  a promoted `ProgressStyle` (indeterminate) Live Update with a "Working" chip; below, an ordinary ongoing
  notification. It changes at most every two seconds and goes when nothing works. While it shows, the
  phone keeps its links up off screen (`AppCore.holdConnected`) and `LiveUpdateService`, a foreground
  service of type `connectedDevice` whose notification is the Live Update itself, keeps the process from
  being frozen, so it stays true with the phone locked. Limits: Android starts that service only while the
  app is on screen, so a run that begins while the app is closed is not followed until it is opened (FCM's
  pushes cover that time); and if the system ends the process anyway, nothing changes the notification,
  so a new process removes any left over before showing its own.
