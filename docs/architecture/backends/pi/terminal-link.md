# The terminal link

A phone sees a terminal's Pi session live, and can send it a message and stop it, through a small extension the bridge installs into Pi's agent directory. This file says what runs where, why it is built the way it is, what it cannot do, and how to turn it off. The code is `packages/bridge/src/backends/pi/terminal/`; the tests are `terminal_link`, `terminal_channel`, `terminal_reconnect`, `terminal_extension`, `terminal_install` in `src/__tests__/pi/`.

```
terminal `pi` ──(Broski link extension, in the pi process)──► unix socket ──► bridge (TerminalLinkServer) ──► the Pi adapter ──► the core ──► phone
                                                                                    ◄── prompt / abort commands ──
```

## What the phone gets

- A session a terminal runs is **live**: `run_started{trigger: "external"}`, text, thinking, tools, compactions, the model and thinking level, `run_finished`, with a correct snapshot for a phone that attaches mid-run (the open blocks and the tools under way are in the snapshot).
- `externalLive: true` (the conformance rule on runs another client starts runs against a real terminal: `driver.ts` `runExternally`).
- The phone can **send a message** (start when the terminal is idle, steer or queue during a run), **change model and thinking level**, **trigger compaction** (`broski-link` v10+; older already-running terminals fall back cleanly to `unsupported`), and **stop the run**. Everything goes through the terminal's own process: the terminal's `pi` stays the only writer of its session file. A message from the phone is echoed with its `clientRequestId`, so the phone's own prompt is not shown twice.
- A question the terminal asks (`select`, `confirm`, `input`, `broski:questions`) is raised on the phone as an ask too, and the first answer, the terminal's or the phone's, closes the other (`extension/dialogs.ts`, `terminal/dialogs.ts`); an `editor` and `custom(..., { blocked })` (when not already mirrored) report a notice naming what waits, while non-blocking custom overlays/viewers/menus and the extension's own typing guard stay quiet in the terminal. Only the permissions mode stays terminal-only (`unsupported`, "Change it in the terminal that runs this session.") because the host permission gate does not run in the terminal's `pi`.
- When the terminal quits (or switches away via `/new`, `/resume`, `/fork`), the session returns to controllable dormant-hosted mode (whenever its working directory still exists) and its viewers are told (`resynced` + `session_replaced` naming the same session, so they attach again with full hosted capabilities including `compact` and model/thinking/mode controls, reviving a `pi --mode rpc` host lazily on the next action). Only a session whose working directory is gone falls back to watch-only.
- **A link that drops is not a terminal that quit.** The extension tracks the run whether or not a bridge listens, so the snapshot it reconnects with says what is under way: the run, the text being streamed, the tools running, the open dialogs (`extension/link.ts`; `running` is also checked against `ctx.isIdle()`, so a missed `agent_settled` cannot leave a phantom run). The bridge tells a drop from an exit: a `bye` (quit, `/new`, `/resume`, `/fork`, `/reload`) or a dropped connection whose pid is gone (`kill(pid, 0)`) ends the session at once, its run `aborted` with "The terminal closed while this was running."; a dropped connection whose `pi` still lives leaves the session held, in the registry and to its viewers, for up to 5 s (`linked-terminal.ts`, checked every 250 ms), and the next connection of the same pid, file and session id picks it up from its snapshot: the run goes on with its id, the tools the snapshot lists stay open, the streamed text is caught up in place, and only what ended meanwhile is closed. A command sent while it is held is refused `busy`. The snapshot reconciles the run before the dialogs, so a dialog open at connection blocks the run and the session shows `waiting_for_user`.

## The extension

`extensions/broski-link/{index,link,projection}.ts` in the agent directory (`~/.pi/agent`, or `$PI_CODING_AGENT_DIR`), copied from `terminal/extension/` by `installExtension` at the bridge's start. The files are embedded in the bridge (text imports, `extension-sources.ts`), so a compiled bridge installs them too.

