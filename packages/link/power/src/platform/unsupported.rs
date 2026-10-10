use std::time::Duration;

use crate::{Error, PowerEvent, PowerStatus};

pub(crate) struct MonitorInner;

pub(crate) fn start(
    _grace: Duration,
    _on_event: Box<dyn Fn(PowerEvent) + Send + 'static>,
) -> Result<MonitorInner, Error> {
    Err(Error::Unsupported)
}

pub(crate) fn stop(_inner: &mut MonitorInner) {}

pub struct AwakeAssertion;

impl AwakeAssertion {
    pub fn acquire(_reason: &str) -> Result<Self, Error> {
        Err(Error::Unsupported)
    }
}

pub fn power_status() -> PowerStatus {
    PowerStatus::default()
}
