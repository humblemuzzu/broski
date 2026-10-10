use std::collections::HashMap;

use tokio::time::Instant;

use crate::device::DeviceRecord;

/// Keeps a `(kind, request|session)` pair from alerting twice inside the window.
pub struct Debounce {
    window: std::time::Duration,
    recent: HashMap<(String, String), Instant>,
}

impl Debounce {
    pub fn new(window: std::time::Duration) -> Debounce {
        Debounce {
            window,
            recent: HashMap::new(),
        }
    }

    /// True when the pair may alert now; a `true` answer remembers it.
    pub fn allow(&mut self, key: (String, String), now: Instant) -> bool {
        self.recent
            .retain(|_, at| now.duration_since(*at) < self.window);
        if self.recent.contains_key(&key) {
            return false;
        }
        self.recent.insert(key, now);
        true
    }
}

/// The devices that must be woken: registered for push, and with no phone attached right now.
pub fn targets(devices: Vec<DeviceRecord>, connected: impl Fn(&str) -> bool) -> Vec<DeviceRecord> {
    devices
        .into_iter()
        .filter(|device| device.push.is_some() && !connected(&device.id))
        .collect()
}
