# Open items

Work left over on purpose, with what is already known, so the next session starts from facts.

## 1. Claude Code runs started from the phone still end when the bridge restarts

**Symptom.** A Claude Code session the bridge hosts (started or continued from the phone) stops mid-run
whenever the bridge process dies: a daemon restart (`tmux respawn-pane -k -t broski-daemon`, an upgrade), a
crash, `broski restart`. The phone then shows the run ended and the person has to say "continue".

**Why.** The Claude Code adapter drives `claude` through the Agent SDK in the bridge's own process
(`packages/bridge/src/backends/claude-code/live/`): the SDK spawns the CLI with stdio pipes owned by the
bridge, so the CLI dies with it. The supervisor kills the bridge with SIGKILL
(`packages/link/daemon/src/supervisor.rs`), so no graceful path runs. The conformance driver declares
`runsSurviveRestart: false` for Claude Code (`src/contract/testing/`), and contract README rule 11 allows
it.

**Already solved for Pi, the model to follow.** Hosted Pi sessions run under a holder process
(`packages/bridge/src/backends/pi/holder/`, Pi README §1.1): detached, owns `pi`'s stdio, keeps a replay since
the session was last at rest, and a new bridge adopts it at start (`live/session-hosts.ts` `adoptAll`,
`session-host.ts` `adopt`). Tests: `src/__tests__/pi/holder_*.test.ts`, `host_restart.test.ts`.

**What to work out first.**
- Whether the SDK can attach to a CLI it did not spawn, or whether the adapter must speak the CLI's
  `stream-json` stdio itself so a holder can own the process (the SDK's control protocol, permission
  callbacks and hooks would then cross the holder too).
- How a new bridge rebuilds a run mid-way: the CLI keeps no replay, so the holder would keep one (as for Pi),
  or the transcript tail plus the CLI's own `~/.claude/sessions/<pid>.json` status
  (`backends/claude-code/terminal/cli-processes.ts`) gives a coarser resume.
- The terminal route already survives restarts (watch-only + `PermissionRequest` hook); hosting phone-started
  sessions as terminal-style processes is the alternative to weigh.

**Done when.** The Claude Code driver declares `runsSurviveRestart: true` and passes
`sessionsSurviveARestart` (run reopened under a new RunId with its prompt, abortable, a pending ask
answerable once), plus a real-CLI test that SIGKILLs a bridge mid-tool and sees the run finish on the next.

## 2. Bridge restarts under the installed services are not verified live

Hosted Pi sessions survive a bridge restart when the daemon runs in tmux (verified on this Mac). Under the
installed services it is reasoned, not run:

- **macOS launchd** (`src/platform/service/launchd.ts`, unchanged): launchd kills by process group and the
  holder leaves the bridge's group with `setsid`, so it should survive. Verify: `broski install`, start a
  hosted run from the phone, `launchctl kickstart -k gui/$UID/com.broski.link`, check the
  `__pi-holder` process and its `pi` are still alive and the phone shows the run going on.
