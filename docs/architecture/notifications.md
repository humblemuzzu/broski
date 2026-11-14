# Notifications — what raises one, and what must not

Two things can notify the user about an agent, and they follow one policy: **one notification per finished
run, "needs you" only for a real request, never per tool call or model round trip, and nothing for the chat
the user is looking at.**

| Source | Where | Raises |
|---|---|---|
| Daemon push (APNs / FCM, needs the relay) | `server/link-feed/contract-tap.ts` ← the core's observer → `broski-link` | `approval` and `attention` per request id, `done` after a session's run ends and the session stays idle 5 s; from a run's start and end (`run_finished` `completed`, `error`, `limit`; not `aborted`) and from pending interactions (`tool_permission` → `approval`, every other kind → `attention`) ([bridge-feed.md](connectivity-v2/bridge-feed.md), [push.md](connectivity-v2/push.md)) |
| Local notification while the app is alive | the phone app (Phase 4 of `docs/rebuild/PLAN.md`), from the catalog's session rows | one "completed" notification on a row's busy → idle edge, except for a subagent's child session (its run is inside its parent's, which is told) and for the chat on screen with the app in front |

A run's end raises the `done` push and the local notification alike; when the run wrote no text, the push body names
its newest top-level call and a failing exit code instead of an answer line (`server/link-feed/contract-format.ts`).

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

- **Push (iOS).** The notification service extension keeps `backend`, `session` and `request` on the delivered content
  and hands a tap on the notification itself (the default action) to the app, at once when the app is listening and
  otherwise when it first asks, which is how a tap that launched the app arrives. The push's machine id (`m`) travels
  with the tap as `machine`. Approve/Deny keep their lock-screen path. A response that is not one of our pushes (`m`
  absent) is passed on. The code carried over for this is in `apps/ios/carryover/`
  ([`apps/carryover/README.md`](../../apps/carryover/README.md)).
- **Routing.** A tap waits for the paired machines to be read; one for another paired machine moves the app there first,
  one for a machine no longer paired is dropped. It then waits until the backends are known, from the bridge or from the
  list saved for that machine, so a tap made offline opens what was saved. A tap the app cannot act on within 30 s is
  let go, so it never opens long after, out of nowhere.

## Pi's own extensions

A user's Pi extension may write terminal notifications of its own (an OSC 777 on `agent_end`, for example). Those
go to the bridge's stdout, not to the phone; the bridge neither forwards nor interprets them.
