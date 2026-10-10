use broski_link_core::{LinkEvent, STREAM_BRIDGE, STREAM_CONTROL};
use serde::Serialize;
use tracing::{debug, warn};

use crate::clock;
use crate::conn::SendError;
use crate::control::ToDevice;
use crate::device::short;

use super::Actor;

impl Actor {
    pub(super) async fn pump(&mut self) {
        self.drain_events().await;
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

    pub(super) fn send_bridge_status(&mut self) {
        let status = self.deps.monitor.status();
        if self.last_bridge.as_ref() == Some(&status) {
            return;
        }
        self.last_bridge = Some(status.clone());
        let message = ToDevice::Bridge {
            state: status.state,
            detail: status.detail.as_deref(),
        };
        if let Some(bytes) = encode(&message) {
            self.push_control(bytes);
        }
    }

    pub(super) fn push_control(&mut self, bytes: Vec<u8>) {
        match self.link.send(STREAM_CONTROL, &bytes, clock::now_ms()) {
            Ok(()) => {}
            Err(error) => {
                debug!(error = %error, device = short(&self.device.id), "control message not queued");
                if backpressure(&error) {
                    self.fatal = true;
                }
            }
        }
    }

    pub(super) fn queue_for_device(&mut self, bytes: Vec<u8>) {
        if let Err(error) = self.link.send(STREAM_BRIDGE, &bytes, clock::now_ms()) {
            debug!(error = %error, device = short(&self.device.id), "bridge message not queued");
            self.fatal = true;
        }
    }

    pub(super) fn lose_connection(&mut self) {
        self.sender = None;
        self.pending_out = None;
        self.link.disconnect();
        if self.detached_at.is_none() {
            self.detached_at = Some(tokio::time::Instant::now());
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
                    self.fatal = true;
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
                        self.fatal = true;
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

    fn queue_for_bridge(&mut self, bytes: Vec<u8>) {
        if !self.bridge.queue(bytes) {
            warn!(
                device = short(&self.device.id),
                "bridge is not draining; dropping the session"
            );
            self.fatal = true;
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

fn backpressure(error: &broski_link_core::Error) -> bool {
    matches!(
        error,
        broski_link_core::Error::Proto(broski_link_proto::Error::Backpressure { .. })
    )
}
