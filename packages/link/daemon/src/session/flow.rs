use broski_link_core::{Error, STREAM_BRIDGE, STREAM_CONTROL};
use tracing::{debug, warn};

use crate::clock;
use crate::device::short;

use super::{close_codes, Actor};

/// The session stops reading its bridge socket at this much unacked, so the link keeps half its
/// window free for control messages.
const BRIDGE_READ_HIGH: usize = 8 * 1024 * 1024;
/// ... and starts again once acks bring the window back down to here.
const BRIDGE_READ_LOW: usize = 4 * 1024 * 1024;
const CONTROL_BACKLOG: usize = 64;

impl Actor {
    /// Hysteresis over the link's unacked window. Not polling the bridge socket is what pushes the
    /// slowness back at the bridge: the reader blocks on a full queue, then the socket buffer fills.
    pub(super) fn gate_open(&mut self) -> bool {
        let unacked = self.link.unacked_bytes();
        if self.read_open && unacked >= BRIDGE_READ_HIGH {
            self.read_open = false;
            debug!(
                device = short(&self.device.id),
                unacked, "bridge read gate shut"
            );
        } else if !self.read_open && unacked < BRIDGE_READ_LOW {
            self.read_open = true;
            debug!(
                device = short(&self.device.id),
                unacked, "bridge read gate open"
            );
        }
        self.read_open && self.pending_device.is_none()
    }

    pub(super) fn queue_for_device(&mut self, bytes: Vec<u8>) {
        match self.link.send(STREAM_BRIDGE, &bytes, clock::now_ms()) {
            Ok(()) => {}
            Err(error) if retriable(&error) => self.pending_device = Some(bytes),
            Err(error) => debug!(
                error = %error,
                device = short(&self.device.id),
                "bridge message dropped"
            ),
        }
    }

    pub(super) fn push_control(&mut self, bytes: Vec<u8>) {
        if self.pending_control.len() >= CONTROL_BACKLOG {
            warn!(
                device = short(&self.device.id),
                "control backlog is full; a message is lost"
            );
            return;
        }
        match self.link.send(STREAM_CONTROL, &bytes, clock::now_ms()) {
            Ok(()) => {}
            Err(error) if retriable(&error) => self.pending_control.push_back(bytes),
            Err(error) => debug!(
                error = %error,
                device = short(&self.device.id),
                "control message dropped"
            ),
        }
    }

    /// Hands the link everything it would not take earlier, oldest first.
    pub(super) fn retry_pending(&mut self) {
        while let Some(bytes) = self.pending_control.pop_front() {
            match self.link.send(STREAM_CONTROL, &bytes, clock::now_ms()) {
                Ok(()) => {}
                Err(error) if retriable(&error) => {
                    self.pending_control.push_front(bytes);
                    break;
                }
                Err(error) => debug!(
                    error = %error,
                    device = short(&self.device.id),
                    "control message dropped"
                ),
            }
        }
        let Some(bytes) = self.pending_device.take() else {
            return;
        };
        match self.link.send(STREAM_BRIDGE, &bytes, clock::now_ms()) {
            Ok(()) => {}
            Err(error) if retriable(&error) => self.pending_device = Some(bytes),
            Err(error) => debug!(
                error = %error,
                device = short(&self.device.id),
                "bridge message dropped"
            ),
        }
    }

    pub(super) fn queue_for_bridge(&mut self, bytes: Vec<u8>) {
        if !self.bridge.queue(bytes) {
            warn!(
                device = short(&self.device.id),
                "the bridge is not draining; ending the session"
            );
            self.fail(close_codes::BRIDGE_OVERFLOW);
        }
    }
}

/// Backpressure and a session that does not exist yet both pass: the message waits and goes out
/// later. `Closed` does not — nothing can go out on a session that is over.
fn retriable(error: &Error) -> bool {
    matches!(
        error,
        Error::NoSession | Error::Proto(broski_link_proto::Error::Backpressure { .. })
    )
}
