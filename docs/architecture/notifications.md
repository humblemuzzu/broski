# Notifications — what raises one, and what must not

Two things can notify the user about an agent, and they follow one policy: **one notification per finished
turn, "needs you" only for a real request, never per tool call or model round trip, and nothing for the chat
the user is looking at.**

| Source | Where | Raises |
|---|---|---|
| Daemon push (APNs / FCM, needs the relay) | `server/link-feed/tracker.ts` → `broski-link` | `approval` and `attention` per request id, `done` after a session goes busy → idle and stays idle 5 s ([bridge-feed.md](connectivity-v2/bridge-feed.md), [push.md](connectivity-v2/push.md)) |
| Daemon push for a session served through the backend contract (Pi) | `server/link-feed/contract-tap.ts` ← the core's observer | the same three kinds, from a run's start and end (`run_finished` `completed`, `error`, `limit`; not `aborted`) and from pending interactions (`tool_permission` → `approval`, every other kind → `attention`) ([bridge-feed.md](connectivity-v2/bridge-feed.md#contract-sessions)) |
| Local notification while the app is alive | `lib/providers/sessions_provider.dart` | one "completed" notification on a session's busy → idle edge |
| Local notification for a contract session (Pi) | `lib/agent/notify/run_completion_watcher.dart` (catalog rows) → `lib/services/notifications/local_run_done_notifier.dart` | one "completed" notification on a row's busy → idle edge, except for a subagent's child session (its run is inside its parent's, which is told) and for the chat on screen with the app in front |

A `!` command typed for a contract session is a run like any (it streams and can be stopped), so its end raises
the same `done` push and local notification; the push body names the command and a failing exit code instead of
an answer line (`server/link-feed/contract-format.ts`). The old Pi raised neither only because its `!` was a
request the app waited on, with no run.

Right after the app goes to the background a run's end can raise both a local notification (the app is still
alive) and the daemon's push (the phone is no longer in the foreground). The old protocol's sessions behave the
same; the two are not deduplicated, since the app cannot know whether the push will be delivered (the relay may be
unreachable), and dropping either would lose the only one in some cases.

## Why a run is the unit

Both sources read the normalized `agent_started` / `agent_finished` pair. For that to mean "the turn", **only the
agent run may emit them**. Pi's `turn_start` / `turn_end` bracket each *model call* inside a run,
so a prompt that runs two tools has three of them; mapped to the lifecycle they made the app finish and restart
the agent three times (a notification each, the Stop control gone between them) and could push `done` whenever a
model call took longer than the 5 s idle window. The old Pi mappers (deleted on 2026-10-30) emitted
`agent_started` for `agent_start` and `agent_finished` for `agent_end` only. Pi now speaks the contract, and its
adapter keeps the rule: a run opens at `agent_start`, `run_finished` follows `agent_settled`, and `turn_*` map to
nothing (`backends/pi/live/event-bridge.ts`).

The `runtime_state` snapshot that follows a Pi run is published at `agent_settled`, not at `agent_end`: at
`agent_end` the session still reports `isStreaming`, and a snapshot saying so would start the turn again in the
app.

## The local notification

`lib/services/turn_notification_policy.dart` decides: no notification when the app is in the foreground **and** a
chat screen is open **and** that chat is the session that finished. `ChatPresence`
(`lib/providers/notifications/chat_presence.dart`) counts open chat screens; `chat_screen.dart` opens and
closes it. A draft chat that has not adopted a session id yet is not "the session that finished", so it notifies.

## Tapping one

A tap on a push or on a local notification whose payload names a backend and a session opens that session's conversation
on the contract core's screen (`AgentChatScreen`):

- **Push (iOS).** The notification service extension keeps `backend`, `session` and `request` on the delivered content;
  `ios/Runner/PushNotifications.swift` hands a tap on the notification itself (the default action) to Dart over the
  `broski/notification_taps` channel — at once when Dart is listening, otherwise when it first asks (`takeTap`), which is
  how a tap that launched the app arrives. The push's machine id (`m`) travels with the tap as `machine`.
  Approve/Deny keep their lock-screen path. A response that is not one of our
  pushes (`m` absent) is passed on to the plugins, so a local notification's tap reaches the plugin again.
- **Local.** `NotificationService._onNotificationTapped` puts the payload into the same relay; a tap that launched the
  app reaches no callback and is read from the plugin's launch details at start (`launch_tap.dart`). A payload that is
  JSON with `backend` and `session` (`NotificationTap.toPayload`, which also carries the machine the app was on) names
  a session; the plain session id older local notifications carry names none and opens nothing.
- **Routing.** `lib/services/notifications/` (the tap, the relay that keeps a tap nobody has heard, the channel),
  `lib/providers/notifications/notification_tap_provider.dart` (the tap not yet acted on) and
  `lib/screens/notifications/notification_tap_routing.dart`, called from `RootScreen.build` (`routeNotificationTaps`).
  A tap waits for the paired machines to be read; one for another paired machine moves the app there first
  (`machineSwitchProvider`, once per tap), one for a machine no longer paired is dropped. It then waits until the
  backends are known, from the bridge or from the list saved for that machine, so a tap made offline opens what was
  saved; it opens the chat only when the tapped backend is one the core serves, so the app names no backend, and a
  session of the old protocol opens nothing. A tap the app cannot act on within 30 s is let go
  (`PendingNotificationTap.maxWait`), so it never opens long after, out of nowhere.

## Pi's own extensions

A user's Pi extension may write terminal notifications of its own (an OSC 777 on `agent_end`, for example). Those
go to the bridge's stdout, not to the phone; the bridge neither forwards nor interprets them.
