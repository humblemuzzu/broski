use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use objc2_core_foundation::{
    kCFRunLoopDefaultMode, CFArray, CFDictionary, CFNumber, CFRetained, CFRunLoop, CFRunLoopSource,
    CFString, CFType,
};
use objc2_io_kit::{
    io_connect_t, io_object_t, io_service_t, kIOMessageCanSystemSleep,
    kIOMessageSystemHasPoweredOn, kIOMessageSystemWillSleep, kIOPMAssertionLevelOn,
    kIOReturnSuccess, IOAllowPowerChange, IODeregisterForSystemPower, IONotificationPort,
    IONotificationPortRef, IOPMAssertionCreateWithName, IOPMAssertionDeclareUserActivity,
    IOPMAssertionID, IOPMAssertionRelease, IOPMUserActiveType, IOPSCopyPowerSourcesInfo,
    IOPSCopyPowerSourcesList, IOPSGetPowerSourceDescription, IORegisterForSystemPower,
    IOServiceClose,
};

use crate::event_worker::{self, Notification};
use crate::{Error, EventHandler, PowerEvent, PowerStatus};

const ASSERTION_TYPE_PREVENT_USER_IDLE_SYSTEM_SLEEP: &str = "PreventUserIdleSystemSleep";
const POWER_SOURCE_STATE_KEY: &str = "Power Source State";
const CURRENT_CAPACITY_KEY: &str = "Current Capacity";
const MAX_CAPACITY_KEY: &str = "Max Capacity";
const SOURCE_TYPE_KEY: &str = "Type";
const INTERNAL_BATTERY_TYPE: &str = "InternalBattery";
const AC_POWER_VALUE: &str = "AC Power";
const RUN_PASS: Duration = Duration::from_millis(500);

pub(crate) struct MonitorInner {
    notify: Option<mpsc::Sender<Notification>>,
    run_loop: Arc<AtomicPtr<CFRunLoop>>,
    stopped: Arc<AtomicBool>,
    monitor: Option<JoinHandle<()>>,
    worker: Option<JoinHandle<()>>,
}

struct Shared {
    connection: AtomicU32,
    notify: mpsc::Sender<Notification>,
    grace: Duration,
}

pub(crate) fn start(grace: Duration, on_event: EventHandler) -> Result<MonitorInner, Error> {
    let (notify, worker) = event_worker::spawn(on_event)
        .map_err(|err| Error::Os(format!("cannot spawn the power event thread: {err}")))?;

    let run_loop = Arc::new(AtomicPtr::new(ptr::null_mut()));
    let stopped = Arc::new(AtomicBool::new(false));
    let (setup_tx, setup_rx) = mpsc::sync_channel::<Result<(), Error>>(1);
    let monitor = thread::Builder::new()
        .name("broski-power-monitor".to_owned())
        .spawn({
            let run_loop = Arc::clone(&run_loop);
            let stopped = Arc::clone(&stopped);
            let notify = notify.clone();
            move || watch(notify, grace, run_loop, stopped, setup_tx)
        })
        .map_err(|err| Error::Os(format!("cannot spawn the power monitor thread: {err}")))?;

    setup_rx.recv().map_err(|_| {
        Error::Os("the power monitor thread stopped before it was watching".to_owned())
    })??;

    Ok(MonitorInner {
        notify: Some(notify),
        run_loop,
        stopped,
        monitor: Some(monitor),
        worker: Some(worker),
    })
}

pub(crate) fn stop(inner: &mut MonitorInner) {
    // Set before the swap/stop: CFRunLoopStop does nothing when the loop is not yet running, so
    // the flag is what makes a stop that lands in that window reach the monitor thread.
    inner.stopped.store(true, Ordering::Release);
    let run_loop = inner.run_loop.swap(ptr::null_mut(), Ordering::Acquire);
    if !run_loop.is_null() {
        // SAFETY: the monitor thread holds its CFRunLoop alive until its run-loop passes end, and
        // only this call can wake it early.
        unsafe {
            (*run_loop).stop();
            (*run_loop).wake_up();
        }
    }
    drop(inner.notify.take());
    if let Some(monitor) = inner.monitor.take() {
        let _ = monitor.join();
    }
    if let Some(worker) = inner.worker.take() {
        let _ = worker.join();
    }
}

