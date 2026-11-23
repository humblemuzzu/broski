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

/// The devices an alert goes to: every one registered for push, attached or not. An attached
/// phone's app hides the alert of the session on its screen; for any other session the alert is the
/// only word the person gets, and a link that looks attached may belong to an app that just went
/// to the background.
pub fn targets(devices: Vec<DeviceRecord>) -> Vec<DeviceRecord> {
    devices
        .into_iter()
        .filter(|device| device.push.is_some())
        .collect()
}
