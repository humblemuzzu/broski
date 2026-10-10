use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use broski_link_core::{Accepted, Link, CONFIG};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;
use tracing::debug;
use zeroize::Zeroizing;

use crate::bridge::BridgeIn;
use crate::bridge_status::{BridgeMonitor, BridgeStatus};
use crate::clock;
use crate::conn::ConnSender;
use crate::control::{MachineInfo, ToDevice};
use crate::device::{short, DeviceRecord};
use crate::offers::Offers;
use crate::registry::{Registry, SessionState};
use crate::relay::RelayHandle;
use crate::routes::{Adverts, Routes};
use crate::store::Store;
use crate::supervisor::Supervisor;

mod bridge;
mod peer;
mod wire;

use bridge::BridgePump;

const IDLE_LIMIT: Duration = Duration::from_secs(600);
const SESSION_CLOSE_CODE: u16 = 1000;

pub struct SessionDeps {
    pub machine_id: String,
    pub machine_name: String,
    pub bridge_socket: PathBuf,
    pub monitor: Arc<BridgeMonitor>,
    pub supervisor: Option<Supervisor>,
    pub store: Arc<Store>,
    pub routes: Routes,
    pub offers: Arc<Offers>,
    pub relay: RelayHandle,
    pub shutdown: watch::Receiver<bool>,
}

pub enum SessionCommand {
    Accept {
        accepted: Box<Accepted>,
        sender: ConnSender,
        paired: Option<Zeroizing<String>>,
        pairing_revoke: Option<String>,
        reply: oneshot::Sender<()>,
    },
    Wire {
        conn: u64,
        bytes: Vec<u8>,
    },
    BridgeLetter {
        bytes: Vec<u8>,
        reply: oneshot::Sender<bool>,
    },
    Lost {
        conn: u64,
    },
    Revoke,
}

pub fn spawn(
    device: DeviceRecord,
    state: Arc<SessionState>,
    commands: mpsc::Receiver<SessionCommand>,
    deps: Arc<SessionDeps>,
    registry: Arc<Registry>,
    token: u64,
) {
    let device_id = device.id.clone();
    tokio::spawn(async move {
        Actor::new(device, state, deps, commands).run().await;
        registry.stop_if_token(&device_id, token);
    });
}

enum Input {
    Command(SessionCommand),
    Bridge(BridgeIn),
    BridgeClosed,
    BridgeStatus,
    Routes,
    Timer,
    Shutdown,
}

struct Actor {
    device: DeviceRecord,
    state: Arc<SessionState>,
    deps: Arc<SessionDeps>,
    commands: mpsc::Receiver<SessionCommand>,
    status_rx: watch::Receiver<BridgeStatus>,
    routes_rx: watch::Receiver<Adverts>,
    shutdown: watch::Receiver<bool>,
    link: Link,
    sender: Option<ConnSender>,
    paired: Option<Zeroizing<String>>,
    pairing_revoke: Option<String>,
    pending_revoke: Option<String>,
    bridge: BridgePump,
    last_bridge: Option<BridgeStatus>,
    pending_out: Option<Vec<u8>>,
    detached_at: Option<Instant>,
    fatal: bool,
}

impl Actor {
    fn new(
        device: DeviceRecord,
        state: Arc<SessionState>,
        deps: Arc<SessionDeps>,
        commands: mpsc::Receiver<SessionCommand>,
    ) -> Actor {
        let status_rx = deps.monitor.subscribe();
        let routes_rx = deps.routes.subscribe();
        let shutdown = deps.shutdown.clone();
        let bridge = BridgePump::new(
            deps.bridge_socket.clone(),
            device.id.clone(),
            deps.monitor.clone(),
            device.name.clone(),
        );
        Actor {
            device,
            state,
            deps,
            commands,
            status_rx,
            routes_rx,
            shutdown,
            link: Link::client(CONFIG),
            sender: None,
            paired: None,
            pairing_revoke: None,
            pending_revoke: None,
            bridge,
            last_bridge: None,
            pending_out: None,
            detached_at: Some(Instant::now()),
            fatal: false,
        }
    }

    async fn run(mut self) {
        loop {
            self.pump().await;
            if self.fatal || self.idle_expired() {
                break;
            }
            match self.next().await {
                Input::Command(command) => {
                    if !self.on_command(command).await {
                        break;
                    }
                }
                Input::Bridge(BridgeIn::Ready) => self.bridge.ready(),
                Input::Bridge(BridgeIn::Message(bytes)) => self.queue_for_device(bytes),
                Input::BridgeClosed => self.bridge.down(),
                Input::BridgeStatus => self.send_bridge_status(),
                Input::Routes => self.send_routes(),
                Input::Timer => {
                    self.link.handle_timeout(clock::now_ms());
                    self.bridge.retry();
                }
                Input::Shutdown => break,
            }
        }
        if self.sender.is_some() {
            self.link.close(SESSION_CLOSE_CODE);
            self.pump().await;
        }
        if let Some(sender) = &self.sender {
            sender.close();
        }
        self.state.detached();
        debug!(device = short(&self.device.id), "session closed");
    }