**Discovery.** Pi loads `*.ts`/`*.js` files and `<dir>/index.ts|js` under `<agentDir>/extensions/`; if that folder is itself an extension (an `index.ts`/`index.js` or a `package.json` with `pi.extensions` at its top) Pi loads only that (`dist/core/package-manager.js:382-470`, `addAutoDiscoveredResources` `:2145-2214`). The installer refuses in that case and says so in `status()`.

**Versioned, bridge-owned, idempotent.** `index.ts` opens with `// broski-link-extension v<N>` (v4 adds the `hosted` frame and the typing guard). The installer writes a file only when its content differs (the entry point last, so Pi never loads a new entry beside old parts), reports `installed | updated | current`, and **never touches** a folder named `broski-link` whose `index.ts` does not carry the marker. A running `pi` loads extensions at its start: a terminal started before the install, or before an update, runs the copy it loaded until a restart (or `/reload`). That is why `LINK_VERSION` stays 1 and fields are only added, optional: an older copy still links, with the older copy's behaviour (a v2 copy, for one, forgets a run that starts or ends while no bridge listens).

**Uninstall.** Delete `~/.pi/agent/extensions/broski-link/`, or set `"pi": { "terminalLink": false }` in the bridge's config: at the next bridge start nothing listens and the installer removes its files (only the files it wrote; a folder holding anything else stays). `uninstallExtension` is the same code.

**The terminal is never harmed.**

| Rule | How |
|---|---|
| No blocking | Event handlers copy a few fields and return; a socket write happens on a `setImmediate`; there is no `await` on any Pi path but one: typed input while the phone runs the session waits for the terminal's own user to choose (above). |
| Bounded memory | One queue of at most 2 MiB (a line over 1 MiB is dropped). Past the bound the queue is dropped whole and the next flush sends a `snapshot reason: "resync"` instead: the bridge reconciles to the terminal's state and the viewers are caught up. The socket's own buffer is respected (`write()` returning false pauses flushing until `drain`). Tested against a peer that stops reading. |
| Silent with no bridge | No socket, no key file, a refused connection: nothing is printed, nothing throws; retries at 0.5, 1, 2, 3, then every 5 s (a failed try on a local socket is a file read and a refused connect, so a bridge that comes back after a long outage is found within 5 s). Timers and the socket are `unref`'d, so `pi` can exit. |
| No output | The only text it ever shows is one `ctx.ui.notify` warning (below). |
| Contained | Every handler is wrapped: a throw never reaches Pi. |
| Only the interactive terminal | It does nothing unless `ctx.mode === "tui"` and the session has a file. `rpc`, `json` and `print` runs are ignored. |
| Inert in the bridge's own sessions | The bridge's hosted `pi --mode rpc` loads it from the same agent dir, and by the `ctx.mode` check above links nothing: a terminal's extension runner lists it, a hosted session registers no terminal (`terminal_install.test.ts`). |

**Frames are bounded and strict.** One JSON object per line, 8 MiB at most (`MAX_LINE_BYTES`); every frame goes through a strict `zod` schema (`protocol.ts`: unknown keys, wrong types, oversized strings and lists are refused) before anything reads it, and a refused frame closes the connection. `hello` first (version, key, pid, session file, id, cwd), a `snapshot` before any `event`, a `result` only for a command that was sent. Pending commands are capped. Tool-result images cross as placeholders (no bytes).

### Why a unix socket and a key file

The extension runs in a process the bridge does not start, as the same user, with no daemon in between. Candidates: (1) the bridge's loopback TCP listener, which needs a bearer token and TLS and is shared with the permission hook and `/proxy`; (2) the daemon's `bridge.sock`, which is for the daemon and would put terminal processes on the phone protocol; (3) its own socket. (3) was chosen: `~/.broski/pi-link/bridge.sock` (override: `$BROSKI_PI_LINK_DIR`, read by both sides), the directory `0700`, the socket and `bridge.key` `0600`; the key is 32 random bytes, hex, **rewritten at every bridge start**, compared in constant time on the `hello`. Another user cannot connect; another process of the same user can, by reading the key, which is what that process could do to `~/.pi` anyway. A stale socket file is replaced after a connection probe fails; a live one is never taken (`already listens`); at most 64 connections.

