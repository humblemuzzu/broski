//! What a machine tells the app about itself. The queue holds which things changed, not their
//! values: each event carries the value at the moment it is taken, so it is bounded however long
//! the app leaves it unread.

use std::sync::Arc;

use broski_contract::{BackendDescriptor, BackendId, BackendStatus, CatalogScope};
use broski_link_session::{BridgeStatus, Status};
use tokio::sync::Notify;

use super::state::State;

#[derive(Debug, Clone, PartialEq)]
pub enum MachineEvent {
    StatusChanged {
        status: MachineStatus,
    },
    /// The machine's routes changed: persist `Machine::record()` in place of the stored record. The
    /// event does not carry it: the record holds secrets, which reach the apps only as the opaque
    /// object `record()` returns.
    RecordChanged,
    BackendsChanged {
        backends: Vec<BackendDescriptor>,
    },
    BackendStatusChanged {
        backend: BackendId,
        status: BackendStatus,
    },
    /// The backend's models, commands or modes changed: a screen showing them reads them again.
    CatalogInvalidated {
        backend: BackendId,
        scope: CatalogScope,
    },
}

/// Where a machine stands, for the UI: the link (connecting, connected over the LAN or the relay,
/// waiting and why, revoked), the daemon's bridge socket, and whether the bridge speaks this
/// client's protocol.
#[derive(Debug, Clone, PartialEq)]
pub struct MachineStatus {
    pub link: Status,
    pub bridge: Option<BridgeStatus>,
    pub contract: ContractState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContractState {
    /// No bridge socket has agreed on the protocol yet; requests wait for one.
    Waiting,
    Ready {
        bridge_version: String,
    },
    /// The bridge would not take this phone's `hello`, for the reason it gives here. The client says
    /// it again after a pause that doubles from 1 s to 30 s while the bridge socket lasts; requests
    /// wait as they do while `Waiting`.
    Refused {
        message: String,
    },
    /// The bridge speaks another major; requests fail until a bridge that matches takes the link.
    Incompatible {
        message: String,
    },
}

pub(crate) enum Taken {
    Event(MachineEvent),
    Wait(Arc<Notify>),
    Closed,
}

#[derive(Default)]
pub(crate) struct MachineEvents {
    notify: Arc<Notify>,
    status: bool,
    record: bool,
    backends: bool,
    statuses: Vec<BackendId>,
    invalidated: Vec<(BackendId, CatalogScope)>,
    closed: bool,
}

impl MachineEvents {
    pub(crate) fn status(&mut self) {
        self.status = true;
        self.notify.notify_one();
    }

    pub(crate) fn record(&mut self) {
        self.record = true;
        self.notify.notify_one();
    }

    pub(crate) fn backends(&mut self) {
        self.backends = true;
        self.notify.notify_one();
    }

    pub(crate) fn backend_status(&mut self, backend: BackendId) {
        if !self.statuses.contains(&backend) {
            self.statuses.push(backend);
        }
        self.notify.notify_one();
    }

    pub(crate) fn invalidated(&mut self, backend: BackendId, scope: CatalogScope) {
        if !self.invalidated.contains(&(backend, scope)) {
            self.invalidated.push((backend, scope));
        }
        self.notify.notify_one();
    }

    pub(crate) fn close(&mut self) {
        self.closed = true;
        self.notify.notify_one();
    }
}

/// The next event, read from the state as it is now.
pub(crate) fn take(state: &mut State) -> Taken {
    if std::mem::take(&mut state.events.status) {
        return Taken::Event(MachineEvent::StatusChanged {
            status: state.status(),
        });
    }
    if std::mem::take(&mut state.events.record) {
        return Taken::Event(MachineEvent::RecordChanged);
    }
    if std::mem::take(&mut state.events.backends) {
        if let Some(backends) = state.catalog.backends() {
            return Taken::Event(MachineEvent::BackendsChanged { backends });
        }
    }
    while let Some(backend) = state.events.statuses.pop() {
        if let Some(status) = state.catalog.status_of(backend) {
            return Taken::Event(MachineEvent::BackendStatusChanged { backend, status });
        }
    }
    if let Some((backend, scope)) = state.events.invalidated.pop() {
        return Taken::Event(MachineEvent::CatalogInvalidated { backend, scope });
    }
    if state.events.closed {
        Taken::Closed
    } else {
        Taken::Wait(Arc::clone(&state.events.notify))
    }
}
