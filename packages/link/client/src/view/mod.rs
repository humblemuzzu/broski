//! Session views: the chat screen's data, kept by the contract's reducer in Rust and handed to the UI
//! as a whole snapshot when it must start over and as bounded change records otherwise.

pub(crate) mod changes;
pub(crate) mod queue;
pub(crate) mod stream;
#[cfg(test)]
mod stream_tests;
#[cfg(test)]
mod tests;

use std::sync::Arc;

use broski_contract::{SessionCapabilities, SessionRef, SessionSnapshot, SessionStatus};
use tokio::time::Instant;

pub use self::changes::SessionChange;
use self::queue::Take;
use crate::machine::Machine;
use crate::wait;

/// What a session view hands the UI, in order.
#[derive(Debug, Clone, PartialEq)]
pub enum SessionUpdate {
    /// Start over from this state: the first update, and after a resync, a replacement followed, or
    /// a reattach the bridge answered with a snapshot. `session` is the session viewed now.
    Reset {
        session: SessionRef,
        capabilities: SessionCapabilities,
        snapshot: SessionSnapshot,
        status: SessionStatus,
    },
    /// Apply in order; then the UI's state equals the view's `snapshot()` at the moment the batch was
    /// taken. At most 30 batches a second.
    Changes {
        changes: Vec<SessionChange>,
        status: SessionStatus,
    },
    /// Nothing follows.
    Ended { reason: ViewEnd },
}

/// Why a view ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ViewEnd {
    /// The session was deleted.
    Removed,
    /// The bridge would not attach the session.
    Refused { message: String },
    /// The machine was closed or forgotten.
    Closed,
    /// The machine revoked this phone.
    Revoked,
}

/// One screen's view of a session. It stays attached, and attaches again after a link that
/// started over, until it is closed or dropped; the last view of a session detaches it.
pub struct SessionView {
    machine: Arc<Machine>,
    subscriber: u64,
}

impl SessionView {
    pub(crate) fn new(machine: Arc<Machine>, subscriber: u64) -> SessionView {
        SessionView {
            machine,
            subscriber,
        }
    }

    /// The next update; `None` once the view has ended or was closed. One reader at a time.
    pub async fn next_update(&self) -> Option<SessionUpdate> {
        loop {
            let (take, notify) = self
                .machine
                .shared()
                .lock()
                .streams
                .take(self.subscriber, Instant::now());
            match take {
                Take::Update(update) => return Some(update),
                Take::Finished => return None,
                Take::Wait(deadline) => {
                    wait::notified(self.machine.shared().runtime(), &notify, deadline).await;
                }
            }
        }
    }

    /// The live state now, once the session has been attached.
    pub fn snapshot(&self) -> Option<SessionSnapshot> {
        let state = self.machine.shared().lock();
        let stream = state.streams.read(self.subscriber)?;
        stream.capabilities().map(|_| stream.snapshot().clone())
    }

    /// The session viewed now, which a replacement changes.
    pub fn session(&self) -> Option<SessionRef> {
        let state = self.machine.shared().lock();
        state
            .streams
            .read(self.subscriber)
            .map(|stream| stream.session().clone())
    }

    pub fn capabilities(&self) -> Option<SessionCapabilities> {
        let state = self.machine.shared().lock();
        state.streams.read(self.subscriber)?.capabilities().cloned()
    }

    /// Stops the view; dropping it does the same.
    pub fn close(&self) {
        self.machine.leave_view(self.subscriber);
    }
}

impl Drop for SessionView {
    fn drop(&mut self) {
        self.close();
    }
}
