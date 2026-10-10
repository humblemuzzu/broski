use std::time::Duration;

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) type EventHandler = Box<dyn Fn(PowerEvent) + Send + 'static>;

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod event_worker;

#[cfg(target_os = "macos")]
#[path = "platform/macos.rs"]
mod platform;
#[cfg(target_os = "linux")]
#[path = "platform/linux.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "platform/windows.rs"]
mod platform;
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
#[path = "platform/unsupported.rs"]
mod platform;

pub use platform::{power_status, AwakeAssertion};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerEvent {
    WillSleep,
    DidWake,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PowerStatus {
    pub on_ac: Option<bool>,
    pub battery_percent: Option<u8>,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("the operating system offers no power management interface here")]
    Unsupported,
    #[error("power management call failed: {0}")]
    Os(String),
}

/// Starts watching system sleep and wake. `on_event` runs on a thread owned by the monitor; while
/// it handles [`PowerEvent::WillSleep`] the OS sleep is held back for at most `sleep_grace`.
/// Dropping the monitor stops it and joins that thread.
pub struct PowerMonitor {
    inner: platform::MonitorInner,
}

impl PowerMonitor {
    pub fn start(
        sleep_grace: Duration,
        on_event: impl Fn(PowerEvent) + Send + 'static,
    ) -> Result<Self, Error> {
        Ok(Self {
            inner: platform::start(sleep_grace, Box::new(on_event))?,
        })
    }
}

impl Drop for PowerMonitor {
    fn drop(&mut self) {
        platform::stop(&mut self.inner);
    }
}
