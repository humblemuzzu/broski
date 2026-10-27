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
pub mod pipe;
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
    pub link_key: Arc<crate::link_key::LinkKey>,
    pub registry: Arc<Registry>,
    pub seen: Arc<replay::Seen>,
    pub feed: Handle,
    pub pipes: Arc<pipe::Pipes>,
    pub relay: mpsc::Sender<RelayCommand>,
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
    match apply(deps, incoming).await {
        Outcome::Accepted => ack(deps, incoming.id),
        Outcome::Rejected(reason) => {
            debug!(
                letter = incoming.id,
                device = crate::device::short(&incoming.device),
                reason,
                "letter rejected"
            );
            ack(deps, incoming.id);
        }
        // Nothing happened yet: leaving the letter unacknowledged is what lets the relay hand it
        // over again later, and forgetting it is what lets that redelivery be acted on.
        Outcome::Deferred { reason, letter } => {
            deps.seen.forget(&letter).await;
            warn!(
                letter = incoming.id,
                device = crate::device::short(&incoming.device),
                reason,
                "letter left for the relay to redeliver"
            );
        }
    }
}

fn ack(deps: &Deps, id: u64) {
    if deps.relay.try_send(RelayCommand::LetterAck(id)).is_err() {
        warn!(letter = id, "letter ack not queued");
    }
}

/// What became of one letter: accepted means acted on or delivered, rejected means it will never
/// be acted on (so it is acked and forgotten), deferred means nothing happened and it must come
/// back.
enum Outcome {
    Accepted,
    Rejected(&'static str),
    Deferred {
        reason: &'static str,
        letter: String,
    },
}

async fn apply(deps: &Deps, incoming: &Incoming) -> Outcome {
    let (device, opened) = match read(deps, incoming).await {
        Ok(read) => read,
        Err(reason) => return Outcome::Rejected(reason),
    };
    match &opened.body {
        open::Body::Decision {
            backend,
            session,
            request,
            decision,
        } => {
            let answer = apply::decision(deps, backend, session, request.as_ref(), *decision).await;
            let Some(value) = answer else {
                return Outcome::Deferred {
                    reason: "the bridge did not answer the decision",
                    letter: opened.id,
                };
            };
            debug!(
                letter = incoming.id,
                ok = value
                    .get("ok")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
                "decision answered"
            );
            Outcome::Accepted
        }
        open::Body::Bridge { message } => match apply::bridge(deps, &device, message).await {
            apply::Delivery::Failed => Outcome::Deferred {
                reason: "bridge unreachable",
                letter: opened.id,
            },
            delivery => {
                debug!(
                    letter = incoming.id,
                    delivery = delivery.as_str(),
                    "bridge message delivered"
                );
                Outcome::Accepted
            }
        },
    }
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
