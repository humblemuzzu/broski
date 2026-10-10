use std::sync::{Arc, Mutex};

use tokio::sync::watch;

pub const UP: &str = "up";
pub const STARTING: &str = "starting";
pub const DOWN: &str = "down";
pub const CRASHED: &str = "crashed";

#[derive(Clone, PartialEq, Eq)]
pub struct BridgeStatus {
    pub state: &'static str,
    pub detail: Option<String>,
}

/// The child process state, when `--bridge-cmd` supervises one.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Supervision {
    /// No `--bridge-cmd`: the daemon only dials a bridge someone else started.
    External,
    Starting,
    Crashed,
}

struct Inner {
    supervision: Supervision,
    live: usize,
    detail: Option<String>,
}

/// One shared view of the bridge for every session and the control socket.
pub struct BridgeMonitor {
    tx: watch::Sender<BridgeStatus>,
    inner: Mutex<Inner>,
}

impl BridgeMonitor {
    pub fn new() -> Arc<BridgeMonitor> {
        let (tx, _rx) = watch::channel(BridgeStatus {
            state: DOWN,
            detail: None,
        });
        Arc::new(BridgeMonitor {
            tx,
            inner: Mutex::new(Inner {
                supervision: Supervision::External,
                live: 0,
                detail: None,
            }),
        })
    }

    pub fn status(&self) -> BridgeStatus {
        self.tx.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<BridgeStatus> {
        self.tx.subscribe()
    }

    pub fn supervised(&self, supervision: Supervision, detail: Option<String>) {
        let mut inner = self.lock();
        inner.supervision = supervision;
        inner.detail = detail;
        self.publish(&inner);
    }

    pub fn opened(&self) {
        let mut inner = self.lock();
        inner.live += 1;
        self.publish(&inner);
    }

    pub fn closed(&self) {
        let mut inner = self.lock();
        inner.live = inner.live.saturating_sub(1);
        self.publish(&inner);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn publish(&self, inner: &Inner) {
        let next = match (inner.live, inner.supervision) {
            (1.., _) => BridgeStatus {
                state: UP,
                detail: None,
            },
            (0, Supervision::External) => BridgeStatus {
                state: DOWN,
                detail: None,
            },
            (0, Supervision::Starting) => BridgeStatus {
                state: STARTING,
                detail: None,
            },
            (0, Supervision::Crashed) => BridgeStatus {
                state: CRASHED,
                detail: inner.detail.clone(),
            },
        };
        self.tx.send_if_modified(|current| {
            if *current == next {
                return false;
            }
            *current = next;
            true
        });
    }
}