    async fn next(&mut self) -> Input {
        let deadline = self.deadline();
        tokio::select! {
            biased;
            _ = self.shutdown.wait_for(|stopped| *stopped) => Input::Shutdown,
            command = self.commands.recv() => match command {
                Some(command) => Input::Command(command),
                None => Input::Shutdown,
            },
            incoming = bridge::input(&mut self.bridge) => incoming,
            _ = self.status_rx.changed() => Input::BridgeStatus,
            _ = self.routes_rx.changed() => Input::Routes,
            _ = tokio::time::sleep_until(deadline) => Input::Timer,
        }
    }

    fn deadline(&self) -> Instant {
        let mut at = Instant::now() + Duration::from_secs(3600);
        if let Some(deadline) = self.link.poll_timeout() {
            at = at.min(clock::instant(deadline));
        }
        if let Some(retry) = self.bridge.deadline() {
            at = at.min(retry);
        }
        if let Some(detached) = self.detached_at {
            at = at.min(detached + IDLE_LIMIT);
        }
        at
    }

    fn idle_expired(&self) -> bool {
        self.detached_at
            .is_some_and(|detached| detached.elapsed() >= IDLE_LIMIT)
    }

    fn connected(&mut self) {
        if let Some(token) = self.paired.take() {
            let adverts = self.routes_rx.borrow().clone();
            let message = ToDevice::Paired {
                device_id: &self.device.id,
                relay_token: &token,
                machine: machine_info(&self.deps, &adverts),
            };
            if let Some(bytes) = wire::encode(&message) {
                self.push_control(bytes);
            }
            self.pending_revoke = self.pairing_revoke.take();
        }
        self.send_routes();
        self.send_bridge_status();
        self.bridge.ensure();
    }

    async fn on_command(&mut self, command: SessionCommand) -> bool {
        match command {
            SessionCommand::Accept {
                accepted,
                sender,
                paired,
                pairing_revoke,
                reply,
            } => {
                self.accept(*accepted, sender, paired, pairing_revoke);
                let _ = reply.send(());
                true
            }
            SessionCommand::Wire { conn, bytes } => {
                if self.sender.as_ref().map(ConnSender::id) != Some(conn) {
                    return true;
                }
                if let Err(error) = self.link.handle_wire(&bytes, clock::now_ms()) {
                    debug!(error = %error, device = short(&self.device.id), "wire unit rejected");
                    self.lose_connection();
                }
                true
            }
            SessionCommand::BridgeLetter { bytes, reply } => {
                let queued = self.bridge.queue(bytes);
                if queued {
                    self.bridge.ensure();
                    self.bridge.flush();
                }
                let _ = reply.send(queued);
                true
            }
            SessionCommand::Lost { conn } => {
                if self.sender.as_ref().map(ConnSender::id) == Some(conn) {
                    self.lose_connection();
                }
                true
            }
            SessionCommand::Revoke => false,
        }
    }

    /// msg2 for a resume the link accepts, or `None` when the caller must start a fresh session.
    fn resume(&mut self, accepted: &mut Accepted, now: u64) -> Option<Vec<u8>> {
        let matches = accepted
            .resume
            .is_some_and(|resume| self.link.session_id() == Some(resume.session_id));
        if !matches {
            return None;
        }
        match accepted.resume(&mut self.link, now) {
            Ok(msg2) => Some(msg2),
            Err(error) => {
                debug!(error = %error, device = short(&self.device.id), "resume refused, starting fresh");
                None
            }
        }
    }

    fn accept(
        &mut self,
        mut accepted: Accepted,
        sender: ConnSender,
        paired: Option<Zeroizing<String>>,
        pairing_revoke: Option<String>,
    ) {
        let now = clock::now_ms();
        let mut fresh = None;
        let msg2 = match self.resume(&mut accepted, now) {
            Some(msg2) => msg2,
            None => match self.fresh_session(accepted, now) {
                Some((link, msg2)) => {
                    fresh = Some(link);
                    msg2
                }
                None => return,
            },
        };
        self.attach(sender, msg2, fresh, paired, pairing_revoke);
    }

    fn attach(
        &mut self,
        sender: ConnSender,
        msg2: Vec<u8>,
        fresh: Option<Link>,
        paired: Option<Zeroizing<String>>,
        pairing_revoke: Option<String>,
    ) {
        let route = sender.route();
        match sender.try_wire(msg2) {
            Ok(()) => {
                if let Some(link) = fresh {
                    self.link = link;
                }
                self.sender = Some(sender);
                self.paired = paired;
                self.pairing_revoke = pairing_revoke;
                self.detached_at = None;
                self.state.attached(route);
            }
            Err(_) => {
                if fresh.is_none() {
                    self.link.disconnect();
                }
                self.lose_connection();
            }
        }
    }

    fn fresh_session(&mut self, accepted: Accepted, now: u64) -> Option<(Link, Vec<u8>)> {
        let Ok(session_id) = clock::bytes::<16>() else {
            return None;
        };
        let (link, msg2) = match accepted.fresh(CONFIG, session_id, now) {
            Ok(pair) => pair,
            Err(error) => {
                debug!(error = %error, device = short(&self.device.id), "fresh session not started");
                return None;
            }
        };
        Some((link, msg2))
    }
}

fn machine_info<'a>(deps: &'a SessionDeps, adverts: &'a Adverts) -> MachineInfo<'a> {
    MachineInfo {
        id: &deps.machine_id,
        name: &deps.machine_name,
        os: std::env::consts::OS,
        relay: adverts.relay.as_deref(),
        lan: &adverts.lan,
    }
}
