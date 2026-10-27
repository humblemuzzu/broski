use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::json;
use tokio::sync::{mpsc, watch, Notify};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info, warn};
use zeroize::Zeroizing;

use crate::backoff::{self, Backoff};
use crate::clock;
use crate::letters;
use crate::pairing::Pairing;
use crate::responder::Responder;
use crate::store::Store;

mod commands;
mod session;
mod sync;

pub use commands::{PushRequest, RelayCommand};

use session::Session;
use sync::Sync;

const CLOSE_REPLACED: u16 = 4001;
const BACKOFF_MIN: Duration = Duration::from_millis(500);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
const IDLE_WAKE: Duration = Duration::from_secs(3600);
/// A socket that stayed up this long proved the relay worth trusting, so the next reconnect starts
/// from the shortest wait. Anything shorter — a peer that accepts and immediately closes — leaves
/// the backoff where it was instead of turning it into a permanent retry loop.
const HEALTHY: Duration = Duration::from_secs(30);

struct Inner {
    sync: Notify,
    connected: AtomicBool,
}

#[derive(Clone)]
pub struct RelayHandle {
    inner: Arc<Inner>,
}

impl RelayHandle {
    pub fn connected(&self) -> bool {
        self.inner.connected.load(Ordering::Relaxed)
    }

    /// Wakes the client so it re-publishes the device list; a permit survives a reconnect.
    pub fn refresh(&self) {
        self.inner.sync.notify_one();
    }

    fn set_connected(&self, value: bool) {
        self.inner.connected.store(value, Ordering::Relaxed);
    }
}

pub fn handle() -> RelayHandle {
    RelayHandle {
        inner: Arc::new(Inner {
            sync: Notify::new(),
            connected: AtomicBool::new(false),
        }),
    }
}

pub struct Config {
    pub url: String,
    pub machine_id: String,
    pub secret: Zeroizing<Vec<u8>>,
    pub public: String,
    pub store: Arc<Store>,
    pub responder: Arc<Responder>,
    pub pairing: watch::Receiver<Pairing>,
    pub busy: watch::Receiver<bool>,
    pub letters: mpsc::Sender<letters::Incoming>,
    pub commands: mpsc::Receiver<RelayCommand>,
    pub shutdown: watch::Receiver<bool>,
}

pub fn spawn(config: Config, handle: RelayHandle) -> JoinHandle<()> {
    tokio::spawn(run(config, handle))
}

enum Outcome {
    Stop,
    Lost,
}

enum Event {
    Message(Message),
    Sync,
    Busy,
    Command(RelayCommand),
    Stop,
    Lost,
}

