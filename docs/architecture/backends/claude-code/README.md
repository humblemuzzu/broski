# The Claude Code adapter

Status: **Step 3 (foundation) built** on `cc/foundation`: types, seams, shared helpers and typed stubs. Nothing is registered (D28): `server/contract-backends.ts` does not know this adapter until Step 5. The plan is [`PLAN.md`](PLAN.md); what each Step 4 lane builds against is [`STEP-3-INTERFACES.md`](STEP-3-INTERFACES.md).

## What it is

The contract backend for Claude Code (`packages/bridge/src/backends/claude-code/`): it implements `AgentBackend` (`src/contract/backend.ts`) on `@anthropic-ai/claude-agent-sdk` 0.3.316 (bundled CLI 2.1.316), so the generic app (`lib/agent/`) drives Claude Code exactly as it drives Pi. It may import only the contract (not its test kit), itself, `node:` built-ins (not `node:module`), `zod` and the SDK (`bun run check:layers`).

## Layout

```
backends/claude-code/
  factory.ts        claudeCodeBackendFactory(options) → BackendFactory            foundation
  backend.ts        the AgentBackend over the parts; open routing; dispose order   foundation
  call-op.ts        AgentBackend.call: ClaudeCodeOp → ops/                         foundation
  traits.ts         CLAUDE_CODE_TRAITS, claudeCodeTraits({customTools})            foundation (D38)
  ports.ts, ports/  every seam between the parts                                  foundation
  services.ts       factory options, shared services                               foundation
  ids.ts cursor.ts bounds.ts json.ts rejections.ts catalog-feed.ts                foundation, built + tested
  permission-modes.ts  the permissions axis's values                               foundation, built
  sdk/              the ClaudeSdk port: in process, or a worker under a config dir (D36)   foundation, built
  process/env.ts process/inbox.ts                                                 foundation, built
  live/live-state.ts                                                              foundation, built
  owned.ts store/                                                                 lane A
  mapping/                                                                        lane B
  models/ modes.ts commands.ts status.ts process/probe.ts process/version-check.ts lane C
  live/ (but live-state.ts) process/options.ts                                    lane D
  ui/                                                                             lane E
  ops/                                                                            lane F
  terminal/                                                                       lane G
```

Tests: `src/__tests__/claude-code/foundation/` (Step 3), `src/__tests__/claude-code/conformance/` (the driver, the suite skipped until Step 5), `src/__tests__/claude-code/helpers/` (`fake-claude-sdk.ts`, `fake-query.ts`, `frame-fixtures.ts`, `fixture-transcripts.ts`), and one directory per lane (STEP-3 §1).

PLAN §7 listed `ui/dialogs.ts`; it is not created: D5 as amended by the spike passes no `onUserDialog` and declares no `choice`, so there is no dialog to map.

## Decisions

D1–D35 are [`PLAN.md`](PLAN.md) §3 (D1–D30 the plan's, D31–D35 the spike's). Step 3 took D36–D39.

### D36. An explicit config dir runs the SDK's session functions in a worker; production calls them in process

The SDK's session and settings functions (`listSessions`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents`, `forkSession`, `renameSession`, `resolveSettings`) read `CLAUDE_CONFIG_DIR` from the environment of the thread they run in: `sdk.mjs:30` `function hu(){return process.env.CLAUDE_CONFIG_DIR}` and `Mt=PP(()=>(hu()??join(homedir(),".claude")).normalize("NFC"),hu)`; their options have no config dir (`sdk.d.ts:934`, `:1143`, `:3418`).

When they read it decides the mechanism. Read in `sdk.mjs`:

| Function | First read of the config dir | Before its first `await`? |
|---|---|---|
| `listSessions` | `X0(e,t,n=Et())` default parameter (`sdk.mjs:117`) | yes |
| `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents` | `ws(…,o=Et())` default parameter, called synchronously (`:56`, `:114`, `:117`) | yes |
| `forkSession` with `dir` | `qn(l,o)` defaults `n=Et()` after `await No(t,…)` (`:117` `kxe`) | **no** |
| `renameSession` with `dir`, `deleteSession` with `dir` | `qn(…)` after `await No(…)` (`:161` `J3`, `aJe`) | **no** |
| `resolveSettings` | after `await R6()` (`:152` `k6`) | **no** |

A synchronous swap of `process.env` around the call would therefore leave `fork`, `rename` and `resolveSettings` reading whatever the environment says after the first `await`, and a swap held across that `await` mutates the bridge's environment while other code runs (forbidden). So:

