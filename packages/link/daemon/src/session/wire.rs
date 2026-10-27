use broski_link_core::{LinkEvent, STREAM_BRIDGE, STREAM_CONTROL};
use serde::Serialize;
use tokio::time::Instant;
use tracing::{debug, warn};

use crate::conn::SendError;
use crate::control::ToDevice;
use crate::device::short;

use super::{close_codes, Actor};

impl Actor {
    pub(super) async fn pump(&mut self) {
        self.drain_events().await;
        self.retry_pending();
        self.transmit();
        self.revoke_pairing();
        self.bridge.flush();
    }

    pub(super) fn send_routes(&mut self) {
        let adverts = self.routes_rx.borrow().clone();
        let message = ToDevice::Routes {
            relay: adverts.relay.as_deref(),
            lan: &adverts.lan,
        };
        if let Some(bytes) = encode(&message) {
            self.push_control(bytes);
        }
    }

    pub(super) fn bridge_ready(&mut self) {
        self.bridge.ready();
        self.send_bridge_status(false);
    }

    pub(super) fn bridge_closed(&mut self, unsent: Vec<Vec<u8>>) {
        if !self.bridge.closed(unsent) {
            warn!(
                device = short(&self.device.id),
                "what the bridge never read does not fit the queue; ending the session"
            );
            self.fail(close_codes::BRIDGE_OVERFLOW);
        }
        self.send_bridge_status(false);
    }

    pub(super) fn lose_connection(&mut self) {
        self.sender = None;
        self.pending_out = None;
        self.link.disconnect();
        if self.detached_at.is_none() {
            self.detached_at = Some(Instant::now());
        }
        self.state.detached();
    }

    async fn drain_events(&mut self) {
        while let Some(event) = self.link.poll_event() {
            match event {
                LinkEvent::Connected { resumed } => {
                    debug!(
                        device = short(&self.device.id),
                        resumed, "session connected"
                    );
                    self.connected();
                }
                LinkEvent::Message { stream, bytes } => {
                    if stream == STREAM_BRIDGE {
                        self.queue_for_bridge(bytes);
                    } else if stream == STREAM_CONTROL {
                        self.control(&bytes).await;
                    }
                }
                LinkEvent::PeerClosed(code) => {
                    debug!(
                        device = short(&self.device.id),
                        code, "device closed the session"
                    );
                    self.fail(close_codes::NORMAL);
                }
                LinkEvent::Dead => self.lose_connection(),
            }
        }
    }

    fn transmit(&mut self) {
        loop {
            if self.sender.is_none() {
                return;
            }
            let frame = match self.pending_out.take() {
                Some(frame) => frame,
                None => match self.link.poll_transmit() {
                    Ok(Some(frame)) => frame,
                    Ok(None) => return,
                    Err(error) => {
                        warn!(error = %error, device = short(&self.device.id), "link seal failed");
                        self.fail(close_codes::SESSION_ERROR);
                        return;
                    }
                },
            };
            match self.sender.as_ref().map(|sender| sender.try_wire(frame)) {
                Some(Ok(())) => {}
                Some(Err(SendError::Full(frame))) => {
                    self.pending_out = Some(frame);
                    return;
                }
                Some(Err(SendError::Closed)) | None => {
                    self.lose_connection();
                    return;
                }
            }
        }
    }

    /// Revokes the pairing device on the machine socket after the pairing reply, so the relay
    /// closes the pairing channel only once the phone holds its real relay token.
    fn revoke_pairing(&mut self) {
        let Some(device) = self.pending_revoke.clone() else {
            return;
        };
        if self.pending_out.is_some() {
            return;
        }
        let Some(sender) = self.sender.as_ref() else {
            return;
        };
        match sender.revoke(device.clone()) {
            Ok(()) => {
                self.pending_revoke = None;
                self.deps.offers.pairing_revoked(&device);
            }
            Err(SendError::Full(_)) => {}
            Err(SendError::Closed) => {
                self.pending_revoke = None;
                self.deps.offers.pairing_unreachable(&device);
            }
        }
    }
}

pub(super) fn encode<T: Serialize>(message: &T) -> Option<Vec<u8>> {
    match serde_json::to_vec(message) {
        Ok(bytes) => Some(bytes),
        Err(error) => {
            warn!(error = %error, "control message not encoded");
            None
        }
    }
}
