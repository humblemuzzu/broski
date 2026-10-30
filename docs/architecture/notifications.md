# Notifications — what raises one, and what must not

Two things can notify the user about an agent, and they follow one policy: **one notification per finished
turn, "needs you" only for a real request, never per tool call or model round trip, and nothing for the chat
the user is looking at.**

| Source | Where | Raises |
|---|---|---|
| Daemon push (APNs / FCM, needs the relay) | `server/link-feed/tracker.ts` → `broski-link` | `approval` and `attention` per request id, `done` after a session goes busy → idle and stays idle 5 s ([bridge-feed.md](connectivity-v2/bridge-feed.md), [push.md](connectivity-v2/push.md)) |
| Daemon push for a session served through the backend contract (Pi) | `server/link-feed/contract-tap.ts` ← the core's observer | the same three kinds, from a run's start and end (`run_finished` `completed`, `error`, `limit`; not `aborted`) and from pending interactions (`tool_permission` → `approval`, every other kind → `attention`) ([bridge-feed.md](connectivity-v2/bridge-feed.md#contract-sessions)) |
| Local notification while the app is alive | `lib/providers/sessions_provider.dart` | one "completed" notification on a session's busy → idle edge |

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
  how a tap that launched the app arrives. Approve/Deny keep their lock-screen path. A response that is not one of our
  pushes (`m` absent) is passed on to the plugins, so a local notification's tap reaches the plugin again.
- **Local.** `NotificationService._onNotificationTapped` puts the payload into the same relay. A payload that is JSON with
  `backend` and `session` (`NotificationTap.toPayload`) names a session; the plain session id older local notifications
  carry names none and opens nothing.
- **Routing.** `lib/services/notifications/` (the tap, the relay that keeps a tap nobody has heard, the channel),
  `lib/providers/notifications/notification_tap_provider.dart` (the tap not yet acted on) and
  `lib/screens/notifications/notification_tap_routing.dart`, called from `RootScreen.build` (`routeNotificationTaps`).
  A tap waits until the bridge has listed its backends; it opens the chat only when the tapped backend is one the core
  serves (`backends.list`), so the app names no backend, and a session of the old protocol opens nothing. Contract
  sessions raise no local notification of their own yet.

## Pi's own extensions

A user's Pi extension may write terminal notifications of its own (an OSC 777 on `agent_end`, for example). Those
go to the bridge's stdout, not to the phone; the bridge neither forwards nor interprets them.
