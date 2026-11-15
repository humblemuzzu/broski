//! Opening routes: the race between the LAN candidates and the relay (`route_dialer.dart`), and
//! attaching the chosen socket (`link_engine.dart` `_attach`).

use std::time::Duration;

use broski_link_core::crypto::HandshakeMode;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::http::StatusCode;
use tracing::debug;

use super::{Dialed, Engine, Handshake, Purpose, Race};
use crate::close;
use crate::endpoint::Target;
use crate::race::{Choice, RouteRace};
use crate::status::{LinkState, Route, WaitReason};
use crate::transport::{self, DialError, MachinePresence, Presence, Socket, SocketEvent, WsStream};

impl Engine {
    /// Drops whatever the link was doing and races every route again; `only` limits the race to
    /// one route, after a failure on the other.
    pub(super) fn connect(&mut self, only: Option<Route>) {
        if self.finished || self.close.revoked() {
            return;
        }
        self.retry_at = None;
        self.handshake = Handshake::default();
        self.stop_sockets();
        self.detach_link();
        self.set_state(LinkState::Connecting);
        self.start_race(only);
    }

    fn start_race(&mut self, only: Option<Route>) {
        let lan = match only {
            Some(Route::Relay) => Vec::new(),
            _ => self.lan_targets(),
        };
        let relay = match only {
            Some(Route::Lan) => None,
            _ => self.relay_target(),
        };
        let generation = self.next_id();
        self.race = Some(Race {
            generation,
            race: RouteRace::new(lan.len()),
            lan: lan.iter().map(|_| None).collect(),
            relay: None,
            pending: lan.len() + usize::from(relay.is_some()),
            grace_at: None,
            relay_refused: false,
        });
        let timings = self.options.timings;
        for (index, target) in lan.into_iter().enumerate() {
            self.spawn_dial(
                generation,
                Purpose::Lan(index),
                target,
                timings.lan_dial_timeout,
            );
        }
        if let Some(target) = relay {
            self.spawn_dial(
                generation,
                Purpose::Relay,
                target,
                timings.relay_dial_timeout,
            );
        }
        self.settle();
    }

    pub(super) fn spawn_dial(
        &mut self,
        generation: u64,
        purpose: Purpose,
        target: Target,
        within: Duration,
    ) {
        let tls = self.tls.clone();
        self.dials.spawn(async move {
            let result = transport::dial(&target, tls, within).await;
            Dialed {
                generation,
                purpose,
                target,
                result,
            }
        });
    }

    /// A dial of an abandoned race or probe lands here too; dropping its stream closes it.
    pub(super) fn on_dialed(&mut self, dialed: Dialed) {
        if let Err(error) = &dialed.result {
            debug!(route = ?dialed.target.route, detail = %dialed.target.detail, %error, "dial failed");
        }
        if dialed.purpose == Purpose::Probe {
            self.probe_dialed(dialed);
            return;
        }
        let current = self.race.as_ref().map(|race| race.generation);
        if current == Some(dialed.generation) {
            self.race_dialed(dialed);
        }
    }

    fn race_dialed(&mut self, dialed: Dialed) {
        let refused = dialed.purpose == Purpose::Relay
            && self.pairing.is_none()
            && matches!(
                dialed.result,
                Err(DialError::Refused(StatusCode::UNAUTHORIZED))
            );
        let socket = match dialed.result {
            Ok(stream) => Some(self.open_socket(&dialed.target, stream)),
            Err(_) => None,
        };
        if dialed.purpose == Purpose::Relay && socket.is_some() {
            self.refusals.reset();
        }
        let Some(race) = self.race.as_mut() else {
            return;
        };
        race.pending -= 1;
        race.relay_refused |= refused;
        match (dialed.purpose, socket) {
            (Purpose::Lan(index), Some(socket)) => {
                race.lan[index] = Some(socket);
                race.race.lan_opened(index);
            }
            (Purpose::Lan(_), None) => race.race.lan_failed(),
            (_, Some(socket)) => {
                race.relay = Some(socket);
                race.race.relay_opened();
            }
            (_, None) => race.race.relay_failed(),
        }
        self.settle();
    }

    pub(super) fn open_socket(&mut self, target: &Target, stream: WsStream) -> Socket {
        let pairing = self.pairing.is_some() && target.route == Route::Relay;
        let id = self.next_id();
        Socket::spawn(id, target, stream, self.socket_tx.clone(), pairing)
    }

    /// Chooses once the race has a winner, arms the grace window, or gives up when every dial
    /// failed.
    pub(super) fn settle(&mut self) {
        let Some(race) = self.race.as_mut() else {
            return;
        };
        if race.race.choice() != Choice::Wait {
            self.choose();
            return;
        }
        if race.race.awaiting_grace() && race.grace_at.is_none() {
            race.grace_at = Some(Instant::now() + self.options.timings.lan_grace);
        }
        if race.pending == 0 {
            let refused = race.relay_refused;
            self.race = None;
            if refused {
                self.on_relay_refused();
            } else {
                self.on_failure();
            }
        }
    }

