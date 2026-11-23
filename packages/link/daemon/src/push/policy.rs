use std::collections::HashMap;
use std::time::Duration;

use tokio::time::Instant;

use super::Event;
use crate::device::DeviceRecord;

/// Keeps an alert from being pushed twice: each key is remembered for the time it was given.
#[derive(Default)]
pub struct Debounce {
    until: HashMap<(String, String), Instant>,
}

impl Debounce {
    /// True when the key may alert now; a `true` answer remembers it for `window`.
    pub fn allow(&mut self, key: (String, String), window: Duration, now: Instant) -> bool {
        self.until.retain(|_, until| now < *until);
        if self.until.contains_key(&key) {
            return false;
        }
        self.until.insert(key, now + window);
        true
    }
}

/// The devices an alert goes to: every one registered for push, attached or not, that wants this
/// kind of alert about this session. An attached phone's app hides the alert of the session on its
/// screen; for any other session the alert is the only word the person gets, and a link that
/// looks attached may belong to an app that just went to the background.
pub fn targets(devices: Vec<DeviceRecord>, event: &Event<'_>) -> Vec<DeviceRecord> {
    devices
        .into_iter()
        .filter(|device| {
            device.push.is_some()
                && device
                    .notify
                    .wants(event.kind, event.backend, event.session)
        })
        .collect()
}

/// The devices to tell that a request is over: Android phones, whose handler can drop the
/// notification without showing anything. An iPhone's push always shows, so it is left to clear
/// the alert itself the next time the app opens.
pub fn resolved_targets(devices: Vec<DeviceRecord>) -> Vec<DeviceRecord> {
    devices
        .into_iter()
        .filter(|device| {
            device
                .push
                .as_ref()
                .is_some_and(|push| push.platform == "fcm")
        })
        .collect()
}
