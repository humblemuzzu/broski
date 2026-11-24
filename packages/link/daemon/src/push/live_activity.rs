use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::warn;

use crate::clock;
use crate::device::short;
use crate::feed::Deps;
use crate::relay::{PushRequest, RelayCommand};

const LISTED_RUNS: usize = 4;
const STALE_AFTER_SECS: u64 = 2 * 60 * 60;
const DISMISS_AFTER_SECS: u64 = 15;
const MAX_PAYLOAD_BYTES: usize = 3_072;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct RunEntry {
    backend: String,
    session_id: String,
    phase: String,
    started_at: i64,
}

#[derive(Deserialize)]
struct RunsFrame {
    runs: Vec<RunEntry>,
    #[serde(default)]
    at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ActivityRun {
    title: String,
    machine_name: String,
    phase: String,
}

/// Exact wire layout of iOS `RunActivityAttributes.ContentState` for APNs Live Activity pushes.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ContentState {
    phase: String,
    title: String,
    machine_id: String,
    machine_name: String,
    backend: String,
    session_id: String,
    started_at_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    ended_at_ms: Option<i64>,
    runs: Vec<ActivityRun>,
    live_count: usize,
    needs_you_count: usize,
}

/// What one device's Live Activity was last told.
struct Shown {
    focused: RunEntry,
    state: String,
}

/// Follows `link_runs` snapshots from the bridge feed and pushes iOS Live Activity updates/ends
/// through the relay to disconnected devices that have registered an active ActivityKit token. Each
/// device is told about the sessions it has not muted, so its lock screen shows what its own app
/// would.
#[derive(Default)]
pub struct LiveActivityFeed {
    shown: HashMap<String, Shown>,
}

impl LiveActivityFeed {
    pub async fn handle(&mut self, deps: &Deps, value: &Value) {
        let Ok(frame) = serde_json::from_value::<RunsFrame>(value.clone()) else {
            return;
        };
        let now_secs = clock::unix_secs();
        let machine_name = deps.store.name().to_owned();
        let names = Names {
            machine_id: &deps.machine_id,
            machine_name: &machine_name,
        };
        for device in deps.store.devices().await {
            let Some(token) = device.live_activity_token.clone() else {
                self.shown.remove(&device.id);
                continue;
            };
            let visible: Vec<&RunEntry> = frame
                .runs
                .iter()
                .filter(|run| !device.notify.mutes(&run.backend, &run.session_id))
                .collect();
            if deps.registry.is_connected(&device.id) {
                self.observe_connected(&device.id, &visible, &names);
                continue;
            }
            let Some(planned) = self.plan(&device.id, &visible, &names, frame.at, now_secs) else {
                continue;
            };
            if !queue(deps, &device.id, token, &planned.payload) {
                continue;
            }
            self.commit(&device.id, planned.next);
            if planned.ending {
                let _ = deps.store.set_live_activity(&device.id, None).await;
            }
        }
    }

    /// A connected phone updates its own Live Activity locally; mirror that state in `shown` so
    /// disconnecting mid-run still knows whether an `end` or state change push is needed later.
    fn observe_connected(&mut self, device: &str, visible: &[&RunEntry], names: &Names<'_>) {
        match visible.first() {
            Some(focused) => {
                if let Ok(state) = serde_json::to_string(&names.running(focused, visible)) {
                    self.shown.insert(
                        device.to_owned(),
                        Shown {
                            focused: (*focused).clone(),
                            state,
                        },
                    );
                }
            }
            None => {
                self.shown.remove(device);
            }
        }
    }

    /// The push this device needs now, or `None` when it already shows exactly this or has
    /// nothing to end. Does not mutate `shown` until the caller queues the push.
    fn plan(
        &self,
        device: &str,
        visible: &[&RunEntry],
        names: &Names<'_>,
        at: i64,
        now_secs: u64,
    ) -> Option<Planned> {
        let Some(focused) = visible.first() else {
            let previous = self.shown.get(device)?;
            let ended_at_ms = if at > 0 {
                at
            } else {
                (now_secs as i64).saturating_mul(1_000)
            };
            let state = names.ended(previous.focused.clone(), ended_at_ms);
            return Some(Planned {
                ending: true,
                payload: aps("end", now_secs, &state, DISMISS_AFTER_SECS),
                next: None,
            });
        };
        let state = names.running(focused, visible);
        let encoded = serde_json::to_string(&state).ok()?;
        if self
            .shown
            .get(device)
            .is_some_and(|shown| shown.state == encoded)
        {
            return None;
        }
        Some(Planned {
            ending: false,
            payload: aps("update", now_secs, &state, STALE_AFTER_SECS),
            next: Some(Shown {
                focused: (*focused).clone(),
                state: encoded,
            }),
        })
    }