## The reverse direction: a terminal opens a session the phone runs

Pi's terminal reads a session file once, when it opens (`SessionManager.open`, `dist/core/session-manager.js:1338-1360`) and appends to it afterwards; it does not watch the file. Two writers on one file diverge. So:

- **The phone's session is idle** when the terminal opens it: the bridge lets its host go (the terminal's file is then the only one that moves) and the session becomes the terminal's, live for the phone; viewers get `session_replaced`.
- **The phone's session is running** (a run, an ask, a compaction, or the bridge reconnecting to its `pi`): the terminal's extension gets `welcome{running: true}` and shows one warning, "Broski: the app on your phone is running this session. Don't type here until it is done." The terminal's `/resume` shows the file up to that moment and will not show what the phone adds after. The bridge keeps the session hosted, and tells the extension each time that changes (`hosted{running}`; an older extension ignores the frame). What the user types in the terminal meanwhile is held by the extension's `input` handler (only `source: "interactive"`, pi-coding-agent 1.5.2 `docs/extensions.md` "input"): it asks in the terminal alone, not on the phone, "…A message sent here now would split it in two.", and on "Don't send it" puts the text back in the editor (`handled`). Extension commands and `!` shell lines do not pass through `input`, so this is a guard, not a lock.
- **The phone's run ends** while the terminal has the session open: the host is idle, the view gives way to the terminal as above (`SessionView.hostChanged`), and the host's `pi` ends; the terminal is told `hosted{running: false}` and is the only writer from then on.
- **A terminal without the extension** (not installed, off, started before the install, a Pi run that is not the TUI) cannot be told apart from no terminal at all. The phone's session is controllable, and a human who opens it in both places has the two-writers problem.

## A session nobody runs here

Any session whose working directory still exists and that no linked terminal holds opens hosted and controllable, whether it began on the phone (`origin: "broski"`) or in a terminal (`origin: "external"`). `host/extension/` preserves the recorded system prompt and tool declarations so the prompt cache stays warm. Only a session whose working directory is gone opens watch-only.

## What it cannot do (Pi 1.5.2, `dist/` paths under `@earendil-works/pi-coding-agent`)

- **No queue or retry events for extensions.** Pi's extension events (`core/extensions/types.d.ts`) have no `queue_update` or `auto_retry_*`; those are the agent session's own. The terminal's steering and follow-up queues, and its automatic retries, are invisible: `queue_changed` is never sent for a terminal session; the phone's steer/queue is delivered (`pi.sendUserMessage(…, {deliverAs})`, `core/agent-session.js:2012`) but not listed, and `cancelQueued` does not exist.
- **Stop is the terminal's Esc, and the terminal's queue goes to the terminal.** `ctx.abort()` is bound by the interactive mode to `restoreQueuedMessagesToEditor({abort: true})` (`modes/interactive/interactive-mode.js:1586-1591`): queued text lands in the terminal's editor, not the phone's composer, and no `input_returned` is sent for a terminal session. A session the bridge hosts does hand the texts to the phone.
- **Dialogs are answered from either side by wrapping `ctx.ui`**, which every extension shares; `editor` takes no signal, so it is not mirrored and reports an unmirrored `ui_prompt` notice instead; `custom` reports a notice only when called with Pi's `blocked` option and no mirrored dialog is open, so TUI overlays such as background-job viewers and menus never raise false notices on the phone.
- **Tool-result images** are not carried.
- **Compaction mid-run** is reported by `session_before_compact`/`session_compact`/`session_compact_failed`; a `prompt` while it runs is refused `busy`.
