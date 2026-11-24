use std::collections::HashMap;

use serde_json::{json, Value};
use tracing::debug;

use crate::device::DeviceRecord;
use crate::pairing::Pairing;
use crate::store::Store;

use super::session::Session;

/// Keeps the relay's device table equal to the devices this machine authorises: the paired ones
/// plus the pairing device of an open offer.
pub(super) struct Sync {
    allowed: HashMap<String, String>,
    kept: bool,
}

impl Sync {
    pub(super) fn new() -> Sync {
        Sync {
            allowed: HashMap::new(),
            kept: false,
        }
    }

    pub(super) async fn run(
        &mut self,
        session: &mut Session,
        store: &Store,
        pairing: &Pairing,
        now_secs: u64,
    ) -> bool {
        let devices = store.devices().await;
        let mut desired = authorised(&devices);
        let retired = pairing_device(pairing, now_secs, &mut desired);
        if !self.grant(session, &desired).await {
            return false;
        }
        if !self.withdraw(session, &desired, &retired).await {
            return false;
        }
        if !self.kept {
            if !self.keep(session, &desired).await {
                return false;
            }
            self.kept = true;
        }
        if !self.targets(session, &devices).await {
            return false;
        }
        debug!(devices = devices.len(), "relay device list published");
        true
    }

    /// Replaces the relay's offline-alert targets with the devices that have a push registration
    /// and have not turned Failures off: the relay's offline alert is the one failure it reports.
    async fn targets(&mut self, session: &mut Session, devices: &[DeviceRecord]) -> bool {
        let targets: Vec<Value> = devices
            .iter()
            .filter_map(|device| {
                let push = device.push.as_ref().filter(|_| device.notify.failures)?;
                Some(json!({
                    "device": &device.id,
                    "platform": &push.platform,
                    "token": &push.token,
                }))
            })
            .collect();
        session
            .request(json!({"t": "alert_targets", "targets": targets}))
            .await
    }

    /// Once per connection, names every device this machine authorises so the relay forgets the
    /// rest, including devices revoked while the machine was away from it. Sent without a request
    /// id: a relay that predates `keep` ignores it.
    async fn keep(&mut self, session: &mut Session, desired: &HashMap<String, String>) -> bool {
        let devices: Vec<&String> = desired.keys().collect();
        session.send(json!({"t": "keep", "devices": devices})).await
    }

    async fn grant(&mut self, session: &mut Session, desired: &HashMap<String, String>) -> bool {
        for (id, hash) in desired {
            if self.allowed.get(id) == Some(hash) {
                continue;
            }
            if !session
                .request(json!({"t": "allow", "device": id, "token_hash": hash}))
                .await
            {
                return false;
            }
            self.allowed.insert(id.clone(), hash.clone());
        }
        true
    }

    /// `retired` names the pairing device the session already revoked on the machine socket.
    async fn withdraw(
        &mut self,
        session: &mut Session,
        desired: &HashMap<String, String>,
        retired: &[String],
    ) -> bool {
        let gone: Vec<String> = self
            .allowed
            .keys()
            .filter(|id| !desired.contains_key(*id))
            .cloned()
            .collect();
        for id in gone {
            if !retired.contains(&id)
                && !session.request(json!({"t": "revoke", "device": &id})).await
            {
                return false;
            }
            self.allowed.remove(&id);
        }
        true
    }
}

fn authorised(devices: &[DeviceRecord]) -> HashMap<String, String> {
    devices
        .iter()
        .map(|device| (device.id.clone(), device.relay_token_hash.clone()))
        .collect()
}

/// Adds the open offer's pairing device to `desired` and returns the ids the session retired.
fn pairing_device(
    pairing: &Pairing,
    now_secs: u64,
    desired: &mut HashMap<String, String>,
) -> Vec<String> {
    match pairing {
        Pairing::Allowed(device) if !device.expired(now_secs) => {
            desired.insert(device.id.clone(), device.token_hash.clone());
            Vec::new()
        }
        Pairing::Retired(id) => vec![id.clone()],
        Pairing::None | Pairing::Allowed(_) => Vec::new(),
    }
}
