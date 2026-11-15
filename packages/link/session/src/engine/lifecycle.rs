//! Failure, retry, pause, resume and the end of a session (`link_engine.dart`).

use std::time::Duration;

use broski_link_core::STREAM_CONTROL;
use tokio::time::Instant;

use super::{Command, Engine, Handshake, PushIntent};
use crate::backoff::jitter;
use crate::close;
use crate::error::Error;
use crate::events::{locked, Event};
use crate::outbound::SendFailure;
use crate::status::{LinkState, Route, WaitReason};

/// How long the writer gets to put the phone's CLOSE on the wire when the app closes a session.
const CLOSE_FLUSH: Duration = Duration::from_secs(1);

impl Engine {
    pub(super) async fn on_command(&mut self, command: Option<Command>) {
        match command {
            Some(Command::Pause) => self.pause(),
            Some(Command::Resume) => self.resume(),
            Some(Command::NetworkChanged) => self.reconnect_now(),
            Some(Command::LanDiscovered(routes)) => self.lan_discovered(&routes),
            Some(Command::Push(intent)) => self.set_push(intent),
            Some(Command::Close) => self.close_session().await,
            // Every handle is gone: nobody is left to hear about the session, so it just stops and
            // the machine keeps it for a later resume.
            None => self.finish(LinkState::Closed),
        }
    }

    /// The socket in use failed; the next attempt follows the retry policy.
    pub(super) fn on_failure(&mut self) {
        self.retry_later(WaitReason::Retry);
    }

    /// The relay refused this device's token and no route connected. The retry policy applies as
    /// to any failure; refusals that keep coming for `Timings::relay_refusal_window` end the
    /// session as revoked.
    pub(super) fn on_relay_refused(&mut self) {
        if !self.finished && !self.pause.paused() && self.refusals.refused(Instant::now()) {
            self.finish(LinkState::Revoked);
        } else {
            self.retry_later(WaitReason::RelayRefused);
        }
    }

    fn retry_later(&mut self, reason: WaitReason) {
        if self.finished {
            return;
        }
        if self.pause.paused() {
            self.stop_sockets();
            return;
        }
        self.detach_link();
        self.handshake = Handshake::default();
        let failed = self.current.as_ref().map(|socket| socket.route);
        self.stop_sockets();
        let has_lan = !self.lan_targets().is_empty();
        let has_relay = self.relay_target().is_some();
        let has_route = |route| match route {
            Route::Lan => has_lan,
            Route::Relay => has_relay,
        };
        let retry = self.retry.next(failed, has_route, jitter());
        self.retry_at = Some((Instant::now() + retry.delay, retry.only));
        self.set_state(LinkState::Waiting(reason));
    }

    pub(super) fn on_peer_closed(&mut self, code: u16) {
        self.close.record(code);
        if self.close.revoked() {
            self.finish(LinkState::Revoked);
        } else {
            self.on_failure();
        }
    }

    pub(super) fn reconnect_now(&mut self) {
        if self.finished || self.pause.paused() || self.close.revoked() {
            return;
        }
        self.retry.reset();
        self.connect(None);
    }

    /// The app went to the background. The socket in use is closed so the machine sees the phone
    /// leave and pushes its alerts again; a dial still in flight may finish and wait for a resume.
    fn pause(&mut self) {
        if self.finished || self.pause.paused() {
            return;
        }
        self.pause.pause(Instant::now());
        self.retry_at = None;
        self.handshake = Handshake::default();
        self.detach_link();
        self.current = None;
        self.migration = None;
        self.set_state(LinkState::Waiting(WaitReason::Paused));
    }

    fn resume(&mut self) {
        if self.finished {
            return;
        }
        let Some(fresh) = self.pause.resume(Instant::now()) else {
            return;
        };
        if fresh && self.current.is_some() {
            self.retry.reset();
            self.attach();
        } else if fresh && self.race.is_some() {
            self.retry.reset();
            self.set_state(LinkState::Connecting);
        } else {
            self.reconnect_now();
        }
    }

    fn set_push(&mut self, intent: Option<PushIntent>) {
        self.push = intent;
        if !matches!(self.reporter.state(), LinkState::Connected { .. }) {
            return;
        }
        let message = match &self.push {
            Some(PushIntent::Register { platform, token }) => match self.record.push_key() {
                Ok(key) => crate::control::push_register(*platform, token, &key),
                Err(_) => return,
            },
            Some(PushIntent::Unregister) => crate::control::push_unregister(),
            None => return,
        };
        self.queue_control(message);
    }

    fn queue_control(&mut self, message: Vec<u8>) {
        if let Err(reason) = locked(&self.shared.outbound).push(STREAM_CONTROL, message, None) {
            self.emit_failure(None, reason);
        }
    }

    /// Cancels every dial and closes every socket.
    pub(super) fn stop_sockets(&mut self) {
        self.race = None;
        self.current = None;
        self.migration = None;
    }

    /// The app closed the session: the machine is told with a CLOSE 1000 when a connection can
    /// carry it, so it ends the session instead of keeping it for a resume.
    async fn close_session(&mut self) {
        if self.link.is_connected() {
            self.link.close(close::NORMAL);
            self.transmit();
            if let Some(socket) = self.current.take() {
                socket.shut(CLOSE_FLUSH).await;
            }
        }
        self.finish(LinkState::Closed);
    }

    /// Ends the session for good: nothing dials again and every message still queued is reported.
    pub(super) fn finish(&mut self, state: LinkState) {
        self.finished = true;
        self.retry_at = None;
        self.handshake = Handshake::default();
        self.stop_sockets();
        self.detach_link();
        let dropped = locked(&self.shared.outbound).close();
        for tag in dropped {
            self.emit_failure(tag, SendFailure::Closed);
        }
        if let Some(pairing) = self.pairing.take() {
            pairing.fail(Error::PairingRejected(
                "the session ended before the machine confirmed",
            ));
        }
        self.set_state(state);
    }

    pub(super) fn set_state(&mut self, state: LinkState) {
        self.sync_probe();
        let route = self
            .current
            .as_ref()
            .map(|socket| (socket.route, socket.detail.clone()));
        if let Some(status) = self.reporter.report(state, route, self.close.code()) {
            self.shared.emit(Event::Status(status));
        }
    }
}
