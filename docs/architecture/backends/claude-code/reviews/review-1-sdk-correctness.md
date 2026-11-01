# Code review

## Summary

This range adds a Claude Code adapter on `@anthropic-ai/claude-agent-sdk` 0.3.316 (bundled CLI 2.1.316), with its session store, ask desk, terminal-hook receiver, executable resolution and server wiring. The SDK is used correctly almost everywhere. Options, control calls, callback replies, frame mapping, paging order and the hook settings shape all match `sdk.d.ts`, `sdk.mjs` and the recorded frames. The two findings that matter are a session-title source that is mislabelled because the SDK folds AI titles into `customTitle`, and an unconditional `allowDangerouslySkipPermissions` that probably stops every hosted session when the bridge runs as root. Typecheck passes. The mapping, store, live, asks, foundation and terminal tests pass (370 and 368 passed, 0 failed), including the real-CLI ones.

## Comments

### medium · Title source mislabelled: SDK folds AI titles into `customTitle`

- **Filename:** packages/bridge/src/backends/claude-code/store/rows.ts
- **Start line:** 22
- **End line:** 25
- **Comment type:** bug
- **Text:** `titleSource` treats `info.customTitle` as the user's `/rename` title, but the SDK also fills `customTitle` from the AI-generated title, and `summary` from the last prompt.
- **Why:** The title source is wrong for most real sessions. An AI-generated title is reported as `user`. A last-prompt title is reported as `generated`; the test at `real_cli.test.ts:106` expects exactly that. `first_prompt` is only reachable for one-prompt sessions. The `d.ts` comment ("User-set session title via /rename") does not match the implementation.
- **Checked:** ran a script calling `getSessionInfo` on a transcript with an `{"type":"ai-title","aiTitle":"Fix login bug"}` line → `{"summary":"Fix login bug","customTitle":"Fix login bug","firstPrompt":"fix the login bug please"}`. Also read `sdk.mjs` `ml()`: `d=Qt(s,"customTitle")||r||Qt(o,"customTitle")||Qt(s,"aiTitle")||Qt(o,"aiTitle")`, then `g=d||Qt(s,"lastPrompt")||…||p`. The 2.1.316 binary writes `ai-title` and `last-prompt` entries.
- **Fix:** Take the source from the transcript instead of `customTitle`: `custom-title` entry → `user`, `ai-title` entry → `generated`, neither → `first_prompt`. `store/raw-scan.ts` already reads the tail. Update `real_cli.test.ts:106` to match.
```ts
function titleSource(info: SDKSessionInfo, kinds: { custom: boolean; ai: boolean }): TitleSource {
	if (kinds.custom) return "user";
	return kinds.ai ? "generated" : "first_prompt";
}
```

### medium · `allowDangerouslySkipPermissions: true` on every host likely stops all sessions as root

- **Filename:** packages/bridge/src/backends/claude-code/process/options.ts
- **Start line:** 37
- **End line:** 37
- **Comment type:** bug
- **Text:** Every host passes `allowDangerouslySkipPermissions: true`, which the SDK turns into `--allow-dangerously-skip-permissions`, and the CLI exits 1 on that flag when running as uid 0.
- **Why:** On a root-run bridge (container or VPS) no session can start. The probe omits the flag (`probe.ts:37-46`), so the catalogue still looks healthy. Hosts do not set `CLAUDE_CODE_STARTUP_FAILURE_RESULTS` (only the probe does, `probe.ts:40`), so the typed `bypass_root` reason that `models/startup-failures.ts` already words never reaches the app. The user sees only "Claude Code process exited with code 1. stderr: …".
- **Checked:** not verified. The 2.1.316 binary contains `if(s==="bypassPermissions"||r){if(typeof process.getuid==="function"&&process.getuid()===0&&process.env.IS_SANDBOX!=="1"&&!i.CLAUDE_CODE_BUBBLEWRAP)console.error("--dangerously-skip-permissions cannot be used with root/sudo privileges…"),…reason:"bypass_root"…process.exit(1)`. I could not prove that `r` is the allow flag, because the function head is minified. I did not run it as root.
- **Fix:** Pass the flag only when not root or when `IS_SANDBOX=1`. Drop `bypassPermissions` from the offered modes in `modes.ts` in that case. Add `CLAUDE_CODE_STARTUP_FAILURE_RESULTS=1` to `process/env.ts` so startup refusals reach `outcome.ts:92` typed.
```ts
const mayBypass = process.getuid?.() !== 0 || input.services.cliEnv.IS_SANDBOX === "1";
// ...
...(mayBypass && { allowDangerouslySkipPermissions: true }),
```

### low · "Denied" is detected by English wording while the CLI sends structured metadata

- **Filename:** packages/bridge/src/backends/claude-code/mapping/tool-outcome.ts
- **Start line:** 13
- **End line:** 25
- **Comment type:** suggested_edit
- **Text:** `failureOutcome` classifies a refusal by text prefixes, but the live `user` frame carries `tool_result_meta[].permission_decision`, which is unused.
- **Why:** A wording change in a CLI bump silently turns `denied` into `failed`. The fixture `permission-deny.jsonl` already shows a denial ("Not that file.") classified as `failed`, while its `tool_result_meta` says `{"decision":"reject","source":"user_reject"}`.
- **Checked:** traced `fixtures/frames/permission-deny.jsonl` user frame → `mapping/user-input.ts:44-53` → `tool-outcome.ts:22-25`. `lanes/b.md:56` records `tool_result_meta` as seen and unused.
- **Fix:** In the live path, prefer `tool_result_meta[].permission_decision.decision === "reject"` and mark the call denied before falling back to the prefixes. Keep the prefixes for history, where the metadata is not in the transcript.

