# Code review

> **Historical record.** Written before the rebuild (`docs/rebuild/PLAN.md`). It may describe the old protocol, backend ops, custom tools, Pi Durable, the Flutter app or protocol minors, none of which exist now. The README beside it describes the current code.

## Summary

This range extends the contract to protocol 1.4, adds the Claude Code adapter behind `claudeCode.contract`, and adds the matching app-core UI in `lib/agent/`. The core and adapter are carefully built. `check:layers`, `contract:check` and `typecheck` are clean, all 31 conformance rules pass against the real CLI, and the Dart answer and plan tests pass. I found one real minor-gating leak: Claude Code's `prompt_suggestion` extension reaches pre-1.4 clients through the capabilities list. I also found one gap in the conformance kit, one piece of unwired app code, and one unreachable hold edge case.

## Comments

### medium · Pre-1.4 clients are sent `prompt_suggestion` in `Capabilities.extensions`

- **Filename:** packages/bridge/src/core/minor-views.ts
- **Start line:** 64
- **End line:** 69
- **Comment type:** bug
- **Text:** `descriptorFor` filters only `capabilities.backendOps` by client minor, so the 1.4 enum value `prompt_suggestion` in `capabilities.extensions` (declared at `backends/claude-code/traits.ts:36`) goes to clients that never heard of it.
- **Why:** The contract's gating rule (README §12.4) is that the bridge never sends an enum value newer than the minor the client named in `hello`, and §12.4 says every check is in the core. The generated Dart `ExtensionKind.fromJson` throws `FormatException('Unknown ExtensionKind …')` (`lib/contract/generated/extensions.dart:25-28`), so an older app would fail to parse the Claude Code descriptor. This only bites with `claudeCode.contract` on, which defaults to off. No test or mutant covers it: `prompt_suggestion` appears only in `core_minor_four_events.test.ts` and `scripts/mutate-core/minor-mutants.ts`.
- **Checked:** ran `descriptorFor` from `minor-views.ts` with a fake client where `speaks = m => 3 >= m` and `CLAUDE_CODE_TRAITS` → printed `[ "rate_limit", "prompt_suggestion" ] [ "rewind_files" ]`. The ops were filtered and the extension was not.
- **Fix:** Add an `EXTENSION_ADDED_IN: Readonly<Record<ExtensionKind, number>>` table (`rate_limit: 0`, `prompt_suggestion: ADDED_IN_MINOR.configOps`) and filter `extensions` in `descriptorFor` the way `backendOps` is filtered. Add a core test for a 1.3 client's descriptor, and a `mutate-core` mutant for the new filter.

```ts
const extensions = descriptor.capabilities.extensions.filter((kind) => client.speaks(EXTENSION_ADDED_IN[kind]));
```

### low · Conformance rule 30 does not test `truncated ⇒ !editable` or `delete`

- **Filename:** packages/bridge/src/contract/testing/rules-files.ts
- **Start line:** 16
- **End line:** 50
- **Comment type:** bug
- **Text:** The rule never asserts the contract invariant that a truncated file is never editable, and it never sends a `delete` change.
- **Why:** README line 573 states "`truncated` … is never `editable`", and `EditableFile` (`contract/editable-file.ts:25-36`) has no `refine` for it. An adapter that returns `truncated: true, editable: true`, or that ignores the revision on `delete`, passes rule 30. There is also no negative adapter for either case. The Claude Code adapter itself sets the two flags consistently (`ops/custom-tool.ts` `fileOf`, `ops/file-view.ts` `refusalOf`), so this is a gap in the kit, not an adapter bug.
- **Checked:** traced `rules-files.ts:16-50` → the only `change` it builds is `{kind:"write"}`, and `file.editable`, `file.exists` and `file.format` are read only to pick a branch. `contract_negative_files.test.ts` (11 tests, all pass) has no case for either.
- **Fix:** In the rule, add `expect(!(file.truncated && file.editable), …)` right after each read. Also send `{kind:"delete", revision: OTHER_REVISION}` and expect `stale`, and send a delete on a non-editable file and expect `unsupported`. Add negative adapters in `contract_negative_files.test.ts` for each: an editable truncated file, and a delete that ignores the revision.