fn watch(
    notify: mpsc::Sender<Notification>,
    grace: Duration,
    run_loop: Arc<AtomicPtr<CFRunLoop>>,
    stopped: Arc<AtomicBool>,
    setup: mpsc::SyncSender<Result<(), Error>>,
) {
    let shared = Box::new(Shared {
        connection: AtomicU32::new(0),
        notify,
        grace,
    });

    let Some(current) = CFRunLoop::current() else {
        let _ = setup.send(Err(Error::Os(
            "the power monitor thread has no run loop".to_owned(),
        )));
        return;
    };
    let registration = match register(&shared, &current) {
        Ok(registration) => registration,
        Err(err) => {
            let _ = setup.send(Err(err));
            return;
        }
    };
    run_loop.store(CFRetained::as_ptr(&current).as_ptr(), Ordering::Release);
    let _ = setup.send(Ok(()));

    // Short passes, each rechecking the flag: `CFRunLoop::run` never returns if a stop lands
    // before it starts, which would hang the drop that joins this thread. RunInMode returns for
    // the flag check, a source event (sleep/wake, delivered without extra latency) or the timeout.
    let mode = unsafe { kCFRunLoopDefaultMode };
    while !stopped.load(Ordering::Acquire) {
        CFRunLoop::run_in_mode(mode, RUN_PASS.as_secs_f64(), false);
    }

    // SAFETY: released here and nowhere else.
    unsafe { registration.release() };
}

/// Joins IOKit's system-power notifications to `run_loop`, with `shared` as the callback's refcon.
fn register(shared: &Shared, run_loop: &CFRunLoop) -> Result<Registration, Error> {
    let refcon = ptr::from_ref(shared).cast_mut().cast::<c_void>();
    // SAFETY: `refcon` points at `shared`, which outlives this function.
    let registration = unsafe { Registration::take(refcon) }?;
    // The callback cannot run before the source below joins a running run loop, so it always sees a
    // stored connection.
    shared
        .connection
        .store(registration.connection, Ordering::Release);
    if let Err(err) = add_notification_source(&registration, run_loop) {
        // SAFETY: released here and nowhere else.
        unsafe { registration.release() };
        return Err(err);
    }
    Ok(registration)
}

fn add_notification_source(registration: &Registration, run_loop: &CFRunLoop) -> Result<(), Error> {
    // SAFETY: the registration is live and not yet released.
    let Some(source) = (unsafe { registration.run_loop_source() }) else {
        return Err(Error::Os(
            "the power notification port has no run loop source".to_owned(),
        ));
    };
    // SAFETY: reading CoreFoundation's own default mode constant.
    let mode = unsafe { kCFRunLoopDefaultMode };
    run_loop.add_source(Some(&source), mode);
    Ok(())
}

struct Registration {
    connection: io_connect_t,
    port: IONotificationPortRef,
    notifier: io_object_t,
}

impl Registration {
    /// # Safety
    ///
    /// `refcon` must point at a `Shared` that outlives the registration, and IOKit must be able to
    /// call `on_power_message` on it.
    unsafe fn take(refcon: *mut c_void) -> Result<Self, Error> {
        let mut port: IONotificationPortRef = ptr::null_mut();
        let mut notifier: io_object_t = 0;
        // SAFETY: forwarded from the caller, and the callback has the IOServiceInterestCallback
        // shape.
        let connection = unsafe {
            IORegisterForSystemPower(refcon, &mut port, Some(on_power_message), &mut notifier)
        };
        if connection == 0 {
            return Err(Error::Os(
                "IORegisterForSystemPower returned no connection".to_owned(),
            ));
        }
        Ok(Self {
            connection,
            port,
            notifier,
        })
    }

    /// # Safety
    ///
    /// `self` must come from `take` and must not have been released.
    unsafe fn run_loop_source(&self) -> Option<CFRetained<CFRunLoopSource>> {
        // SAFETY: forwarded from the caller.
        unsafe { IONotificationPort::run_loop_source(self.port) }
    }

    /// # Safety
    ///
    /// `self` must come from `take`. Consuming `self` is what keeps this to once.
    unsafe fn release(mut self) {
        // SAFETY: forwarded from the caller.
        unsafe {
            IODeregisterForSystemPower(&mut self.notifier);
            IONotificationPort::destroy(self.port);
        }
        IOServiceClose(self.connection);
    }
}

