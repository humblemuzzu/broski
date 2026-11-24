use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tracing::warn;

use crate::clock;
use crate::device::short;
use crate::push::{keys, seal, Kind};
use crate::relay::{PushRequest, RelayCommand};
use crate::store::Store;

use super::{scan_on_screen, MacDialog};

const POLL_INTERVAL: Duration = Duration::from_secs(2);

pub struct Deps {
    pub machine_id: String,
    pub store: Arc<Store>,
    pub relay: mpsc::Sender<RelayCommand>,
    pub tx: watch::Sender<Vec<MacDialog>>,
    pub enabled: watch::Receiver<bool>,
}

pub fn spawn(mut deps: Deps, mut shutdown: watch::Receiver<bool>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut seen: HashSet<String> = HashSet::new();
        let mut seeded = false;
        let mut ticker = tokio::time::interval(POLL_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            if !*deps.enabled.borrow() {
                seen.clear();
                seeded = false;
                deps.tx.send_if_modified(|current| {
                    if current.is_empty() {
                        false
                    } else {
                        current.clear();
                        true
                    }
                });
                tokio::select! {
                    changed = deps.enabled.changed() => {
                        if changed.is_err() { return; }
                    }
                    _ = crate::stop::stopped(&mut shutdown) => return,
                }
                continue;
            }
            tokio::select! {
                _ = ticker.tick() => {
                    let dialogs = tokio::task::spawn_blocking(scan_on_screen)
                        .await
                        .unwrap_or_default();
                    let newly_appeared: Vec<MacDialog> = if seeded {
                        dialogs
                            .iter()
                            .filter(|d| !seen.contains(&d.id))
                            .cloned()
                            .collect()
                    } else {
                        seeded = true;
                        Vec::new()
                    };
                    seen = dialogs.iter().map(|d| d.id.clone()).collect();
                    deps.tx.send_if_modified(|current| {
                        if *current == dialogs {
                            false
                        } else {
                            *current = dialogs;
                            true
                        }
                    });
                    if let Some(first) = newly_appeared.first() {
                        push_dialog(&deps, first, newly_appeared.len()).await;
                    }
                }
                changed = deps.enabled.changed() => {
                    if changed.is_err() { return; }
                }
                _ = crate::stop::stopped(&mut shutdown) => return,
            }
        }
    })
}

async fn push_dialog(deps: &Deps, dialog: &MacDialog, count: usize) {
    let targets: Vec<_> = deps
        .store
        .devices()
        .await
        .into_iter()
        .filter(|device| {
            device.remote_screen
                && device.push.is_some()
                && device.notify.wants(Kind::Attention, "", "")
        })
        .collect();
    if targets.is_empty() {
        return;
    }
    let machine = deps.store.name().to_owned();
    let title = match dialog.kind.as_str() {
        "mac_password" => "macOS password prompt",
        "mac_crash" => "macOS app crash dialog",
        _ => "macOS system dialog",
    };
    let body = if count > 1 {
        format!(
            "{} (+{} more) — open Screen to respond",
            dialog.title,
            count - 1
        )
    } else {
        format!("{} — open Screen to respond", dialog.title)
    };
    let notification = seal::Notification {
        v: 1,
        kind: "mac_dialog",
        title,
        body: &body,
        machine: &machine,
        backend: "",
        session: "",
        request: None,
        at: clock::unix_ms(),
    };
    let Some(plaintext) = seal::encode(&notification) else {
        return;
    };
    let collapse = format!("mac-dialog-{}", short(&deps.machine_id));
    for device in targets {
        let Some(registration) = device.push.as_ref() else {
            continue;
        };
        let Some(secret) = keys::decode(&registration.key) else {
            warn!(device = short(&device.id), "push key is malformed");
            continue;
        };
        let notify = keys::notify(&secret);
        let Some(data) = seal::seal(&notify, deps.machine_id.as_bytes(), &plaintext) else {
            continue;
        };
        let request = RelayCommand::Push(PushRequest {
            platform: registration.platform.clone(),
            token: registration.token.clone(),
            kind: "attention",
            data: crate::codec::b64url(&data),
            collapse: Some(collapse.clone()),
            priority: "high",
        });
        if deps.relay.try_send(request).is_err() {
            warn!(device = short(&device.id), "mac dialog push not queued");
        }
    }
}
