# Notifications — what raises one, and what must not

Two things can notify the user about an agent, and they follow one policy: **one notification per finished
run, "needs you" only for a real request, never per tool call or model round trip, and nothing for the chat
the user is looking at.** What the person turned off in Settings › Notifications is held by the Mac, which never sends
it, so it works with the app killed ([push.md](connectivity-v2/push.md) § Policy).

| Source | Where | Raises |
|---|---|---|
| Daemon push (APNs / FCM, needs the relay) | `server/link-feed/contract-tap.ts` ← the core's observer → `broski-link` | `approval` and `attention` per request id, `done` or `failed` after a session's run ends and the session stays idle 5 s; from a run's start and end (`run_finished` `completed` → `done`, `error` and `limit` → `failed`; not `aborted`) and from pending interactions (a `tool_permission` with a plain Allow and Deny → `approval`, every other kind → `attention`) ([bridge-feed.md](connectivity-v2/bridge-feed.md), [push.md](connectivity-v2/push.md)) |
| Local notification while the app is alive | the phone app, from the catalog's session rows | one "completed" notification on a row's busy → idle edge, except for a subagent's child session (its run is inside its parent's, which is told) and for the chat on screen with the app in front |

A run's end raises the `done` push and the local notification alike; when the run wrote no text, the push body names
its newest top-level call and a failing exit code instead of an answer line (`server/link-feed/contract-format.ts`).

## What the words say

A notification is `<session name> — <state>` over one plain line (`server/link-feed/contract-format.ts`, `words.ts`):
`Fix the build — needs approval` / `Claude Code wants to run npm test`; `Fix the build — has a question` / `Which
library? date-fns · luxon`; `Fix the build — plan ready` / `Refactor timers: Replace setTimeout`; `Fix the build —
finished` / the first line of the answer; `Fix the build — failed` / `Sign-in was refused. Check the agent's login on your
Mac.`. The session's name is its title, else its folder's, else its agent's. Markdown never shows (no `##`, `**`, bullets,
backticks or fences), a command is its first line, a path inside the session's folder is relative to it, and an MCP
tool reads `github create_issue`, not `mcp__github__create_issue`. Allow and Deny are on an `approval` only: a request
that needs a closer look is an `attention` that opens the app.

## What the person can switch off

Settings › Notifications has three alert kinds and the Live Activity (iOS) or Live Update (Android):

| Switch | Covers |
|---|---|
| Needs you | `approval`, `attention` |
| Finished | `done` |
| Failed | `failed` (an error or a limit), and the relay's "Mac offline or asleep" |
| Live Activity / Live Update | the ongoing activity of agents at work; off ends it at once and none starts |

A session's mute silences all of them and leaves it out of the Live Activity. The choices live on the phone (the iOS app
group, the Android settings store) and are sent to every Mac as `notify_prefs`, which is what holds them with the app
closed. The Live Activity and the Live Update follow their own switch in the app itself.

## Taking an alert down

When the person opens a session in the app its notifications come down. When a request stops waiting (answered in the
app or on the Mac), the app takes its approval or question down on both platforms; an Android phone is also told by a
`resolved` push, which cancels it with no sound or banner, even with the app closed. An iPhone is not: Apple shows every
alert push, so a request answered on the Mac while the iPhone's app is closed stays on its lock screen until the app next
reads that session.

Right after the app goes to the background a run's end can raise both a local notification (the app is still alive)
and the daemon's push (the phone is no longer in the foreground). The two are not deduplicated, since the app cannot
know whether the push will be delivered (the relay may be unreachable), and dropping either would lose the only one in
some cases.

## Why a run is the unit

Both sources read the contract's run: `run_started` and `run_finished`. For that to mean "the turn", **only the agent
run may emit them**. Pi's `turn_start` / `turn_end` bracket each *model call* inside a run, so a prompt that runs two
tools has three of them; mapped to the run lifecycle they would make the app finish and restart the run three times (a
notification each, the Stop control gone between them) and could push `done` whenever a model call took longer than the
5 s idle window. The Pi adapter keeps the rule: a run opens at `agent_start`, `run_finished` follows `agent_settled`, and
`turn_*` map to nothing (`backends/pi/live/event-bridge.ts`).

## The local notification

No notification when the app is in the foreground **and** a chat screen is open **and** that chat is the session that
finished. A draft chat that has not adopted a session id yet is not "the session that finished", so it notifies.

## Tapping one

A tap on a push or on a local notification whose payload names a backend and a session opens that session's
conversation:

- **Push (iOS).** The notification service extension (`apps/ios/Broski/Extensions/NotificationService`,
  `Shared/PushContent.swift`) opens the push with the core's `openNotification` and keeps `machine` (the relay's `m`),
  `backend`, `session` and `request` on the delivered content. The app's notification delegate
  (`Sources/Core/PushNotifications.swift`, set before launch finishes, so a tap that launched the app arrives) turns a
  tap on the notification itself into `AppModel.sessionToOpen`; Allow and Deny post the core's `decisionLetter`. A
  push for the session `AppModel.visibleSession` names does not banner while the app is in front
  ([`apps/ios/README.md`](../../apps/ios/README.md)).
- **Routing.** A tap waits for the paired machines to be read; one for another paired machine moves the app there first,
  one for a machine no longer paired is dropped. It then waits until the backends are known, from the bridge or from the
  list saved for that machine, so a tap made offline opens what was saved. A tap the app cannot act on within 30 s is
  let go, so it never opens long after, out of nowhere.

## Pi's own extensions

A user's Pi extension may write terminal notifications of its own (an OSC 777 on `agent_end`, for example). Those
go to the bridge's stdout, not to the phone; the bridge neither forwards nor interprets them.