    fn commit(&mut self, device: &str, next: Option<Shown>) {
        match next {
            Some(shown) => {
                self.shown.insert(device.to_owned(), shown);
            }
            None => {
                self.shown.remove(device);
            }
        }
    }
}

struct Planned {
    ending: bool,
    payload: Value,
    next: Option<Shown>,
}

struct Names<'a> {
    machine_id: &'a str,
    machine_name: &'a str,
}

fn safe_activity_title(backend: &str) -> String {
    match backend {
        "claude-code" => "Claude Code".to_owned(),
        "pi" => "Pi".to_owned(),
        _ => "Coding agent".to_owned(),
    }
}

impl Names<'_> {
    fn running(&self, focused: &RunEntry, visible: &[&RunEntry]) -> ContentState {
        // ActivityKit remote pushes are plaintext JSON to APNs via the relay, so never
        // include user prompt / session titles here — only non-sensitive agent + phase state.
        ContentState {
            phase: focused.phase.clone(),
            title: safe_activity_title(&focused.backend),
            machine_id: self.machine_id.to_owned(),
            machine_name: self.machine_name.to_owned(),
            backend: focused.backend.clone(),
            session_id: focused.session_id.clone(),
            started_at_ms: focused.started_at,
            ended_at_ms: None,
            runs: visible
                .iter()
                .take(LISTED_RUNS)
                .map(|run| ActivityRun {
                    title: safe_activity_title(&run.backend),
                    machine_name: self.machine_name.to_owned(),
                    phase: run.phase.clone(),
                })
                .collect(),
            live_count: visible.len(),
            needs_you_count: visible.iter().filter(|run| run.phase == "needsYou").count(),
        }
    }

    fn ended(&self, previous: RunEntry, ended_at_ms: i64) -> ContentState {
        ContentState {
            phase: "done".to_owned(),
            title: safe_activity_title(&previous.backend),
            machine_id: self.machine_id.to_owned(),
            machine_name: self.machine_name.to_owned(),
            backend: previous.backend,
            session_id: previous.session_id,
            started_at_ms: previous.started_at,
            ended_at_ms: Some(ended_at_ms),
            runs: Vec::new(),
            live_count: 0,
            needs_you_count: 0,
        }
    }
}

/// An ActivityKit push: `update` goes stale after `date_secs` without another, `end` leaves the
/// activity on screen for `date_secs` more.
fn aps(event: &str, now_secs: u64, state: &ContentState, date_secs: u64) -> Value {
    let date_key = if event == "end" {
        "dismissal-date"
    } else {
        "stale-date"
    };
    json!({
        "aps": {
            "timestamp": now_secs,
            "event": event,
            date_key: now_secs.saturating_add(date_secs),
            "content-state": state,
        }
    })
}

