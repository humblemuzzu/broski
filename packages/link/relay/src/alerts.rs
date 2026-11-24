use std::sync::Arc;

use serde::Serialize;
use tracing::{info, warn};

use crate::auth::truncated;
use crate::hub::Hub;
use crate::protocol::now_ms;
use crate::push::{Kind, Platform, Priority, PushRequest};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Arming {
    Gone,
    Asleep,
}

impl Arming {
    pub fn state(self) -> &'static str {
        match self {
            Arming::Gone => "offline",
            Arming::Asleep => "asleep",
        }
    }
}

#[derive(Debug)]
pub struct AlertTarget {
    pub device: String,
    pub platform: Platform,
    pub token: String,
}

#[derive(Serialize)]
struct Alert<'a> {
    machine: &'a str,
    state: &'a str,
    since: i64,
}

/// Raises the offline alert once the grace has passed with the machine still gone or asleep. One
/// timer per room, holding the room, however often the machine arms it.
pub fn arm(hub: &Arc<Hub>, machine_id: &str, arming: Arming) {
    if !hub.push().configured() {
        if hub.note_alert_gap() {
            info!("offline alerts unavailable: push is not configured");
        }
        return;
    }
    let room = hub.lease(machine_id, None);
    let due = tokio::time::Instant::now() + hub.limits().alert_grace;
    if !room.arm_alert(arming, due) {
        return;
    }
    let hub = hub.clone();
    let machine_id = machine_id.to_owned();
    tokio::spawn(async move {
        while let Some(due) = room.alert_due() {
            tokio::time::sleep_until(due).await;
            if let Some(arming) = room.claim_alert(due) {
                raise(&hub, &machine_id, arming.state()).await;
            }
        }
    });
}

async fn raise(hub: &Hub, machine_id: &str, state: &'static str) {
    let targets = match hub.db().alert_targets(machine_id).await {
        Ok(targets) => targets,
        Err(_) => return,
    };
    if targets.is_empty() {
        return;
    }
    let data = match serde_json::to_vec(&Alert {
        machine: machine_id,
        state,
        since: now_ms(),
    }) {
        Ok(data) => data,
        Err(_) => return,
    };
    let collapse = format!("offline-{}", truncated(machine_id));
    for target in &targets {
        let request = PushRequest {
            machine: machine_id.to_owned(),
            platform: target.platform,
            token: target.token.clone(),
            kind: Kind::Offline,
            data: data.clone(),
            collapse: Some(collapse.clone()),
            priority: Priority::High,
        };
        if hub.push().send(&request).await.is_err() {
            warn!(
                machine = truncated(machine_id),
                kind = "offline",
                "alert not delivered"
            );
        }
    }
    info!(
        machine = truncated(machine_id),
        targets = targets.len(),
        "offline alert sent"
    );
}