/// # Safety
///
/// `refcon` must come from a live `IORegisterForSystemPower` call, and the other arguments are
/// IOKit's.
#[allow(non_upper_case_globals)]
unsafe extern "C-unwind" fn on_power_message(
    refcon: *mut c_void,
    _service: io_service_t,
    message: u32,
    argument: *mut c_void,
) {
    // SAFETY: the refcon registered alongside this callback points at a `Shared` that lives until
    // the registration is torn down, which happens after the run loop that calls us.
    let shared = unsafe { &*refcon.cast::<Shared>() };
    match message {
        kIOMessageCanSystemSleep => {}
        kIOMessageSystemWillSleep => {
            event_worker::report(&shared.notify, PowerEvent::WillSleep, shared.grace);
        }
        kIOMessageSystemHasPoweredOn => {
            event_worker::report(&shared.notify, PowerEvent::DidWake, shared.grace);
            return;
        }
        _ => return,
    }
    IOAllowPowerChange(shared.connection.load(Ordering::Acquire), argument as isize);
}

pub struct AwakeAssertion {
    id: IOPMAssertionID,
}

impl AwakeAssertion {
    pub fn acquire(reason: &str) -> Result<Self, Error> {
        let kind = CFString::from_str(ASSERTION_TYPE_PREVENT_USER_IDLE_SYSTEM_SLEEP);
        let name = CFString::from_str(reason);
        let mut id: IOPMAssertionID = 0;
        // SAFETY: both strings outlive the call, and `id` is written only on success.
        let status = unsafe {
            IOPMAssertionCreateWithName(Some(&kind), kIOPMAssertionLevelOn, Some(&name), &mut id)
        };
        if status != kIOReturnSuccess {
            return Err(Error::Os(format!(
                "IOPMAssertionCreateWithName reported {status}"
            )));
        }
        Ok(Self { id })
    }
}

impl Drop for AwakeAssertion {
    fn drop(&mut self) {
        IOPMAssertionRelease(self.id);
    }
}

/// Lights a sleeping display without requiring elevated privileges (equivalent to `caffeinate -u`).
pub fn wake_display(reason: &str) -> Result<(), Error> {
    let name = CFString::from_str(reason);
    let mut id: IOPMAssertionID = 0;
    // SAFETY: `name` outlives the call, and `id` is written only on success.
    let status = unsafe {
        IOPMAssertionDeclareUserActivity(Some(&name), IOPMUserActiveType::Local, &mut id)
    };
    if status != kIOReturnSuccess {
        return Err(Error::Os(format!(
            "IOPMAssertionDeclareUserActivity reported {status}"
        )));
    }
    Ok(())
}

pub fn power_status() -> PowerStatus {
    let Some(snapshot) = IOPSCopyPowerSourcesInfo() else {
        return PowerStatus::default();
    };
    // SAFETY: returns a +1 CFArray over the snapshot, which CFRetained then owns.
    let Some(sources) = (unsafe { IOPSCopyPowerSourcesList(Some(&snapshot)) }) else {
        return PowerStatus::default();
    };
    // SAFETY: the list holds CFTypeRefs.
    let sources: &CFArray<CFType> = unsafe { sources.cast_unchecked() };
    sources
        .iter()
        .find_map(|source| source_status(&snapshot, &source))
        .unwrap_or_default()
}

fn source_status(snapshot: &CFType, source: &CFType) -> Option<PowerStatus> {
    // SAFETY: `source` came out of the list copied from `snapshot`.
    let description = unsafe { IOPSGetPowerSourceDescription(Some(snapshot), Some(source)) }?;
    if string_value(&description, SOURCE_TYPE_KEY)?.as_str() != INTERNAL_BATTERY_TYPE {
        return None;
    }
    let on_ac =
        string_value(&description, POWER_SOURCE_STATE_KEY).map(|state| state == AC_POWER_VALUE);
    let current = number_value(&description, CURRENT_CAPACITY_KEY);
    let maximum = number_value(&description, MAX_CAPACITY_KEY);
    let battery_percent = match (current, maximum) {
        (Some(current), Some(maximum)) if maximum > 0 => {
            u8::try_from((current * 100 / maximum).clamp(0, 100)).ok()
        }
        _ => None,
    };
    Some(PowerStatus {
        on_ac,
        battery_percent,
    })
}

fn string_value(description: &CFDictionary, key: &str) -> Option<String> {
    let value = dictionary_value(description, key)?;
    Some(value.downcast::<CFString>().ok()?.to_string())
}

fn number_value(description: &CFDictionary, key: &str) -> Option<i64> {
    let value = dictionary_value(description, key)?;
    value.downcast::<CFNumber>().ok()?.as_i64()
}

fn dictionary_value(description: &CFDictionary, key: &str) -> Option<CFRetained<CFType>> {
    // SAFETY: `IOPSGetPowerSourceDescription` returns a dictionary keyed by CFStrings.
    let description: &CFDictionary<CFString, CFType> = unsafe { description.cast_unchecked() };
    description.get(&CFString::from_str(key))
}
