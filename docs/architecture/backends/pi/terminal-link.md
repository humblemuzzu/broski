# The terminal link

A phone sees a terminal's Pi session live, and can send it a message and stop it, through a small extension the bridge installs into Pi's agent directory. This file says what runs where, why it is built the way it is, what it cannot do with Pi 1.4.0, and how to turn it off. The code is `packages/bridge/src/backends/pi/terminal/`; the tests are `terminal_link`, `terminal_channel`, `terminal_extension`, `terminal_install` in `src/__tests__/pi/`.

```
terminal `pi` ──(Broski link extension, in the pi process)──► unix socket ──► bridge (TerminalLinkServer) ──► the Pi adapter ──► the core ──► phone
                                                                                    ◄── prompt / abort commands ──
```

## What the phone gets

- A session a terminal runs is **live**: `run_started{trigger: "external"}`, text, thinking, tools, compactions, the model and thinking level, `run_finished`, with a correct snapshot for a phone that attaches mid-run (the open blocks and the tools under way are in the snapshot).
- `externalLive: true` (the conformance rule on runs another client starts runs against a real terminal: `driver.ts` `runExternally`).
- The phone can **send a message** (start when the terminal is idle, steer or queue during a run) and **stop the run**. Both go through the terminal's own process: the terminal's `pi` stays the only writer of its session file. A message from the phone is echoed with its `clientRequestId`, so the phone's own prompt is not shown twice.
- A question the terminal asks (a permission dialog, a select) stays in the terminal; the phone shows a notice that the terminal is waiting. Changing the model, the thinking level, a mode or compacting is done in the terminal (`unsupported`, "Change it in the terminal that runs this session.").
- When the terminal quits, the session goes back to being watch-only and its viewers are told (`session_replaced` naming the same session, so they attach again and get the new capabilities).

## The extension

`extensions/broski-link/{index,link,projection}.ts` in the agent directory (`~/.pi/agent`, or `$PI_CODING_AGENT_DIR`), copied from `terminal/extension/` by `installExtension` at the bridge's start. The files are embedded in the bridge (text imports, `extension-sources.ts`), so a compiled bridge installs them too.

**Discovery.** Pi loads `*.ts`/`*.js` files and `<dir>/index.ts|js` under `<agentDir>/extensions/`; if that folder is itself an extension (an `index.ts`/`index.js` or a `package.json` with `pi.extensions` at its top) Pi loads only that (`src/core/package-manager.ts:599-651`, `addAutoDiscoveredResources` `:2419-2540`). The installer refuses in that case and says so in `status()`.

**Versioned, bridge-owned, idempotent.** `index.ts` opens with `// broski-link-extension v<N>`. The installer writes a file only when its content differs (the entry point last, so Pi never loads a new entry beside old parts), reports `installed | updated | current`, and **never touches** a folder named `broski-link` whose `index.ts` does not carry the marker. A running `pi` loads extensions at its start: a terminal started before the install needs a restart (or `/reload`).

**Uninstall.** Delete `~/.pi/agent/extensions/broski-link/`, or set `"pi": { "terminalLink": false }` in the bridge's config: at the next bridge start nothing listens and the installer removes its files (only the files it wrote; a folder holding anything else stays). `uninstallExtension` is the same code.

**The terminal is never harmed.**

| Rule | How |
|---|---|
| No blocking | Event handlers copy a few fields and return; a socket write happens on a `setImmediate`; there is no `await` on any Pi path. |
| Bounded memory | One queue of at most 2 MiB (a line over 1 MiB is dropped). Past the bound the queue is dropped whole and the next flush sends a `snapshot reason: "resync"` instead: the bridge reconciles to the terminal's state and the viewers are caught up. The socket's own buffer is respected (`write()` returning false pauses flushing until `drain`). Tested against a peer that stops reading. |
| Silent with no bridge | No socket, no key file, a refused connection: nothing is printed, nothing throws; retries at 1, 2, 5, 15, then 30 s. Timers and the socket are `unref`'d, so `pi` can exit. |
| No output | The only text it ever shows is one `ctx.ui.notify` warning (below). |
| Contained | Every handler is wrapped: a throw never reaches Pi. |
| Only the interactive terminal | It does nothing unless `ctx.mode === "tui"` and the session has a file. `rpc`, `json` and `print` runs are ignored. |
| Inert in the bridge's own sessions | The bridge's hosted `AgentSessionRuntime` loads extensions with an `extensionsOverride` that drops this one (`live/runtime-factory.ts`, `isBroskiLink`). Tested by listing the loaded extension paths. |

