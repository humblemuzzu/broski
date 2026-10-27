use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::{mpsc, watch};
use tokio::time::Instant;

pub const UP: &str = "up";
pub const STARTING: &str = "starting";
pub const DOWN: &str = "down";
pub const CRASHED: &str = "crashed";

/// An unsupervised bridge with no socket any more is reported `down` only once it has been gone
/// this long: the daemon's own feed socket redials within a few hundred milliseconds, and a bridge
/// that is there all along must not flicker through `down` while it does.
const DOWN_DEBOUNCE: Duration = Duration::from_millis(750);

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
    gone_since: Option<Instant>,
}

/// The state every handle shares, held apart so the debounce task can outlive the call that
/// started it without the monitor referring to itself.
struct Shared {
    tx: watch::Sender<BridgeStatus>,
    inner: Mutex<Inner>,
}

impl Shared {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn publish(&self, inner: &mut Inner) {
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
        if next.state != DOWN {
            inner.gone_since = None;
        } else if self.tx.borrow().state != DOWN {
            let since = *inner.gone_since.get_or_insert_with(Instant::now);
            if since.elapsed() < DOWN_DEBOUNCE {
                return;
            }
        }
        if *self.tx.borrow() == next {
            return;
        }
        inner.gone_since = None;
        self.tx.send_replace(next);
    }
}

/// One shared view of the bridge for every session and the control socket.
pub struct BridgeMonitor {
    shared: Arc<Shared>,
    confirm: mpsc::Sender<()>,
}

impl BridgeMonitor {
    pub fn new() -> Arc<BridgeMonitor> {
        let (tx, _rx) = watch::channel(BridgeStatus {
            state: DOWN,
            detail: None,
        });
        let shared = Arc::new(Shared {
            tx,
            inner: Mutex::new(Inner {
                supervision: Supervision::External,
                live: 0,
                detail: None,
                gone_since: None,
            }),
        });
        let (confirm, pending) = mpsc::channel(1);
        tokio::spawn(confirm_later(Arc::clone(&shared), pending));
        Arc::new(BridgeMonitor { shared, confirm })
    }

    pub fn status(&self) -> BridgeStatus {
        self.shared.tx.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<BridgeStatus> {
        self.shared.tx.subscribe()
    }

    pub fn supervised(&self, supervision: Supervision, detail: Option<String>) {
        let mut inner = self.shared.lock();
        inner.supervision = supervision;
        inner.detail = detail;
        self.shared.publish(&mut inner);
    }

    pub fn opened(&self) {
        let mut inner = self.shared.lock();
        inner.live += 1;
        self.shared.publish(&mut inner);
    }

    pub fn closed(&self) {
        let mut inner = self.shared.lock();
        inner.live = inner.live.saturating_sub(1);
        self.shared.publish(&mut inner);
        if inner.gone_since.is_some() {
            let _ = self.confirm.try_send(());
        }
    }
}

/// Reports a bridge that is still gone once the debounce window has passed.
async fn confirm_later(shared: Arc<Shared>, mut pending: mpsc::Receiver<()>) {
    while pending.recv().await.is_some() {
        tokio::time::sleep(DOWN_DEBOUNCE).await;
        let mut inner = shared.lock();
        if inner.live == 0 {
            shared.publish(&mut inner);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn a_socket_that_comes_back_does_not_flicker_through_down() {
        let monitor = BridgeMonitor::new();
        monitor.opened();
        assert_eq!(monitor.status().state, UP);

        monitor.closed();
        assert_eq!(
            monitor.status().state,
            UP,
            "the feed is redialling: nothing is reported yet"
        );

        tokio::time::sleep(DOWN_DEBOUNCE / 2).await;
        monitor.opened();
        assert_eq!(monitor.status().state, UP);

        tokio::time::sleep(DOWN_DEBOUNCE).await;
        assert_eq!(
            monitor.status().state,
            UP,
            "a socket came back before the window closed"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_bridge_that_stays_gone_is_reported_down() {
        let monitor = BridgeMonitor::new();
        monitor.opened();
        monitor.closed();
        assert_eq!(monitor.status().state, UP);

        tokio::time::sleep(DOWN_DEBOUNCE + Duration::from_millis(10)).await;
        assert_eq!(monitor.status().state, DOWN);
    }

    #[tokio::test(start_paused = true)]
    async fn a_supervised_child_reports_its_own_state_at_once() {
        let monitor = BridgeMonitor::new();
        monitor.supervised(Supervision::Starting, None);
        assert_eq!(monitor.status().state, STARTING);
        monitor.supervised(Supervision::Crashed, Some("exited".to_owned()));
        assert_eq!(monitor.status().state, CRASHED);
        assert_eq!(monitor.status().detail.as_deref(), Some("exited"));
    }
}