### low · Session list drops worktree sessions that `listSessions({dir})` includes

- **Filename:** packages/bridge/src/backends/claude-code/store/list.ts
- **Start line:** 129
- **End line:** 129
- **Comment type:** non_actionable
- **Text:** A session is kept only if `info.cwd` equals the requested cwd or its realpath, while the SDK's `listSessions({dir})` also lists the project's git worktrees by default.
- **Why:** Sessions started in a worktree of a project do not appear in that project's list. This looks like a deliberate contract choice, but PLAN D15 says rows come from the SDK's listing, so the difference should be stated.
- **Checked:** read `sdk.d.ts:1161-1166` (`includeWorktrees` defaults to true) and `sdk.mjs` `Z0`/`jwe` (expands worktree paths).

### low · `contextTokens` will almost always be absent

- **Filename:** packages/bridge/src/backends/claude-code/mapping/usage.ts
- **Start line:** 30
- **End line:** 43
- **Comment type:** suggested_edit
- **Text:** `contextTokensOf` reads `result.usage.iterations`, which is `[]` in every recorded result frame.
- **Why:** The context-window figure then depends on a field the real CLI fills only on some API paths, so the UI will usually show none.
- **Checked:** read `fixtures/frames/text.jsonl`, `compaction.jsonl` and `retry-529.jsonl` → `"iterations": []`. The README lists this as unverified.
- **Fix:** Take the figure from `query.getContextUsage({detail:"summary"})` (already used by `ops/context-usage.ts`) when a number is needed, or document the gap.

### low · Probe skips the D5 callbacks

- **Filename:** packages/bridge/src/backends/claude-code/process/probe.ts
- **Start line:** 37
- **End line:** 46
- **Comment type:** non_actionable
- **Text:** The probe sets no `canUseTool` or `onElicitation` and uses `persistSession:false`, against the D5 rule "onElicitation always set".
- **Why:** The effect is nil today: no turn runs, and without `onElicitation` the SDK declines automatically (`sdk.d.ts:1797-1799`). It still starts the user's MCP servers on every probe, because `settingSources` is omitted. A comment citing D5 would stop a later reader from "fixing" it.
- **Checked:** read `sdk.d.ts:1797-1799` and `sdk.mjs` `processControlRequest` (`elicitation` without a handler returns `{action:"decline"}`).

### low · Per-subagent summary calls are on for every host

- **Filename:** packages/bridge/src/backends/claude-code/process/options.ts
- **Start line:** 40
- **End line:** 40
- **Comment type:** non_actionable
- **Text:** `agentProgressSummaries: true` makes the CLI fork each running subagent's conversation about every 30 seconds to produce a summary.
- **Why:** Each fork is a billed model call on the user's account. It reuses the prompt cache, so the cost is small, but it is not free and not visible to the user.
- **Checked:** read `sdk.d.ts:2135-2143`.

### low · SDK worker is not a compile entrypoint

- **Filename:** packages/bridge/src/backends/claude-code/sdk/worker-client.ts
- **Start line:** 89
- **End line:** 89
- **Comment type:** suggested_edit
- **Text:** `new Worker(new URL("./sdk-worker.ts", import.meta.url))` needs `sdk-worker.ts` as an entrypoint of `bun build --compile`, but `scripts/build.sh:162-164` passes one.
- **Why:** It is unreachable in production because `configDir` is test-only (`services.ts:19`). If anyone sets it in a compiled bridge, the first session call fails with a module-not-found error.
- **Checked:** read `scripts/build.sh:162-164` and `services.ts:19`.
- **Fix:** Add the worker as a second entrypoint to the compile command, or make `createClaudeSdk` refuse `configDir` when `isCompiledBinary()`.

### low · SDK version is read through a relative `node_modules` path

- **Filename:** packages/bridge/src/server/claude-code-backend.ts
- **Start line:** 9
- **End line:** 9
- **Comment type:** non_actionable
- **Text:** `import sdkPackage from "../../node_modules/@anthropic-ai/claude-agent-sdk/package.json"` works only while the package sits in `packages/bridge/node_modules`.
- **Why:** Hoisting dependencies to a workspace root, or a different install layout, would break the import. The SDK's `exports` map has no `./package.json` entry, so a package-style import is not available.
- **Checked:** the path exists in this checkout; `package.json` carries `claudeCodeVersion` `2.1.316`.

### low · Store reads undeclared `SessionMessage` fields

- **Filename:** packages/bridge/src/backends/claude-code/store/message-parts.ts
- **Start line:** 42
- **End line:** 52
- **Comment type:** non_actionable
- **Text:** `entryTimestamp` and `isCompactSummary` read fields that `SessionMessage` (`sdk.d.ts:6809`) does not declare.
- **Why:** They are present at runtime and the exact pin keeps them safe, but a type-only upgrade will not warn if the SDK drops them.
- **Checked:** read `sdk.mjs` `$R()` → returns `timestamp`, `isCompactSummary:true`, `is_meta`, `origin`, `isQueuedCommand`.

### low · Frame table is typed over the SDK union

- **Filename:** packages/bridge/src/backends/claude-code/mapping/frame-kinds.ts
- **Start line:** 24
- **End line:** 116
- **Comment type:** compliment
- **Text:** `FRAME_KINDS` is a `Record<FrameKey, Disposition>` keyed by every `type/subtype` of `SDKMessage`, and `UNDECLARED_FRAMES` lists the frames the CLI sends outside the union (`command_lifecycle` and others).
- **Why:** An SDK bump that adds a frame fails the type check until someone decides what it shows. The undeclared ones are named rather than discovered in production. The recorded-frame fixtures back both.
