# Changelog

All notable changes to Broski are documented here.

## Unreleased

### Antigravity on your phone

- **A third agent**: Broski drives your own `agy` the way it drives `claude` and `pi`, over `agy acp`, with your
  sign-in, plan, models and config. It bundles nothing and changes none of agy's settings. Set
  `"antigravity": {"cliPath": "/path/to/agy"}` in `~/.broski/config.json` when `agy` is not on your login shell's
  `PATH`; `broski doctor` shows the `agy` it found, its version and whether it is signed in.
- **The whole conversation**: streamed answers and thinking, tool rows with their diffs, every model agy offers with
  its own thinking levels, agy's modes (default, accept-edits, auto, plan), its slash commands, `/compact`, and images
  in your prompts.
- **Permissions and questions wait for you**: Allow or Deny each command or edit agy asks about, with the diff, and
  answer its questions with one choice, several, or your own words. Nothing is answered for you, not even an ask the
  app cannot draw: that one waits for you to refuse it.
- **Terminal and phone take turns**: a conversation open in a terminal `agy` is watch-only on the phone until you quit
  it there, then the phone can send again. While the phone has a conversation open, a terminal `agy` that opens it
  warns and offers `/fork`.
- **Limits**: conversations cannot be renamed, deleted or forked from the phone (agy offers none of them), sub-agents
  show as tool rows, a run started in the terminal is not shown live, and restarting the bridge ends a running turn.
