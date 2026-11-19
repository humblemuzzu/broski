use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::warn;

use crate::clock;
use crate::device::short;
use crate::feed::Deps;
use crate::relay::{PushRequest, RelayCommand};

const LISTED_RUNS: usize = 4;
const STALE_AFTER_SECS: u64 = 2 * 60 * 60;
const DONE_DISMISS_SECS: u64 = 15;
const MAX_PAYLOAD_BYTES: usize = 3_800;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct RunEntry {
    backend: String,
    session_id: String,
    title: String,
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

/// Follows `link_runs` snapshots from the bridge feed and pushes iOS Live Activity updates/ends
/// through the relay to disconnected devices that have registered an active ActivityKit token.
#[derive(Default)]
pub struct LiveActivityFeed {
    last_focused: Option<RunEntry>,
}

impl LiveActivityFeed {
    pub async fn handle(&mut self, deps: &Deps, value: &Value) {
        let Ok(frame) = serde_json::from_value::<RunsFrame>(value.clone()) else {
            return;
        };
        let now_secs = clock::unix_secs();
        let machine_name = deps.store.name().to_owned();
        let (ending, payload) = if let Some(focused) = frame.runs.first().cloned() {
            let needs_you_count = frame
                .runs
                .iter()
                .filter(|run| run.phase == "needsYou")
                .count();
            let runs = frame
                .runs
                .iter()
                .take(LISTED_RUNS)
                .map(|run| ActivityRun {
                    title: run.title.clone(),
                    machine_name: machine_name.clone(),
                    phase: run.phase.clone(),
                })
                .collect();
            let state = ContentState {
                phase: focused.phase.clone(),
                title: focused.title.clone(),
                machine_id: deps.machine_id.clone(),
                machine_name,
                backend: focused.backend.clone(),
                session_id: focused.session_id.clone(),
                started_at_ms: focused.started_at,
                ended_at_ms: None,
                runs,
                live_count: frame.runs.len(),
                needs_you_count,
            };
            self.last_focused = Some(focused);
            (
                false,
                json!({
                    "aps": {
                        "timestamp": now_secs,
                        "event": "update",
                        "stale-date": now_secs.saturating_add(STALE_AFTER_SECS),
                        "content-state": state,
                    }
                }),
            )
        } else {
            let Some(previous) = self.last_focused.take() else {
                return;
            };
            let ended_at_ms = if frame.at > 0 {
                frame.at
            } else {
                (now_secs as i64).saturating_mul(1_000)
            };
            let state = ContentState {
                phase: "done".to_owned(),
                title: previous.title,
                machine_id: deps.machine_id.clone(),
                machine_name,
                backend: previous.backend,
                session_id: previous.session_id,
                started_at_ms: previous.started_at,
                ended_at_ms: Some(ended_at_ms),
                runs: Vec::new(),
                live_count: 0,
                needs_you_count: 0,
            };
            (
                true,
                json!({
                    "aps": {
                        "timestamp": now_secs,
                        "event": "end",
                        "dismissal-date": now_secs.saturating_add(DONE_DISMISS_SECS),
                        "content-state": state,
                    }
                }),
            )
        };

        let Ok(bytes) = serde_json::to_vec(&payload) else {
            return;
        };
        if bytes.len() > MAX_PAYLOAD_BYTES {
            warn!(bytes = bytes.len(), "live activity payload does not fit");
            return;
        }
        let encoded = crate::codec::b64url(&bytes);
        let devices = deps.store.devices().await;
        for device in devices {
            if deps.registry.is_connected(&device.id) {
                continue;
            }
            let Some(token) = device.live_activity_token else {
                continue;
            };
            let request = RelayCommand::Push(PushRequest {
                platform: "apns_live_activity".to_owned(),
                token,
                kind: "live_activity",
                data: encoded.clone(),
                collapse: None,
                priority: "high",
            });
            if deps.relay.try_send(request).is_err() {
                warn!(device = short(&device.id), "live activity push not queued");
                continue;
            }
            if ending {
                let _ = deps.store.set_live_activity(&device.id, None).await;
            }
        }
    }
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
}