    /// The winner becomes the current socket and every loser is closed. A winner that arrives
    /// while the app is paused waits there: a quick resume picks it up instead of dialling again.
    fn choose(&mut self) {
        let Some(mut race) = self.race.take() else {
            return;
        };
        let winner = match race.race.choice() {
            Choice::Lan(index) => race.lan[index].take(),
            Choice::Relay => race.relay.take(),
            Choice::Wait => None,
        };
        drop(race);
        self.current = winner;
        if self.current.is_some() && !self.pause.paused() {
            self.attach();
        }
    }

    /// A LAN socket starts its handshake at once; a relay socket waits until the relay says the
    /// machine is online, because the relay drops what a device sends to a machine it lacks.
    pub(super) fn attach(&mut self) {
        let Some(socket) = self.current.as_ref() else {
            return;
        };
        self.handshake.sent = false;
        if socket.route == Route::Lan {
            self.start_handshake();
            return;
        }
        match socket.presence.map(|presence| presence.machine) {
            Some(MachinePresence::Online) => self.start_handshake(),
            Some(MachinePresence::Offline) => {
                self.set_state(LinkState::Waiting(WaitReason::MachineOffline))
            }
            Some(MachinePresence::Asleep) => {
                self.set_state(LinkState::Waiting(WaitReason::MachineAsleep))
            }
            None => {
                self.handshake.presence_by =
                    Some(Instant::now() + self.options.timings.presence_timeout);
                self.set_state(LinkState::Connecting);
            }
        }
    }

    pub(super) fn start_handshake(&mut self) {
        // The pairing secret is used until a handshake completes, so a socket that dies mid-Pair
        // is retried in Pair mode.
        let mode = match self
            .pairing
            .as_ref()
            .and_then(|pairing| pairing.secret.as_ref())
        {
            Some(secret) => HandshakeMode::Pair { secret: **secret },
            None => HandshakeMode::Connect,
        };
        self.detach_link();
        self.handshake = Handshake {
            sent: true,
            reply_by: Some(Instant::now() + self.options.timings.handshake_timeout),
            presence_by: None,
        };
        self.set_state(LinkState::Connecting);
        match self
            .link
            .connect(self.identity.as_static(), &self.server, mode)
        {
            Ok(msg1) => self.pending_wire = Some(msg1),
            Err(error) => {
                debug!(%error, "msg1 could not be built");
                self.on_failure();
            }
        }
    }

    pub(super) fn on_socket(&mut self, event: SocketEvent) {
        match event {
            SocketEvent::Wire { id, bytes } => {
                if self.handshake.sent && self.is_current(id) {
                    self.handle_wire(&bytes);
                } else if self.is_migration(id) {
                    self.complete_migration(&bytes);
                }
            }
            SocketEvent::Presence { id, presence } => self.on_presence(id, presence),
            SocketEvent::Closed { id, code } => self.on_closed(id, code),
        }
    }

    fn on_presence(&mut self, id: u64, presence: Presence) {
        if let Some(socket) = self.socket_mut(id) {
            socket.presence = Some(presence);
        }
        self.reporter.saw_machine(presence.last_seen_ms);
        if self.pause.paused() || !self.is_current(id) {
            return;
        }
        self.handshake.presence_by = None;
        match presence.machine {
            MachinePresence::Online if !self.handshake.sent => self.start_handshake(),
            MachinePresence::Online => {}
            MachinePresence::Offline => self.machine_gone(WaitReason::MachineOffline),
            MachinePresence::Asleep => self.machine_gone(WaitReason::MachineAsleep),
        }
    }

    fn machine_gone(&mut self, reason: WaitReason) {
        self.detach_link();
        self.handshake = Handshake::default();
        self.set_state(LinkState::Waiting(reason));
    }

    fn on_closed(&mut self, id: u64, code: Option<u16>) {
        if self.is_migration(id) {
            self.abandon_migration();
            return;
        }
        if !self.is_current(id) {
            self.race_socket_closed(id);
            return;
        }
        let revoked = self
            .current
            .as_ref()
            .is_some_and(|socket| socket.route == Route::Relay && !socket.pairing);
        if revoked && code == Some(close::REVOKED) {
            self.close.record(close::REVOKED);
            self.finish(LinkState::Revoked);
        } else if self.pause.paused() {
            self.current = None;
        } else {
            self.on_failure();
        }
    }

    /// A relay socket that dies while it waits out the grace window hands the race back.
    fn race_socket_closed(&mut self, id: u64) {
        let Some(race) = self.race.as_mut() else {
            return;
        };
        if race.relay.as_ref().is_some_and(|socket| socket.id == id) {
            race.relay = None;
            race.race.relay_failed();
            self.settle();
        }
    }

    fn is_current(&self, id: u64) -> bool {
        self.current.as_ref().is_some_and(|socket| socket.id == id)
    }

    fn is_migration(&self, id: u64) -> bool {
        self.migration
            .as_ref()
            .is_some_and(|migration| migration.socket.id == id)
    }

    /// Only relay sockets hear about presence: the current one, or the race's.
    fn socket_mut(&mut self, id: u64) -> Option<&mut Socket> {
        let race = self.race.as_mut().and_then(|race| race.relay.as_mut());
        self.current
            .iter_mut()
            .chain(race)
            .find(|socket| socket.id == id)
    }
}
