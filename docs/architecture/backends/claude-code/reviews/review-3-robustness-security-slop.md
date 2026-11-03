# Code review

## Summary
This range adds the Claude Code contract adapter (`backends/claude-code/`), the loopback terminal-ask hook, the CLI path and embedding wiring, the core `hold`/`release` calls, and the phone-side config panels. The adapter is carefully built. Config writes use compare-and-swap, atomic rename and realpath containment. I found no automatic answers and no session-id path traversal. Typecheck, the layer check and the sampled tests pass. One high bug breaks the terminal-ask feature in production: the real server resets requests after 10 s, and the tests mask it with `idleTimeout: 0`. Two medium data-loss paths remain in files that the new surface reaches.

## Comments

### high · Loopback server resets terminal-hook requests after 10 s
- **Filename:** packages/bridge/src/server.ts
- **Start line:** 215
- **End line:** 228
- **Comment type:** bug
- **Text:** `Bun.serve({...})` for the loopback listener sets no `idleTimeout`, so Bun's 10 s HTTP default applies to `/cc-terminal-hook` requests that are meant to stay open while a person decides.
- **Why:** The receiver in `server/cc-terminal-hook.ts` holds each request until the phone answers, and the hook is installed with `timeout: 86_400`. At 10 s Bun resets the connection and `request.signal` aborts. The ask is withdrawn from the phone and the CLI falls back to its own terminal prompt. Terminal asks therefore only work if answered within 10 s. The old `/cc-hook` waiter (10-minute timeout) has the same flaw.
- **Checked:** ran a `Bun.serve` whose handler sleeps 13 s, fetched from the same process (Bun 1.4.4) → `warn: Bun.serve() timed out a request after 10 seconds` and `ECONNRESET` after 12008 ms. Production `Bun.serve` at `server.ts:215` has no `idleTimeout`, while `hook_cli.test.ts:81`, `conformance/terminal-asks.ts:65` and `helpers/scripted-anthropic-server.ts:159` all set `idleTimeout: 0`, which is why tests miss it.
- **Fix:** Disable the idle timeout on the loopback listener, which is loopback-only. Add a test that runs the real `createBridgeServer` and answers an ask after more than 10 s.
```ts
secureServer = Bun.serve({
	hostname: "127.0.0.1",
	port: options.port,
	idleTimeout: 0,
	// ...
});
```

### medium · Old hook installer wipes a settings.json that fails to parse
- **Filename:** packages/bridge/src/handlers/cc_hook_installer.ts
- **Start line:** 42
- **End line:** 79
- **Comment type:** bug
- **Text:** `installCcHook` treats a parse failure as "create fresh" (`settings = {}`) and then overwrites the whole file with only the hook.
- **Why:** This runs on every bridge start for flag-off users, which is the default (`claude-code-hooks.ts:36-39`). A `settings.json` with a comment or trailing comma is replaced by `{hooks:{PreToolUse:…}}`, losing the user's `model`, `permissions` and everything else. The write is non-atomic and has no revision check. `uninstallCcHook` (`:132-150`) also reformats the whole file without a check, and `clearOldHook` calls it.
- **Checked:** ran `installCcHook` with a temp `HOME` whose `settings.json` was `{ // my notes\n "model":"opus", "permissions":{…},}` → the file afterwards held only `hooks.PreToolUse`.
- **Fix:** Route the old hook through the strict, compare-and-swap, atomic editor already written in this range (`terminal/hook-install.ts`). Refuse and log when the file is not valid JSON. Do not write when the parse fails.

### medium · Phone save can replace custom-tools.json with a single tool
- **Filename:** packages/bridge/src/custom-tools.ts
- **Start line:** 243
- **End line:** 309
- **Comment type:** bug
- **Text:** `loadCustomTools` returns `[]` on any read or parse error, and `saveCustomTool` then writes only the new tool with a non-atomic `writeFile`.
- **Why:** The new `custom_tool` op (`server/cc-custom-tools.ts:67-71`, `ops/custom-tool.ts`) lets the phone create tools, which makes this reachable. A hand-edited, truncated or half-written file silently loses every other tool on the next save. The per-tool lock in `ops/custom-tool.ts:85` does not protect the shared file.
- **Checked:** ran `saveCustomTool` with a temp `HOME` containing truncated JSON (`{"version":1,"tools":[{"id":"a","name":"keep_me"},`) → the file afterwards contained only tool `b`.
- **Fix:** Separate ENOENT from a parse error in `loadCustomTools` and make `saveCustomTool` refuse when the file exists but does not parse. Write through a temp file and `rename`. Serialise saves and deletes in the store, not per tool id.

