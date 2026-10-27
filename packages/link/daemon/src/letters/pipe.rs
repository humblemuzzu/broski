use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{timeout, Instant};
use tokio_tungstenite::tungstenite::Message;
use tracing::debug;

use crate::device::{short, DeviceRecord};
use crate::link_key::LinkKey;

/// Letters one device's pipe may hold while its socket is being written to.
const QUEUE: usize = 4;
/// How long one letter waits for room in that queue, and then for the socket to take it.
const QUEUE_WAIT: Duration = Duration::from_secs(1);
const SEND_TIMEOUT: Duration = Duration::from_secs(1);

type Entries = Arc<Mutex<HashMap<String, mpsc::Sender<Queued>>>>;

struct Queued {
    message: String,
    reply: oneshot::Sender<bool>,
}

/// One bridge socket per device for the letters that arrive when that device has no live session.
/// The socket is redialled when it dies and closed once nothing has been sent on it for a while,
/// so a burst of letters never opens a socket each.
pub struct Pipes {
    socket: PathBuf,
    key: Arc<LinkKey>,
    dial_timeout: Duration,
    hold: Duration,
    entries: Entries,
}

impl Pipes {
    pub fn new(
        socket: PathBuf,
        key: Arc<LinkKey>,
        dial_timeout: Duration,
        hold: Duration,
    ) -> Arc<Pipes> {
        Arc::new(Pipes {
            socket,
            key,
            dial_timeout,
            hold,
            entries: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// True when the device's own pipe took the message; false leaves the letter to the relay.
    pub async fn send(&self, device: &DeviceRecord, message: &str) -> bool {
        let Some(tx) = self.sender_for(device) else {
            return false;
        };
        let (reply, answer) = oneshot::channel();
        let queued = Queued {
            message: message.to_owned(),
            reply,
        };
        if timeout(QUEUE_WAIT, tx.send(queued)).await.is_err() {
            debug!(device = short(&device.id), "the letter pipe is busy");
            return false;
        }
        matches!(timeout(SEND_TIMEOUT, answer).await, Ok(Ok(true)))
    }

    fn sender_for(&self, device: &DeviceRecord) -> Option<mpsc::Sender<Queued>> {
        let mut entries = self.lock();
        if let Some(tx) = entries.get(&device.id) {
            return Some(tx.clone());
        }
        let (tx, rx) = mpsc::channel(QUEUE);
        entries.insert(device.id.clone(), tx.clone());
        drop(entries);
        tokio::spawn(run(
            self.socket.clone(),
            self.key.clone(),
            device.clone(),
            self.dial_timeout,
            self.hold,
            rx,
            Prune {
                entries: Arc::clone(&self.entries),
                device: device.id.clone(),
                tx: tx.clone(),
            },
        ));
        Some(tx)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, mpsc::Sender<Queued>>> {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

/// Takes this pipe out of the map when it ends, unless a newer one already replaced it.
struct Prune {
    entries: Entries,
    device: String,
    tx: mpsc::Sender<Queued>,
}

impl Drop for Prune {
    fn drop(&mut self) {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if entries
            .get(&self.device)
            .is_some_and(|tx| tx.same_channel(&self.tx))
        {
            entries.remove(&self.device);
        }
    }
}

#[allow(
    clippy::too_many_arguments,
    reason = "one pipe, one set of owned parts: splitting it would only move the arguments"
)]
async fn run(
    socket: PathBuf,
    key: Arc<LinkKey>,
    device: DeviceRecord,
    dial_timeout: Duration,
    hold: Duration,
    mut queue: mpsc::Receiver<Queued>,
    prune: Prune,
) {
    let _prune = prune;
    let Some(mut live) =
        crate::bridge::dial(&socket, &key, &device.id, &device.name, dial_timeout).await
    else {
        while let Some(queued) = queue.recv().await {
            let _ = queued.reply.send(false);
        }
        return;
    };
    let mut idle = Instant::now() + hold;
    loop {
        tokio::select! {
            queued = queue.recv() => match queued {
                Some(queued) => {
                    let taken = live
                        .send(Message::Text(queued.message.clone().into()))
                        .await
                        .is_ok();
                    let _ = queued.reply.send(taken);
                    if !taken {
                        return;
                    }
                    idle = Instant::now() + hold;
                }
                None => return,
            },
            incoming = live.next() => match incoming {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => return,
                Some(Ok(_)) => {}
            },
            _ = tokio::time::sleep_until(idle) => return,
        }
    }
}
