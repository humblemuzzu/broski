use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use windows_sys::Win32::System::Power::{
    GetSystemPowerStatus, SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    SYSTEM_POWER_STATUS,
};

use crate::{Error, PowerEvent, PowerStatus};

pub(crate) struct MonitorInner;

pub(crate) fn start(
    _grace: Duration,
    _on_event: Box<dyn Fn(PowerEvent) + Send + 'static>,
) -> Result<MonitorInner, Error> {
    Err(Error::Unsupported)
}

pub(crate) fn stop(_inner: &mut MonitorInner) {}

/// Thread execution state is per-thread, so the request has to be held by a thread that outlives
/// the caller.
pub struct AwakeAssertion {
    stop: Arc<(Mutex<bool>, Condvar)>,
    keeper: Option<JoinHandle<()>>,
}

impl AwakeAssertion {
    pub fn acquire(_reason: &str) -> Result<Self, Error> {
        let stop = Arc::new((Mutex::new(false), Condvar::new()));
        let requested = Arc::clone(&stop);
        let keeper = thread::Builder::new()
            .name("broski-power-keep-awake".to_owned())
            .spawn(move || {
                // SAFETY: the execution state belongs to this thread alone.
                unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
                let (lock, condvar) = &*requested;
                let mut stopped = lock.lock().unwrap_or_else(PoisonError::into_inner);
                while !*stopped {
                    stopped = condvar
                        .wait(stopped)
                        .unwrap_or_else(PoisonError::into_inner);
                }
                // SAFETY: same thread, same per-thread execution state.
                unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
            })
            .map_err(|err| Error::Os(format!("cannot spawn the keep-awake thread: {err}")))?;
        Ok(Self {
            stop,
            keeper: Some(keeper),
        })
    }
}

impl Drop for AwakeAssertion {
    fn drop(&mut self) {
        let (lock, condvar) = &*self.stop;
        *lock.lock().unwrap_or_else(PoisonError::into_inner) = true;
        condvar.notify_all();
        if let Some(keeper) = self.keeper.take() {
            let _ = keeper.join();
        }
    }
}

pub fn power_status() -> PowerStatus {
    let mut raw = SYSTEM_POWER_STATUS {
        ACLineStatus: 255,
        BatteryFlag: 0,
        BatteryLifePercent: 255,
        SystemStatusFlag: 0,
        BatteryLifeTime: 0,
        BatteryFullLifeTime: 0,
    };
    // SAFETY: `raw` is a correctly sized and aligned output buffer for the call.
    if unsafe { GetSystemPowerStatus(&mut raw) } == 0 {
        return PowerStatus::default();
    }
    PowerStatus {
        on_ac: match raw.ACLineStatus {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        },
        battery_percent: (raw.BatteryLifePercent <= 100).then_some(raw.BatteryLifePercent),
    }
}