fn queue(deps: &Deps, device: &str, token: String, payload: &Value) -> bool {
    let Ok(bytes) = serde_json::to_vec(payload) else {
        return false;
    };
    if bytes.len() > MAX_PAYLOAD_BYTES {
        warn!(bytes = bytes.len(), "live activity payload does not fit");
        return false;
    }
    let request = RelayCommand::Push(PushRequest {
        platform: "apns_live_activity".to_owned(),
        token,
        kind: "live_activity",
        data: crate::codec::b64url(&bytes),
        collapse: None,
        priority: "high",
    });
    if deps.relay.try_send(request).is_err() {
        warn!(device = short(device), "live activity push not queued");
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_state_serializes_with_ios_codable_field_names() {
        let state = ContentState {
            phase: "done".to_owned(),
            title: "Refactor timers".to_owned(),
            machine_id: "00112233445566778899aabbccddeeff".to_owned(),
            machine_name: "Studio Mac".to_owned(),
            backend: "pi".to_owned(),
            session_id: "s-1".to_owned(),
            started_at_ms: 1_760_000_000_000,
            ended_at_ms: Some(1_760_000_060_000),
            runs: vec![ActivityRun {
                title: "Refactor timers".to_owned(),
                machine_name: "Studio Mac".to_owned(),
                phase: "working".to_owned(),
            }],
            live_count: 1,
            needs_you_count: 0,
        };
        let value = serde_json::to_value(&state).expect("json");
        assert_eq!(value["phase"], "done");
        assert_eq!(value["machineId"], "00112233445566778899aabbccddeeff");
        assert_eq!(value["machineName"], "Studio Mac");
        assert_eq!(value["sessionId"], "s-1");
        assert_eq!(value["startedAtMs"], 1_760_000_000_000i64);
        assert_eq!(value["endedAtMs"], 1_760_000_060_000i64);
        assert_eq!(value["liveCount"], 1);
        assert_eq!(value["needsYouCount"], 0);
        assert_eq!(value["runs"][0]["machineName"], "Studio Mac");
    }

    fn run(session: &str, phase: &str) -> RunEntry {
        RunEntry {
            backend: "pi".to_owned(),
            session_id: session.to_owned(),
            phase: phase.to_owned(),
            started_at: 1_760_000_000_000,
        }
    }

    fn names() -> Names<'static> {
        Names {
            machine_id: "00112233445566778899aabbccddeeff",
            machine_name: "Studio Mac",
        }
    }

    #[test]
    fn a_device_is_told_what_it_shows_once_and_ended_when_nothing_is_left_for_it() {
        let mut feed = LiveActivityFeed::default();
        let (a, b) = (run("a", "needsYou"), run("b", "working"));
        let first = feed
            .plan("d1", &[&a, &b], &names(), 0, 100)
            .expect("the first sight is pushed");
        assert!(!first.ending);
        let state = &first.payload["aps"]["content-state"];
        assert_eq!(state["liveCount"], 2);
        assert_eq!(state["needsYouCount"], 1);
        assert_eq!(first.payload["aps"]["event"], "update");
        feed.commit("d1", first.next);
        assert!(feed.plan("d1", &[&a, &b], &names(), 0, 101).is_none());

        let narrowed = feed
            .plan("d1", &[&b], &names(), 0, 102)
            .expect("a run the device muted leaves its activity");
        assert_eq!(narrowed.payload["aps"]["content-state"]["liveCount"], 1);
        assert_eq!(narrowed.payload["aps"]["content-state"]["sessionId"], "b");
        feed.commit("d1", narrowed.next);

        let end = feed
            .plan("d1", &[], &names(), 5_000, 103)
            .expect("nothing left to show ends the activity");
        assert!(end.ending);
        assert_eq!(end.payload["aps"]["event"], "end");
        assert_eq!(end.payload["aps"]["content-state"]["phase"], "done");
        assert_eq!(end.payload["aps"]["content-state"]["endedAtMs"], 5_000);
        feed.commit("d1", end.next);
        assert!(feed.plan("d1", &[], &names(), 0, 104).is_none());
    }

    #[test]
    fn a_run_started_while_connected_still_ends_and_updates_after_disconnect() {
        let mut feed = LiveActivityFeed::default();
        let working = run("s1", "working");
        let waiting = run("s1", "needsYou");

        // Started while connected, then phone locks, then run finishes: must send `end`.
        feed.observe_connected("d1", &[&working], &names());
        let end = feed
            .plan("d1", &[], &names(), 9_000, 200)
            .expect("disconnecting mid-run must still emit an end push");
        assert!(end.ending);
        assert_eq!(end.payload["aps"]["event"], "end");
        assert_eq!(end.payload["aps"]["content-state"]["sessionId"], "s1");
        // Without commit (simulated queue failure), the end is retried on the next snapshot.
        assert!(feed.plan("d1", &[], &names(), 9_000, 201).is_some());
        feed.commit("d1", end.next);

        // Working disconnected → reconnects and shows needsYou → disconnects → resumes working.
        let pushed = feed
            .plan("d1", &[&working], &names(), 0, 210)
            .expect("push");
        feed.commit("d1", pushed.next);
        feed.observe_connected("d1", &[&waiting], &names());
        let resumed = feed
            .plan("d1", &[&working], &names(), 0, 220)
            .expect("returning to working after connected needsYou must push");
        assert_eq!(resumed.payload["aps"]["content-state"]["phase"], "working");
    }
}
