use std::sync::Arc;

use serde::Serialize;
use tracing::{info, warn};

use crate::auth::truncated;
use crate::hub::Hub;
use crate::protocol::now_ms;
use crate::push::{Kind, Platform, Priority, PushRequest};
use crate::room::Room;

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

pub fn arm(hub: &Arc<Hub>, room: &Arc<Room>, machine_id: &str, arming: Arming) {
    if !hub.push().configured() {
        if hub.note_alert_gap() {
            info!("offline alerts unavailable: push is not configured");
        }
        return;
    }
    let Some(seq) = room.arm_alert() else {
        return;
    };
    let hub = hub.clone();
    let room = room.clone();
    let machine_id = machine_id.to_owned();
    tokio::spawn(async move {
        tokio::time::sleep(hub.limits().alert_grace).await;
        if room.claim_alert(seq, arming) {
            raise(&hub, &machine_id, arming.state()).await;
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
