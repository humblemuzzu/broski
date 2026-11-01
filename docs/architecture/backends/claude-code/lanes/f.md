# Lane F · Ops (D90–D99)

> Merged in Step 5 (`cc/integrate`). This file is the lane's record as delivered; where the adapter [README](../README.md)'s integration decisions D120–D129 changed something here, the README wins.

Files: `packages/bridge/src/backends/claude-code/ops/*` (34 files, none over 253 lines); tests `packages/bridge/src/__tests__/claude-code/ops/` (10 test files and `ops-world.ts`; 4 tests run the real bundled CLI, most of the others the SDK's real settings reader in its worker, the rest a scripted `FakeQuery`). Paths below are relative to `ops/`. `d.ts:N` = `sdk.d.ts`; `mjs` = `sdk.mjs`; `bin` = strings of the 2.1.316 `claude` binary.

## Decisions

### D90. Config files are addressed by `<kind>:<scope>[/<path below the directory>]`; only a directory kind creates files

`config-paths.ts` is the one place that knows where the CLI reads: settings user/project/local (managed on macOS `/Library/Application Support/ClaudeCode`, Linux `/etc/claude-code`, read-only), `.mcp.json`, CLAUDE.md (user, `./CLAUDE.md`, `./.claude/CLAUDE.md` listed only when it exists, `./CLAUDE.local.md`, managed read-only), auto memory `projects/<every non-alphanumeric as ->/memory/` (research 05 §2.8: the `autoMemoryDirectory` doc string in `bin`; `autoMemoryDirectory` from any source but project wins), and `agents/`, `commands/`, `skills/<name>/SKILL.md`, `output-styles/` under the config dir and `<cwd>/.claude/`. All relative to `ClaudeSdk.configRoot()` (D36), never `os.homedir()`. A `template` entry is the directory; `config_file` with a `name` answers the new file under its own id (`agents:project/reviewer.md`), with a starting text. A name must match `[A-Za-z0-9][A-Za-z0-9_.-]{0,99}` (a trailing `.md` is dropped); an id inside a directory must be `.md` (skills: exactly `<name>/SKILL.md`), with no segment starting with `.`, at most 4 segments. `~/.claude/memory` (the old wrong directory) and `~/.claude.json` are never listed.

Project/local settings are `<cwd>/.claude/settings{,.local}.json`, or the path `resolveSettings` reports for that source when the file exists (`sources[].path`): evidence below.

### D91. The writer: strict, schema-checked by the CLI's own reader, contained, compare-and-swap, atomic

- **Revision** = `sha256-<hex>` of the bytes; `absent` for a file that does not exist. Text is `ignoreBOM` so a byte order mark round-trips; a file that is not UTF-8, is not a regular file (a named pipe is never opened: `file_layer.test.ts`), or is longer than `MAX_TEXT_CHARS` is `truncated`/`faithful: false` and never `editable`.
- **Validation (invalid_input).** JSON files: strict `JSON.parse` of a top-level object; `.mcp.json`: `mcpServers` an object. **Settings files additionally go through the CLI's schema**: `settings-schema.ts` writes the candidate text as a scratch project's local settings and asks `resolveSettings({cwd: scratch, settingSources: ["local"]})` whether anything loaded. This exists because the CLI's engine drops the **whole file**, valid keys included, on any schema mismatch (run: `{"model":5,"language":"x"}` loads nothing; `{"enabledPlugins":{"o@m":{"version":"1.2"}}}` loads nothing, an array value loads, `__proto__` keys are dropped; `settings_schema.test.ts`). An existing file that parses but loads nothing gets a `problems` entry saying so (compared against `resolveSettings` `sources[].path`).
- **Containment.** `contained-path.ts`: lexical check, then the real path of the deepest existing ancestor must stay inside the real base; a dangling link is refused. A link that stays inside is followed (the write goes to its target and the link survives). A link out of the base is `unsupported` (editable false, never read). Cost for dotfile users: a `~/.claude/settings.json` symlinked outside `~/.claude` is listed read-only.
- **Atomic.** Temp file in the target's directory (`.<name>.<random>.tmp`, mode of the file it replaces), `fsync`, re-check of the revision, `rename`; a new file appears with `link` (fails with `EEXIST` → `stale` if it appeared meanwhile; no hard links → re-check and rename). One writer per path at a time inside this bridge (`serialized.ts`). **Not covered:** the window between the last revision check and `rename` against another process (the CLI, an editor) writing the same file; there is no cross-process lock.
- **Delete** (`delete{revision}`): `trash <real path>` spawned with `services.cliEnv`'s `PATH`, so a test world puts a fake `trash` first (`ops-world.ts` always does: no test can reach the real Trash); the file stays when the command fails. Same convention as Pi's `trashFile`. For `custom_tool` the port's `remove` is used (D98).

### D92. `mcp_servers` never writes `~/.claude.json`: the CLI's `mcp_toggle` persists the toggle itself (contradicts the brief, PLAN D22 and research 05 §4)

Run (`real_cli.test.ts`): `toggleMcpServer("elicit", false)` on a live host rewrote `<configDir>/.claude.json` with `projects[<cwd>].disabledMcpServers: ["elicit"]` and left every other key (`machineID`, `userID`, `mcpServers`, `pluginUsage`…) byte-equal in value; re-enabling emptied the list; a `.mcp.json` server toggled the same way (`STATUS3 … projsrv disabled`, no `.claude/settings.local.json` written). In the binary: the `mcp_toggle` handler calls `PGt` → `Dit(mh, …)` (`disabledMcpServers`, or `enabledMcpServers` for its one opt-in server) with the CLI's own locked writer (`bin`: `saveConfigWithLock … refusing to write to avoid wiping ~/.claude.json`). A second writer from the bridge would race the CLI's on a file that holds the account. The global config is `$CLAUDE_CONFIG_DIR/.claude.json` when that variable is set, else `~/.claude.json` (`mjs` `w3(e)`). The adapter's ops pass through `Query.toggleMcpServer` / `reconnectMcpServer` and the test world asserts no `.claude.json` is created by them. Actions per row: `disabled` → enable; `connected`/`failed` → reconnect + disable; `pending`/`needs-auth` → disable; `managed`/`enterprise` sources → no toggle; `needs-auth` is reported ("sign in from a terminal"), not fixed. Credentials in a URL or argument list are never shown (origin / command basename only).

### D93. `plugins` rows are `enabledPlugins` as the cascade resolves it; enable/disable writes local settings, then reloads a live host

Per plugin: the effective value, its highest tier (`sources` low→high), `managed` → no action. Enable writes `true`, disable `false`, in `settings:local` through `settings-edit.ts` (all other keys kept, the file's indentation kept, schema-checked before and after, a file that does not parse or is skipped is never repaired). A local value that is a version list is never overwritten by a disable (`unsupported`). With a `sessionId`: `reloadPlugins({holdOnCacheImpact: host.busy()})`; a held reload, a failed reload, and an idle session each say so in `note` while the saved change stands. Rows from `system/init` `plugins`/`plugin_errors` are **not built**: `HostView` does not expose the last init frame (port gap below). `reloadPlugins` run: the loaded set includes `cc-plugin-*@builtin` plugins that `enabledPlugins` never names.

### D94. `session_settings` serves three settings; the others in D22's list are not real here

- `outputStyle` (choice): options `available_output_styles` of `catalogue.initialize(cwd)` plus the current value; saved with the host's own `updateSettings("localSettings", {outputStyle})` (live-applies; the allowlist and reformatting are Q8/D34) or, with no host, the local settings file through the same editor.
- `autoMemoryEnabled` (default on: `bin` `uI(){…return!0}`), `promptSuggestionEnabled` (default on unless `false`: `bin` `K1n`, `d.ts:2116-2133`): saved in **user** settings, where `/memory` and `/config` save (`bin`). Notes say when `CLAUDE_CODE_DISABLE_AUTO_MEMORY` / `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` in the CLI's env, a higher tier, or policy decides the value; a managed key is `unsupported`.
- Left out, with reasons: **fast mode** (state only arrives in frames the ops cannot see; `d.ts:6013`, `6128`, `6290`), **1M context** (the default models already run 1,000,000 tokens: `getContextUsage` reported `maxTokens: 1000000`; the beta is Sonnet 4/4.5 only, `d.ts:1773`), **language** (free text: `config_file` on settings), effort (`setThinking`, lane D).

### D95. `settings_overview` is `resolveSettings` + `filterEscalatingDefaultMode`, with problems first and no secret in a value

Rows: Problems (a settings file that does not parse or that the schema skips; a project's escalating `defaultMode` the filter dropped), Account (the catalogue's `initialize().account`), Permissions (default mode + every rule, highest tier first, deny/ask/allow with tones and the tier as a badge), Settings (one row per effective key, sorted, tier badge; `managed (<policyOrigin>)` with a "managed by policy" status). `env`, `mcpServers`, `hooks`, `headers` show names only and any key matching token/secret/password/… is masked (`settings-preview.ts`). No actions.

### D96. `changed_files` folds the transcript's own tool results

`SessionStore` has no `changedFiles`, so the op pages `store.transcript` newest-first (200 per page, at most 60 pages = 12,000 items) and folds `fileChanges` of `completed` tool results per path (edits, additions, deletions), most edited first, as Pi does. A longer transcript is silently incomplete: the result has no field to say so.

### D97. `rewind_files`, `context_usage` and `mcp_servers` use `withHost` (a transient host when nothing hosts the session)

`rewind_files`: `store.locate` (unknown session → `not_found`), `store.entryOf` (the item must be a `user` entry: `invalid_input`), then `host.query.rewindFiles(entry.uuid, {dryRun})`; a real rewind on a busy host answers `busy`; `canRewind:false` + the CLI's `error` is an answer. Run: previews and restores a Write turn's file on a live CLI (`userItemId` = the `uuid` the send carried, D37). `tasks` and `session_settings` use `withLiveHost` (no tasks for a session nobody hosts).

### D98. Custom tools: the port only; templates are remembered

Both ops are `unsupported` without `services.customTools`. `custom_tool` renders a definition as 2-space JSON text, revision = hash of that text; compare-and-swap, strict JSON object, `JsonValue` bounds, the port's `save` problems become `invalid_input`; per-tool serialization. A template's id is remembered (last 50, per port) so a write to it is not `not_found`. Delete goes through `port.remove`: **the server layer's implementation should move the definition to the Trash like `config_file` does**; lane F cannot, since the storage is behind the port.

### D99. The config watcher is delivered, not wired

`config-watch.ts` `createConfigWatch({configRoot, catalogue})` → `start()`, `track(cwd)`, `dispose()`: watches the user's `commands/ skills/ agents/ output-styles/` folders and each tracked project's `.claude/` ones (recursive, a folder that does not exist yet is picked up when it appears), debounced 300 ms, then `catalogue.invalidate(cwd | undefined)`. Nothing else in `~/.claude` fires it (`projects/` transcripts are never watched). **Integration** creates it in `factory.ts` with `services.sdk.configRoot()` and the catalogue, calls `start()` after construction, `track(cwd)` when a host opens for a cwd, and `dispose()` first in `backend.dispose()`. `config_file` writes to those folders and `plugins` changes call `catalogue.invalidate(cwd)` themselves.

## Facts that contradict the plan or the research

1. **`mcp_toggle` persists** (D92). PLAN D22 / research 05 §4 / the brief say the bridge writes the per-project list.
2. **A settings file the schema rejects is skipped whole** and `resolveSettings` shows it as absent from `sources` (research 05 fact 1 only names JSON errors and "schema mismatch"). The object form of `enabledPlugins` (`{"version": …}`) that `d.ts:7733` allows (`[k: string]: unknown`) fails the CLI's schema; a string list passes.
3. **Project and local settings are read at `<cwd>/.claude/…`** for a cwd that is a subdirectory of a git repo (run: root-level local settings were not merged for `cwd = root/sub`), against research 05 §3.1 ("canonical root"). The ops use `sources[].path` where the file exists, the cwd path otherwise.
4. **Calling `resolveSettings` from a test process reads the real `~/.claude`** (D36): one exploratory run did, read-only, before the rest used the worker-backed `createClaudeSdk({configDir})`; no test in the lane does.
5. `autoMemoryEnabled` and `promptSuggestionEnabled` default to on (D94).

## Port and integration needs

- **Port gap (optional):** `HostView` exposes no `system/init` data. A `plugins()` (name, version, errors) and `fastModeState()` on it would let `plugins` list loaded and failed plugins and `session_settings` offer fast mode. Nothing blocks without it.
- **Integration:** wire `createConfigWatch` (D99); replace `T/foundation/backend_skeleton.test.ts`'s "not built" assertion (it now fails by design: all 13 ops are built); lane A's `entryOf` must answer a user message's item id with `{type: "user"}` and `locate` must know a session before its file exists only if it is hosted (`rewind_files` calls `locate` first); the factory's `env.PATH` decides which `trash` runs.
- **Unverified here:** `stopTask` and the `tasks` rows against a real background task (declaration + `mjs` `stop_task` only; the fake-query tests cover the op); `changed_files` over lane A's real transcript (fake store); the conformance suite (skipped until Step 5).
