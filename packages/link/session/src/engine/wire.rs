//! Driving the `Link`: wire units in, sealed frames and outbound messages out, link events to the
//! app (`link_session_io.dart`).

use broski_link_core::{LinkEvent, STREAM_BRIDGE, STREAM_CONTROL};
use tokio::sync::mpsc::error::TrySendError;
use tracing::debug;

use super::{Engine, Handshake, LiveActivityIntent, PushIntent};
use crate::control::{self, FromMachine, Malformed};
use crate::events::{locked, Event};
use crate::outbound::SendFailure;
use crate::status::LinkState;
use crate::transport::Socket;

impl Engine {
    /// One whole wire unit: msg2 first, then one sealed frame each.
    pub(super) fn handle_wire(&mut self, bytes: &[u8]) {
        if let Err(error) = self.link.handle_wire(bytes, self.now_ms()) {
            debug!(%error, "wire unit rejected");
            self.on_failure();
            return;
        }
        self.drain_link();
    }

    /// Messages received before a close or a dead peer are still delivered: they arrived.
    pub(super) fn drain_link(&mut self) {
        while let Some(event) = self.link.poll_event() {
            match event {
                LinkEvent::Connected { resumed } => self.on_connected(resumed),
                LinkEvent::Message { stream, bytes } => self.deliver(stream, bytes),
                LinkEvent::PeerClosed(code) => self.on_peer_closed(code),
                LinkEvent::Dead => self.on_failure(),
            }
            if self.finished {
                return;
            }
        }
    }

    /// `resumed = false` after an earlier session means the machine started a new one: every
    /// message queued for the old one is dropped and reported, and the status says so.
    fn on_connected(&mut self, resumed: bool) {
        let reset = !resumed && self.has_session;
        self.has_session = true;
        if let Some(pairing) = self.pairing.as_mut() {
            pairing.secret = None;
        }
        let dropped = self.ready_outbound(reset);
        for tag in dropped {
            self.emit_failure(tag, SendFailure::SessionReset);
        }
        self.handshake = Handshake {
            sent: true,
            ..Handshake::default()
        };
        self.retry.reset();
        self.refusals.reset();
        let session_reset = self.close.take_resync(reset);
        self.set_state(LinkState::Connected {
            resumed,
            session_reset,
        });
    }

    /// Opens the outbound queue with this phone's `hello` and push registration in front.
    fn ready_outbound(&mut self, reset: bool) -> Vec<Option<String>> {
        let push = match &self.push {
            Some(PushIntent::Register { platform, token }) => match self.record.push_key() {
                Ok(key) => Some(control::push_register(*platform, token, &key)),
                Err(_) => None,
            },
            Some(PushIntent::Unregister) => Some(control::push_unregister()),
            None => None,
        };
        let live_activity = match &self.live_activity {
            Some(LiveActivityIntent::Register { token }) => {
                Some(control::live_activity_register(token))
            }
            Some(LiveActivityIntent::Unregister) => Some(control::live_activity_unregister()),
            None => None,
        };
        let notify = self.notify.as_ref().map(control::notify_prefs);
        let hello = control::hello(&self.options.device_name, self.options.platform);
        let mut outbound = locked(&self.shared.outbound);
        let dropped = if reset { outbound.reset() } else { Vec::new() };
        if let Some(notify) = notify {
            outbound.push_front(STREAM_CONTROL, notify);
        }
        if let Some(live_activity) = live_activity {
            outbound.push_front(STREAM_CONTROL, live_activity);
        }
        if let Some(push) = push {
            outbound.push_front(STREAM_CONTROL, push);
        }
        outbound.push_front(STREAM_CONTROL, hello);
        outbound.set_ready(true);
        dropped
    }

    fn deliver(&mut self, stream: u32, bytes: Vec<u8>) {
        match stream {
            STREAM_BRIDGE => self.shared.emit(Event::Bridge(bytes)),
            STREAM_CONTROL => match control::parse(&bytes) {
                Ok(Some(FromMachine::Paired(paired))) => self.on_paired(paired),
                Ok(Some(FromMachine::Routes(routes))) => self.on_routes(routes),
                Ok(Some(FromMachine::Bridge(status))) => {
                    self.shared.emit(Event::BridgeStatus(status))
                }
                Ok(None) => {}
                Err(Malformed(reason)) => debug!(reason, "control message refused"),
            },
            _ => debug!(stream, "message on an unknown stream"),
        }
    }

    /// Pumps the outbound queue into the link while it has a transport, then hands every sealed
    /// frame to the current socket's writer.
    pub(super) fn flush(&mut self) {
        if self.link.is_connected() {
            let now = self.now_ms();
            let link = &mut self.link;
            let rejected =
                locked(&self.shared.outbound).pump(|stream, bytes| link.send(stream, bytes, now));
            for tag in rejected {
                self.emit_failure(tag, SendFailure::Rejected);
            }
        }
        self.transmit();
    }

    /// A frame the writer has no room for waits in `pending_wire`: it is already sealed, so it
    /// must go out next and cannot be dropped.
    pub(super) fn transmit(&mut self) {
        let Some(writer) = self.current.as_ref().and_then(Socket::out).cloned() else {
            return;
        };
        loop {
            let frame = match self.pending_wire.take() {
                Some(frame) => frame,
                None => match self.link.poll_transmit() {
                    Ok(Some(frame)) => frame,
                    Ok(None) => return,
                    Err(error) => {
                        debug!(%error, "frame could not be sealed");
                        self.on_failure();
                        return;
                    }
                },
            };
            match writer.try_send(frame) {
                Ok(()) => {}
                Err(TrySendError::Full(frame)) => {
                    self.pending_wire = Some(frame);
                    return;
                }
                // The writer is gone; the reader reports the socket closed.
                Err(TrySendError::Closed(_)) => return,
            }
        }
    }

    /// The connection is gone; the link keeps its session for the next resume, and the outbound
    /// queue holds everything until a handshake completes.
    pub(super) fn detach_link(&mut self) {
        self.link.disconnect();
        self.pending_wire = None;
        locked(&self.shared.outbound).set_ready(false);
    }

    pub(super) fn emit_failure(&self, tag: Option<String>, reason: SendFailure) {
        self.shared.emit(Event::SendFailed { tag, reason });
    }
}
