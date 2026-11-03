# The new Claude Code in the normal app: where each feature is

Step 7 audit of PLAN §10, row by row, with the new Claude Code selected (AI Backend → *Claude Code (new)*, which the picker lists only while the bridge has `"claudeCode": {"contract": true}`). Every place below is in the normal app; there is no dev-only screen. Test paths: `test/…` are Flutter tests, `src/__tests__/…` are bridge tests under `packages/bridge/`. "Generic" means the test drives the shared `lib/agent/` screens with the scripted bridge; the Claude Code-specific end of the same feature is cited beside it where one exists.

How a person gets there:

- **Sessions tab**: the list (`ContractSessionsTab`), its header (title filters, More = backend panels, new session), a row's ⋯ actions, a row's tap (the chat).
- **Projects tab**: a row's tap (new session there), a row's long press (continue latest, project configuration).
- **Chat**: the app bar (copy last answer, *Model and modes*, compact, More), a message's actions (long press at the bubble's edge, or the screen reader's *Actions from here*), the composer, the ask sheet, the Stop bar.

| PLAN §10 row | Where the user finds it | Proving test |
|---|---|---|
| Sessions tab, project grouping, search, sort | Sessions tab: the list, search field, order menu, directory menu, group toggle | `test/screens/contract/claude_code_selection_test.dart` (the tab lists Claude Code sessions over the contract, no `cc_*` sent); `test/screens/agent/session_list_tools_test.dart` |
| Title filters | Sessions tab header → filter button → *Title Filters* sheet (plain text or `/regex/`, per backend) | `test/screens/contract/title_filters_test.dart` |
| Session previews, subagent rows, orphan subagent dirs | Sessions rows; row ⋯ → *Subagents* | `test/screens/agent/children_test.dart`; `src/__tests__/claude-code/store/children.test.ts` |
| Diff-stat badges | dropped (owner, 2026-11-01); chat More → *Changed files* instead | `test/screens/agent/copy_and_changes_test.dart` "the files a session changed" |
| Active/working pill | Sessions row pill *Running* / *Waiting for you* | `test/screens/agent/session_list_test.dart` "a row shows its run while it lasts" |
| Rename, delete | row ⋯ → *Rename*, *Delete* (asks first, claims no permanence) | `test/screens/agent/session_list_test.dart` "a rename asks…"; `test/screens/agent/session_openers_test.dart` "a delete asks first…"; conformance rule 8 on the real CLI |
| Open session, load earlier, big transcripts | row tap → chat; scroll up loads earlier pages | `test/screens/contract/claude_code_selection_test.dart` (opens a Claude Code chat); `src/__tests__/claude-code/store/scale.test.ts`; conformance rule 7 |
| Tool results and diffs in history, hidden command echoes | chat timeline | `test/screens/agent/timeline_builder_test.dart`; `src/__tests__/claude-code/store/real_cli_tool_results.test.ts` |
| Subagent transcript | row ⋯ → *Subagents* → a child; a subagent tool card's link | `test/screens/agent/children_test.dart` |
| Offline transcript, prefetch | Sessions, Projects and a chat opened before, with the link down (read-only banner) | `test/screens/agent/offline_test.dart`; `test/screens/contract/contract_backend_flow_test.dart` "with the link down…" |
| Copy/export transcript | chat app bar → copy last answer; chat More → *Copy conversation*; a message's actions → *Copy text*. Export as a file: not for Claude Code (no op) | `test/screens/agent/copy_and_changes_test.dart` |
| Modified files sidebar | chat More → *Changed files* (`changed_files`) | `test/screens/contract/claude_code_reachability_test.dart`; `test/screens/agent/copy_and_changes_test.dart` |
| Streamed text, thinking, tool cards by tool | chat timeline | `test/screens/agent/chat_screen_test.dart`; conformance rules 10–12 |
| Todos | not shown: Claude Code declares `plan: false` (README D38, owner to confirm) | — |
| Compaction divider, retry banner, errors, refusal line | chat timeline and banners; app bar → compact | `test/screens/agent/run_cancel_test.dart`; conformance rule 22; `src/__tests__/claude-code/mapping/outcome_usage.test.ts` |
| Token usage / cost, context bar | chat title line (tokens, cost, `context/window`); chat More → *Context usage* | `test/screens/contract/claude_code_reachability_test.dart` (`context_usage`); `src/__tests__/claude-code/live/context_after_run.test.ts` |
| Structured output | never produced: the adapter sets no `outputFormat`, so the CLI sends no `structured_output` (lane B, `mapping/frame-kinds.ts`) | — |
| Hook activity cards | chat timeline: one compact row per hook (name · event · outcome · duration), tap to unfold the output; live and in history | `test/screens/agent/activity_card_test.dart`; `src/__tests__/claude-code/integration/hook_activity.test.ts` (real CLI, live and history) |
| Background task cards, stop task | chat More → *Background tasks* (Stop asks first) | `test/screens/contract/claude_code_reachability_test.dart` (`tasks`); `src/__tests__/claude-code/ops/live_lists.test.ts` |
| Tool-use summaries, files persisted | not shown, by lane B's decision: `tool_use_summary` comes only with `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES`, `files_persisted` has no place (`mapping/frame-kinds.ts`; every kind's reason is checked by `src/__tests__/claude-code/mapping/frame_table.test.ts`) | `src/__tests__/claude-code/mapping/frame_table.test.ts` |
| Rate-limit info | the chat's notices strip (`rate_limit` extension) | `test/agent/session/session_extensions_test.dart`; `src/__tests__/claude-code/mapping/side_frames.test.ts` |
| Prompt suggestions | chip above the composer; the toggle in chat More → *Session settings* | `test/screens/agent/prompt_suggestion_test.dart`; `src/__tests__/claude-code/integration/prompt_suggestion.test.ts` |
| Auth status, local command output | AI Backend picker subtitle and Sessions tab say why it is not usable; notices | `src/__tests__/claude-code/catalogue/catalogue.test.ts`; `test/screens/contract/claude_code_selection_test.dart` |
| Subagent attribution and live progress | nested under the tool card that runs it | `test/screens/agent/children_test.dart` |
| External (terminal) session live view, external prompt | a recently written session opens watch-only (note instead of composer); chat More → *Open as fork* continues it here | `test/screens/agent/watched_answers_test.dart`; `test/screens/agent/session_openers_test.dart`; `src/__tests__/claude-code/terminal/watch_live_cli.test.ts` |
| Reconnect replay | automatic on reconnect | `test/agent/session/` (attach, replay, snapshot) |
| Send prompt, images, file and agent mentions, slash commands | composer (image button, `@` mentions, `/` commands) | `test/screens/agent/composer_shell_test.dart`; conformance rule 13 |
| Queued message | composer while running → queue; queue chip ✕ cancels | `test/screens/agent/chat_screen_test.dart`; conformance rule 18 |
| Resume from this message | a message's actions → *Fork through this* / *Fork just before this* | `test/screens/contract/claude_code_reachability_test.dart` (`fork:through`); `test/screens/agent/copy_and_changes_test.dart` |
| Stop, stop while an ask is pending, offline stop | Stop bar | `test/screens/agent/chat_screen_test.dart`; conformance rule 19 |
| Model picker, 1M context | chat → *Model and modes*; 1M: every model already runs with 1,000,000 (README D157), no toggle | `test/screens/contract/claude_code_reachability_test.dart` (refresh models beside the picker); `src/__tests__/claude-code/spike/context_window_fast_mode.test.ts` |
| Thinking / effort, fast mode, quick settings | chat → *Model and modes* (effort); chat More → *Session settings* (fast mode after the first turn on Opus/Default, prompt suggestions, auto memory, output style) | `src/__tests__/claude-code/integration/fast_mode.test.ts` (real CLI); `src/__tests__/claude-code/ops/fast_mode_plugins.test.ts`; `test/screens/agent/session_control_panels_test.dart` |
| Permission-mode chip incl. plan, bypass | chat → *Model and modes* → permissions axis | conformance rule 21; `src/__tests__/claude-code/catalogue/catalogue.test.ts` |
| Allowed/disallowed tools lists | project configuration → *Configuration files* → settings; *Settings in effect* | `test/screens/contract/project_rows_test.dart`; `src/__tests__/claude-code/ops/settings_overview.test.ts` |
| SDK approval prompt, always-allow rules | the ask sheet | `test/screens/agent/interaction_sheet_test.dart`; conformance rule 23 |
| Terminal-session approval | a terminal's ask shows on the watch-only session with *Answer* | `test/screens/agent/watched_answers_test.dart`; conformance rule 31 on the real CLI |
| Pending approvals after reconnect, lock-screen approval | the ask bar after reconnect; the notification's allow/deny | `test/agent/session/`; `src/__tests__/claude-code/integration/run_end_asks.test.ts` |
| AskUserQuestion, MCP elicitation | the ask sheet | `test/screens/agent/interaction_sheet_test.dart`; conformance rule 23 |
| Undo a turn's file changes | a user message's actions → *Rewind files* | `test/screens/contract/claude_code_reachability_test.dart` (`item-panel:rewind_files`); `src/__tests__/claude-code/integration/rewind.test.ts` |
| Fork session, fork from a message | row ⋯ → *Open as fork*; a message's actions → fork | `test/screens/agent/session_openers_test.dart`; conformance rule 8 |
| Fork-on-resume, continue latest | row ⋯ / chat More → *Open as fork*; project row long press → *Continue latest session*; Sessions tab with one directory chosen → *Continue the latest session here* | `test/screens/agent/session_openers_test.dart`; `test/screens/contract/project_rows_test.dart`; `src/__tests__/claude-code/integration/fork_open.test.ts` (source byte-for-byte unchanged) |
| Subagent definitions, commands, skills, memory, output styles, hooks, `.mcp.json`, claude.ai connectors toggle | project row long press or chat More → *Configuration files* (agents, commands, skills, CLAUDE.md, auto memory, settings, `.mcp.json`) | `test/screens/contract/project_rows_test.dart`; `test/screens/agent/config_panels_test.dart`; `src/__tests__/claude-code/ops/config_files.test.ts` |
| Filesystem agents list, active subagent | `@` agent mentions in the composer | conformance rule 13 |
| Agent teams toggle | dropped (owner, 2026-11-01) | — |
| Plugins list, toggle, reload | project configuration or chat More → *Plugins* (enable/disable; with a session, what loaded and what failed) | `test/screens/contract/project_rows_test.dart`; `src/__tests__/claude-code/ops/fast_mode_plugins.test.ts`; `src/__tests__/claude-code/ops/plugins.test.ts` |
| MCP status, reconnect, toggle | chat More → *MCP servers* (a session that can be driven) | `test/screens/contract/claude_code_reachability_test.dart`; `test/screens/agent/action_list_test.dart` |
| Custom tools | Sessions tab header → More → *Custom tools* (test, delete, edit, new) | `test/screens/contract/claude_code_reachability_test.dart`; `src/__tests__/claude-code/integration/custom_tools_port.test.ts` |
| CC settings screen, sandbox, account card, init snapshot | *Settings in effect* (permissions, sandbox, MCP approvals, plugins, account) and *Configuration files* | `src/__tests__/claude-code/ops/settings_overview.test.ts`; `test/screens/contract/project_rows_test.dart` |
| Subscription usage | Settings → *AI Usage* (shown for a contract choice) | unchanged screen (`get_subscription_usage`) |
| Availability / sign-in hint | picker subtitle, Sessions tab note | `src/__tests__/claude-code/catalogue/catalogue.test.ts` |
| File watchers refreshing lists | automatic (`catalog_invalidated`) | `src/__tests__/claude-code/ops/config_watch.test.ts` |
| Run-done notification and its tap | the local *completed* notification; its tap opens the chat while the new Claude Code is chosen | `test/agent/notify/`; `test/screens/notifications/notification_tap_routing_test.dart` |

**Not reachable, on purpose:** todos (`plan: false`, D38), diff-stat badges and the agent-teams toggle (dropped), export as a file (no op; copy covers it, D167), structured output, tool-use summaries and persisted-file frames (lane B), live hook rows on a watch-only session (history shows them; README known gaps). Each of these is named in PLAN §10 as decided.