### medium · Terminal-ask titles keep bidi override characters that hosted asks strip
- **Filename:** packages/bridge/src/backends/claude-code/terminal/hook-interaction.ts
- **Start line:** 73
- **End line:** 73
- **Comment type:** bug
- **Text:** The terminal-ask interaction title goes through `toolTitle` → `phoneLine` (`mapping/phone-text.ts:23`), which strips ANSI only, while hosted asks use `plain` (`ui/text.ts:9`), which also removes U+200E/F, U+202A-E and U+2066-9.
- **Why:** The ask card is where a person decides allow or deny. A command containing U+202E renders reordered on the phone, so the text shown can differ from what runs. There are also two sanitisers for one job, and only one covers bidi.
- **Checked:** ran a script with `Bash` input `echo safe \u202e# ;dm- fr` → terminal path title `"Bash: echo safe ‮# ;dm- fr"` (U+202E kept), hosted path title `"Bash: echo safe # ;dm- fr"`.
- **Fix:** Have one helper own the job. Add the `CONTROLS` strip from `ui/text.ts` to `withoutTerminalEscapes`, or make `phoneText` and `phoneLine` call `plain`. Add a test that the terminal ask title has no U+202E.

### low · Terminal hook is never removed on uninstall or when the bridge stops
- **Filename:** packages/bridge/src/server/shutdown.ts
- **Start line:** 46
- **End line:** 46
- **Comment type:** bug
- **Text:** With `claudeCode.contract` on, `keepsOldHook` is false, so shutdown removes nothing. Only `claude-code-hooks.ts` calls `removeTerminalHook`, so no uninstall path removes it.
- **Why:** A `PermissionRequest` hook, `NODE_EXTRA_CA_CERTS` and the bearer token stay in `~/.claude/settings.json` pointing at a dead port, indefinitely.
- **Checked:** not verified (grep shows `removeTerminalHook` is referenced only from `server/claude-code-hooks.ts` and its own module; I did not run a CLI against a refused hook, so whether the CLI treats it as non-blocking is untested).
- **Fix:** Call `removeTerminalHook` from `broski uninstall`, or at least document the leftover entry and how to remove it.

### low · Hook bearer token written to settings.json with the file's existing mode
- **Filename:** packages/bridge/src/backends/claude-code/terminal/hook-install.ts
- **Start line:** 112
- **End line:** 112
- **Comment type:** suggested_edit
- **Text:** The temp file is opened with the original file's mode, and `hook-settings.ts:118` puts `Authorization: Bearer <token>` in it.
- **Why:** `~/.claude/settings.json` is often 0644 and often kept in a dotfiles repo, so the loopback token is readable by other local users or can be committed. The listener is loopback-only and the token is not on a command line, so impact is limited.
- **Fix:** Document that the file now holds a token. Consider 0600 when the file is created or when our hook is added.

### low · Transient host can start after dispose has taken its snapshot
- **Filename:** packages/bridge/src/backends/claude-code/live/transient-host.ts
- **Start line:** 46
- **End line:** 62
- **Comment type:** bug
- **Text:** `registry.withHost` checks `disposing` at `registry.ts:131`, then `withTransientHost` awaits `launchOptions` and spawns a CLI that `endAll()` (`registry.ts:146-153`, which snapshots `transients`) never saw.
- **Why:** The process is closed only in `finally` after `work`. If `work` hangs (control requests have no timeout), the CLI child outlives dispose.
- **Checked:** not verified (traced `registry.ts:131-132` → `transient-host.ts:46-62` → `registry.ts:147`; no race reproduction).
- **Fix:** Re-check the registry's `disposing` flag after `await launchOptions(...)` and before `new HostProcess(...)`, and return `CLOSED` if set.

### low · Unused imports and a pointless `private` left in host.ts
- **Filename:** packages/bridge/src/backends/claude-code/live/host.ts
- **Start line:** 5
- **End line:** 74
- **Comment type:** suggested_edit
- **Text:** Biome reports unused imports (`AgentEvent`, `InteractionAnswer`, `Rejected`, `SessionControl`, `SessionEmitter`, `FrameMapper`, `MappedEvent`, `rejected`, `returnQueued`, `RunEndDeps`) and `private readonly start` used only as a constructor parameter.
- **Why:** These are extraction leftovers. The `lint` script warns, and so does `store/context.ts:5` and four test files. CI uses `--diagnostic-level=error`, so it does not catch them.
- **Checked:** ran `bunx biome check scripts/ src/` → 17 warnings, 7 files among them changed in this range.
- **Fix:** Run `bunx biome check --write` on the changed files, drop `private readonly` from `start`, and make `bun run lint` warning-free.