async fn run(mut config: Config, handle: RelayHandle) {
    let mut backoff = Backoff::new(BACKOFF_MIN, BACKOFF_MAX);
    let mut pairing = config.pairing.clone();
    let mut busy = config.busy.clone();
    let mut shutdown = config.shutdown.clone();
    loop {
        let mut session = match session::connect(&config).await {
            Ok(session) => session,
            Err(error) => {
                debug!(error = %error, "relay connect failed");
                handle.set_connected(false);
                tokio::select! {
                    _ = tokio::time::sleep(backoff.next()) => {}
                    _ = shutdown.wait_for(|stopped| *stopped) => return,
                }
                continue;
            }
        };
        let opened = Instant::now();
        handle.set_connected(true);
        info!(relay = %config.url, "relay connected");

        let mut sync = Sync::new();
        let outcome = session_loop(
            &mut session,
            &mut config,
            &handle,
            &mut shutdown,
            &mut sync,
            &mut pairing,
            &mut busy,
        )
        .await;
        session.teardown().await;
        handle.set_connected(false);
        if backoff::healthy(opened, HEALTHY) {
            backoff.reset();
        }
        if let Outcome::Stop = outcome {
            return;
        }
        warn!(relay = %config.url, "relay connection lost");
        tokio::select! {
            _ = tokio::time::sleep(backoff.next()) => {}
            _ = shutdown.wait_for(|stopped| *stopped) => return,
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn session_loop(
    session: &mut Session,
    config: &mut Config,
    handle: &RelayHandle,
    shutdown: &mut watch::Receiver<bool>,
    sync: &mut Sync,
    pairing: &mut watch::Receiver<Pairing>,
    busy: &mut watch::Receiver<bool>,
) -> Outcome {
    if !publish(session, config, sync, pairing).await {
        return Outcome::Lost;
    }
    if !watch_busy(session, busy).await {
        return Outcome::Lost;
    }
    loop {
        let event = {
            let deadline = expiry_deadline(pairing);
            let next = session.stream.next();
            tokio::select! {
                incoming = next => match incoming {
                    Some(Ok(message)) => Event::Message(message),
                    Some(Err(error)) => {
                        debug!(error = %error, "relay socket error");
                        Event::Lost
                    }
                    None => Event::Lost,
                },
                command = config.commands.recv() => match command {
                    Some(command) => Event::Command(command),
                    None => Event::Stop,
                },
                _ = busy.changed() => Event::Busy,
                _ = handle.inner.sync.notified() => Event::Sync,
                _ = pairing.changed() => Event::Sync,
                _ = tokio::time::sleep_until(deadline) => Event::Sync,
                _ = shutdown.wait_for(|stopped| *stopped) => Event::Stop,
            }
        };
        if let Some(outcome) = act(event, session, config, sync, pairing, busy).await {
            return outcome;
        }
    }
}

/// `Some` ends the connection, `None` keeps it.
async fn act(
    event: Event,
    session: &mut Session,
    config: &Config,
    sync: &mut Sync,
    pairing: &watch::Receiver<Pairing>,
    busy: &watch::Receiver<bool>,
) -> Option<Outcome> {
    let lost = Some(Outcome::Lost);
    match event {
        Event::Message(Message::Text(text)) => {
            session.control(&text, &config.responder).await;
            None
        }
        Event::Message(Message::Binary(bytes)) => {
            session.forward(&bytes).await;
            None
        }
        Event::Message(Message::Close(frame)) => {
            let code = frame.as_ref().map(|frame| u16::from(frame.code));
            if code == Some(CLOSE_REPLACED) {
                warn!("relay replaced this machine socket");
            }
            lost
        }
        Event::Message(Message::Ping(_))
        | Event::Message(Message::Pong(_))
        | Event::Message(Message::Frame(_)) => None,
        Event::Sync => (!publish(session, config, sync, pairing).await).then_some(Outcome::Lost),
        Event::Busy => (!watch_busy(session, busy).await).then_some(Outcome::Lost),
        Event::Command(command) => run_command(session, command).await,
        Event::Stop => Some(Outcome::Stop),
        Event::Lost => lost,
    }
}

async fn run_command(session: &mut Session, command: RelayCommand) -> Option<Outcome> {
    let encode_failed = |error| {
        warn!(error = %error, "relay command not encoded");
        None
    };
    match command {
        RelayCommand::Push(request) => match serde_json::to_value(request.message()) {
            Ok(message) => (!session.request(message).await).then_some(Outcome::Lost),
            Err(error) => encode_failed(error),
        },
        RelayCommand::LetterAck(id) => {
            (!session.send(json!({"t": "letter_ack", "id": id})).await).then_some(Outcome::Lost)
        }
        RelayCommand::Sleep { done } => {
            let _ = session.send(json!({"t": "sleep"})).await;
            let _ = done.send(());
            None
        }
    }
}

async fn watch_busy(session: &mut Session, busy: &watch::Receiver<bool>) -> bool {
    session
        .send(json!({"t": "watch", "on": *busy.borrow()}))
        .await
}

async fn publish(
    session: &mut Session,
    config: &Config,
    sync: &mut Sync,
    pairing: &watch::Receiver<Pairing>,
) -> bool {
    let current = pairing.borrow().clone();
    sync.run(session, &config.store, &current, clock::unix_secs())
        .await
}

/// One publish when the active pairing device expires; nothing to wake for otherwise.
fn expiry_deadline(pairing: &watch::Receiver<Pairing>) -> Instant {
    let now = clock::unix_secs();
    match &*pairing.borrow() {
        Pairing::Allowed(device) if !device.expired(now) => {
            Instant::now() + Duration::from_secs(device.expires_at - now)
        }
        _ => Instant::now() + IDLE_WAKE,
    }
}
