use std::time::Duration;

use crate::control::Platform;

/// What a session announces in its `hello`, and the windows it runs on.
#[derive(Clone, Debug)]
pub struct SessionOptions {
    /// What the machine lists this phone as; cut to 64 bytes by the daemon.
    pub device_name: String,
    pub platform: Platform,
    pub timings: Timings,
}

impl SessionOptions {
    pub fn new(device_name: impl Into<String>, platform: Platform) -> SessionOptions {
        SessionOptions {
            device_name: device_name.into(),
            platform,
            timings: Timings::default(),
        }
    }
}

/// Every window the session's connection policy runs on. The defaults are the production values;
/// tests shrink them instead of waiting them out.
#[derive(Clone, Copy, Debug)]
pub struct Timings {
    /// How long an open relay socket waits for a LAN candidate to open and win instead.
    pub lan_grace: Duration,
    pub lan_dial_timeout: Duration,
    pub relay_dial_timeout: Duration,
    /// From msg1 to msg2.
    pub handshake_timeout: Duration,
    /// How long an open relay socket waits for the relay to say whether the machine is there.
    pub presence_timeout: Duration,
    /// A socket a dial opened while the app was paused is reused by a resume within this window.
    pub stale_socket: Duration,
    /// How often the LAN candidates are probed while the relay carries the link.
    pub probe_interval: Duration,
    pub probe_timeout: Duration,
    pub backoff_min: Duration,
    pub backoff_max: Duration,
    /// A LAN route discovered again inside this window is not a reason to dial again.
    pub lan_redial_interval: Duration,
    /// How long a pairing waits for the machine's `paired` once its identity was verified.
    pub pairing_confirm: Duration,
    /// How long one address gets to serve the machine's identity during a pairing.
    pub identity_fetch_timeout: Duration,
    /// How long the relay must keep refusing this device's token, with no connection in between,
    /// before the machine is taken to have revoked the device.
    pub relay_refusal_window: Duration,
    pub ping_idle: Duration,
    /// A phone's connection often dies without a word (a cell handoff, Tailscale changing paths).
    pub dead_after: Duration,
    /// How long the link in use gets to answer a ping after the network changed.
    pub network_probe: Duration,
    /// How long a pause waits for the machine to acknowledge what was already sent.
    pub pause_grace: Duration,
}

impl Default for Timings {
    fn default() -> Timings {
        Timings {
            lan_grace: Duration::from_millis(300),
            lan_dial_timeout: Duration::from_secs(4),
            relay_dial_timeout: Duration::from_secs(12),
            handshake_timeout: Duration::from_secs(8),
            presence_timeout: Duration::from_secs(10),
            stale_socket: Duration::from_secs(15),
            probe_interval: Duration::from_secs(15),
            probe_timeout: Duration::from_millis(1500),
            backoff_min: Duration::from_millis(500),
            backoff_max: Duration::from_secs(10),
            lan_redial_interval: Duration::from_secs(2),
            pairing_confirm: Duration::from_secs(20),
            identity_fetch_timeout: Duration::from_millis(1500),
            relay_refusal_window: Duration::from_secs(300),
            ping_idle: Duration::from_secs(5),
            dead_after: Duration::from_secs(15),
            network_probe: Duration::from_secs(4),
            pause_grace: Duration::from_secs(20),
        }
    }
}