- **Inside Google's rules for third-party ACP clients**: you drive every session on your own agy sign-in and plan;
  agy gets only your own prompts, images and commands, with no system prompt, replayed history or text of Broski's own.
  Broski opens a session you did not only to read what you asked for (models, modes, a folder's commands), and never
  prompts one. It no longer reads Antigravity's plan usage, which only Google's internal endpoints serve.
  Broski's phone-writing note is not sent to agy; put it in your own `~/.gemini/GEMINI.md` if you want it.

### Updates that always finish

- **`broski update` runs the new release's own installer.** The update code no longer lives in the installed binary,
  where an old bug could never be fixed: `broski update` checks for a new version, then runs the `install.sh`
  published with it. A fix to the installer now reaches every installed version on its next update.
- **Downloads resume.** A dropped connection resumes at the byte it reached, up to six tries; a download stopped with
  Ctrl-C, a closed lid or a lost network continues on the next `broski update` or one-line install. There is no time
  limit, only a stall limit (under 1 KB/s for a minute), so a slow connection finishes.
- **A third smaller.** Releases add `.tar.xz` copies (the Apple Silicon bridge: 29.5 MB, against 46 MB as `.gz` and
  102 MB raw); the installer uses them when the Mac's `tar` reads xz, else `.gz`, else the raw file.
- **Nothing is replaced until everything is ready.** Every file is checked against `SHA256SUMS` after download and
  again after unpacking, the new `broski` and `broski-link` must start on the Mac, and only then are all files swapped
  in together. A failed update leaves the installed version untouched.
- **The installer restarts Broski.** When the background service runs from `~/.broski/bin`, the installer restarts it
  and waits for the bridge, so the one-line install also updates a running Mac. Pairings are kept.
- **Clearer edge cases**: one install at a time (the lock of a run that crashed is taken over), `sudo` refused,
  Rosetta terminals get the Apple Silicon build, Ctrl-C during `broski update` stops cleanly and resumes next time,
  and `broski update` exits non-zero when it fails.
- **Installer fixes**: a one-line install whose script download is cut short now does nothing instead of running
  half a script, and bash users get Broski on their PATH in `~/.bash_profile`, which Terminal's bash reads.

### Fixes

- **A session is done only when its background work is**: a session whose agent finished its reply but left jobs or
  agents running in the background showed as idle in the inbox and sent its "done" alert at once. It now stays
  working in the inbox, the session list and the Live Activity until that work ends, the "done" alert waits for it,
  and the Mac stays awake for it.
- **`broski restart` and `broski stop` end only Broski**: they used to force-quit every process whose command line
  contained "broski", such as `tail -f ~/.broski/logs/bridge.log`, an editor, or an Xcode build of this repository.
  They now end only the bridge server and the `broski-link run` daemon of the install, and still never a Pi session.

> **On Broski v0.1.1 or older:** those versions update with their own built-in updater, which stops after two minutes.
> On a slow connection, run the one-line install once instead; it keeps your pairing and restarts Broski.

## v0.1.2 — Remote Mac Screen (Experimental) & Security Hardening (2026-11-24)

> **Android: uninstall Broski once before installing this APK.** Releases are now signed with a new key, so Android
> will not install this version over an older APK. Uninstall Broski, install `broski-android-arm64.apk`, then run
> `broski-link pair` on your Mac and scan the code again. Later updates install over this one normally.

### Highlights

- **Remote Mac Screen (Experimental, off by default)**: See and control your Mac's screen from your phone over the
  same end-to-end encrypted Broski link, and answer macOS password and permission prompts when you are away. Turn it
  on in **Settings › Experimental › Remote Mac Screen** on iOS or Android. While it is off, your Mac does not watch
  for system dialogs, sends no dialog alerts, and refuses screen connections.
- **Mac code when pairing**: `broski-link pair` prints a short code under the QR (like `7F3A 91C2 0E5D B846`) and the
  app shows the same code before you tap Pair, so a pairing link that names your Mac but came from somewhere else is
  easy to spot.
- **Security hardening across the link, relay, bridge and installer** (below).

### Security

- **Wi-Fi port answers only your own networks**: the Mac's direct port now refuses peers outside its local networks,
  Tailscale and Personal Hotspot before any handshake; anywhere else the phone uses the relay as before.
- **Lock-screen Live Activity carries no session titles**: Live Activity updates (which iOS cannot encrypt) show the
  agent and its state only, never a prompt or title.
- **Handshake replay and revoke races closed**: a captured handshake can no longer be replayed to knock a phone
  offline, and a phone revoked at the moment it connects is stopped at once.
- **Self-hosted relay**: optional `--register-token-file` so only your Macs can register; a phone revoked while the
  Mac was offline loses relay access at the Mac's next connect; idle rooms are freed; per-address limits on the
  HTTP routes; one offline-alert timer per machine; 256 KiB WebSocket frame cap; the database is created owner-only.
- **Installer and updater**: downloads never follow an HTTPS-to-HTTP redirect, and a compiled `broski` ignores
  update-source overrides from the environment.
- **Bridge**: the unused loopback dev-server proxy (`/proxy`) is removed; loopback routes check the `Host` header;
  the Claude Code hook token is written to an owner-only `settings.json`.
- **Builds**: shipped binaries no longer contain the build machine's file paths.

### Fixes

- Android Remote Screen no longer crashes when a screen session closes; macOS dialog alerts reach Android.
- iOS quiets macOS dialog alerts when Remote Mac Screen is off, even while the app is closed.

## v0.1.1 — Seamless Terminal Handoff, Model Wheel & Switching Fixes (2026-11-24)

### Highlights

- **Continue Any Idle Terminal Session from Your Phone**: Claude Code sessions left open at the prompt in a Mac terminal tab or tmux pane now open immediately controllable on iOS and Android instead of locking you into watch-only mode. When a terminal is actively mid-turn, the phone streams it live, lets you answer prompts, and automatically unlocks the composer the moment that turn finishes (no need to close the terminal on your Mac).
- **Model Wheel & Thinking Slider**: Pinned models now roll on a tactile drum wheel and thinking/effort levels slide across an interactive track with native haptics on both iOS and Android.
- **Reliable Mid-Chat Model & Thinking Switching**: Fixed catalog races and state clobbering that could leave the model/thinking sheet blank or unresponsive right after starting a new Claude Code chat, and added direct **Model** access in the chat `...` menu on both apps.

### Bridge (Claude Code & Pi)

- **Claude Code Idle-Terminal Dormant Control**: `watch-only.ts` and `open-session.ts` now distinguish actively running terminal turns (`busy` / `waiting`, pending hook asks, or untracked recent writes) from idle terminal tabs (`idle` / `shell`). Idle terminal sessions open controllable in dormant mode (spawning no extra `claude` process until you act) and seamlessly switch to live watch if you start typing on your Mac.
- **Instant Post-Turn Auto-Promotion**: `PromotableWatchView` now promotes from watch-only to controllable as soon as an active terminal turn goes idle (clearing the 10 s mtime window immediately) or when an untracked write window expires.
- **New-Session Metadata Before First Flush**: Newly created Claude Code sessions now serve live `getSession` summaries and `listCommands` using the live host's `cwd` before turn 1 writes a `.jsonl` file, eliminating the initial `not_found` race when transitioning from New Session to Chat.
- **Wire Model ID Matching**: `listedModelIdOf` now maps dated (`-YYYYMMDD`) and context-suffixed (`[1m]`) Claude wire model IDs back to their listed catalog row.
- **Pi Dormant Thinking Level**: `rereadSession` now reads the latest `thinking_level_change` entry on the active branch so dormant and reopened Pi sessions show their current thinking level right away.

### iOS & Android Apps

- **Model Wheel & Thinking Slider**: Replaced the flat model list with a drum wheel for pinned/short model lists and a continuous slider for thinking levels, keeping the opened-on model and pinned order stable while the sheet is open.
- **Faster, Failure-Tolerant Catalog Loading**: Android `CatalogReader` and iOS `ComposerCatalog` now load models, modes, and slash commands independently so a slow commands probe never blocks the model picker, and keep existing models across transient reloads. Fixed iOS `ComposerCatalog.model(_:)` falling back to `nil` for unlisted wire IDs.
- **Merged & Serialized Setting Changes**: Rapid model → thinking → mode selections now merge pending state cleanly (clearing stale thinking when switching to a different model) and execute RPCs in strict order without waiting on the 1 s UI settle grace.
- **Model Entry in Chat Menu**: Added **Model** directly to the chat `...` overflow menu on both iOS and Android so you can switch models, thinking, or permission modes without expanding the composer first.
- **Native Haptics & Cleaner Usage Cards**: Added tactile haptics across swipe back, pull to refresh, new-session send, copies, and terminal keys, and removed the pace line and pace labels from usage cards while keeping "Runs out" when it applies.

## v0.1.0 — Initial Open-Source Release (2026-11-24)

Broski is a native iOS and Android remote and inbox for the AI coding agents already running on your Mac. It drives your own installed **Claude Code** and **Pi** with your real config, permissions, models, and extensions — over an end-to-end encrypted link on your local network or a self-hosted blind relay.

### Highlights

- **Native iOS and Android Apps**: Built natively in SwiftUI (iOS 26+) and Jetpack Compose (Android 8+) with full feature parity across both phones, no WebViews, and no accounts to create.
- **Unified Multi-Mac Inbox**: See every session across every paired Mac sorted by what needs you right now (`Needs you`, `Working`, `Done`, `Idle`), with one-tap **Approve** and **Deny** directly on inbox rows.
- **Steer by Default, Queue on Long-Press**: Tap Send while an agent is working to steer the live run at its next step (matching `Enter` in Pi); long-press Send to queue a follow-up for after the turn finishes.
- **Collapsible "Worked for" Turn Summaries**: Long stretches of thinking, file reads, edits, and shell commands fold into one expandable line (`Worked for 4m · Edited 3 files · Ran 12 commands`) right above the final answer.
- **Zero-Friction Agent Setup Inheritance**: Broski runs your installed `claude` and `pi` with your login-shell environment, hooks, MCP servers, extensions, `steeringMode`, and Claude Code `permissions.defaultMode` — never bundling an agent binary or inventing parallel configs.
- **Full Project Workspace on Your Phone**: Browse and search files, read syntax-highlighted code, stage files by swipe, review word-level git diffs, switch branches, commit changes, and open a native `libghostty` terminal inside the session folder.
- **Notifications That Actually Hold When Closed**: Toggle Needs you, Finished, Failed, and per-session mutes on your phone; your Mac enforces them before sending any push. Includes lock-screen Allow/Deny, iOS Live Activity & Dynamic Island, and Android Live Updates.
- **Usage Limits, Home Screen Widgets & Local Cost Analytics**: Track live Claude and Antigravity plan limits on your phone and Home Screen widgets, plus cross-agent token and API-equivalent cost stats across Claude Code, Pi, Codex, OpenCode, Grok, Gemini CLI, and Antigravity.
- **End-to-End Encrypted Over LAN or Self-Hosted Relay**: Pair with a one-time QR code, connect directly over Wi-Fi, IPv6, or Personal Hotspot when nearby, or run your own blind relay (`broski-relay`) that only ever sees ciphertext.

### Inbox & Multi-Mac Control

- **Action-First Grouping**: Sessions are grouped into `Needs you`, `Working`, `Done`, and `Idle` across all paired Macs, newest first within each group.
- **Approve or Deny from the Row**: Standard tool permission prompts show plain-English descriptions (`Claude Code wants to run npm test`) and Allow/Deny buttons right in the inbox without opening the chat.
- **Search, Paging & Pinning**: Search sessions across all backends by title or folder, load older history page by page as you scroll, and pin important sessions so they stay accessible no matter how old they get.
- **Read State That Stays Tidy**: Finished sessions automatically settle from `Done` to `Idle` after 24 hours; swipe or open the menu to **Mark Unread**, **Pin**, **Mute**, or **Mark All Read**.
- **Instant Cold Start**: The last known inbox and read markers restore immediately on launch while your Macs reconnect in the background, without ever wiping active lock-screen alerts during reconnect.
- **Multi-Mac Pairing & Management**: Pair as many Macs as you want via QR code or `broski://pair?...` link, see live LAN/relay route status and bridge versions, and revoke any device individually with `broski-link revoke`.

### Chat, Streaming & Composer

- **Live Streaming & 60 Hz Smooth Scrolling**: Watch answers, thinking blocks, and tool calls stream in real time with prefix-cached transcript rendering so long thousand-item sessions stay smooth.
- **Interactive Prompts at Thumb Height**: Permission approvals, multi-question pickers, plan reviews (with inline Markdown editing and feedback), and confirmation prompts replace the composer right where your thumb rests, or fold into a pill above it so you can read the transcript first.
- **Resting Pill Composer**: Stays compact while reading and expands cleanly when typing, with `@file` mention autocomplete, slash commands and skills, and multi-image attachments (camera or photo library) with automatic size fitting and zoomable full-screen image viewers.
- **Model, Thinking & Permission Pickers**: Switch models, pin favorite models to the top of the sheet, change thinking/effort levels, and switch Claude Code permission modes mid-session.
- **Prompt Cache Timer**: See the remaining lifetime on your agent's prompt cache (when reported by the provider) and the latest request's cache hit ratio right in the chat header and model picker.
- **Session Actions**: Start new sessions in any browsed folder on any paired Mac, fork a session from any turn, rename, compact context, inspect session info, export/share full conversations, or delete sessions.
- **Long-Prompt Folding**: Very long user prompts collapse neatly under a chevron so they do not push the agent's reply off screen.

### Reading, Typography & Formatting

- **Purpose-Built Mobile Markdown Renderer**: Clean headings, airy nested lists, blockquotes, GitHub-style callouts (Note, Tip, Important, Warning, Caution, Insight), inline and display math, and tappable `path/to/file.ts:42` links that open straight to that line in the file viewer.
- **Syntax Highlighting & Word-Level Diffs**: Powered by `@pierre/highlights`, with copy-code buttons, line counts, expandable long blocks, and side-by-side / inline diffs with word-level emphasis on every file change.
- **Readable Mobile Tables**: Wide Markdown tables render cleanly with both scrollable grid and stacked-row views, plus one-tap copy as plain text, Markdown, CSV, or TSV.
- **Appearance & Reading Controls**: Choose System / Light / Dark theme, **True Black** (`#000000` OLED) or Charcoal dark canvas, Text Size stepper, Spacing (Compact / Balanced / Airy), Font (Sans / Serif / Mono), Inline Code style, Wrap Code Blocks, Underline Links, Collapse Agent Work toggle, and Keep Screen Awake policy — with a live preview right in Appearance settings.

### Workspace: Files, Git & Terminal

- **Project File Browser**: Open the session's folder directly from any chat, browse directories, toggle hidden files, search filenames, and read syntax-highlighted files and images.
- **Full Git Client**: Inspect staged, unstaged, and untracked changes, stage or unstage files with a swipe, inspect diffs hunk by hunk, write commit messages and commit, view commit history, and list or check out branches.
- **Native `libghostty` Terminal**: Open, list, and reattach to real PTY terminals inside the session folder on both iOS and Android, with a mobile key bar (Ctrl, Esc, Tab, arrows) and hardware keyboard support.

### Voice Dictation

- **Code-Aware Transcription**: Hold or tap the mic in the composer to record and transcribe directly through xAI's Grok Voice Transcribe 2.0 (`api.x.ai/v1/stt`) using your own API key, automatically seeded with up to 100 relevant terms from your current conversation, git diff, and project folder.
- **Private & Keyless Fallback**: Without an xAI key (or offline), Broski seamlessly falls back to on-device speech recognition. Includes language selection and a custom personal dictionary in Settings › Voice.

### Notifications, Live Activity & Live Updates

- **Plain-English Alerts**: Notifications say what is actually happening (`Fix the build — needs approval` / `Claude Code wants to run npm test`) with Markdown stripped, relative file paths, and readable MCP tool names.
- **Daemon-Side Preference Sync**: Turning off **Needs you**, **Finished**, or **Failed** — or muting an individual session — syncs straight to every paired Mac so unwanted pushes are dropped before they are ever sent.
- **Lock-Screen Decisions & Auto-Clear**: Allow or Deny straightforward tool approvals from the lock screen without opening the app. Answered approvals clear automatically when the session settles (and silently in the background on Android).
- **Live Activity (iOS) & Live Updates (Android)**: Track active agents, elapsed run time, and pending approvals on your lock screen and Dynamic Island, with a Stop button right on the activity and a Settings toggle that stops active displays immediately.
- **Keep Mac Awake While Working**: `broski-link` automatically holds a macOS idle-sleep assertion while an agent is actively running (respecting battery level) and releases it as soon as work finishes.

### Usage Limits, Stats & Widgets

- **Plan Usage Tracking**: View live session and weekly usage limits for Claude and Antigravity across your paired Macs, with automatic refresh on connect and native Home Screen widgets on both iOS and Android.
- **Cross-Agent Token & Cost Analytics**: Local SQLite-backed stats engine scanning Claude Code, Pi, Codex, OpenCode, Grok Build, Gemini CLI, and Antigravity logs for day / week / month / quarter / year / all-time windows — showing total tokens, cache savings, API-equivalent cost, active coding time, model breakdowns, and trends.

### Agents, Terminal Handoff & Extensibility

- **Claude Code**: Drives your installed `claude` through `@anthropic-ai/claude-agent-sdk`, inheriting your settings, hooks, MCP servers, and `permissions.defaultMode`, forwarding terminal permission prompts via `PermissionRequest` hooks, and attaching Broski's loopback `broski_notify` MCP tool.
- **Pi**: Drives your installed `pi` over `pi --mode rpc` inside a detached holder so active runs and pending questions survive bridge restarts, respecting your `steeringMode`, models, and extensions, and providing `broski_ask` when no user extension already claims phone questions.
- **Watch-Only Terminal Mirroring**: Follow sessions started in your Mac's terminal live on your phone and answer their permission prompts without risking concurrent writes.
- **Open Backend Contract & Plugins**: Add new coding agents as built-in adapters or external plugins (`broski-bridge/plugin`) in `~/.broski/config.json` with zero changes to the mobile apps (`docs/adding-an-agent.md`).

### Connectivity, Security & Privacy

- **Hybrid Post-Quantum Encryption**: Every phone-to-Mac link uses Noise IK with hybrid X25519 + ML-KEM-768 and pins the Mac's key fingerprint from the pairing QR.
- **Smart Route Selection**: Connects directly over LAN (Bonjour/mDNS, IPv4, dual-stack IPv6, and Personal Hotspot) with automatic make-before-break migration when switching between Wi-Fi and cellular, falling back to your self-hosted blind relay when away.
- **No Public Bridge Port**: The bridge listens only on a key-guarded Unix socket and loopback `127.0.0.1` (with TLS and bearer tokens). No VPN, tunnel, or port forwarding required.
- **Zero Accounts, Zero Telemetry**: No login, no cloud sync, no analytics servers. Everything stays between your Mac and your phone.

### Installation, Updates & Platform Support

- **Platforms**: macOS desktop host (Apple Silicon and Intel; Windows and Linux are not supported), iOS 26+, and Android 8.0+ (API 26+).
- **One-Line macOS Installer**: Install verified `broski`, `broski-link`, and universal `libbroski_pty.dylib` binaries straight from GitHub Releases with `SHA256SUMS` verification (`install.sh`, plus `--uninstall`).
- **Non-Intrusive Update Checks**: Checks GitHub Releases on startup and daily via a lightweight `/releases/latest` redirect (no API rate limits, never auto-installs, opt-out via `updates.check: false` or `BROSKI_NO_UPDATE_CHECK=1`). Run `broski update` whenever you want to upgrade both `broski` and `broski-link`.
- **Easy Mobile Builds & TestFlight**: Public iOS TestFlight beta, gitignored `Local.xcconfig` for effortless personal Xcode signing, and signed `arm64-v8a` Android APKs (16 KB page aligned) attached to GitHub Releases.