### low · Duplicated file helpers across the adapter
- **Filename:** packages/bridge/src/backends/claude-code/terminal/hook-install.ts
- **Start line:** 91
- **End line:** 143
- **Comment type:** suggested_edit
- **Text:** `indentOf` (here `:99` and `ops/settings-edit.ts:23`), `isMissing` (here `:140`, `ops/contained-path.ts:13`, `terminal/tail.ts:107`), JSON-object parsing (here `:91` and `ops/json-check.ts`), and four temp-then-rename writers (here `:109`, `ops/file-write.ts:32`, `store/line-journal.ts` `rewrite`, `models/catalog-cache.ts` `save`) do the same jobs separately.
- **Why:** The copies already differ. `ops/json-check.ts` strips a BOM and `hook-install.ts` does not, so a BOM file gets the misleading "is not a JSON object". The atomic-write rules (mode, fsync, compare-and-swap) have to stay in step in several places.
- **Fix:** Move one `isMissing`, one `indentOf`, one strict `parseObject` and one atomic writer into a shared module inside `backends/claude-code/` and have these callers import them. The layer rules allow this.

### low · Delete confirmation says the file cannot be recovered, but it goes to the Trash
- **Filename:** lib/screens/agent/panels/editable_file_view.dart
- **Start line:** 105
- **End line:** 110
- **Comment type:** bug
- **Text:** The dialog body reads "The file is removed from the Mac. This cannot be undone."
- **Why:** The adapter moves the file to the OS Trash (`ops/file-write.ts:80-89`, `trash.ts`), and custom-tool definitions are staged into the Trash too. The copy is wrong, it frightens users, and it hides that the file can be restored.
- **Checked:** traced `editable_file_view.dart:105-110` → `ops/config-file.ts:42` (`trashIfUnchanged`) → `trash.ts:40`.
- **Fix:** Change the body to something like "The file is moved to the Trash on the Mac."

### low · Fork-link journal is append-only and old links are silently dropped
- **Filename:** packages/bridge/src/backends/claude-code/store/fork-links.ts
- **Start line:** 1
- **End line:** 59
- **Comment type:** suggested_edit
- **Text:** `forks.jsonl` is appended to forever and never compacted, and only the last 4 MiB (`MAX_READ_BYTES`) is read back.
- **Why:** Past 4 MiB, the oldest fork parent links disappear with no signal. `owned.ts` already compacts its journal, so this is inconsistent.
- **Checked:** not verified (read `fork-links.ts` and `store/line-journal.ts`; I did not generate a large journal).
- **Fix:** Compact like `owned.ts` does: when the line count passes a limit, rewrite from the in-memory map through `LineJournal.rewrite`.

### low · Committed spike probes under scripts/cc-spike
- **Filename:** packages/bridge/scripts/cc-spike/compiled-probe.ts
- **Start line:** 1
- **End line:** 67
- **Comment type:** non_actionable
- **Text:** `scripts/cc-spike/` holds 303 lines of one-off probe scripts (`probe-lifecycle.ts`, `probe-refusal-fallback.ts`, `probe-side-requests.ts`, `compiled-probe*.ts`, and shell scripts).
- **Why:** They are referenced from `docs/architecture/backends/claude-code/research/08-spike.md` and PLAN D32, so they are intentional. They are not covered by CI, and `compiled-probe-old-path.ts` needs a temp `HOME` set by the caller, otherwise it reads real `~/.claude` and `~/.broski`.
- **Fix:** Keep them if the docs need them. Otherwise delete them and keep the findings in `08-spike.md`.

### low · Settings edits go through a lossy JSON round trip
- **Filename:** packages/bridge/src/backends/claude-code/ops/settings-edit.ts
- **Start line:** 41
- **End line:** 51
- **Comment type:** non_actionable
- **Text:** `editSettings` re-serialises with `JSON.parse` then `JSON.stringify`.
- **Why:** Duplicate keys collapse, and a number outside double range (`1e400`) becomes `null` in the written file. Key order, indent and every other key are preserved, and `faithful` guards UTF-8 loss, so this is rarely hit.
- **Fix:** No change needed. If it matters, refuse the edit when `JSON.stringify(JSON.parse(text))` differs from a normalised form of `text` by more than whitespace.

### low · Config-write path is well built
- **Filename:** packages/bridge/src/backends/claude-code/ops/file-write.ts
- **Start line:** 21
- **End line:** 77
- **Comment type:** compliment
- **Text:** `writeIfUnchanged` is a compare-and-swap write done properly: it re-reads under a per-path lock, refuses to rewrite a non-faithful file, preserves the mode, fsyncs a temp file, and uses a hard link for create-only.
- **Why:** Together with `containedPath` (realpath of the deepest existing ancestor, dangling-link check) and read-only managed files, no user config write in this range can half-write or overwrite a concurrent change.