- **`configDir` unset (production):** the functions run in process. The bridge's `process.env` already is the login shell's (`applyServiceShellEnv` imports it, `platform/shell-env.ts`), so a `CLAUDE_CONFIG_DIR` set in `~/.zshrc` reaches the SDK and the CLI alike (the CLI gets `services.cliEnv`, built from the same shell env).
- **`configDir` set (tests, and any future override):** they run in a `node:worker_threads` worker started with `env: {…cliEnv, CLAUDE_CONFIG_DIR: configDir}` (`sdk/worker-client.ts`, `sdk/sdk-worker.ts`). Bun gives a worker its own `process.env` (proven before writing it: two workers with different `env` read different values while the parent's stays as it was). The bridge's `process.env` is never written. The worker starts on the first call, is `unref`'d, and ends at `dispose()`.

Evidence: `src/__tests__/claude-code/foundation/config_dir.test.ts` — two ports over two temp config dirs, five reads in one `Promise.all` (lists with and without `dir`, messages, a cross-dir `getSessionInfo` that must miss), with the bridge's own `CLAUDE_CONFIG_DIR` pointed at a third, decoy dir: each port sees exactly its own sessions and the decoy is untouched; `renameSession` and `forkSession` with `dir` land in the right dir; a disposed port refuses. A compiled bridge never starts the worker (production leaves `configDir` unset), so `scripts/build.sh` needs no extra entry point; a build that ever sets `configDir` must add `sdk/sdk-worker.ts` as a `bun build --compile` entry point first.

### D37. A prompt's send `uuid` is its `clientRequestId`

The `SDKUserMessage` that carries a prompt has `uuid = clientRequestId` (`ids.ts` `sendUuid`). The CLI keeps a send's uuid as its transcript entry's uuid (`sdk.d.ts:878-882`; proven by `conformance/session_router.test.ts`: the first chain entry's uuid is the uuid sent), keys `command_lifecycle` and `result.user_message_uuids` by it (08-spike Q4), so one id names the prompt in the live `user_message.messageId`, the transcript item id (`userItemId`), and the image refs `<uuid>:<blockIndex>`. The owner journal (`owned.ts`) records each prompt this bridge sent with its image names (the CLI keeps none); the store gives a user item `clientRequestId = uuid` exactly when the journal has it, so a prompt typed in a terminal never carries one. A fork remaps every uuid, so a fork's prompts carry none.

### D38. The declared capabilities

`CLAUDE_CODE_TRAITS` (`traits.ts`) is the plan's list with two changes, each because no conformance rule could pass the plan's value:

- **`attachments: ["image"]`, files as mentions.** A contract file attachment is a path on the Mac (`FileContent.uri`), which D10 sends as `@<path>`, exactly as a file mention. Rule 13 compares each delivered attachment and mention with what was sent, and a driver reading the model request cannot tell `@path`-from-an-attachment from `@path`-from-a-mention, so declaring both would make one of them fail. A file reaches Claude Code as a mention (`mentions: ["file", "agent"]`).
- **`plan: false`.** On the CLI's models (`claude-*-5-5`) the todo tools are off: the 2.1.316 binary enables `TodoWrite`/`TaskCreate` only for an older model, a launch opt-in, or `CLAUDE_CODE_ENABLE_TODO_TOOLS` (`p5()` in the binary's strings), and no recorded `system/init` lists either tool (`fixtures/frames/text.jsonl`, `subagent.jsonl`). Rule 12 could not show `plan_updated` without the adapter forcing that variable, which would offer the model a tool a terminal `claude` does not (D5's parity). Lane B therefore emits no `plan_updated` (an undeclared trait is a stream violation). **Owner to confirm**; the alternative is `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` in D4's env and `plan: true`.

The custom tool ops are declared only when the server layer hands over the custom tools port (`claudeCodeTraits({customTools})`), since rule 9 calls every declared op. `cancelRetry` is not a method (the CLI's retry is cancelled only by interrupting the run, Q13), so rule 29 checks nothing for retries; `cancelCompaction` is lane D's to decide (D70s).

### D39. Every live id the adapter mints is a random UUID; the CLI's own ids are used where they are unique

`ids.ts` is the one place for id formats: run, interaction and queue item ids are minted (`crypto.randomUUID()`, never reused in a session across CLI processes); a tool call is its API `tool_use` id; a block is `<message.id>:<index>`; a tool result item `<toolCallId>:result`; an image `<entryUuid>:<blockIndex>[:<innerIndex>]`; a child session `<sessionId>/<agentId>`; a command its name. The CLI's `request_id` of an ask is per process and is mapped to a minted interaction id by the desk, so a redelivered ask (fact 13) keeps its interaction and a new process never reuses one.

## Lane decisions

Each lane appends its decisions here, with the evidence (PLAN §8, §9).

### Lane A · Store (D40–D49)

### Lane B · Mapping (D50–D59)

### Lane C · Catalogue (D60–D69)

### Lane D · Live session (D70–D79)

### Lane E · Asks (D80–D89)

### Lane F · Ops (D90–D99)

### Lane G · Terminal (D100–D109)

### Lane H · App (D110–D119)

## Known gaps

- **D26 cannot be built on the contract as it is.** An ask raised on a session a terminal is writing (watch-only by D21: its `OpenSession` has no `control`) cannot be answered: the core routes every answer through `SessionControl.answer`, and both `core/controlled.ts:57-61` and `core/bridge-answer.ts:31-32` answer `unsupported` when `control` is absent. Giving the session a `control` whose other methods refuse would make it `controllable` (the composer would show). The port is typed (`ports/terminal.ts` `TerminalAskHandler`) and nothing is wired; the plan owner decides the contract change (STEP-3 §9).
