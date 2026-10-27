# Notifications — what raises one, and what must not

Two things can notify the user about an agent, and they follow one policy: **one notification per finished
turn, "needs you" only for a real request, never per tool call or model round trip, and nothing for the chat
the user is looking at.**

| Source | Where | Raises |
|---|---|---|
| Daemon push (APNs / FCM, needs the relay) | `server/link-feed/tracker.ts` → `broski-link` | `approval` and `attention` per request id, `done` after a session goes busy → idle and stays idle 5 s ([bridge-feed.md](connectivity-v2/bridge-feed.md), [push.md](connectivity-v2/push.md)) |
| Local notification while the app is alive | `lib/providers/sessions_provider.dart` | one "completed" notification on a session's busy → idle edge |

## Why a run is the unit

Both sources read the normalized `agent_started` / `agent_finished` pair. For that to mean "the turn", **only the
agent run may emit them**. Pi's `turn_start` / `turn_end` (and Pi Durable's) bracket each *model call* inside a run,
so a prompt that runs two tools has three of them; mapped to the lifecycle they made the app finish and restart
the agent three times (a notification each, the Stop control gone between them) and could push `done` whenever a
model call took longer than the 5 s idle window. The Pi mappers now emit `agent_started` for `agent_start` and
`agent_finished` for `agent_end` only; `turn_*` and `agent_settled` map to nothing
(`runtime/pi-runtime-event-mapper.ts`, `runtime/pi-durable-runtime-event-mapper.ts`).

The `runtime_state` snapshot that follows a Pi run is published at `agent_settled`, not at `agent_end`: at
`agent_end` the session still reports `isStreaming`, and a snapshot saying so would start the turn again in the
app.

## The local notification

`lib/services/turn_notification_policy.dart` decides: no notification when the app is in the foreground **and** a
chat screen is open **and** that chat is the session that finished. `ChatPresence`
(`lib/providers/notifications/chat_presence.dart`) counts open chat screens; `chat_screen.dart` opens and
closes it. A draft chat that has not adopted a session id yet is not "the session that finished", so it notifies.

## Pi's own extensions

A user's Pi extension may write terminal notifications of its own (an OSC 777 on `agent_end`, for example). Those
go to the bridge's stdout, not to the phone; the bridge neither forwards nor interprets them.
