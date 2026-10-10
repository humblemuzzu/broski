use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tracing::{debug, warn};

use crate::clock;
use crate::codec;
use crate::device::DeviceRecord;
use crate::durations::Durations;
use crate::feed::Handle;
use crate::push::keys;
use crate::registry::Registry;
use crate::relay::RelayCommand;
use crate::store::Store;

pub mod apply;
pub mod open;
pub mod replay;

pub use open::Decision;

const QUEUE: usize = 128;

/// One letter the relay handed over, before it is read.
#[derive(Clone)]
pub struct Incoming {
    pub id: u64,
    pub device: String,
    pub data: String,
}

pub struct Deps {
    pub store: Arc<Store>,
    pub registry: Arc<Registry>,
    pub seen: Arc<replay::Seen>,
    pub feed: Handle,
    pub relay: mpsc::Sender<RelayCommand>,
    pub bridge_socket: PathBuf,
    pub machine_id: String,
    pub durations: Durations,
}

pub fn spawn(
    deps: Arc<Deps>,
    mut shutdown: watch::Receiver<bool>,
) -> (mpsc::Sender<Incoming>, JoinHandle<()>) {
    let (tx, mut rx) = mpsc::channel(QUEUE);
    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                incoming = rx.recv() => match incoming {
                    Some(incoming) => handle(&deps, &incoming).await,
                    None => break,
                },
                _ = crate::stop::stopped(&mut shutdown) => break,
            }
        }
    });
    (tx, task)
}

async fn handle(deps: &Deps, incoming: &Incoming) {
    if let Err(reason) = apply(deps, incoming).await {
        debug!(
            letter = incoming.id,
            device = crate::device::short(&incoming.device),
            reason,
            "letter rejected"
        );
    }
    if deps
        .relay
        .try_send(RelayCommand::LetterAck(incoming.id))
        .is_err()
    {
        warn!(letter = incoming.id, "letter ack not queued");
    }
}

async fn apply(deps: &Deps, incoming: &Incoming) -> Result<(), &'static str> {
    let (device, opened) = read(deps, incoming).await?;
    match &opened.body {
        open::Body::Decision {
            backend,
            session,
            request,
            decision,
        } => {
            let answer = apply::decision(deps, backend, session, request.as_ref(), *decision).await;
            match answer {
                Some(value) => debug!(
                    letter = incoming.id,
                    ok = value
                        .get("ok")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false),
                    "decision answered"
                ),
                None => warn!(letter = incoming.id, "decision went unanswered"),
            }
        }
        open::Body::Bridge { message } => {
            let delivery = apply::bridge(deps, &device, message).await;
            if delivery == apply::Delivery::Failed {
                return Err("bridge unreachable");
            }
            debug!(
                letter = incoming.id,
                delivery = delivery.as_str(),
                "bridge message delivered"
            );
        }
    }
    Ok(())
}

/// Decrypts and vets one letter: device, key, window, replay.
async fn read(
    deps: &Deps,
    incoming: &Incoming,
) -> Result<(DeviceRecord, open::Opened), &'static str> {
    let device = deps
        .store
        .device(&incoming.device)
        .await
        .ok_or("unknown device")?;
    let registration = device.push.as_ref().ok_or("no push key")?;
    let secret = keys::decode(&registration.key).ok_or("malformed push key")?;
    let data = codec::b64url_decode(&incoming.data).ok_or("malformed data")?;
    let opened = open::open(&secret, &deps.machine_id, &device.id, &data).ok_or("undecryptable")?;
    let now = clock::unix_ms();
    if opened
        .at
        .saturating_add(deps.durations.letter_ttl.as_millis() as u64)
        < now
    {
        return Err("older than the window");
    }
    if opened.at > now.saturating_add(deps.durations.letter_future_skew.as_millis() as u64) {
        return Err("from the future");
    }
    if deps.seen.check_and_mark(&opened.id, now).await {
        return Err("already seen");
    }
    Ok((device, opened))
}
