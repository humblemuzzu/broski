# The Antigravity adapter

`packages/bridge/src/backends/antigravity/` speaks the backend contract ([contract README](../../contract/README.md))
for Antigravity. It runs the user's own installed `agy` over its ACP server, `agy acp`: ACP v1, JSON-RPC 2.0 as JSONL
over stdio. One live front, `agy acp --process-per-session`, hosts every session the phone has open; short-lived plain
`agy acp` jobs read the session list, each directory's catalog and a session's history. It bundles no `agy` and
imports no package of agy's: `BACKEND_SDKS` in `scripts/contract-gen/layers.ts` has no `antigravity` entry, so
`bun run check:layers` proves it. It is registered in every bridge (`server/contract-backends.ts`).

Every agy fact here was measured on Antigravity CLI **1.5.18** on a signed-in Mac. ACP facts are the protocol's v1
schema (agentclientprotocol.com `schema/v1/schema.json`); `acp/frames.ts` reads its payloads as the schema's own
readers do. `status()` reads `agy --version` and compares it with nothing: a different `agy` runs, and a payload it changed
that no longer reads is reported as a fault (§11).

## Why ACP

| Way in | Verdict |
|---|---|
| `agy acp` | Used. agy's documented integration for clients; adds nothing to install; runs the user's own `agy`, sign-in, plan, models and config. |
| Antigravity's official SDK | Not used: a Python package that bundles its own runtime and signs in with an API key or a cloud account, not the user's plan. |
| `agy -p` with JSON output | Not used: it ran a command without asking, it has no way to answer a permission, and Google does not support wrapping it in another application on a consumer plan (see Google's rules below). |
| Unofficial SDKs | Not used: unofficial, and some call agy's private endpoints. |

The ACP client in `acp/` names nothing of agy's. It sits in the adapter's directory because it has one user; it
moves to `adapter-kit/` when a second ACP agent arrives.

## Google's rules for third-party ACP clients

Google allows a phone UI like Broski: a person directly driving the unmodified `agy acp`. This section lists what
Google has said and the rules Broski keeps to stay within it.

### What Google says

- **Allowed** ([antigravity-cli#1493](https://github.com/google-antigravity/antigravity-cli/issues/1493), a
  collaborator on Google's antigravity-cli repository, 2026-11-12, Free, Plus, Pro and Ultra): "Any interactive ACP
  v1 client, including … custom or non-editor interactive ACP UIs, may launch the unmodified agy acp binary when a
  human user is directly driving the session." and "Using accept-edits, auto mode, or permission rules in your own
  session is supported."
- **Not allowed** (the same): "Having another agent, autonomous loop, or background task queue generate prompts and
  drive agy acp or agy -p programmatically is not permitted on consumer OAuth, nor is overriding Antigravity's system
  identity instructions or automating account rotation."
- **Not allowed**
  ([discuss.ai.google.dev/t/…/202556](https://discuss.ai.google.dev/t/a-question-regarding-the-usage-limitations-of-antigravity-acp/202556),
  an answer on Google's AI developer forum, 2026-11-19): "Wrapping agy acp in an outer harness that injects its own
  system prompt, serialized tool definitions, replayed history, or automated loops violates Section 6". **Allowed**
  there: "a thin interactive client where Antigravity is the agent—sending your direct prompts to agy acp, letting it
  own its history, identity, and tools, and adding custom tools via MCP." For automation it names "Authenticate via
  gemini-api-key (GEMINI_API_KEY)", which is what Broski's automated test suites use (§16); Broski itself runs on the
  user's own agy sign-in and plan.
- **Models** (an answer on Google's AI developer forum, discuss.ai.google.dev/t/…/197131, 2026-11-02): the
  unmodified binary with its native `oauth-personal` sign-in "for single-user interactive development (for the Gemini
  models in your plan) is compliant"; for "ACP clients outside of first-party IDE integrations, model selection
  through antigravity-acp is scoped only to the Gemini models included in your plan." Broski lists the models the
  user's own `agy` offers it over ACP.
- **No background use** (an answer on Google's AI developer forum): "unattended/automatic background requests (like
  event-driven daemons or polling loops) are not supported on consumer plans".
- [Terms §6](https://antigravity.google/terms); the [FAQ](https://antigravity.google/docs/faq): "agy -p … Wrapping agy
  inside third-party coding agents or applications … is not supported under consumer plans".
- Other third-party clients have been asked to stop reading Google's internal quota APIs and to stop polling usage
  with background `agy -p`.

### What Broski does and never does

Broski is a thin interactive client on the user's own agy sign-in and plan: a person on the phone drives each session,
and agy is the agent.

| Rule | Where it holds |
|---|---|
| Only the person's own words reach agy: their prompt text and images, a slash command they chose (`/<name> <text>`), and `/compact` when they press Compact. One `session/prompt` call site in the bridge. | `live/host.ts:236`, `live/turns.ts:206,225,117` |
| No system prompt and no identity change: `session/new` is `{cwd, mcpServers: []}`, with no `_meta` anywhere. The phone-writing note Claude Code and Pi get is not sent (`server/phone-writing.ts`); a person who wants it puts the text of `PHONE_WRITING` in `packages/bridge/src/server/phone-writing.ts` into their own `~/.gemini/GEMINI.md`. | `live/hosts.ts:130`, `catalog/probe.ts:116` |
| No replayed history and no prompt text of the bridge's own: the backend declares `verbatimPrompts`, so the core offers no portable fork (its `<broski_context_handoff>` would open a new session's first prompt with the old conversation). The core's queue and steer send the person's input as it came, only its mode changed. agy owns its history; a reopened session is `session/load`. | `traits.ts:37`, `core/fallbacks.ts:144`, `contract/backend.ts:60` |
| No tool definitions injected: every session opens with `mcpServers: []`, and the client offers agy no file system and no terminal. | `live/hosts.ts:130,186`, `store/transcript.ts:124`, `acp/connection.ts:50` |
| No `agy -p`: agy is only ever started as `agy acp` or `agy acp --process-per-session` (and `agy --version` for the status). | `jobs.ts:66`, `live/front.ts:42` |
| No Google internal API and no reading of agy's sign-in: the bridge calls no `cloudcode-pa` or `v1internal:*` endpoint, reads no OAuth token of agy's and never calls `authenticate`; Antigravity's plan usage is not metered (only Claude's is). | `usage/usage-reader.ts:36` |
| An honest client: `clientInfo {name: "broski", version: <bridge version>}`. | `backend.ts:84`, `acp/connection.ts:55` |
| The user's own sign-in, one user, no account rotation: agy runs with its own sign-in and config; the bridge chooses no account. | `agy-process.ts` |
| No automatic sessions beyond the reads the person asks for (below), no timer that opens one, and never a prompt the person did not send. | `catalog/catalogs.ts:63,69` |

**When Broski opens a session the person did not.** Only to answer a read they asked for, and each is closed at once
with no prompt (agy lists no session that never had a prompt):

- the first models or modes read after the bridge starts, after `agy` is updated (its file stamp changes), after a
  hosted session sees agy offer other models or modes, or once what was read is an hour old: one catalog probe (§4);
- the first commands read for a folder no probe or hosted session has read in the last hour, or whose last probe
  saw agy announce none: one commands probe in that folder (§4);
- `broski-bridge doctor`, which the person runs: one session in the void folder for the sign-in (§3).

Listing and history (`session/list`, `session/load` on a short job) open no new session.

### For maintainers: never add

- a `_meta` on any request, a system prompt, an identity, or any text of the bridge's own in a prompt (a handoff, a
  summary, an instruction, a "continue");
- a core fallback that writes prompt text for a backend with `verbatimPrompts`, or removing that trait;
- tool definitions or an MCP server the person did not configure in agy;
- a prompt, a probe or a session on a timer, a retry loop, or any request the person did not cause;
- `agy -p`, `authenticate`, `logout`, a borrowed `clientInfo` or user agent, or any flag of agy's beyond `acp` and
  `--process-per-session`;
- a call to a Google endpoint (`cloudcode-pa`, `v1internal:*`, OAuth) or a read of agy's tokens, keychain or settings;
- a live test, recording or conformance run on a Google sign-in: those automated suites run only on a Gemini API key
  (§16), while Broski itself runs on the user's own sign-in.

## Run it, and check again after an agy update

```bash
cd packages/bridge
bun test src/__tests__/antigravity     # CI: starts no agy, replays agy's recorded frames; the suites below skip
GEMINI_API_KEY=… BROSKI_TEST_AGY=1 bun test src/__tests__/antigravity/live/live.test.ts
GEMINI_API_KEY=… BROSKI_TEST_AGY=1 BROSKI_TEST_AGY_TERMINAL=1 bun test src/__tests__/antigravity/live/live.test.ts
GEMINI_API_KEY=… BROSKI_TEST_AGY=1 bun test src/__tests__/antigravity/conformance/conformance.test.ts
GEMINI_API_KEY=… BROSKI_AGY_RECORD=1 bun test src/__tests__/antigravity/record/record_frames.test.ts
```

The last four run the real `agy` (`BROSKI_TEST_AGY_CLI` names another, else `PATH`'s), and only on the developer's
own Gemini API key in a profile of their own, never on a Google sign-in: they write and drive agy's prompts by
program, which Google allows only on a Gemini API key (Google's rules, above). Without `GEMINI_API_KEY` each skips,
saying so. They spend the key's quota. Each prompt is taken from one budget per process, `BROSKI_AGY_PROMPT_BUDGET`
(default 40): the live file sends 23 prompts (25 with the terminal clash), the conformance run about 37, the recorder
12. So run one file per `bun test`; a second process is refused while one runs (§16).

After an `agy` update, with the key set:

1. Run the recorder. It writes each scenario's frames, both ways and timed, scrubbed and checked by
   `scripts/check-personal-info.sh --files`, to `src/__tests__/antigravity/fixtures/frames/<scenario>.json`, each
   naming the `agy` it was recorded on. Read the diff of `fixtures/frames/`: it is what agy now does differently. A
   fixture is agy's own frames: never edit one by hand, record it again.
2. Run `bun test src/__tests__/antigravity/replay`, which replays the new frames through the backend as CI does (§15). A
   failure there is a change of agy's the adapter has to follow; fix the adapter, never the fixture.
3. Run the live file (with `BROSKI_TEST_AGY_TERMINAL=1` when tmux is installed) and the conformance run.
4. Update §1 and the version above to what they showed.

What agy asks before a tool is its permission policy's to say (§1), and the tests never read it. The test profile has
no policy of its own, so agy asks before commands and writes there and the permission rules run. On an agy whose
policy approves every command and write, no permission reaches the bridge, so expect:

- the live file to pass, its tool turn logging for each tool `agy's own permission policy approved it, no
  session/request_permission on the wire`, which it checks on the wire;
- the conformance run to fail one rule, "every declared interaction kind is answered, checked and cancelled
  correctly", at `tool_permission`, saying agy's own permission policy approved the command; on an agy that asks
  before a command, that rule runs;
- the recorder to write `permission-allow-unasked`, `permission-deny-unasked` and `tool-edit-diff-unasked` in place of
  the fixtures of the asks.

Conversations the tests make stay in the test profile, which goes with the test's temp folder: none reaches the user's
`agy` history.

## Layout

```
backends/antigravity/
  factory.ts          antigravityBackendFactory(options) → BackendFactory
  backend.ts          the AgentBackend: reads as short jobs, live sessions on the front, hosted rows over listed ones
  traits.ts           ANTIGRAVITY_META ("Antigravity", #1A73E8, iconHint antigravity) and ANTIGRAVITY_TRAITS (§13),
                      with `verbatimPrompts`
  install.ts          AgyInstall (the agy found, its environment, the void and presence folders)
  status.ts           status(): installed, version, and the sign-in the last probe saw; never throws
  agy-process.ts      one `agy acp` started in the void folder, as the front and the short jobs both start it
  jobs.ts             ShortJobs: one plain `agy acp` at a time for reads, kept 20 s after its last job
  acp/                the ACP v1 client; nothing in it is agy's
    connection.ts     one agent process: `initialize`, the client's capabilities, an exit ends every request, stop
    rpc.ts            JSON-RPC 2.0 both ways: ids, deadlines, a route per session, agent requests, `$/cancel_request`
    inbound.ts        one record read as a response, request, notification or fault
    frames.ts         zod readers of the payloads the adapter uses
  catalog/
    catalogs.ts       models and modes per agy binary, commands per folder, each kept an hour; the last sign-in seen
    probe.ts          a session opened and closed to read its config options, each model's levels and the commands
    models.ts         the model option as ModelSummary: each model's thinking levels, context window, the default
    modes.ts          the mode option as one ModeAxis, `mode`
    commands.ts       available commands as CommandSummary
    config-options.ts the select option of a category
  store/
    sessions.ts       one `session/list` on a short job, kept 15 s: list, get, find, locate
    list.ts           rows decoded and realpathed, the void rule, and the bridge's own filter, order and pages
    made.ts           the sessions this bridge made while it runs: their folder, their time, `origin: broski`
    transcript.ts     readTranscript from a short job's `session/load` replay, kept per `updatedAt`, paged by position
    transcript-items.ts  the replay's updates as transcript items
  mapping/
    tools.ts          an agy tool call (its `tool_call` with each update laid over it) as the contract's row and result
  live/
    hosts.ts          AgyHosts: hosted sessions by id on one front; open new and existing, room, watch-only
    front.ts          the live front, `agy acp --process-per-session`
    cap.ts            the bound on hosted sessions and which idle one to close
    host.ts           AgyHost: one hosted session, its worker, its presence lock, its live state
    host-row.ts       a hosted session's list row, announced as `session_updated`
    view.ts           AgyView, a hosted session's OpenSession; loads an ended host again on the next action
    turns.ts          one `session/prompt` in flight: a run, or the phone's compaction
    updates.ts        a run's stream: blocks and tool events
    settings.ts       model, thinking level and mode from config options; a choice as `set_config_option`
    usage.ts          the context fill and the latest turn's cache window
    outcomes.ts       stop reasons and errors as run and compaction outcomes; worker loss
    asks.ts           permissions and questions on the kit's ask desk, ended only by the person or by agy
    permissions.ts    `session/request_permission` ↔ `tool_permission`
    questions.ts      `elicitation/create` ↔ `questions`
    phone-prompts.ts  the phone's prompts: images for readAttachment, `clientRequestId` and images back on the replay
    lock.ts           agy's presence locks: take, test, release, watch
    watch.ts          a session a terminal `agy` holds: watch-only, promoted by the kit's promotable view

src/server/
  antigravity-cli-path.ts  which `agy` the bridge runs, through `cli-path.ts` (shared with Pi)
  contract-backends.ts     the factory's options in production
src/platform/file-lock.ts  the FileLock port: `flock(2)` from libSystem through `bun:ffi`
src/doctor/checks/antigravity.ts  the doctor's check: path, version, sign-in
```

From `adapter-kit/` it uses the JSONL splitter, the stdio child and its stop ladder, the CLI version reader, the ask
desk, phone text, bounded JSON, unified diffs, page cursors, the image cache and reads, the live state, rejections,
the `FileLock` and `ImageFitter` ports, and the promotable view. The phone apps draw Antigravity from its descriptor
like any backend; its mark is iOS `AgentBrand`/`AgentMark` and Android `AgentMark`/`Agent`.

## 1. agy facts the code relies on

**Process** (`jobs.ts`, `live/front.ts`, `live/cap.ts`)

- `agy acp --process-per-session` is a front of about 128 MB and one worker of about 190 MB per session. On a Gemini
  API key the front had one child more than it had sessions, so the live tests know a session's worker as the child
  that joined the front while it opened that session.
- Killing a worker leaves the other sessions working. A request of its session in flight as it exits (a
  `session/prompt` held on a question, say) is answered within milliseconds `-32603` "The Antigravity process serving
  this session exited unexpectedly", and every later one `-32602 Session not found`.
- `session/close` ends that session's worker. A dead front takes every worker with it.
- stdin's end or SIGTERM exits cleanly in about 300 ms, workers included.
- A cold `agy acp` takes about 2.6 s to its first `session/new`; later ones take milliseconds.

**Handshake** (`acp/connection.ts`)

- ACP v1 only.
- `initialize` offers `loadSession`; listing, resuming and closing sessions; additional directories; and images and
  embedded context in prompts. No fork, and no HTTP MCP. The adapter reads `loadSession`, `sessionCapabilities.list`
  and `sessionCapabilities.close`.
- `session/new` would take `_meta.antigravity.systemPrompt.append`; the adapter never sends it (Google's rules).

**Sign-in and plan** (`catalog/catalogs.ts`)

- `agy acp` works signed in from a launchd job in the user's `Aqua` session.
- `session/new` answers `_meta.antigravity.tier`, the plan of the account signed in.
- `session/set_config_option` changes the session alone: choosing a model does not write agy's `settings.json`.

**Turns** (`live/turns.ts`)

- `session/prompt` resolves at the turn's end with `{stopReason, usage}`; `usage` holds that turn's `inputTokens`,
  `outputTokens`, `cachedReadTokens`, `thoughtTokens` and `totalTokens`. `totalTokens` is the other four added up: the input
  leaves out the cached reads, so the prompt is `inputTokens + cachedReadTokens` (two like turns: about 2,100 input
  and 13,900 cached reads each).
- Thinking streams by level: the Gemini Flash model streams no `agent_thought_chunk` at `low` (`thoughtTokens: 0`),
  and one thinking block before its answer at `high`.
- A second `session/prompt` mid-turn makes the first resolve at once, and everything streamed after belongs to the
  second.
- After `session/cancel`, up to 5 buffered chunks arrive before the `cancelled` result.
- `/compact` sent as a prompt compacts and keeps the conversation's memory. `/plan` writes a plan file and ends the
  turn: no approval is asked.

**Tools** (`mapping/tools.ts`, `live/updates.ts`; recorded in `fixtures/frames/`)

- Every `tool_call_update` repeats the call whole: its `name`, `kind`, `title`, `rawInput` and `locations`.
- A `run_command` that ran ends `completed` with `rawOutput: {output, exit_code}`; `output`, also its text content,
  is agy's `Created At …`, `Completed At …` and `Command exited with code N.` lines, then the command's output. A
  command whose permission was refused ends `failed`, with agy's refusal as its `rawOutput` and content.
- `write_file` (`{Path, Content}`) and `edit_file` (`{Path, Target, Replacement}`) name their file in `locations` and,
  once done, in `diff` content. agy titles them by the path from its own folder (`File ../../…/notes.txt`), which is
  the void one.
- `ask_question` is a tool call of kind `other` around its `elicitation/create`; it ends `failed` when the turn is
  stopped.

**Asks** (`live/permissions.ts`, `live/questions.ts`)

- agy asks what the user's own agy permission policy says to ask, and the bridge never reads, writes or overrides that
  policy. Where it approves a tool, agy runs it with no `session/request_permission`, so no ask reaches the phone: on
  a policy that approves every command, a `touch` in `default` mode ran unasked. agy's default policy asks before
  commands and writes.
- `session/request_permission` offers `allow_once` and `reject_once` alone. An edit's request carries
  `content: [{type: "diff", path, oldText?, newText}]`; a new file has no `oldText`.
- agy asks for no read inside the session's folder.
- agy withdraws its own asks on cancel and tolerates a late answer.
- `ask_question` asks with a form `elicitation/create`: each `qN` is `{type: "string", oneOf: [{const, title}]}` or
  `{type: "array", items: {anyOf: [{const, title}]}}`, with an optional `qN_other` string. Accept takes
  `{action: "accept", content: {qN}}`; decline and cancel both let the turn go on. Labels may carry "(Recommended)".
- No other form, choice, confirm or text dialog was seen.

**Listing and history** (`store/list.ts`, `store/transcript-items.ts`)

- `session/list` returns every session at once, with no paging, and ignores `cwd`.
- A session that stored no `cwd` reports the lister's own folder. Paths come percent-encoded (23 of 59 in one
  listing) or realpathed (`/private/var/…`).
- A session with no prompt yet is not listed.
- `session/load` replays the user's text, the agent's text and the tool calls with their answers before it answers,
  about 2.5 s cold: no ids, times, thinking or images.
- Loading a session that is already open is accepted, so a short job can read a session the front hosts.
- After `session/load` agy adds a server restart notice of its own to the conversation, so the next turn takes two
  model steps: the model acknowledges the notice, then answers the prompt (measured on 1.5.18, on a Gemini API key
  and a Google sign-in).
- A worker lost while agy's `ask_question` waited leaves that call `failed` in the replay. The reloaded conversation
  may take the ask up again: on the next prompt ("Reply with exactly: ok") the model asked the same question anew, a
  new `elicitation/create` (seen on 1.5.18, on a Gemini API key).

**Terminal lock** (`live/lock.ts`)

- A terminal `agy` holds an exclusive `flock` on `~/.gemini/antigravity-cli/presence/<sessionId>.lock` while it has
  the conversation open.
- ACP creates no lock file and takes no lock.
- Without a lock, ACP and a terminal write to the same conversation, and the terminal never sees ACP's messages.
- A lock another process takes on that file makes the terminal warn "Conversation already open … Use /fork".

## 2. Processes

- **The live front** (`live/front.ts`): one `agy acp --process-per-session` per backend, started on the first open,
  with the bridge's login-shell environment (`platform/shell-env.ts`) in `~/.broski/antigravity/void`, an empty
  folder the bridge owns (`voidDirOf`). Each hosted session is a worker of its own. When the front exits, every hosted
  session is lost (§11), and the next open or action starts another.
- **Short jobs** (`jobs.ts`): a plain `agy acp` in the void folder for a listing, a catalog probe or a transcript, one
  job at a time in the order asked. The process is kept 20 s after its last job (`LINGER_MS`), so one cold start
  serves the burst of reads a screen makes. A job whose connection failed under it (a deadline, an exit, a frame the
  client cannot read) stops that `agy`, and the next job starts another; an error agy answered keeps it. No job is run
  again. A session a job opens refuses any ask agy raises in it (`-32603`): nobody would see it.
- **The bound** (`live/cap.ts`): at most 8 hosted sessions (`antigravity.maxSessions`, 1–32). An open counts from
  the moment it starts. Room is made by `session/close` of the least recently used session with no run, ask,
  compaction or request in flight, even one a phone views; that view keeps what it showed, and its next action loads
  the session again (`resynced`). When every session has work in flight, the open is refused `busy`, naming the key.
- **Closing**: a hosted session whose view closes is closed once it is idle (`session/close`, which ends its worker
  and frees its lock for a terminal).
- **The stop ladder** (`adapter-kit/stdio-child.ts`): stdin's end, 1.5 s; SIGTERM to the process group, 0.75 s;
  SIGKILL, 0.25 s. Each `agy` leads a process group of its own. `dispose` expires every ask, stops the front and the
  short jobs' `agy`, then lets every lock go once the workers are gone.
- **Deadlines** (`acp/rpc.ts`): `initialize` 30 s, every other request 60 s, `session/prompt` none: a turn waits on a
  human's answers for as long as they take. An exit ends every request still waiting, with the exit and agy's last
  stderr (8 KiB kept).
- **Records**: LF-delimited, a CR before the LF dropped, 64 MiB at most (`adapter-kit/jsonl.ts`); a longer one is
  skipped and reported. Records about a session that arrive before its route is attached wait for it, 256 deep; an
  ask dropped from that queue is answered `-32603`.

## 3. Install, status and the doctor

`server/antigravity-cli-path.ts` finds `agy`: the config key `antigravity.cliPath` when it names a file, else `agy` on
the login shell's `PATH`. With none, `status()` is `installed: false` with the install fix, and every read is refused
with that reason (`registration.test.ts`).

`status()` (`status.ts`) runs `agy --version` (read again only when the file changes; 10 s timeout) and reports the
sign-in the last catalog probe saw; it opens no session itself, so before any probe `auth` is `unknown`.

- `_meta.antigravity.tier` on the probe's `session/new`: `signed_in`.
- ACP's `auth_required` (`-32000`), or another agy error whose message names auth: `signed_out`, an error issue in
  agy's words with "Run `agy` in a terminal and sign in.", and `usable: false`. A catalog read then answers `auth`.
- Any other failure: a warning, and `usable` stays true, since the probe may have failed for its folder alone.

`broski-bridge doctor` (`doctor/checks/antigravity.ts`) reports the path, the version and the sign-in, read by
opening and closing one session in the void folder, which agy then does not list: the doctor runs only when the person
runs it. The `agents.antigravity` config key and the wizard's agent step (`wizard/steps/agents.ts`) only say which
agents the user meant to use; the backend is registered whatever they say.

## 4. Catalogs

`catalog/catalogs.ts` reads what agy offers only to answer a read the person asked for, and never on a timer. Models,
their thinking levels and modes are the account's and the `agy` binary's, not a folder's, so they are probed once,
and again when the binary's file stamp changes (an update), when a hosted session sees agy offer other models or
modes (`invalidate`, from `config_option_update` and `set_config_option` answers), or when a read finds them an hour
old (`KEEP_MS`, checked as it reads, with no timer): what agy offers changes otherwise only as the person changes its
config, their plan or a folder's skills, none of which the bridge hears of. Commands are a folder's (its workspace
skills): each folder's are read from the catalog probe when it ran there, else from a commands probe there, and kept
as long (64 folders) under the same binary; a hosted session that agy announces commands to
(`available_commands_update`) replaces its folder's (`announced`). Readers asking while a probe runs share it, and a
failed probe is not kept. Nor is a wait in which agy announced no commands: it read nothing, so it is answered as a
failure ("agy announced no commands within 5 s"), which the phone's core does not keep either, and the next read
probes again; an empty list would have been kept, on the bridge and on the phone, as agy offering none.

- **The catalog probe** (`catalog/probe.ts`), on a short job, in the folder asked (the void folder without one):
  `session/new {cwd, mcpServers: []}`, then `session/set_config_option` of each model in turn to read its own
  `thought_level` option, then the starting model again, then `session/close`; it waits up to 5 s for the commands agy
  announces.
- **The commands probe**: `session/new`, the commands agy announces (up to 5 s), `session/close`.

Neither session is ever prompted, so agy does not list it.

- **Models** (`catalog/models.ts`): agy's model option, its values in agy's order with their names, descriptions and
  groups (`providerName`). `thinking.options` are that model's own levels, empty for a model with none, defaulting to
  the level agy starts it on. `contextWindow` is the `usage_update.size` seen while it was selected. `isDefault` is the
  option's `currentValue`. A model agy refused to select carries `unavailableReason` and is listed only to
  `includeUnavailable`, after the usable ones.
- **Modes** (`catalog/modes.ts`): agy's mode option as one axis, id `mode`, label "Mode": `default`, `accept-edits`,
  `auto` and `plan` with agy's descriptions, defaulting to its current value.
- **Commands** (`catalog/commands.ts`): `available_commands_update`, by name; a name with whitespace is left out,
  since a command is sent back as the prompt `/<name> <input>`. A hosted session lists the commands agy announced to
  it; another session lists its folder's.

A hosted session that sees the offered models, a selected model's levels or the modes change drops the models and
modes and emits `catalog_invalidated`.

## 5. Sessions and listing

`store/sessions.ts` reads `session/list` on a short job (following `nextCursor`, 100 pages at most, though agy sends
one) and keeps it 15 s; every turn a hosted session ends drops it, and `getSession` lists afresh when the kept listing
lacks the session. `store/list.ts` makes agy's rows the contract's:

1. Each `cwd` percent-decoded, then realpathed (the decoded path when it exists, else the path as written).
2. A row reporting the void folder has no `cwd`: agy stored none.
3. The bridge filters by the query's canonical `cwd` and search words, orders by `updatedAt` then id, newest first,
   and pages by keyset cursor (`adapter-kit/cursor.ts`). A query for child sessions is answered empty.

A row's title is agy's (`source: "generated"`); `status` is `unknown`, except that a hosted session's row is the
host's (`live/host-row.ts`): status, model, run start, title, and `updatedAt` when one of its turns last ended.
`origin` is `broski` for a session this bridge made while it runs (`store/made.ts`, 10,000 kept in memory), else
`external`: agy keeps no record of the client that made a session.

## 6. Transcript

`store/transcript.ts`: a short job's `session/load {sessionId, cwd, mcpServers: []}` in the session's folder (the void
folder when agy kept none), every replayed update collected until the answer, then `session/close`. A run of chunks of
one kind is one item (user message, text, thinking); each tool call is a call item and, once ended, a result item
(`mapping/tools.ts`, the same mapper as live). Ids are positions, `<sessionId>:<n>` (`idStability: "positional"`);
every item's time is the session's `updatedAt`. Replayed updates that do not read are counted in a warning notice
after the items. The items are kept per session while its `updatedAt` stays the same, 8 sessions, and dropped when a
hosted turn ends.

For a session the bridge hosts (`live/hosts.ts` `shown`): while a run is on, the items stop before its prompt's user
message, which agy may already have stored; and the user messages this bridge sent get back their `clientRequestId`
and their images while kept (§9), paired from the newest by text. A hosted session agy does not list yet (it has had
no prompt) has an empty transcript.

## 7. Opening a session

- **New** (`live/hosts.ts` `created`): on the front, `session/new {cwd, mcpServers: []}` and nothing else. Then the
  session's presence lock is taken (§10); then the phone's model, thinking level and modes, in that order, each a
  `set_config_option` (a model has levels of its own). A refused setting closes the session and refuses the open. The
  snapshot carries agy's model, level and mode from its config options.
- **Existing**, when no terminal holds its lock: the lock, then `session/load` on the front. The replay's history is
  dropped (the transcript reads it); its `usage_update`, `available_commands_update` and `session_info_update` set
  the host's context fill, commands and title. agy answering that the session does not exist is `not_found`, and the lock file the bridge made for it is removed.
- **Existing, held by a terminal `agy`**: watch-only (§10).

A session is known when agy lists it (listed afresh when the kept listing lacks it) or this bridge made it; any other
id is `not_found`, as is one with characters other than letters, digits, `_` and `-`, since it names a lock file.

## 8. Runs and events

One `session/prompt` in flight per session (`live/turns.ts`). A `start` prompt while a run or the phone's compaction
is on is refused `busy`; the core's queue sends a queued prompt after `run_finished`, and its steer stops the run and
starts the next (core README §24). A repeat of an accepted `clientRequestId` answers the first result (1,000
remembered). `PromptInput.command` is sent as `/<name> <text>`, refused `not_found` when agy announced the session's
commands and that is not one; a file attachment is `unsupported`.

`run_started` (trigger `prompt`) and `user_message` (with its `clientRequestId` and image refs) go out as the prompt
is sent; `run_finished` when agy answers it. Before `run_finished`, every open block closes and every tool still
running ends `aborted`.

| agy sends | The phone sees |
|---|---|
| `agent_message_chunk` | a text block: `block_started`, `block_delta`, `block_finished` |
| `agent_thought_chunk` | a thinking block |
| `tool_call`, `tool_call_update` | `tool_started`; `tool_updated` (`input`, `output_replaced`, `file_changes`); `tool_finished` at `completed` or `failed` |
| `usage_update {used, size}` | `usage_updated`: `contextTokens`, `contextWindow`; nothing when the snapshot already holds them |
| the prompt result's `usage` | `usage_updated`: `cache` |
| `session_info_update` | the row's title, announced as `session_updated` |
| `available_commands_update` | the session's commands; `catalog_invalidated` (commands) |
| `config_option_update`, a `set_config_option` answer | `model_changed`, `mode_changed` when a setting changed; the catalog dropped when what is offered changed. A choice of the value the session already has sends agy nothing and still shows as its event |
| `current_mode_update` | `mode_changed` |
| `user_message_chunk` | nothing live (the bridge sent the message itself) |
| `session/request_permission` | `interaction_requested` `tool_permission` (§9) |
| `elicitation/create` | `interaction_requested` `questions` (§9) |
| an update of another kind | nothing |

A block closes when the kind changes, when a tool call starts, when its text would pass the contract's text bound, and
when the run ends; the blocks between two tool calls share one message id. A tool call keeps agy's id, made unique in
the session with a `#n` suffix. A call agy first names in a `tool_call_update` starts there. An update's `content` and
`locations` replace the call's whole, as ACP says.

**Tools** (`mapping/tools.ts`). The row's `name` is agy's tool name (else its kind, else `tool`), its `input` agy's
`rawInput`, bounded; all text goes through `adapter-kit/phone-text`.

| agy tool | Row title |
|---|---|
| `run_command` | the first line of `CommandLine` |
| `read_file`, `write_file`, `edit_file` | the file's name: the `diff` path, else the first location, else `Path` |
| `ask_question` | "Question" |
| `invoke_subagent` | "Subagent: `Role`" |
| any other | agy's `title` |

The recordings hold `run_command`, `write_file`, `edit_file` and `ask_question`; `read_file` was seen live, and
`invoke_subagent`'s `Role` was not seen at all. An `input` update goes out only when agy sends other arguments, since
every update repeats them (§1). A call's result is its text content (a command's `rawOutput.output`, with
`rawOutput.exit_code` as its `exitCode`) and `fileChanges` from its `diff` content: no `oldText` is an `added` file,
else `modified`, with a unified diff (`adapter-kit/unified-diff.ts`). A `failed` call's text is its error.

**Outcomes** (`live/outcomes.ts`): `end_turn` completed; `cancelled` aborted; `max_tokens` the `output_tokens` limit;
`max_turn_requests` the `max_turns` limit; `refusal` an error (`content_filter`) with a warning notice that the
prompt and what follows are left out of what the model sees next; any other stop reason an `unknown` error naming
it. A JSON-RPC error is an error in agy's words: `auth` for `-32000`, `backend_unavailable` when the connection
failed, else `unknown`. An error while the person's stop is under way is the stop. Nothing is retried.

**Usage** (`live/usage.ts`): the context fill from the last `usage_update`. The cache window is the latest turn's:
`cachedTokens` its `cachedReadTokens`, `promptTokens` its `inputTokens` when `totalTokens` equals input, output and
thought tokens together (the input already holds the cached reads), else `inputTokens + cachedReadTokens`, which is
what agy 1.5.18 gives (§1);
`confidence: "exact"`, no `ttlMs`, so the core's `CacheClock` shows the hit ratio with no countdown. The session totals
(`inputTokens`, `outputTokens`, `cacheReadTokens`, `reasoningTokens`) stay absent: agy gives one turn's counts, and a
sum of the turns this bridge ran would read as the session's whole use while it leaves out every turn run elsewhere.

**Compaction** (`control.compact`): `/compact` plus the instructions, sent as a prompt and shown as
`compaction_started` (trigger `manual`) and `compaction_finished`, not as a run; `tokensBefore` is the context fill
before it. What agy writes meanwhile becomes a `/compact` command `activity`; its thinking and tool calls are not
shown. Refused `busy` while a run is on.

## 9. Asks, stop and images

Both kinds go through the kit's ask desk (`live/asks.ts`). No timer answers either. An ask ends unanswered only when
agy ends it: its tool call ends, its turn ends, agy takes the request back (`$/cancel_request`, answered
`-32800 Request cancelled` as ACP requires), or its process goes, each `withdrawn`; the bridge's shutdown expires it.

**Permissions** (`live/permissions.ts`). Each of agy's options keeps its `optionId` and name; its `kind` gives the
effect and scope (`allow_once`, `allow_always`, `reject_once`, `reject_always`). No option is the default, none stops
the run (a rejection lets agy go on without the tool), `deliberate` is false, the input is not editable and there are
no grants. `reason` is the call's `toolSummary` argument, and the title the call's row title (§8), not agy's, which
names a file by its path from the void folder. Previews: `command` for `run_command`, else `file_changes`
from the request's `diff` content, else `paths` from its locations. The answer is
`{outcome: {outcome: "selected", optionId}}`; a dismissal is `{outcome: {outcome: "cancelled"}}`, which leaves the
tool unrun. A request is read with the call as agy reported it so far, since a request may name only its id.

**Questions** (`live/questions.ts`). A form whose properties are `qN` and `qN_other` alone becomes one question per
`qN`, in number order: a string with `oneOf` choices is one pick, an array with `items.anyOf` several, untitled
`enum` choices are titled by their value, a string with no choices takes the person's words, and `qN_other` allows
the person's own words beside the choices. Labels are agy's titles as written. `required` is the schema's. The answer
is `{action: "accept", content}` with each choice's `const` (an array for several) and the words under `qN_other` or
`qN`; a dismissal is `decline`; a cancel that stops the run is `cancel`.

**What the phone cannot show** still goes to the person, and only the person ends it:

- A permission none of whose options reads: one option, "Refuse", and a body saying refusing is all Broski can send.
  Its answer is `cancelled`.
- A form that is not agy's questions, or whose choices repeat a label: one question carrying agy's message with one
  option, "Decline", and a body saying it can only be declined or cancelled by stopping the turn. Its answer is
  `decline`, or `cancel` when the turn is stopped.

**Stop** (`control.abort`): `session/cancel`, and every open request answered as a stopped turn's (a permission
`cancelled`, a question `cancel`), its ask withdrawn. A request agy sends in the turn after the stop is answered the
same way, raising no ask, and `session/cancel` is sent again: agy has not taken the stop. The run ends when agy
answers the prompt, the chunks it still sends before then included.

**Images** (`live/phone-prompts.ts`): sent as `{type: "image", mimeType, data}` blocks. Since `session/load` replays no
image, the bridge keeps each prompt's images in the kit's image cache as `<sessionId>/<uuid>` (32 images, 32 MiB of
base64, across the backend), for `readAttachment` (fitted by the bridge's `ImageFitter`) and for the transcript's user
messages. The images of a prompt sent elsewhere, or before the bridge started, cannot be shown.

## 10. Presence locks and watch-only

agy's terminal lock is the one thing of agy's the adapter touches (`live/lock.ts`). The bridge takes
`presence/<sessionId>.lock` under `$HOME/.gemini/antigravity-cli/` for every session it hosts, through the
`FileLock` port (`platform/file-lock.ts`: `flock(LOCK_EX | LOCK_NB)`, the file made `0600`, the folder `0700`), and
holds it until the host ends. The kernel drops it when the bridge exits, however it exits. So a terminal `agy` that
opens a session the phone has warns "Conversation already open … Use /fork".

- `flock` refuses a second descriptor of the same process as it refuses another process, so the bridge keeps the
  locks it took and counts those as its own.
- Testing another holder takes the exclusive lock without waiting and lets it go in the same synchronous step:
  nothing is held across an await, and a terminal opening the session can meet it only within those two calls. A
  session with no lock file has had no terminal on it.
- A lock file the bridge made for a session agy turns out not to have is removed.

A session a terminal holds opens **watch-only** (`live/watch.ts`): no `control` and no `answer`, since ACP gives the
bridge no channel to a terminal's turn or its asks. Its snapshot is empty, its history is the transcript's, and it
shows the notice "This conversation is open in a terminal `agy`. Quit it there, or use /fork, to send from the
phone." The view looks at the lock every 3 s. Once the terminal lets go, and the session's folder is there (or agy
kept none), it promotes itself through the kit's promotable view (`adapter-kit/promotable-view.ts`): dormant and
controllable, with `resynced` and `session_replaced`; the phone's first action then loads it hosted. If the terminal
takes the lock again before that, the view goes back to watching; an action that meets the terminal is refused
`busy`. A hosted promoted session has `compact`; its queue's `cancelQueued` is the core's.

## 11. Failures

- **Worker loss**: any request of a session answered `-32603` "… process serving this session exited unexpectedly"
  or `-32602` "Session not found" (§1; both matched on code and message in `live/outcomes.ts`, since each code alone
  is any internal error or bad parameter), or met while the front no longer runs, loses its host (`live/host.ts`). Its
  run ends `backend_unavailable` ("the session's agy process stopped: " and agy's words) or its compaction failed,
  its asks are withdrawn, and its lock is let go. The view keeps what it showed; the phone's next action loads the
  session in a new host (`session/load`) and sends `resynced` once.
- **Front exit**: every hosted session is lost the same way; the next action starts a new front.
- **A turn agy fails**: agy's own words, clipped, and never retried (§8).
- **Faults**: a record that is not JSON-RPC, a known update or answer that does not read, an oversized record: each is
  logged to the bridge log with `[antigravity]` (and the session's id), never shown as agy's output; a replay counts
  its own in the transcript (§6). An answer the client cannot read still ends its request, with what was wrong.
  Unknown update kinds pass silently.
- **Not seen on 1.5.18**: the exact signed-out error, a rate-limit or quota error mid-turn, and a login that expires
  mid-turn. Each reaches the phone as agy's own error text.

## 12. Account safety

Google's rules for third-party ACP clients (above) come first; these are the rest.

| Rule | Where |
|---|---|
| An honest client: `clientInfo {name: "broski", version: <bridge version>}` | `backend.ts` `partsOf`, `acp/connection.ts` `open` |
| Never `authenticate` or `logout`, never `--dangerously-skip-permissions`: the client sends `initialize`, `session/new`, `session/load`, `session/list`, `session/prompt`, `session/set_config_option`, `session/close` and `session/cancel`, and starts `agy` with `acp` or `acp --process-per-session` alone, besides the status's `agy --version` | `acp/connection.ts`, `live/`, `store/`, `catalog/probe.ts`; `jobs.ts`, `live/front.ts`, `status.ts` |
| The client offers no file system and no terminal: agy touches every file itself, under its own permissions | `acp/connection.ts` |
| Never write agy's settings, trust list, hooks or plugins: settings are per session, and a probe selects its starting model again | `live/settings.ts`, `catalog/probe.ts` |
| One prompt in flight per session | `live/turns.ts` |
| No retry loops: a failed job, prompt or setting is reported once | `jobs.ts`, `live/outcomes.ts` |
| History only through ACP: the adapter reads no file of agy's and writes only `presence/*.lock` | `store/`, `live/lock.ts` |
| No automatic answers | `live/asks.ts` |

Outside the backend, the bridge meters no Antigravity plan (`usage/usage-reader.ts`) and reads agy's conversation
files only for the local stats (`stats/sources/antigravity.ts`), which send nothing anywhere.

## 13. Capabilities

`ANTIGRAVITY_TRAITS` (`traits.ts`):

- `streamText`, `streamThinking`: `agent_message_chunk`, `agent_thought_chunk`.
- `promptModes: ["start"]`, `queue: false`: a second prompt mid-turn takes over the first turn's output, so steer and
  queue are the core's.
- `attachments: ["image"]`: agy takes image blocks, and the bridge keeps the bytes the replay drops (§9).
- `commands`: announced per session, run as prompt text.
- `interactions: ["questions", "tool_permission"]`: the only asks agy makes. Questions come first: agy asks them on any
  permission policy, and the conformance kit holds its runs on the first kind. Forms, choices, confirms and text
  dialogs are not declared.
- `thinking`: each model's own levels. `usage`: the context fill and the cache window.
- `children: false`: a subagent is an `invoke_subagent` tool call with no stream of its own, shown as a tool row.
- `planProposals: false`: `/plan` writes a file and ends the turn.
- `externalLive: false`: ACP has no live feed of a terminal's turn.
- `extensions: []`.
- `verbatimPrompts`: the bridge sends agy only the person's input, so the core offers it no portable fork.

No `fork`, `rename` or `delete` methods: agy answers each `Method not found`, and with `verbatimPrompts` the core
stands in for none of them, so the phone offers no fork (`registration.test.ts`). Session capabilities: `control` and `compact` for a
hosted session, and `cancelQueued` from the core's queue; none of them, and no `answer`, for a watch-only one.

## 14. What it does not do

- **Rename or delete** a session: agy offers no ACP method for either.
- **Fork**: agy has no `session/fork`, and the core's portable fork would replay the conversation in a prompt the bridge
  wrote (Google's rules).
- **Tell agy it writes for a phone**: Claude Code and Pi get the phone-writing note; agy gets none (Google's rules). The
  person can put it in their own `~/.gemini/GEMINI.md`.
- **Meter the plan**: its usage is only behind Google's internal endpoints and agy's sign-in, which no third-party
  client may use.
- **Children**: subagents are tool rows.
- **Show a terminal's run live**, or answer a terminal's asks: ACP gives no feed of either, and agy has no permission
  hook. Such a session is watch-only until the terminal lets go.
- **Keep a run through a bridge restart**: the front is the bridge's child and ends on its stdin's end, so a running
  turn ends with the bridge; the session reopens from agy's history.
- **Bridge MCP**: every session opens with `mcpServers: []`. agy advertises no HTTP MCP, and its own `ask_question`
  already asks the phone's questions.
- **Exact times in history**: agy replays none, so every item carries the session's `updatedAt`.

## 15. Tests

In CI (`bun test`), no `agy` is started:

- `replay/`: agy's own frames (`fixtures/frames/`, written by the recorder, §16; `recordings.ts`) played back to the
  bridge's JSON-RPC layer in the recorded order (`replay.ts`), every record the code under test sends agy held to the
  one the bridge sent in the recording, ids aside, and none more. Where the recording shows the bridge speaking, the
  phone does what made it speak: the setting, the prompt or compaction, the answer, the stop (`host-rig.ts`, on the
  production `AgyHost`). What the model chose (its words, titles, a tool's arguments, a question's labels, token
  counts) is held to what agy wrote in the recording (`recorded.ts`), never to a copy of it, so a recording made
  again of the same scenarios passes; a question is answered as the recorder answered it (`PICKED`).
  - `acp_frames.test.ts`: the JSONL framing cut anywhere, and every answer, update and request of agy's in every
    fixture read by the bridge's readers, as its kind, with no fault and no list item or named field dropped.
  - `turns.test.ts`: text, thinking and image turns (blocks, settings, usage, title, commands), a command's row with
    its output and exit code, a denied command, a written and an edited file with their diffs, a second prompt refused
    `busy` with one `session/prompt` sent, and a loaded session's compaction.
  - `asks.test.ts`: command and file permissions (agy's options, the command, the diffs, the reason), one-pick,
    several-pick and declined questions, each reply sent as agy got it, and a stop with a question pending.
  - `store.test.ts`: the listing through the bridge's listing job (real folders, filter, order, pages) and a session's
    history from its `session/load` replay, `session/close` included.
- `acp_spec.test.ts`: the JSON-RPC layer on the records ACP's documentation shows.
- `live_turns.test.ts`, `live_asks.test.ts` (over `live-rig.ts`), `live_shapes.test.ts`: turns, stops and an ask
  after one, worker loss, stop reasons, compaction, asks and the unshowable ones, eviction, the cache window, diff
  previews, and a report or choice of what the session already holds, on ACP's documented records, every stream held
  to the contract's stream rules.
- `list.test.ts`: listing on real folders (percent-encoded and symlinked paths, the void rule, pages, hosted rows).
- `watch_lock.test.ts`: watch-only, promotion and going back, against another process holding a real `flock`.
- `jobs_shutdown.test.ts`: the short jobs and `dispose` against a stand-in process that hangs and speaks no ACP.
- `record/scrub.test.ts`: the recorder's scrubber on frames built in the test, holding the run's home folder, this
  Mac's user and host names, the temp folders' names (relative paths among them) and times with a UTC offset.
- `registration.test.ts`: a real bridge on a Mac with no `agy`: the descriptor, the core's steer and queue and no
  fork, the status and the reads' refusals.
- `catalogs.test.ts`: what the catalog keeps and for how long, over probes that note each folder they are asked
  about: a commands wait in which agy announced none is a failure and not kept, the hour's limit, and the drops on
  `invalidate`, an announcement and a new binary.
- `live_gate.test.ts`: the gate every live, conformance and recorder file passes (opted in and a Gemini API key),
  the arguments the tap starts `agy` with (the profile with a relative app data dir for `agy acp`, none for
  `agy --version`, nothing else), what names a plan, and the log lines of a worker and of a terminal `agy` that say
  how agy authenticated.
- `live_end.test.ts`: what a failed live test leaves, on the contract's fake backend behind the live guard: a turn
  still going holds the account's one turn until the guard ends the backend, whether the abort ends the run or not.
- `src/__tests__/doctor_antigravity.test.ts`: the doctor's check, its sources injected.

## 16. The live layer

Opt-in, on the real `agy` and only on the developer's own Gemini API key (`__tests__/antigravity/live/`,
`conformance/`, `record/`): a file runs only with its flag and `GEMINI_API_KEY` set (`live/gate.ts`), else it skips
naming why.

- **The profile** (`live/profile.ts`): a temp folder standing in for the user's home. Every `agy acp` a test starts
  gets `--gemini-dir <temp>/profile/.gemini --app-data-dir antigravity-cli`: agy 1.5.18 resolves the app data dir
  under the gemini dir and refuses an absolute one ("must not be absolute"), so its settings, cache and presence locks
  are `<temp>/profile/.gemini/antigravity-cli/…`. `agy --version` takes no profile and gets none. The terminal `agy`
  lists neither flag, so it is started with `HOME=<temp>/profile`, whose default `~/.gemini/antigravity-cli` is the
  same folder. Its `settings.json` is `{"modelProvider": "gemini"}` (antigravity.google/docs/install,
  "Authenticate"), with the terminal test's folder in `trustedWorkspaces` for that test. Measured on 1.5.18: the tap's
  `authenticate` answers `{}`, `session/new` answers `_meta: null`, agy offers the Gemini API's own models, its sign-in
  state is written into the profile's `cache/`, and nothing of the user's agy (its sign-in state, settings,
  conversations, trust list, presence locks) is read or written. The key reaches agy only through its environment and
  is replaced in every log, screen and fixture.
- **The world** (`live/world.ts`): temp folders, the profile, and the production backend with what production gives it,
  except a temp void folder, the profile's presence folder, `GEMINI_API_KEY` in its environment and, as its `agy`, a
  wire tap (`live/wire-tap.ts`) that starts the real one in the profile and logs every frame, both ways, before it
  passes the frame on, so whatever the backend has received the log holds; on the front it notes agy's children around
  each `session/new` and `session/load`. Once agy answers `initialize`, the tap sends its own
  `authenticate {"methodId": "gemini-api-key"}` (id `broski-tap-auth`, logged as the tap's) and hands the backend agy's
  answer only after agy has answered it; the backend never authenticates.
- **The proof before anything else reaches agy** (`wire-tap.ts`, `profile.ts` `assertApiKey`): the tap stops agy,
  keeping from the backend the answer that made it, when agy refuses the key or any answer of agy's carries
  `_meta.antigravity.tier`, which names the plan on a Google sign-in. So on a consumer sign-in the backend never gets
  its `initialize` answer, or never the catalog probe's `session/new` answer, and sends agy nothing more. `world.start`
  (once the catalog is read, or failed to be) and the guard (before every prompt and compaction) check the wire again:
  every `agy` the backend was answered `initialize` by took the key, and no answer names a plan. Otherwise the test
  throws "agy is on the consumer sign-in; live tests run only on a Gemini API key" and sends nothing. agy's own logs say
  it too: after a world's first session opens, the guard waits (up to 35 s: agy logs in glog's format, and how soon it
  writes a line out was not measured) for a session worker's log in the profile (`antigravity-cli/log/acp-worker-*.log`)
  to say `authenticated via gemini_api_key (effective: gemini_api_key)`, and throws the same when one names another way
  (`keyring` on a Google sign-in). A terminal `agy` writes `cli-<time>.log` there, whose first line names its pid
  ("Starting language server process with pid N"); before the terminal test does anything with one, the log of that
  pid or a process under it must say the same, or the test ends its tmux session and fails.
- **Time and failure** (`live/gate.ts`, `live/live-test.ts`): a turn may take 300 s (`TURN_MS`), and a test its
  turns' sum and 120 s, since the Gemini API on a developer's key is at times very slow (a plain "Reply with exactly:
  ok" once took 56 s, with nothing in agy's log) and the first turn after a reload is two model steps (§1). A test
  fails at that deadline itself, before bun's own timeout, which is 30 s later, so its catch always runs: it prints the
  wire of every open world since it began (`live/wire-summary.ts`) and the last 60 lines of agy's own log of each
  front it saw (`acp-front-<time>-<pid>.log`) and each worker that joined one while it opened a session then
  (`acp-worker-<time>-<pid>.log`), the key replaced and the temp folders named, since the world's folders go with it,
  then ends every open world's backends (each run or compaction still going aborted, the backend disposed, the
  account's turn freed for each of its sessions), so no turn of a failed test refuses the next test's prompt. A suite
  that shares one session (`AgyWorld.shared`) opens it afresh after that.
- **The guard** (`live/guard.ts`, `live/safety.ts`, `live/model.ts`): every prompt runs on the cheapest model agy
  lists at its lowest thinking level (the one turn a test asks to think deeply at its highest), in agy's `default` mode,
  where agy's permission policy (the profile's: agy's default, which asks) decides what agy asks before it runs or
  writes. A permission is allowed only for `touch`, `echo` or `ls` with no shell syntax, inside the test's folders; of
  agy's commands only `/compact` is sent.
- **The account** (`live/account.ts`): one prompt budget per process, in a ledger whose `flock` the first live test
  takes, and one turn with agy at a time, freed when the turn ends or its backend is disposed.
- **The suites** (`live/live.test.ts`): sessions on the front (nothing of the bridge's on `session/new`, the settings,
  reload with agy's own history, a second reader), turns (tools and permissions, a stop, token counts, thinking, an
  image, settings), questions, the bound and the loss of a worker or the front (killing only processes traced to the
  tap's own `agy`, its run held on a question, which the turn that reloads the session may ask again and the test
  declines, §1), and with `BROSKI_TEST_AGY_TERMINAL=1` a terminal `agy -r <id>` in the profile, in a tmux server of
  the test's own (`-L broski-agy-live`, no config of the user's). Nothing is typed into the terminal, so before any
  prompt `agy` alone is started there and must come up asking nothing: one that exits or asks to trust the folder or
  to sign in fails the suite with its screen.
- **Conformance** (`conformance/`): every conformance rule as a live test, with a driver over one shared world;
  scenarios are instructions to the real model, a hold is agy's question, what reached the model is read back from agy's replay and the tapped
  `session/prompt`, `runExternally` is false and runs do not survive a restart. A permission rule whose run ended
  unasked fails with what the wire showed (`unasked`). `echo_model` is declined, since a model does not know agy's id
  for it, so the model rule checks a choice made mid-run at a hold, without which model each request ran with. A
  session the backend does not find is explained from the wire (agy's newest listing, the session's prompts).
- **The recorder** (`record/`): fourteen scenarios, twelve prompts, each scenario on a backend of its own, its frames
  scrubbed of paths, the temp folders' names, the time zone (a time with an offset is written in UTC), names, the key,
  the plan and every session id (`record/scrub.ts`), which CI replays (§15). A scenario about a permission that agy
  ran unasked is recorded as `<name>-unasked`.