**Frames are bounded and strict.** One JSON object per line, 8 MiB at most (`MAX_LINE_BYTES`); every frame goes through a strict `zod` schema (`protocol.ts`: unknown keys, wrong types, oversized strings and lists are refused) before anything reads it, and a refused frame closes the connection. `hello` first (version, key, pid, session file, id, cwd), a `snapshot` before any `event`, a `result` only for a command that was sent. Pending commands are capped. Tool-result images cross as placeholders (no bytes).

### Why a unix socket and a key file

The extension runs in a process the bridge does not start, as the same user, with no daemon in between. Candidates: (1) the bridge's loopback TCP listener, which needs a bearer token and TLS and is shared with the permission hook and `/proxy`; (2) the daemon's `bridge.sock`, which is for the daemon and would put terminal processes on the phone protocol; (3) its own socket. (3) was chosen: `~/.broski/pi-link/bridge.sock` (override: `$BROSKI_PI_LINK_DIR`, read by both sides), the directory `0700`, the socket and `bridge.key` `0600`; the key is 32 random bytes, hex, **rewritten at every bridge start**, compared in constant time on the `hello`. Another user cannot connect; another process of the same user can, by reading the key, which is what that process could do to `~/.pi` anyway. A stale socket file is replaced after a connection probe fails; a live one is never taken (`already listens`); at most 64 connections.

## The reverse direction: a terminal opens a session the phone runs

Pi's terminal reads a session file once, when it opens (`SessionManager.open`, `src/core/session-manager.ts:1029-1050`) and appends to it afterwards; it does not watch the file. Two writers on one file diverge. So:

- **The phone's session is idle** when the terminal opens it: the bridge lets its host go (the terminal's file is then the only one that moves) and the session becomes the terminal's, live for the phone; viewers get `session_replaced`.
- **The phone's session is running** (a run, an ask, a compaction): the terminal's extension gets `welcome{running: true}` and shows one warning, "Broski: the app on your phone is running this session. Don't type here until it is done." The terminal's `/resume` shows the file up to that moment and will not show what the phone adds after. The bridge keeps the session hosted; it cannot stop the terminal from typing, which is why the warning exists.
- **A terminal without the extension** (not installed, off, started before the install, a Pi run that is not the TUI) cannot be told apart from no terminal at all. The phone's session is controllable, and a human who opens it in both places has the two-writers problem.

## A session nobody runs here

A session another client made, with no terminal linked, opens watch-only and stays so: the phone can read it, not drive it. Only a session this bridge created, or one a linked terminal runs, is controllable.

## What Pi 1.4.0 cannot do here

- **No queue or retry events for extensions.** The terminal's steering and follow-up queues, and its automatic retries, are invisible: `queue_changed` is never sent for a terminal session; the phone's steer/queue is delivered (`pi.sendUserMessage(…, {deliverAs})`, `agent-session.ts` `sendUserMessage`) but not listed, and `cancelQueued` does not exist.
- **Stop is the terminal's Esc, and the terminal's queue goes to the terminal.** `ctx.abort()` is bound by the interactive mode to `restoreQueuedMessagesToEditor({abort: true})` (`interactive-mode.ts:1978-1981`): queued text lands in the terminal's editor, not the phone's composer, and no `input_returned` is sent for a terminal session. A session the bridge hosts does hand the texts to the phone.
- **Questions stay in the terminal.** There is no extension API to answer another surface's dialog.
- **`ui_prompt_start`/`end`** tell the phone that the terminal waits, not what it asks beyond a title.
- **Tool-result images** are not carried.
- **Compaction mid-run** is reported by `session_before_compact`/`session_compact`/`session_compact_failed`; a `prompt` while it runs is refused `busy`.