### low · `showProjectPanels` and `projectPanels` have no production caller

- **Filename:** lib/screens/agent/panels/panels_sheet.dart
- **Start line:** 41
- **End line:** 60
- **Comment type:** bug
- **Text:** The doc comment says a screen that lists projects offers the project panels for a row, but no screen calls these functions.
- **Why:** The project-level panels (`config_files`, `settings_overview`, `plugins`, all `OpPlace.project`) are reachable only from an open chat's More menu (`chat_header.dart:90`). A project with no open session has no way to reach them. The `OpPlace.backend` panels do have a caller (`session_list_actions.dart:25`). `showProjectPanels` is dead code that looks like a feature.
- **Checked:** ran `grep -rn "showProjectPanels\|projectPanels" lib test` → matches only in `panels_sheet.dart` and `test/screens/agent/project_panels_test.dart`.
- **Fix:** Call `showProjectPanels(context, backend, cwd:, name:)` from the project or directory row in `session_list_view.dart` (where `byDirectory` grouping already exists), or delete the two functions and the test and correct the comment.

### low · A hold does not carry over when its session is replaced

- **Filename:** packages/bridge/src/core/session-hub.ts
- **Start line:** 203
- **End line:** 217
- **Comment type:** bug
- **Text:** `holds` is keyed by the old session key. `replace` creates `next` under the new ref, so `reviewIdle(next)` sees no hold and idle-closes the session while the holder still believes it holds it.
- **Why:** This breaks the contract that a hold pins a session open until its `release` (core README §20). I did not find a reachable case: `SessionHost.conversationReset` emits `session_replaced` only for hosted sessions, not for the watch-only terminal sessions that holds exist for. The risk is a future adapter that replaces a held watch-only session.
- **Checked:** traced `session-hub.ts:66-85` (`hold` keys by `sessionKey(ref)`) → `:110-121` (`reviewIdle` tests `this.holds.has(live.key)`) → `:203-217` (`replace` builds `next` with the new key, holds untouched). Not run, and no trigger found in the adapter.
- **Fix:** In `replace`, move the hold count from the old key to the new one before `reviewIdle(next)`, and make `release(oldRef)` follow the move. Alternatively, document that a hold ends with its stream.

### low · `externalLive: false` understates what the watch-only tail emits

- **Filename:** packages/bridge/src/backends/claude-code/terminal/translate-state.ts
- **Start line:** 57
- **End line:** 57
- **Comment type:** non_actionable
- **Text:** The terminal tail emits `run_started` with `trigger: "external"`, while the adapter declares `externalLive: false` (`traits.ts:34`) and the capability is defined as "a run another client starts is reported live" (`contract/capabilities.ts:39`).
- **Why:** This is a recorded decision (D128: rule 27 needs the other client's run on a hosted session), and conformance passes because `stream-rules.ts` does not check external runs. The trait still describes the adapter less fully than it behaves. I did not check whether the app reads `externalLive` anywhere.
- **Checked:** `grep externalLive` in `src` (non-test) → the field is read only by `rules-lifecycle.ts:95`.

### low · Terminal-ask receiver and minor-view chain are well built

- **Filename:** packages/bridge/src/server/cc-terminal-hook.ts
- **Start line:** 55
- **End line:** 103
- **Comment type:** compliment
- **Text:** The receiver bounds the body without over-buffering (`readBounded`), caps pending asks at 64, ties `hold`/`release` to the request's lifetime including a client abort during the hold, and never answers on its own (an adapter that declines, a failed hold or a dropped client all end with `{}`). The `EncodedFrame.instead` chain in `core/older-events.ts` and `client.ts` is also correct at minors 1 to 4.
- **Checked:** traced the chain construction in `older-events.ts:451-463` against `client.ts:77` for clients at minors 1, 2, 3 and 4 → each gets the first stand-in its minor speaks.
