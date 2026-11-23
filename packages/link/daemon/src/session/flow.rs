use broski_link_core::{Error, STREAM_BRIDGE, STREAM_CONTROL, STREAM_SCREEN};
use tracing::{debug, warn};

use crate::clock;
use crate::device::short;
use crate::limits::{BRIDGE_READ_HIGH, BRIDGE_READ_LOW, SCREEN_READ_HIGH, SCREEN_READ_LOW};

use super::{close_codes, Actor};

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

    pub(super) fn screen_gate_open(&mut self) -> bool {
        let unacked = self.link.unacked_bytes();
        if self.screen_read_open && unacked >= SCREEN_READ_HIGH {
            self.screen_read_open = false;
        } else if !self.screen_read_open && unacked < SCREEN_READ_LOW {
            self.screen_read_open = true;
        }
        self.screen_read_open && self.pending_screen.is_none()
    }

    pub(super) fn queue_for_device(&mut self, bytes: Vec<u8>) {
        if let Err(bytes) = self.try_send(STREAM_BRIDGE, bytes) {
            self.pending_device = Some(bytes);
        }
    }

    pub(super) fn queue_screen_for_device(&mut self, bytes: Vec<u8>) {
        if let Err(bytes) = self.try_send(STREAM_SCREEN, bytes) {
            self.pending_screen = Some(bytes);
        }
    }

    /// Queues one control message behind everything already waiting, so control keeps its order.
    /// False when it was dropped, which is the caller's sign not to record it as sent.
    pub(super) fn push_control(&mut self, bytes: Vec<u8>) -> bool {
        if !self.pending_control.is_empty() {
            return self.park_control(bytes);
        }
        match self.try_send(STREAM_CONTROL, bytes) {
            Ok(()) => true,
            Err(bytes) => self.park_control(bytes),
        }
    }

    /// Hands the link everything it would not take earlier, oldest first.
    pub(super) fn retry_pending(&mut self) {
        while let Some(bytes) = self.pending_control.pop_front() {
            if let Err(bytes) = self.try_send(STREAM_CONTROL, bytes) {
                self.pending_control.push_front(bytes);
                break;
            }
        }
        if let Some(bytes) = self.pending_device.take() {
            if let Err(bytes) = self.try_send(STREAM_BRIDGE, bytes) {
                self.pending_device = Some(bytes);
            }
        }
        if let Some(bytes) = self.pending_screen.take() {
            if let Err(bytes) = self.try_send(STREAM_SCREEN, bytes) {
                self.pending_screen = Some(bytes);
            }
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

    /// One message to the link. `Err` hands the bytes back: they fit later. A message that can
    /// never go out on this session is dropped here, with its size.
    fn try_send(&mut self, stream: u32, bytes: Vec<u8>) -> Result<(), Vec<u8>> {
        match self.link.send(stream, &bytes, clock::now_ms()) {
            Ok(()) => Ok(()),
            Err(error) if retriable(&error) => Err(bytes),
            Err(error) => {
                warn!(
                    error = %error,
                    device = short(&self.device.id),
                    len = bytes.len(),
                    stream,
                    "message dropped"
                );
                Ok(())
            }
        }
    }

    fn park_control(&mut self, bytes: Vec<u8>) -> bool {
        if self.pending_control.len() >= CONTROL_BACKLOG {
            warn!(
                device = short(&self.device.id),
                len = bytes.len(),
                "control backlog is full; a message is lost"
            );
            return false;
        }
        self.pending_control.push_back(bytes);
        true
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
