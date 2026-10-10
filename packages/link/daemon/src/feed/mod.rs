pub mod client;

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::{mpsc, oneshot};

use crate::bridge_status::BridgeMonitor;
use crate::durations::Durations;

use client::Request;

const QUEUE: usize = 16;

/// The daemon's side of the bridge feed socket: send a request, wait for the bridge's answer.
#[derive(Clone)]
pub struct Handle {
    requests: mpsc::Sender<Request>,
}

impl Handle {
    pub async fn send(&self, message: Value, wait: Duration) -> Option<Value> {
        let (reply, answer) = oneshot::channel();
        let request = Request { message, reply };
        let queued = tokio::time::timeout(wait, self.requests.send(request)).await;
        if !matches!(queued, Ok(Ok(()))) {
            return None;
        }
        match tokio::time::timeout(wait, answer).await {
            Ok(Ok(value)) => value,
            _ => None,
        }
    }
}

pub struct Deps {
    pub socket: std::path::PathBuf,
    pub machine_id: String,
    pub store: Arc<crate::store::Store>,
    pub registry: Arc<crate::registry::Registry>,
    pub relay: mpsc::Sender<crate::relay::RelayCommand>,
    pub busy: tokio::sync::watch::Sender<bool>,
    pub monitor: Arc<BridgeMonitor>,
    pub durations: Durations,
}

pub fn spawn(
    deps: Deps,
    shutdown: tokio::sync::watch::Receiver<bool>,
) -> (Handle, tokio::task::JoinHandle<()>) {
    let (requests, inbox) = mpsc::channel(QUEUE);
    let task = client::spawn(Arc::new(deps), inbox, shutdown);
    (Handle { requests }, task)
}
