# Pocket Mode — working from the phone while the Mac sleeps

> **Note.** It was written before the rebuild: where it names the Flutter app, Pi Durable or `BroskiRuntimeEvent`, those no longer exist**

> **Status: idea only.** Nothing here is planned, scheduled or promised. This document writes down
> how the idea *could* work if we ever chose to build it, what is known to be possible today, and
> what is still unknown. Dates and sources are from research done on 2026-10-27/28.
>
> The Broski code it cites (`connectors/pi-durable/`, the pi-durable mapper) was deleted on
> 2026-10-30, when Pi moved behind the backend contract; it is in git at `e9d1a10`.

---

## 1. The idea in one minute

Today the phone is a remote control. Every chat, every file and every tool call lives on the Mac,
so the Mac has to be awake and reachable — at home, or through the relay when you are away.

Pocket Mode flips one thing: **the phone can carry its own copy of the work and run the agent
itself.**

```
At the desk            In the bag                     Back at a café / hotel / home
───────────            ──────────                     ─────────────────────────────
Mac awake              Mac asleep, cool               Mac opened
phone = remote         phone = the computer           phone finds the Mac nearby
phone keeps a          agent runs on the phone,       phone hands back its commits
fresh copy of          edits the phone's copy,        and its chat turns; Mac hands
code + chats           calls the model directly       back anything new. Both match.
```

- No relay is needed for any of this. The two only talk when they are close to each other.
- No server we host is needed. The only things the phone talks to on the road are the AI model
  providers (Anthropic, OpenAI, …), exactly like Mario Zechner's phone setup.
- The Mac never has to stay awake in a bag.

---

## 2. Why this looks possible now

