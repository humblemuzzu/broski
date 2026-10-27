use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::{mpsc, Notify};

use crate::conn::Route;
use crate::device::DeviceRecord;
use crate::session::{self, SessionCommand, SessionDeps};

pub const COMMAND_QUEUE: usize = 64;

const ROUTE_NONE: u8 = 0;
const ROUTE_LAN: u8 = 1;
const ROUTE_RELAY: u8 = 2;
/// Set on top of the route so one store publishes both facts: a session keeps the route it was
/// last reached on while it is detached, and `connected` is the bit that flips.
const DETACHED: u8 = 0x80;
const ROUTE_MASK: u8 = !DETACHED;

pub struct SessionState {
    state: AtomicU8,
    revoked: AtomicBool,
    revoke: Notify,
}

impl SessionState {
    fn new() -> Arc<SessionState> {
        Arc::new(SessionState {
            state: AtomicU8::new(ROUTE_NONE | DETACHED),
            revoked: AtomicBool::new(false),
            revoke: Notify::new(),
        })
    }

    pub fn attached(&self, route: Route) {
        let route = match route {
            Route::Lan => ROUTE_LAN,
            Route::Relay { .. } => ROUTE_RELAY,
        };
        self.state.store(route, Ordering::Release);
    }

    pub fn detached(&self) {
        self.state.fetch_or(DETACHED, Ordering::Release);
    }

    pub fn route(&self) -> Option<&'static str> {
        match self.state.load(Ordering::Acquire) & ROUTE_MASK {
            ROUTE_LAN => Some("lan"),
            ROUTE_RELAY => Some("relay"),
            _ => None,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.state.load(Ordering::Acquire) & DETACHED == 0
    }

    /// True from the moment the device is revoked, whatever the actor's command queue is doing.
    pub fn is_revoked(&self) -> bool {
        self.revoked.load(Ordering::Acquire)
    }

    fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
        self.revoke.notify_waiters();
    }

    /// Resolves once the device is revoked. Interest is registered before the flag is read, so a
    /// revocation that lands between the two cannot be missed.
    pub async fn revoked(&self) {
        loop {
            let notified = self.revoke.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.is_revoked() {
                return;
            }
            notified.await;
        }
    }
}

struct Entry {
    commands: mpsc::Sender<SessionCommand>,
    state: Arc<SessionState>,
    token: u64,
}

pub struct LiveSession {
    pub device: String,
    pub route: Option<&'static str>,
    pub connected: bool,
}

/// One session actor per device id; a device never shares another device's session.
pub struct Registry {
    entries: Mutex<HashMap<String, Entry>>,
    next_token: AtomicU64,
}

impl Registry {
    pub fn new() -> Arc<Registry> {
        Arc::new(Registry {
            entries: Mutex::new(HashMap::new()),
            next_token: AtomicU64::new(1),
        })
    }

    pub fn get_or_spawn(
        self: &Arc<Self>,
        device: &DeviceRecord,
        deps: Arc<SessionDeps>,
    ) -> mpsc::Sender<SessionCommand> {
        let mut entries = self.lock();
        if let Some(entry) = entries.get(&device.id) {
            return entry.commands.clone();
        }
        let token = self.next_token.fetch_add(1, Ordering::Relaxed);
        let state = SessionState::new();
        let (commands, receiver) = mpsc::channel(COMMAND_QUEUE);
        entries.insert(
            device.id.clone(),
            Entry {
                commands: commands.clone(),
                state: state.clone(),
                token,
            },
        );
        drop(entries);
        session::spawn(
            device.clone(),
            state,
            receiver,
            deps,
            Arc::clone(self),
            token,
        );
        commands
    }

    /// Stops the session for `device_id`, unless a newer actor already replaced it.
    pub fn stop_if_token(&self, device_id: &str, token: u64) -> bool {
        let mut entries = self.lock();
        if !entries
            .get(device_id)
            .is_some_and(|entry| entry.token == token)
        {
            return false;
        }
        match entries.remove(device_id) {
            Some(entry) => {
                entry.state.revoke();
                true
            }
            None => false,
        }
    }

    pub fn stop(&self, device_id: &str) -> bool {
        let mut entries = self.lock();
        let Some(entry) = entries.remove(device_id) else {
            return false;
        };
        entry.state.revoke();
        true
    }

    pub fn commands(&self, device_id: &str) -> Option<mpsc::Sender<SessionCommand>> {
        self.lock()
            .get(device_id)
            .map(|entry| entry.commands.clone())
    }

    pub fn is_connected(&self, device_id: &str) -> bool {
        self.lock()
            .get(device_id)
            .is_some_and(|entry| entry.state.is_connected())
    }

    pub fn live(&self) -> Vec<LiveSession> {
        self.lock()
            .iter()
            .map(|(device, entry)| LiveSession {
                device: device.clone(),
                route: entry.state.route(),
                connected: entry.state.is_connected(),
            })
            .collect()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        self.entries
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_route_and_connection_are_published_together() {
        let state = SessionState::new();
        assert_eq!(state.route(), None);
        assert!(!state.is_connected());

        state.attached(Route::Relay { channel: 7 });
        assert_eq!(state.route(), Some("relay"));
        assert!(state.is_connected());

        state.detached();
        assert_eq!(
            state.route(),
            Some("relay"),
            "the route outlives the attach"
        );
        assert!(!state.is_connected());

        state.attached(Route::Lan);
        assert_eq!(state.route(), Some("lan"));
        assert!(state.is_connected());
    }

    #[tokio::test]
    async fn a_revocation_wakes_a_waiting_actor() {
        let state = SessionState::new();
        let waiter = {
            let state = state.clone();
            tokio::spawn(async move { state.revoked().await })
        };
        tokio::task::yield_now().await;
        assert!(!waiter.is_finished());
        state.revoke();
        tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .expect("the revocation is seen at once")
            .expect("the waiter runs");
    }
}

#[cfg(test)]
mod revoke_tests {
    use super::*;

    /// The command queue is full, so nothing can be pushed into it: the revocation must still be
    /// visible to the actor, which is what the old `try_send` could not promise.
    #[tokio::test]
    async fn a_revocation_reaches_an_actor_whose_queue_is_full() {
        let registry = Registry::new();
        let state = SessionState::new();
        let (commands, mut held) = mpsc::channel(2);
        assert!(held.try_recv().is_err(), "the queue is empty");
        for _ in 0..2 {
            commands
                .try_send(SessionCommand::Lost { conn: 0 })
                .expect("the queue takes its two slots");
        }
        assert!(
            commands.try_send(SessionCommand::Lost { conn: 0 }).is_err(),
            "the queue is full"
        );
        registry.lock().insert(
            "device".to_owned(),
            Entry {
                commands,
                state: Arc::clone(&state),
                token: 1,
            },
        );
        assert!(registry.stop("device"));
        assert!(state.is_revoked());
        tokio::time::timeout(std::time::Duration::from_secs(1), state.revoked())
            .await
            .expect("the actor is woken");
    }
}
