use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::time::Instant;
use tracing::debug;

use crate::backoff::Backoff;
use crate::bridge::{BridgeIn, BridgeLink};
use crate::bridge_status::BridgeMonitor;
use crate::device::short;

use super::Input;

const BACKOFF_MIN: Duration = Duration::from_millis(250);
const BACKOFF_MAX: Duration = Duration::from_secs(5);
const HEALTHY: Duration = Duration::from_secs(30);
const MAX_PENDING_BYTES: usize = 16 * 1024 * 1024;

/// The bridge side of a session: one websocket to the bridge, the messages waiting for it, and
/// the redial schedule when it is down.
pub(super) struct BridgePump {
    socket: PathBuf,
    device_id: String,
    monitor: Arc<BridgeMonitor>,
    name: String,
    link: Option<BridgeLink>,
    backoff: Backoff,
    retry_at: Option<Instant>,
    since: Option<Instant>,
    /// How many times this session's own socket has come up; the phone resyncs on a new one.
    conn: u64,
    pending: VecDeque<Vec<u8>>,
    pending_bytes: usize,
}

impl BridgePump {
    pub(super) fn new(
        socket: PathBuf,
        device_id: String,
        monitor: Arc<BridgeMonitor>,
        name: String,
    ) -> BridgePump {
        BridgePump {
            socket,
            device_id,
            monitor,
            name,
            link: None,
            backoff: Backoff::new(BACKOFF_MIN, BACKOFF_MAX),
            retry_at: None,
            since: None,
            conn: 0,
            pending: VecDeque::new(),
            pending_bytes: 0,
        }
    }

    pub(super) fn name(&self) -> &str {
        &self.name
    }

    /// This session's own socket is through its upgrade, whatever the process-wide monitor says.
    pub(super) fn is_ready(&self) -> bool {
        self.since.is_some()
    }

    pub(super) fn conn(&self) -> u64 {
        self.conn
    }

    pub(super) fn ready(&mut self) {
        self.conn += 1;
        self.since = Some(Instant::now());
        self.retry_at = None;
    }

    pub(super) fn ensure(&mut self) {
        if self.link.is_none() && self.retry_at.is_none() {
            self.dial();
        }
    }

    pub(super) fn retry(&mut self) {
        let Some(at) = self.retry_at else {
            return;
        };
        if Instant::now() < at {
            return;
        }
        self.retry_at = None;
        self.dial();
    }

    /// Takes the socket down and puts back everything it never wrote, oldest first. False when
    /// that overflows the queue bound, which ends the session.
    pub(super) fn closed(&mut self, unsent: Vec<Vec<u8>>) -> bool {
        self.down();
        let total: usize = unsent.iter().map(Vec::len).sum();
        if self.pending_bytes + total > MAX_PENDING_BYTES {
            return false;
        }
        for bytes in unsent.into_iter().rev() {
            self.pending_bytes += bytes.len();
            self.pending.push_front(bytes);
        }
        true
    }

    pub(super) fn down(&mut self) {
        self.link = None;
        if self.retry_at.is_some() {
            return;
        }
        let healthy = self
            .since
            .take()
            .is_some_and(|since| since.elapsed() >= HEALTHY);
        if healthy {
            self.backoff.reset();
        }
        self.retry_at = Some(Instant::now() + self.backoff.next());
    }

    pub(super) fn restart(&mut self, name: String) {
        self.link = None;
        self.retry_at = None;
        self.backoff.reset();
        self.since = None;
        self.name = name;
        self.dial();
    }

    pub(super) fn deadline(&self) -> Option<Instant> {
        self.retry_at
    }

    /// False when the queue is past its byte bound, which ends the session.
    pub(super) fn queue(&mut self, bytes: Vec<u8>) -> bool {
        if self.pending_bytes + bytes.len() > MAX_PENDING_BYTES {
            return false;
        }
        self.pending_bytes += bytes.len();
        self.pending.push_back(bytes);
        true
    }

    pub(super) fn flush(&mut self) {
        // `dial()` returns as soon as the link task is spawned, so a link the pump holds may
        // still be dialling — and may fail. Anything handed to it then dies with it, so the
        // queue only drains into a link that has reported Ready.
        if self.since.is_none() {
            return;
        }
        while let Some(message) = self.pending.pop_front() {
            let len = message.len();
            let Some(link) = self.link.as_ref() else {
                self.pending.push_front(message);
                return;
            };
            match link.tx.try_send(message) {
                Ok(()) => self.pending_bytes -= len,
                Err(mpsc::error::TrySendError::Full(message)) => {
                    self.pending.push_front(message);
                    return;
                }
                // Never written: `closed()` puts the older handed-back messages in front of it.
                Err(mpsc::error::TrySendError::Closed(message)) => {
                    self.pending.push_front(message);
                    self.down();
                    return;
                }
            }
        }
    }

    fn dial(&mut self) {
        if self.link.is_some() {
            return;
        }
        debug!(device = short(&self.device_id), "dialling the bridge");
        self.link = Some(crate::bridge::spawn(
            self.socket.clone(),
            self.device_id.clone(),
            self.name.clone(),
            self.monitor.clone(),
        ));
    }
}

/// Awaits this session's next bridge event; never returns while the read gate is shut or no socket
/// is dialled.
pub(super) async fn input(pump: &mut BridgePump, open: bool) -> Input {
    if !open {
        return std::future::pending().await;
    }
    match pump.link.as_mut() {
        Some(link) => match link.rx.recv().await {
            Some(incoming) => Input::Bridge(incoming),
            None => Input::Bridge(BridgeIn::Closed { unsent: Vec::new() }),
        },
        None => std::future::pending().await,
    }
}