| Fact | Evidence |
|---|---|
| A Pi Durable agent can run fully on a phone; only the model calls leave it | Mario Zechner, Oct 2026: "everything except the llm runs on my phone" ([post](https://x.com/badlogicgames/status/2107236034199126242)); native Android app on Pi Durable ([post](https://x.com/badlogicgames/status/2106855108680024232)) |
| Pi Durable runs inside a phone WebView, on Android **and iPad** | pi-mobile: pi-durable + IndexedDB in a Capacitor WebView; tested on a real iPad Air 5, iPadOS 26.7 ([architecture](https://github.com/geminixiang/pi-mobile/blob/main/docs/architecture.md), [platforms](https://github.com/geminixiang/pi-mobile/blob/main/docs/design/platforms.md)) |
| JavaScript in a WebView gets full JIT speed on iOS | WKWebView runs out of process with JIT; only JavaScriptCore embedded in an app is interpreter-only ([HN](https://news.ycombinator.com/item?id=40726948), [SO](https://stackoverflow.com/questions/22281265)) |
| An iOS agent run can keep going after you leave the app | iOS 26 `BGContinuedProcessingTask`; pi-mobile measured 7/8 runs finishing in the background, then 6/6 after a storage retry fix; WebView timers, fetch, IndexedDB and Workers kept running |
| A shell and git can run on the phone without a real OS shell | just-bash (bash in TypeScript, 127/152 cases identical to GNU in pi-mobile's tests, 12/12 real model tasks) and just-git (pure TypeScript git, clone/commit/push) ([just-git](https://www.npmjs.com/package/just-git), [pi-mobile just-bash notes](https://github.com/geminixiang/pi-mobile/blob/main/docs/research/just-bash.md)) |
| Apple has approved this kind of app | "Aether", a Pi-based agent with a local Linux sandbox, on the App Store since Sep 2026 ([listing](https://apps.apple.com/na/app/aether-open-source-ai-agent/id6793855391)). The March 2026 crackdown hit apps that build and run *other apps* (Replit, Vibecode) under rule 2.5.2 ([AppleInsider](https://forums.appleinsider.com/discussion/243746)) |
| Two copies of a repo can sync with no server | That is what git is; `git bundle` exists for "two machines with no direct connection" ([git docs](https://git-scm.com/docs/git-bundle)) |
| Broski already has most of the parts | Pi Durable is the 5th backend (`connectors/pi-durable/`, 2,288 lines incl. handlers and mapper, Node deps only `path`/`fs`/`os`/`crypto`); mDNS discovery (`packages/link/daemon/src/discovery.rs`, `_broski-link._tcp`); direct LAN link; sleep/wake signals (`packages/link/power`) |

---

## 3. Words used in this document

| Word | Meaning |
|---|---|
| **Pocket copy** | The phone's own copy of a project: a git repo stored inside the app |
| **Pocket session** | A chat whose agent is currently running on the phone |
| **Owner** | The one device allowed to write to a session right now (Mac or phone) |
| **Baton** | The token that says who the owner is; passing it is how a session moves |
| **Handback** | What happens when the phone and Mac meet again: commits and chat turns go across |
| **Nearby** | The phone can reach the Mac without the internet: same Wi‑Fi, the phone's hotspot, a USB cable, or Apple's direct Wi‑Fi (AWDL) |

---

## 4. The pieces

### 4.1 An agent that runs on the phone

**What:** a hidden WebView inside the Flutter app that runs the same Pi Durable code the bridge
runs today.

```
Flutter app
 ├─ existing chat UI  ◀── BroskiRuntimeEvent (same events as today)
 └─ hidden WebView
     ├─ pi-durable harness
     ├─ Broski's pi-durable mapper  (runtime/pi-durable-runtime-event-mapper.ts)
     ├─ storage: IndexedDB (or a native file plugin)
     ├─ tools: read / write / edit / bash / git   → the pocket copy
     └─ model calls → straight to the provider over HTTPS
```

- The bridge's pi-durable code would be bundled for the WebView. Its Node imports are small:
  `node:path` (→ `path-browserify`), `node:fs` / `fs/promises` (→ the WebView storage),
  `node:os` (→ a constant home), `node:crypto` (→ `crypto.subtle`). pi-mobile does the same
  swaps.
- The mapper already turns pi-durable events into `BroskiRuntimeEvent`. The Flutter side would
  receive them through a local JavaScript channel instead of the link socket. **The chat UI would
  not know the difference.**
- Flutter options for the WebView: `flutter_inappwebview`'s `HeadlessInAppWebView`, or a small
  native plugin that owns a `WKWebView` / Android `WebView`. Not `flutter_js`: on iOS it uses
  JavaScriptCore without JIT, roughly 7× slower on parser-heavy work
  ([benchmark](https://dev.to/alastaircoote/to-jsc-or-not-to-jsc-running-javascript-on-ios-in-2020-44ba)).
- Model streaming: some providers allow browser CORS (Anthropic, xAI per Mario's
  [post](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)); the rest would go through a
  native streaming fetch, like pi-mobile's `StreamFetch` plugin.

### 4.2 Tools on the phone

| Tool | On the phone | Note |
|---|---|---|
| `read`, `write`, `edit`, `ls`, `find`, `grep` | Yes | On the pocket copy |
| `bash` | Yes, as just-bash | bash syntax, coreutils, grep/rg, sed, awk, jq. No python, node, curl |
| `git` | Yes, as just-git | add, commit, diff, log, branch, merge; push/pull to GitHub if the user wants |
| Run tests, `flutter analyze`, `npm install`, Xcode | **No** | Waits for the Mac. The agent is told this plainly |
| Code mode (run JS) | Yes | QuickJS in a Worker, as pi-mobile does |
| Web search / fetch | Yes | Straight from the phone |

Later options for more real tools on the phone:

- **iOS:** Wasmer's Swift SDK runs WASIX python/node/clang in a hidden WKWebView, iOS 27+,
  experimental ([post](https://wasmer.io/posts/wasmer-sdk-swift-ios-macos)).
- **Android:** the Termux userland, the way Mario did it, or the built-in Linux Terminal VM on
  phones that support it (Pixel Tensor, some Exynos/MediaTek; not Snapdragon as of late 2025).

### 4.3 Model access from the phone

- The phone holds the provider keys in the Keychain / Keystore and calls the providers itself.
- **Claude subscriptions:** Anthropic's terms forbid using Claude Free/Pro/Max OAuth in any
  product other than Claude Code and claude.ai
  ([The Register, Feb 2026](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546)).
  A pocket session would need an Anthropic **API key**. Other providers, such as ChatGPT sign-in,
  are used this way by pi-mobile.
- The model list could reuse the same `pi-ai` catalogue the Mac uses.

### 4.4 Code sync — git, both ways

The pocket copy is a git repo. Sync is git moving commits between two copies, over the existing
encrypted Broski link, only when the two are nearby.

**Mac → phone (while at the desk, all the time):**

1. The daemon (or bridge) watches the projects that have recent sessions.
2. For each, it makes a snapshot of the working tree without touching it: `git stash create`
   gives a commit of uncommitted changes and leaves the files alone. It is kept under a private
   ref such as `refs/broski/mac/<branch>`.
3. It sends only the new objects since the phone's last known commit (a thin pack / incremental
   bundle).
4. The phone updates its copy. The copy is always a few seconds old, never a rush job at
   lid-close.

**Phone → Mac (handback):**

1. The phone's work lives on its own branch, for example `broski/phone/<branch>`, started from
   the last Mac snapshot.
2. When nearby again, the phone sends its new commits. The Mac stores them as
   `refs/remotes/phone/*`. **The user's working tree and branches are not touched.**
3. The app shows a "Bring back" screen: files changed, the diff, and the chat turns that made them.
4. One tap applies it:
   - If the Mac's files have not changed since the snapshot → fast-forward, clean.
   - If they have → a normal git merge; conflicts are shown in the app or left for the Mac.

**What is copied:**

| Copied | Not copied (unless the user opts in) |
|---|---|
| Tracked files and their history (or a shallow history) | `node_modules`, build output, anything gitignored |
| Uncommitted changes, via the snapshot | `.env` and other untracked secrets |
| | Projects that are not git repos (could be added later with a hidden repo) |

Size check on this repo: 2,146 tracked files, 53 MB of packed history (`git count-objects -vH`,
2026-10-28). A shallow copy would be much smaller. Whether just-git supports shallow clones is not
checked.

### 4.5 Session sync — who owns the chat

A chat can only be written by one device at a time. Pi Durable already works this way: one
process owns a storage, and the bridge enforces it with a lock file
(`connectors/pi-durable/storage-lock.ts`, sessions under `~/.broski/pi-durable/<id>/`). Pocket
Mode would stretch that lock across two devices as a **baton**.

**Per backend:**

| Backend | Can the phone continue the same chat? | How |
|---|---|---|
| **Pi Durable** | Yes, truly | Same engine on both sides. The baton moves; the session's storage entries since the last sync move with it. The Mac reopens the session where the phone left it |
| **Pi** | Very likely | Pi sessions are JSONL trees. The phone could run them as Pi Durable conversations and write the new turns back as Pi entries. Format mapping to be checked |
| **Claude Code** | Partly | The phone cannot run Claude Code. It continues the *conversation* with the same model, using the transcript as context. On handback, the Mac session gets one carry-over message: "While away, on the phone: …, files changed: …". The Claude Agent SDK's `sessionStore` (resume a session on another host from stored entries) might allow more; not checked ([docs](https://code.claude.com/docs/en/agent-sdk/session-storage)) |
| **Codex** | Partly | Same as Claude Code |
| **OpenCode** | Partly | Same as Claude Code |

**The baton rules (sketch):**

- The Mac owns every session by default.
- **Take with me**: the user taps it, or a setting does it automatically for sessions active in
  the last N hours. The baton moves to the phone while both are nearby.
- **Lid closes mid-run** (Pi Durable only): the daemon gets `WillSleep` with about 30 s of grace
  (`packages/link/power`, `docs/architecture/connectivity-v2/power.md`). It stops the run at a safe
  point, sends the last entries and passes the baton. Pi Durable is crash-durable, so the phone
  can pick the task up where it stopped. For other backends the run just pauses on the Mac.
- **Both sides wrote** (the user opened the Mac somewhere without the phone and kept chatting):
  no merge of chats. The session forks into two (Pi Durable supports forks), and the app shows
  both.

### 4.6 Finding the Mac again — no relay

Ways the phone and Mac could meet, in the order they would be tried:

| Way | Works when | State today |
|---|---|---|
| Same Wi‑Fi, found by mDNS | Home, office, most hotspots | Exists: `_broski-link._tcp` advertised by `discovery.rs`, browsed by `lib/services/link/discovery/` |
| Mac on the phone's Personal Hotspot | Anywhere with signal; the phone is the router | Should work with today's LAN path: people SSH from an iPhone into devices on its own hotspot ([example](https://raspberrypi.stackexchange.com/questions/132480)). Not tested with Broski |
| USB cable (iPhone hotspot over USB) | Anywhere, no Wi‑Fi at all | Idea; not checked |
| **Apple direct Wi‑Fi (AWDL)** | Café / hotel Wi‑Fi that blocks devices from seeing each other | Idea. Network.framework peer-to-peer (`includePeerToPeer`), the radio AirDrop uses. Needs a small Swift part on the Mac (the daemon is Rust) and a Flutter plugin on iOS. iPhone ↔ Mac only |

Why the last row matters: café, hotel and airport Wi‑Fi usually turns on **client isolation**, so
two devices on the same network cannot talk
([explainer](https://multitech.com/iot-wiki/client-isolation/)). Hotspot or AWDL gets around it.

Trust stays exactly as today: the phone and the Mac are already paired (Noise, pinned machine
fingerprint). Sync rides that same link, so there is no new login and no new key.

The relay stays useful for one thing only: reaching a Mac that is **awake at home** while the phone
is far away. In Pocket Mode it is optional.

### 4.7 Keeping the phone agent alive

| | Android | iOS |
|---|---|---|
| Run while the app is in the background | Foreground service; keep the WebView renderer important and "visible" (pi-mobile's notes on Chromium freezing hidden pages) | `BGContinuedProcessingTask` (iOS 26): only for a run the user started in the app; Live Activity shows progress; user can cancel |
| Start new work in the background | Yes (alarms, triggers) | No. iOS can continue work, not start it |
| Known trap | Battery optimisation on some brands | WebKit kills IndexedDB transactions when a page is suspended ([WebKit 202705](https://bugs.webkit.org/show_bug.cgi?id=202705)); storage calls must retry (pi-mobile's fix) |
| Progress reporting | — | Report progress at a steady pace; tasks that report nothing get stopped |

### 4.8 The Mac side

Mostly the daemon (`packages/link/daemon/`) and the bridge, with no new process:

- **Sync service:** keeps snapshots and thin packs ready for each watched project and answers the
  phone's "what's new since X".
- **On `WillSleep`:** last snapshot, baton handoff for Pi Durable runs, then let the Mac sleep.
- **On `DidWake` + phone nearby:** receive the handback, store it under `refs/remotes/phone/*`,
  post a "Bring back" card to the phone.
- **Never** edits the user's working tree or branches without a tap.

---

## 5. A day with Pocket Mode

1. **09:00, desk.** Working in Claude Code and Pi Durable from the phone, Mac awake. In the
   background the phone keeps copies of both projects a few seconds behind.
2. **10:30, leaving.** Lid closes. A Pi Durable run was mid-task: the daemon pauses it, hands the
   baton to the phone, and the Mac sleeps. The phone shows "2 sessions now on this phone".
3. **11:00, train.** The Pi Durable task carries on, on the phone. In the Claude Code chat the user
   asks for a change; the phone continues it with the same model through the API key, edits the
   pocket copy, commits to `broski/phone/main`. No tests run; the agent says so.
4. **13:00, café.** Café Wi‑Fi blocks devices from seeing each other. The user opens the Mac; the
   phone finds it over AWDL (or the Mac joins the phone's hotspot).
5. **13:01.** "Bring back" card: 3 commits, 6 files, 14 chat turns. One tap: the Mac
   fast-forwards because nothing changed there. Pi Durable's baton returns; the Claude Code
   session gets one carry-over message. The user runs the tests on the Mac.

---

## 6. What it cannot do

- **No builds or tests on an iPhone** today: no Flutter, Xcode, npm or python. Edit, search,
  commit — yes; verify — on the Mac. Android can do more.
- **iOS cannot start agent work in the background**, only continue a run the user started.
- **Claude Code, Codex and OpenCode sessions do not move byte-for-byte.** The phone continues the
  conversation; the Mac gets a summary.
- **Claude subscriptions cannot be used on the phone agent.** It needs an API key.
- **The Mac is unreachable while asleep.** It is not woken from a bag; sync happens when it is
  opened.
- **Edits on both sides to the same lines** end in a normal git merge conflict.
- **Big repos and huge histories** need shallow copies and file filters; very large monorepos may
  not fit comfortably.

---

## 7. Ideas looked at and dropped

| Idea | Why not |
|---|---|
| Keep the Mac awake in the bag (`pmset -a disablesleep 1`, "closed-display" apps) | Works, but heat and battery drain in a closed bag are the whole problem ([guide](https://docs.kanaries.net/articles/how-to-make-mac-not-sleep)) |
| Background `URLSession` to make model calls while the iPhone app sleeps | Apple adds a growing delay every time it relaunches an app for background session events, so a chain of model calls gets slower each step ([Apple forums](https://developer.apple.com/forums/thread/657683)) |
| JavaScriptCore / `flutter_js` as the phone runtime | No JIT inside apps on iOS; WKWebView has it |
| nodejs-mobile | One Node instance per app, no restart, no child processes ([docs](https://nodejs-mobile.github.io/docs/guide/guide-ios/getting-started/)) |
| WebContainers (real Node in the browser) | Commercial licence required; Safari support marked beta ([licence](https://webcontainers.io/enterprise), [support](https://raw.githubusercontent.com/stackblitz/docs/25325078c10e64a94dd88f6dc4f0c123b21e23b3/docs/platform/webcontainers/browser-support.md)) |
| Wasmer bash (WASIX) in an Android WebView | Needs `SharedArrayBuffer`; the WebView has no cross-origin isolation (pi-mobile's notes) |
| iroh public relays instead of our relay | Free but rate-limited, no uptime guarantee — and they still need the Mac awake ([iroh](https://iroh-computer.vercel.app/services/hosting)) |
| iCloud (CloudKit) as the go-between | Possible as a slow mailbox with silent pushes, but needs a signed Mac app with an iCloud container and only helps when the Mac is awake |

---

## 8. Unknowns, and the small tests that would answer them

Each is a throwaway experiment, not a feature.

| # | Question | Test |
|---|---|---|
| 1 | Does Broski's pi-durable code run in a hidden WebView inside the **Flutter** app on an iPhone? | Bundle `connectors/pi-durable` + the mapper with shims; one prompt; show the events in the existing chat UI |
| 2 | Does `BGContinuedProcessingTask` keep that WebView alive when the WebView belongs to Flutter, not Capacitor? | Same test, switch apps 4 s after sending, count runs that finish |
| 3 | Is just-bash + just-git good enough on a real repo of this size? | Clone this repo into the phone, ask for a multi-file edit and a commit, time it |
| 4 | Does the current LAN link work with the Mac on the iPhone's hotspot? | Mac joins hotspot; check `broski-link status` and the app's route |
| 5 | Can the Rust daemon use AWDL? | A tiny Swift helper with `NWListener` + `includePeerToPeer`, iPhone browsing with the same; try it on isolated café Wi‑Fi |
| 6 | Is Pi Durable storage an append log that can be shipped as "entries since X"? | Read the storage format in `@earendil-works/pi-durable`; write two entries on one side, replay on the other |
| 7 | Can Pi (non-durable) sessions round-trip through the phone? | Convert one JSONL session, add turns, write back, open it in `pi` |
| 8 | Would App Review accept it? | Compare with Aether's listing and rule 2.5.2; the agent edits user files and runs no generated apps |

---

## 9. Rough shape of the work, if it were ever built

Listed as pieces, not as a schedule.

1. **Phone runtime:** hidden WebView host, bundled pi-durable + mapper, storage with suspension
   retries, JS ↔ Dart event channel. Flutter UI unchanged.
2. **Phone tools:** pocket-copy file plugin, just-bash, just-git, clear "cannot run tests here"
   messages.
3. **Phone model access:** keys in Keychain/Keystore, native streaming fetch, model picker reuse.
4. **Code sync:** snapshot refs on the Mac, thin-pack exchange over the link, "Bring back" review
   and apply.
5. **Session baton:** Pi Durable ownership transfer; carry-over messages for Claude Code, Codex,
   OpenCode; fork on conflict.
6. **Nearby discovery:** reuse mDNS; hotspot check; AWDL helper on Mac and iOS.
7. **Background:** Android foreground service; iOS `BGContinuedProcessingTask` with steady
   progress.
8. **Mac hooks:** `WillSleep` handoff, `DidWake` handback, never touching the working tree without
   a tap.

Per the repo rules, every piece would live in new files (`lib/services/pocket/`,
`lib/providers/pocket/`, a `packages/pocket_runtime/` web bundle, `packages/link/daemon/src/sync/`),
not in the frozen files.

---

## 10. Sources

- Mario Zechner on X: [phone app on Pi Durable](https://x.com/badlogicgames/status/2106452296087302173), [everything except the LLM on the phone](https://x.com/badlogicgames/status/2107236034199126242), [native Android app](https://x.com/badlogicgames/status/2106855108680024232), [Termux parts](https://x.com/badlogicgames/status/2111366160205987847), [iOS view](https://x.com/badlogicgames/status/2106440384343875992)
- Earendil: [Pi Durable announcement](https://earendil.com/posts/pi-durable/)
- pi-mobile (geminixiang): [architecture](https://github.com/geminixiang/pi-mobile/blob/main/docs/architecture.md), [platforms + iPad measurements](https://github.com/geminixiang/pi-mobile/blob/main/docs/design/platforms.md), [just-bash tests](https://github.com/geminixiang/pi-mobile/blob/main/docs/research/just-bash.md), [phone runtime](https://github.com/geminixiang/pi-mobile/blob/main/docs/research/phone-runtime.md), [connecting computers](https://github.com/geminixiang/pi-mobile/blob/main/docs/research/connecting-computers.md)
- [just-git](https://www.npmjs.com/package/just-git), [AgentFS in the browser](https://turso.tech/blog/agentfs_browser)
- Apple: [`BGContinuedProcessingTask`](https://developer.apple.com/documentation/backgroundtasks/bgcontinuedprocessingtask), [background session rate limiter](https://developer.apple.com/forums/thread/657683), [BGContinuedProcessingTask stalls](https://developer.apple.com/forums/thread/805554)
- App Store: [Aether](https://apps.apple.com/na/app/aether-open-source-ai-agent/id6793855391), [vibe-coding update holds](https://forums.appleinsider.com/discussion/243746), [Vibecode status](https://www.vibecodeapp.com/app-store-status), [interpreted code rules](https://jackappdev.medium.com/does-apple-allow-ota-updates-on-ios-guideline-2-5-2-fc1030f07e20)
- Anthropic terms: [The Register, Feb 2026](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546)
- Wasmer: [Swift SDK for iOS](https://wasmer.io/posts/wasmer-sdk-swift-ios-macos)
- Android Linux Terminal: [AnTuTu on chip support](http://antutu.com/doc/135454), [SamMobile on S26](https://www.sammobile.com/news/galaxy-s26-ultra-may-offer-linux-terminal-support/)
- iroh: [hosting](https://iroh-computer.vercel.app/services/hosting), [language bindings](https://www.iroh.computer/blog/iroh-language-support)
- Git: [`git bundle`](https://git-scm.com/docs/git-bundle)
- Client isolation: [MultiTech](https://multitech.com/iot-wiki/client-isolation/), [Security SE](https://security.stackexchange.com/questions/16751)
- Hotspot reachability: [Raspberry Pi SE](https://raspberrypi.stackexchange.com/questions/132480)
- Broski code referenced: `packages/bridge/src/connectors/pi-durable/`, `packages/bridge/src/runtime/pi-durable-runtime-event-mapper.ts`, `packages/link/daemon/src/discovery.rs`, `packages/link/power/`, `docs/architecture/connectivity-v2/power.md`, `lib/services/link/discovery/`
