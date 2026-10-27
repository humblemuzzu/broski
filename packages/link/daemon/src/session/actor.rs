use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use broski_link_core::{Accepted, Link, CONFIG};
use tokio::sync::mpsc;
use tokio::time::Instant;
use tracing::debug;
use zeroize::Zeroizing;

use crate::bridge::BridgeIn;
use crate::clock;
use crate::conn::ConnSender;
use crate::control::ToDevice;
use crate::device::{short, DeviceRecord};
use crate::registry::SessionState;

use super::bridge::BridgePump;
use super::{close_codes, machine_info, wire, Actor, Input, SessionCommand, SessionDeps};

impl Actor {
    pub(super) fn new(
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
            deps.dial_timeout,
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
            pending_device: None,
            pending_control: VecDeque::new(),
            read_open: true,
            pending_out: None,
            detached_at: Some(Instant::now()),
            close: None,
        }
    }

    pub(super) async fn run(mut self) {
        loop {
            self.pump().await;
            if self.close.is_some() || self.idle_expired() {
                break;
            }
            match self.next().await {
                Input::Command(command) => {
                    if !self.on_command(command).await {
                        break;
                    }
                }
                Input::Bridge(BridgeIn::Ready) => self.bridge_ready(),
                Input::Bridge(BridgeIn::Message(bytes)) => self.queue_for_device(bytes),
                Input::Bridge(BridgeIn::Closed { unsent }) => self.bridge_closed(unsent),
                Input::BridgeStatus => self.send_bridge_status(false),
                Input::Routes => self.send_routes(),
                Input::Timer => {
                    self.link.handle_timeout(clock::now_ms());
                    self.bridge.retry();
                }
                Input::Shutdown => {
                    self.fail(close_codes::SHUTDOWN);
                    break;
                }
            }
        }
        self.finish().await;
    }

    async fn finish(mut self) {
        let code = self.close.unwrap_or(close_codes::IDLE_EXPIRED);
        if self.sender.is_some() {
            self.link.close(code);
            self.pump().await;
        }
        if let Some(sender) = &self.sender {
            sender.close();
        }
        self.state.detached();
        debug!(device = short(&self.device.id), code, "session closed");
    }

    async fn next(&mut self) -> Input {
        let deadline = self.deadline();
        let read_open = self.gate_open();
        tokio::select! {
            biased;
            _ = self.shutdown.wait_for(|stopped| *stopped) => Input::Shutdown,
            command = self.commands.recv() => match command {
                Some(command) => Input::Command(command),
                None => Input::Shutdown,
            },
            incoming = super::bridge::input(&mut self.bridge, read_open) => incoming,
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
            at = at.min(detached + self.deps.idle_limit);
        }
        at
    }

    fn idle_expired(&self) -> bool {
        self.detached_at
            .is_some_and(|detached| detached.elapsed() >= self.deps.idle_limit)
    }

    pub(super) fn fail(&mut self, code: u16) {
        if self.close.is_none() {
            self.close = Some(code);
        }
    }

    pub(super) fn connected(&mut self) {
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
        // A connection that has just attached knows nothing about this session's bridge socket, so
        // it is told where that socket stands even when nothing changed.
        self.send_bridge_status(true);
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
            SessionCommand::Revoke => {
                self.fail(close_codes::REVOKED);
                false
            }
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
                    // A new session has seen none of this phone's session: nothing queued for the
                    // old one may reach it, and the new one owes the phone a fresh bridge status.
                    self.pending_device = None;
                    self.pending_control.clear();
                    self.last_bridge = None;
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
