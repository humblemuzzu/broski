use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;

use crate::conn::Route;
use crate::device::DeviceRecord;
use crate::session::{self, SessionCommand, SessionDeps};

pub const COMMAND_QUEUE: usize = 64;

const ROUTE_NONE: u8 = 0;
const ROUTE_LAN: u8 = 1;
const ROUTE_RELAY: u8 = 2;

pub struct SessionState {
    route: AtomicU8,
    connected: AtomicBool,
}

impl SessionState {
    fn new() -> Arc<SessionState> {
        Arc::new(SessionState {
            route: AtomicU8::new(ROUTE_NONE),
            connected: AtomicBool::new(false),
        })
    }

    pub fn attached(&self, route: Route) {
        self.route.store(
            match route {
                Route::Lan => ROUTE_LAN,
                Route::Relay { .. } => ROUTE_RELAY,
            },
            Ordering::Relaxed,
        );
        self.connected.store(true, Ordering::Relaxed);
    }

    pub fn detached(&self) {
        self.connected.store(false, Ordering::Relaxed);
    }

    pub fn route(&self) -> Option<&'static str> {
        match self.route.load(Ordering::Relaxed) {
            ROUTE_LAN => Some("lan"),
            ROUTE_RELAY => Some("relay"),
            _ => None,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
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
        if let Some(entry) = entries.remove(device_id) {
            let _ = entry.commands.try_send(SessionCommand::Revoke);
        }
        true
    }

    pub fn stop(&self, device_id: &str) -> bool {
        let mut entries = self.lock();
        let Some(entry) = entries.remove(device_id) else {
            return false;
        };
        let _ = entry.commands.try_send(SessionCommand::Revoke);
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
